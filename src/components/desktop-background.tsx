"use client";

import * as React from "react";
import { Download, Heart, Images, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDayStamp } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { todayStamp, uhdUrl, useWallpaper } from "@/lib/wallpaper";
import { WallpaperGallery } from "@/components/wallpaper-gallery";
import { readEntrance } from "@/lib/store";

/** localStorage 读取「开启动效」开关（与 nav:engine 同机制，同步读出、不闪首屏） */
export function entranceEnabled(): boolean {
  return readEntrance();
}

/**
 * 桌面壁纸（纯渲染层）。
 *
 * 数据全部来自 useWallpaper：初始 state 同步读 localStorage，
 * 第一帧就是最终画面（与 boot.js 画的 body 背景像素一致），无二次上屏。
 * 后续切换走 700ms 交叉淡入；新图 decode 完成后才上屏，绝不半张出现。
 */
export function DesktopBackground() {
  const { t, locale } = useI18n();
  const animateIn = entranceEnabled();
  const {
    settings,
    collection,
    snap,
    displayUrl,
    switching,
    liked,
    advance,
    toggleLike,
    selectFromGallery,
    removeFromGallery,
  } = useWallpaper(locale);

  const [shown, setShown] = React.useState(""); // 当前已呈现的图
  const [incoming, setIncoming] = React.useState<{ url: string; ready: boolean } | null>(null); // 待交叉淡入的新图
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const barRef = React.useRef<HTMLDivElement | null>(null);

  // 画廊打开时，点击容器外区域关闭（容器含底栏与画廊本身，故点击切换按钮不会误关）
  React.useEffect(() => {
    if (!galleryOpen) return;
    function onDown(e: PointerEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setGalleryOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [galleryOpen]);

  // 目标地址变化且不同于当前呈现的图时：先解码，像素完全就绪后再上屏。
  // - 首帧（shown 为空）：直接呈现（首帧已由 boot.js 画在同一位置，无跳变）；
  // - 切换（已有旧图）：走交叉淡入层，700ms 平滑过渡。任何时刻旧图都垫底，
  //   新图没就绪就绝不会露出纯色背景。
  React.useEffect(() => {
    if (!displayUrl || displayUrl === shown) return;
    if (!shown) {
      setShown(displayUrl);
      return;
    }
    let cancelled = false;
    const pre = new Image();
    pre.src = displayUrl;
    const show = () => {
      if (!cancelled) setIncoming({ url: displayUrl, ready: false });
    };
    if (typeof pre.decode === "function") {
      pre
        .decode()
        .then(show)
        .catch(() => {
          if (pre.naturalWidth > 0) show(); // 解码失败但像素可用，仍然呈现
        });
    } else {
      pre.onload = show;
    }
    return () => {
      cancelled = true;
    };
  }, [displayUrl, shown]);

  // 淡入层挂载后，确保 opacity-0 帧已被浏览器绘制（双 rAF），再置 ready 触发过渡。
  React.useEffect(() => {
    if (!incoming || incoming.ready) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setIncoming((n) => (n ? { ...n, ready: true } : n));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [incoming?.url, incoming?.ready]);

  async function onToggleLike() {
    const res = await toggleLike();
    if (!res) return;
    toast.success(res.liked ? t("toast.wallpaperAdded") : t("toast.wallpaperRemoved"));
  }

  /**
   * 下载原图：fetch 成 blob 再走 <a download>，绕开跨域 download 属性失效的问题。
   * 下载走 UHD 4K（展示用的是 1080p，快；但用户要存图时给最高画质）。
   */
  async function onDownload() {
    if (!snap) return;
    const hiRes = uhdUrl(snap.url);
    try {
      let res = await fetch(hiRes, { cache: "force-cache" });
      if (!res.ok && hiRes !== snap.url) {
        res = await fetch(snap.url, { cache: "force-cache" });
      }
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const ext =
        /\.([a-z0-9]+)$/i.exec(new URL(snap.url).pathname)?.[1] ??
        blob.type.split("/")[1] ??
        "jpg";
      // 文件名带壁纸自己的日期（必应每日一图，一天一张）：按文件名排序即是按日期排序
      const stamp = snap.date || todayStamp();
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `wallpaper-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast.error(t("toast.wallpaperDownloadFail"));
    }
  }

  function onSelectFromGallery(id: string) {
    selectFromGallery(id);
    setGalleryOpen(false);
    toast.success(t("toast.wallpaperSet"));
  }

  // 底栏信息行：壁纸日期 + 版权说明（无日期的自定义图只显示版权）
  const infoLine = snap?.date
    ? `${formatDayStamp(snap.date, locale, "full")} · ${snap.copyright || snap.title || ""}`.trim()
    : snap?.copyright || snap?.title || "";

  const btn =
    "group/btn relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 backdrop-blur-md transition-all duration-200 hover:scale-110 hover:bg-black/40 hover:text-white active:scale-90";
  // 次要按钮：默认隐藏（连占位也收起），悬停整组时从右侧滑入展开
  const btnHidden =
    "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100";

  return (
    <>
      {/* 容器刻意不设背景色：底色与首帧图由 boot.js 画在 body/画布层（更底下），
          若在此加不透明背景，会在 React 挂载后把画布首帧盖掉造成闪屏 */}
      <div className={cn("fixed inset-0 -z-10", animateIn && "lp-wp-enter")}>
        {shown && (
          <img
            src={shown}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover"
          />
        )}
        {incoming && (
          <img
            src={incoming.url}
            alt=""
            draggable={false}
            // 像素就绪已由外部 decode() 保证；此处仅处理加载失败兜底
            onError={() => setIncoming(null)}
            onTransitionEnd={() => {
              setShown(incoming.url);
              setIncoming(null);
            }}
            className={cn(
              "absolute inset-0 h-full w-full select-none object-cover transition-opacity duration-700",
              incoming.ready ? "opacity-100" : "opacity-0"
            )}
          />
        )}
        {/* 可读性遮罩：压暗保证图标 / 文字清晰，由设置项「压暗壁纸」控制 */}
        {settings?.dimMask && (
          <>
            <div className="absolute inset-0 bg-black/25 dark:bg-black/45" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30" />
          </>
        )}
      </div>

      {snap && (
        <div ref={barRef} className="contents">
          <div className="group fixed bottom-2 right-3 z-30 flex items-center">
            {/* 悬停时向左展开版权文字，默认只显示圆形按钮 */}
            <span className="pointer-events-none mr-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] text-white/80 opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-[60vw] group-hover:opacity-100">
              {infoLine}
            </span>

            <button
              type="button"
              onClick={onDownload}
              title={t("a11y.downloadWallpaper")}
              aria-label={t("a11y.downloadWallpaper")}
              className={cn(btn, btnHidden, "mr-1.5")}
            >
              <Download className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleLike}
              title={liked ? t("a11y.unlikeWallpaper") : t("a11y.likeWallpaper")}
              aria-label={liked ? t("a11y.unlikeWallpaper") : t("a11y.likeWallpaper")}
              aria-pressed={liked}
              className={cn(btn, btnHidden, "mr-1.5", liked && "text-rose-400")}
            >
              <Heart
                className={cn("h-3.5 w-3.5 transition-all duration-200", liked && "fill-rose-400")}
              />
            </button>

            <button
              type="button"
              onClick={() => setGalleryOpen((v) => !v)}
              title={t("a11y.openGallery")}
              aria-label={t("a11y.openGallery")}
              aria-expanded={galleryOpen}
              className={cn(btn, btnHidden, "mr-1.5", galleryOpen && "scale-110 bg-black/40 text-white")}
            >
              <Images className="h-3.5 w-3.5" />
            </button>

            {/* 换一张（顺序循环）：常驻显示的唯一点位；预取命中时毫秒级切换，
                未命中则转圈等下载完成，画面在就绪前保持不动 */}
            <button
              type="button"
              onClick={advance}
              title={t("a11y.changeWallpaper")}
              aria-label={t("a11y.changeWallpaper")}
              aria-busy={switching}
              className={btn}
            >
              <span
                className={cn(
                  "absolute text-[15px] font-semibold leading-none transition-opacity duration-200",
                  switching ? "opacity-0" : "group-hover/btn:opacity-0"
                )}
              >
                i
              </span>
              {switching ? (
                <Loader2 className="absolute h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="absolute h-3.5 w-3.5 rotate-180 opacity-0 transition-all duration-200 group-hover/btn:rotate-0 group-hover/btn:opacity-100" />
              )}
            </button>
          </div>

          {galleryOpen && (
            <WallpaperGallery
              items={collection}
              currentId={snap.collectionId}
              onClose={() => setGalleryOpen(false)}
              onSelect={onSelectFromGallery}
              onRemove={removeFromGallery}
            />
          )}
        </div>
      )}
    </>
  );
}
