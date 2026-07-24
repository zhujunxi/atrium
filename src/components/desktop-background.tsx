"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface BingImage {
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
}

// 扩展页无 CORS 限制（配合 host_permissions），直连 Bing 每日图接口
// mkt 跟随界面语言：英文界面取 en-US（英文描述），中文界面取 zh-CN（中文描述）
const BING_BASE = "https://www.bing.com";
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

function bingUrl(mkt: string) {
  return `https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=${mkt}`;
}

function mktForLocale(locale: string): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

async function fetchBing(mkt: string): Promise<BingImage[]> {
  const res = await fetch(bingUrl(mkt), { cache: "no-store" });
  const data = (await res.json()) as {
    images?: { url?: string; title?: string; copyright?: string; copyrightlink?: string }[];
  };
  return (data.images || [])
    .filter((img) => img.url)
    .map((img) => ({
      url: img.url!.startsWith("http") ? img.url! : BING_BASE + img.url,
      title: img.title ?? "",
      copyright: img.copyright ?? "",
      copyrightlink: img.copyrightlink ?? "",
    }));
}

/** 桌面壁纸：默认 Bing 今日图，可随机切换 / 自动轮播（切换时交叉淡入，无灰屏闪烁） */
export function DesktopBackground() {
  const { t, locale } = useI18n();
  const [images, setImages] = React.useState<BingImage[]>([]);
  const [index, setIndex] = React.useState(0);
  const [imgUrl, setImgUrl] = React.useState(""); // 当前已显示的图（始终为已加载）
  const [next, setNext] = React.useState<{ url: string; ready: boolean } | null>(null); // 待交叉淡入的新图

  React.useEffect(() => {
    let active = true;
    const mkt = mktForLocale(locale);
    const cacheKey = `bing-cache-${locale}`;
    (async () => {
      try {
        // 先用对应语言的缓存快速上屏，再按 TTL 判断是否刷新
        const cached = await chrome.storage.local.get(cacheKey);
        const entry = cached[cacheKey] as { at: number; images: BingImage[] } | undefined;
        if (entry?.images?.length && active) setImages(entry.images);
        if (!entry || Date.now() - entry.at > CACHE_TTL) {
          const imgs = await fetchBing(mkt);
          if (imgs.length) {
            await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), images: imgs } });
            if (active) {
              setImages(imgs);
              setIndex(0);
            }
          }
        }
      } catch {
        /* 网络异常时保留已有缓存 / 空背景 */
      }
    })();
    return () => {
      active = false;
    };
  }, [locale]);

  const current = images[index];

  // 目标图变化且不同于当前显示图时，启动交叉淡入
  React.useEffect(() => {
    if (!current?.url || current.url === imgUrl) return;
    setNext({ url: current.url, ready: false });
  }, [current?.url, imgUrl]);

  // 新图层挂载后下一帧置为可见，触发 CSS 过渡
  React.useEffect(() => {
    if (!next) return;
    const id = requestAnimationFrame(() =>
      setNext((n) => (n ? { ...n, ready: true } : n))
    );
    return () => cancelAnimationFrame(id);
  }, [next?.url]);

  function shuffle() {
    if (images.length <= 1) return;
    setIndex((prev) => {
      let n = prev;
      while (n === prev) n = Math.floor(Math.random() * images.length);
      return n;
    });
  }

  return (
    <>
      <div className="fixed inset-0 -z-10">
        {imgUrl && (
          <img
            src={imgUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover"
          />
        )}
        {next && (
          <img
            src={next.url}
            alt=""
            draggable={false}
            onTransitionEnd={() => {
              setImgUrl(next.url);
              setNext(null);
            }}
            className={cn(
              "absolute inset-0 h-full w-full select-none object-cover transition-opacity duration-700",
              next.ready ? "opacity-100" : "opacity-0"
            )}
          />
        )}
        {/* 可读性遮罩：压暗保证图标 / 文字清晰（深/浅色分别适配），常驻不参与淡入 */}
        <div className="absolute inset-0 bg-black/25 dark:bg-black/45" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30" />
      </div>

      {current && images.length > 1 && (
        <div className="group fixed bottom-2 right-3 z-30 flex items-center">
          {/* 悬停时向左展开版权文字，默认只显示圆形按钮 */}
          <span className="pointer-events-none mr-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] text-white/80 opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-[60vw] group-hover:opacity-100">
            {current.copyright || current.title}
          </span>
          <button
            type="button"
            onClick={shuffle}
            title={t("a11y.changeWallpaper")}
            aria-label={t("a11y.changeWallpaper")}
            className="group/btn relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-110 hover:bg-black/40 hover:text-white active:scale-90"
          >
            {/* 默认显示 i（纯文字，无外圈，避免与按钮圆框冲突），hover 切换为刷新图标（换一张） */}
            <span className="absolute text-[15px] font-semibold leading-none transition-opacity duration-200 group-hover/btn:opacity-0">
              i
            </span>
            <RefreshCw className="absolute h-3.5 w-3.5 rotate-180 opacity-0 transition-all duration-200 group-hover/btn:rotate-0 group-hover/btn:opacity-100" />
          </button>
        </div>
      )}
    </>
  );
}
