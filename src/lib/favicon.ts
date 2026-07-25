import * as React from "react";
import { domainOf } from "@/lib/utils";
import { ensureFavicon, getCachedSync } from "@/lib/faviconCache";

const HI_RES_KEY = "hi-res-favicon";

/** 高清图标解析开关（默认关闭：需 <all_urls> 可选权限，默认零主机权限更隐私友好） */
export function isHiResEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(HI_RES_KEY) === "1";
}

export function setHiResEnabled(on: boolean) {
  localStorage.setItem(HI_RES_KEY, on ? "1" : "0");
}

/**
 * 开启高清图标：动态申请 <all_urls> 可选主机权限（需在用户手势中调用）。
 * 返回是否成功获得权限。
 */
export async function enableHiRes(): Promise<boolean> {
  try {
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (granted) setHiResEnabled(true);
    return granted;
  } catch {
    return false;
  }
}

/** 关闭高清图标：撤销可选主机权限，回到最小权限状态 */
export async function disableHiRes(): Promise<void> {
  setHiResEnabled(false);
  try {
    await chrome.permissions.remove({ origins: ["<all_urls>"] });
  } catch {
    /* 撤销失败不影响功能 */
  }
}

/**
 * 同步的 favicon 候选地址链（按优先级，供 <img> 依次 onError 兜底）：
 *  1) DuckDuckGo 图标服务：高清、稳定、修复混合内容；
 *  2) 站点根路径 /favicon.ico 兜底；
 *  两者都失败才由组件回退到字母头像。
 */
export function faviconCandidates(url: string): string[] {
  const domain = domainOf(url);
  return [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://${domain}/favicon.ico`,
  ];
}

/** 向 background service worker 请求高清图标（解析目标站 apple-touch-icon / SVG / 大尺寸 link icon） */
export function requestHiResIcon(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "favicon", url }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res?.iconUrl ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * 图标候选 hook：优先返回本地缓存的 dataURL（瞬时、无流量、无闪屏）；
 * 缓存未命中时才回源抓取并入库，仅在确认全部 miss 后保留远程候选链兜底。
 * 关键点：首帧绝不主动渲染远程地址，否则每次刷新都会抢先发网络请求，
 * 缓存形同虚设。
 */
export function useFavicon(url: string): string[] {
  const base = React.useMemo(() => faviconCandidates(url), [url]);
  const domain = React.useMemo(() => domainOf(url), [url]);
  const variant = isHiResEnabled() ? "hd" : "std";

  // 初始只信任「已在内存」的命中；内存未命中则先渲染空（白底占位），
  // 不急着发远程请求，等异步查到缓存/回源后再决定。
  const [candidates, setCandidates] = React.useState<string[]>(() => {
    const cached = getCachedSync(domain, variant);
    return cached ? [cached] : [];
  });

  React.useEffect(() => {
    let active = true;
    (async () => {
      let remoteTry = base;
      let v = variant;
      if (isHiResEnabled()) {
        const hi = await requestHiResIcon(url);
        if (hi) {
          remoteTry = [hi, ...base];
          v = "hd";
        }
      }
      const dataUrl = await ensureFavicon(domain, remoteTry, v);
      if (!active) return;
      if (dataUrl) {
        setCandidates([dataUrl]); // 本地命中/回源成功：仅用本地 dataURL，不发远程请求
      } else {
        // DDG 占位图已被 SW 判为「无图标」返回 null，这里不再回退到 DDG（否则又显示箭头），
        // 仅保留站点根兜底，最终失败由组件 onError 落到字母头像。
        setCandidates([base[1]]);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, variant]);

  return candidates;
}
