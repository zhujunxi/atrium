/**
 * Background service worker：高清网站图标解析。
 * 复刻原 Next 项目 /api/favicon 的核心逻辑——抓取目标站首页 HTML，
 * 解析 <link rel="...icon..."> 候选，按清晰度打分，返回最优图标 URL。
 * 扩展页配合 host_permissions <all_urls>，可直接跨站抓取无 CORS 限制。
 */

const TIMEOUT_MS = 5000;
const UA = "Mozilla/5.0 (compatible; favicon-fetcher)";
const cache = new Map<string, { at: number; iconUrl: string | null }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

async function fetchText(url: URL): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "user-agent": UA },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 HTML 解析所有图标候选并按清晰度打分排序：
 *  apple-touch-icon（通常 180x180）> SVG（矢量可缩放）> sizes 声明的大尺寸 > 无声明 */
function iconCandidatesFromHtml(html: string, base: URL): string[] {
  const scored: { url: string; score: number }[] = [];
  const tagRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!/icon/i.test(rel)) continue;
    let href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    if (href.startsWith("//")) href = base.protocol + href;
    else if (href.startsWith("/")) href = base.origin + href;
    else if (!/^https?:\/\//i.test(href)) href = base.origin + "/" + href;
    const u = safeUrl(href);
    if (!u) continue;
    // 混合内容：扩展页为 https，http 图标会被拦截，升级为 https
    if (u.protocol === "http:") u.protocol = "https:";
    let score = 16;
    if (/apple-touch-icon/i.test(rel)) score += 1000;
    if (/\.svg(\?|#|$)/i.test(u.pathname)) score += 500;
    const sizes = /sizes=["']([^"']+)["']/i.exec(tag)?.[1];
    if (sizes) {
      const dims = sizes
        .split(/\s+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !Number.isNaN(n));
      if (dims.length) score += Math.min(Math.max(...dims), 256);
    }
    scored.push({ url: u.toString(), score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.url);
}

async function resolveHiResIcon(rawUrl: string): Promise<string | null> {
  const target = safeUrl(rawUrl);
  if (!target) return null;

  const cached = cache.get(target.origin);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.iconUrl;

  const html = await fetchText(target);
  let iconUrl: string | null = null;
  if (html) {
    const candidates = iconCandidatesFromHtml(html, target);
    if (candidates.length) iconUrl = candidates[0];
  }
  cache.set(target.origin, { at: Date.now(), iconUrl });
  return iconUrl;
}

// 点击工具栏图标 → 打开新标签页（即本扩展接管的导航页）
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "favicon" && typeof msg.url === "string") {
    resolveHiResIcon(msg.url).then((iconUrl) => sendResponse({ iconUrl }));
    return true; // 异步响应
  }
  return false;
});
