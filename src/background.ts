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

/** ArrayBuffer → Base64（分块避免 apply 参数过多爆栈） */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]
    );
  }
  return btoa(binary);
}

function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buffer).then((hash) => {
    const bytes = new Uint8Array(hash);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  });
}

// DuckDuckGo 对「无 favicon」域名统一返回的固定默认占位图（灰圈+白箭头，1478 字节）。
// 命中即视为「无图标」：返回 null，由页面回退字母头像，且不被缓存。
const DDG_PLACEHOLDER_SHA256 =
  "e5db88ea2322863ca17817b99d60006c625a31cff0dad49cf05d3c6d16a75c17";

/**
 * 抓取远程图标字节并转 dataURL。需针对目标主机声明 host_permissions：
 * - icons.duckduckgo.com（默认主机权限）覆盖低清；
 * - <all_urls>（开启高清图标时）覆盖站点自身图标。
 * 返回：
 *  - { dataUrl }：成功抓到图标字节；
 *  - { noIcon: true }：命中 DDG 默认占位图，确凿无图标（页面据此写负缓存）；
 *  - null：无权限 / 跨域被拦 / 超时 / 瞬断等不确定失败（不缓存，下次可重试）。
 */
async function fetchIconBytes(
  remoteUrl: string
): Promise<{ dataUrl: string } | { noIcon: true } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(remoteUrl, { signal: controller.signal, cache: "force-cache" });
    clearTimeout(timer);
    const isDDG = remoteUrl.includes("icons.duckduckgo.com");

    // DDG 对「无 favicon」域名返回固定占位图（灰圈+白箭头，1478 字节），但状态码是 404 而非 200。
    // 因此非 200 时也要读 body 校验占位图：命中即确凿无图标（写负缓存），否则才算瞬断。
    if (!res.ok) {
      if (isDDG) {
        try {
          const buf = await res.arrayBuffer();
          if ((await sha256Hex(buf)) === DDG_PLACEHOLDER_SHA256) return { noIcon: true };
        } catch {
          /* 读 body 失败，按瞬断处理 */
        }
      }
      return null;
    }

    const buf = await res.arrayBuffer();
    // 识别 DDG 默认占位图：确凿无图标，返回 noIcon 由页面写入负缓存（不再请求、不再闪）
    if (isDDG) {
      const hash = await sha256Hex(buf);
      if (hash === DDG_PLACEHOLDER_SHA256) return { noIcon: true };
    }
    const ct = res.headers.get("content-type") || "image/x-icon";
    // 部分服务返回 text/plain 等非图片 mime，统一回退到图标类型以正确解码
    const mime = ct.startsWith("image/") ? ct : "image/x-icon";
    return { dataUrl: `data:${mime};base64,${arrayBufferToBase64(buf)}` };
  } catch {
    return null;
  }
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
  if (msg?.type === "fetchIconBytes" && typeof msg.url === "string") {
    fetchIconBytes(msg.url).then((r) => sendResponse(r));
    return true; // 异步响应
  }
  return false;
});
