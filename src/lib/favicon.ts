import * as React from "react";
import { domainOf } from "@/lib/utils";
import {
  ensureFavicon,
  getCachedSync,
  getCachedEntry,
  isNoIconCachedSync,
} from "@/lib/faviconCache";

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
 * 图标候选 hook 的返回：候选地址链 + 是否强制字母头像。
 * - 缓存命中的正图：candidates=[dataURL]、forceLetter=false（瞬时、零网络、无闪屏）；
 * - 缓存确认无图标：candidates=[]、forceLetter=true（直接字母头像，零网络）；
 * - 未命中：先空，回源抓取后按结果决定；纯瞬断等不确定失败时退化为远程直连兜底。
 * 首帧绝不主动渲染远程地址，否则每次刷新都会抢先发网络请求，缓存形同虚设。
 */
export interface FaviconState {
  candidates: string[];
  forceLetter: boolean;
}

export function useFavicon(url: string): FaviconState {
  const base = React.useMemo(() => faviconCandidates(url), [url]);
  const domain = React.useMemo(() => domainOf(url), [url]);
  const variant = isHiResEnabled() ? "hd" : "std";

  // 初始只信任「已在内存」的结果：正图瞬时出图，确认无图标直接字母头像，
  // 二者都不在内存则先渲染空（白底占位），不急着发远程请求。
  const [state, setState] = React.useState<FaviconState>(() => {
    const cached = getCachedSync(domain, variant);
    if (cached) return { candidates: [cached], forceLetter: false };
    if (isNoIconCachedSync(domain, variant)) return { candidates: [], forceLetter: true };
    return { candidates: [], forceLetter: false };
  });

  React.useEffect(() => {
    let active = true;
    (async () => {
      // 已知结果（正图或确认无图标）直接出，零网络、不闪
      const known = await getCachedEntry(domain, variant);
      if (known) {
        if (!active) return;
        setState(
          known.dataUrl
            ? { candidates: [known.dataUrl], forceLetter: false }
            : { candidates: [], forceLetter: true }
        );
        return;
      }

      let remoteTry = base;
      if (isHiResEnabled()) {
        const hi = await requestHiResIcon(url);
        if (hi) remoteTry = [hi, ...base];
      }
      const res = await ensureFavicon(domain, remoteTry, variant);
      if (!active) return;

      if (res.status === "positive") {
        setState({ candidates: [res.dataUrl], forceLetter: false });
      } else if (res.status === "negative") {
        // 确凿无图标（已写入负缓存）：直接字母头像，刷新不再请求、不再闪
        setState({ candidates: [], forceLetter: true });
      } else {
        // 纯瞬断等不确定失败：退化远程直连兜底（同改造前），失败由组件 onError 落到字母头像
        setState({ candidates: [base[1]], forceLetter: false });
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, variant]);

  return state;
}
