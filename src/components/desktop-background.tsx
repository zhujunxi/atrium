"use client";

import * as React from "react";
import { Heart, Images, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { saveWallpaperBackdrop } from "@/lib/wallpaper-store";
import { useWallpaper } from "@/lib/use-wallpaper";
import { WallpaperGallery } from "@/components/wallpaper-gallery";
import { readEntrance } from "@/lib/store";

/** localStorage 读取「开启动效」开关（与 nav:engine 同机制，同步读出、不闪首屏） */
export function entranceEnabled(): boolean {
  return readEntrance();
}

/**
 * 桌面壁纸（纯渲染层）。
 * 产品逻辑（图池获取、指针决策、轮换、收藏）全部在 useWallpaper 中：
 * 打开新标签页永远先显示上次那张图，只有「跨天每日更新 / 手动换一张 /
 * 画廊选择 / 轮换到期」这些可预期时刻才切换。
 */
export function DesktopBackground() {
  const { t, locale } = useI18n();
  const animateIn = entranceEnabled();
  const {
    settings,
    collection,
    current,
    backdrop,
    liked,
    advance,
    toggleLike,
    selectFromGallery,
    removeFromGallery,
  } = useWallpaper(locale);

  const [imgUrl, setImgUrl] = React.useState(""); // 当前已显示的图（始终为已加载）
  const [next, setNext] = React.useState<{ url: string; ready: boolean } | null>(null); // 待交叉淡入的新图
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

  // 目标图变化且不同于当前显示图时：先预加载并解码新图，像素完全就绪后再呈现。
  // - 首次加载（imgUrl 为空，无旧图兜底）：直接展示，不做渐入——避免灰底停留 + 渐入被
  //   跳过造成的闪屏（首屏直接展示）。
  // - 切换（imgUrl 非空，有旧图兜底）：走交叉淡入层，700ms 平滑过渡。
  React.useEffect(() => {
    if (!current?.url || current.url === imgUrl) return;
    let cancelled = false;
    const pre = new Image();
    pre.src = current.url;
    const show = () => {
      if (cancelled) return;
      if (!imgUrl) {
        setImgUrl(current.url);
        void saveWallpaperBackdrop(current.url);
      } else {
        setNext({ url: current.url, ready: false });
      }
    };
    if (typeof pre.decode === "function") {
      pre.decode().then(show).catch(show);
    } else {
      pre.onload = show;
      pre.onerror = () => {
        if (!cancelled && imgUrl) setNext(null);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [current?.url, imgUrl]);

  // 淡入层挂载后，确保 opacity-0 帧已被浏览器绘制（双 rAF），再置 ready 触发 700ms 过渡。
  // 这一帧之差决定了过渡是「生效」还是「被 React 批处理跳过、图片啪地出现」。
  React.useEffect(() => {
    if (!next || next.ready) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setNext((n) => (n ? { ...n, ready: true } : n));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [next?.url, next?.ready]);

  async function onToggleLike() {
    const res = await toggleLike();
    if (!res) return;
    toast.success(res.liked ? t("toast.wallpaperAdded") : t("toast.wallpaperRemoved"));
  }

  function onSelectFromGallery(id: string) {
    selectFromGallery(id);
    setGalleryOpen(false);
    toast.success(t("toast.wallpaperSet"));
  }

  const btn =
    "group/btn relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-110 hover:bg-black/40 hover:text-white active:scale-90";

  return (
    <>
      <div className={cn("fixed inset-0 -z-10 bg-background", animateIn && "lp-wp-enter")}>
        {/* 刷新首屏兜底：上一张壁纸的模糊缩略图，直接显示（首屏不渐入），图片加载完即被覆盖 */}
        {backdrop && (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${backdrop})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(20px)",
              transform: "scale(1.1)",
            }}
          />
        )}
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
            // 像素就绪已由外部 decode() 保证；此处仅处理加载失败兜底
            onError={() => setNext(null)}
            onTransitionEnd={() => {
              setImgUrl(next.url);
              setNext(null);
              // 异步缓存新图的极小缩略图，作为下次刷新首屏的模糊兜底
              void saveWallpaperBackdrop(next.url);
            }}
            className={cn(
              "absolute inset-0 h-full w-full select-none object-cover transition-opacity duration-700",
              next.ready ? "opacity-100" : "opacity-0"
            )}
          />
        )}
        {/* 可读性遮罩：压暗保证图标 / 文字清晰（深/浅色分别适配），常驻不参与淡入。
            由设置项「压暗壁纸」控制是否启用。 */}
        {settings?.dimMask && (
          <>
            <div className="absolute inset-0 bg-black/25 dark:bg-black/45" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30" />
          </>
        )}
      </div>

      {current && (
        <div ref={barRef} className="contents">
          <div className="group fixed bottom-2 right-3 z-30 flex items-center">
            {/* 悬停时向左展开版权文字，默认只显示圆形按钮 */}
            <span className="pointer-events-none mr-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] text-white/80 opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-[60vw] group-hover:opacity-100">
              {current.copyright || current.title}
            </span>

            {/* 收藏：已收藏显示实心红心 */}
            <button
              type="button"
              onClick={onToggleLike}
              title={liked ? t("a11y.unlikeWallpaper") : t("a11y.likeWallpaper")}
              aria-label={liked ? t("a11y.unlikeWallpaper") : t("a11y.likeWallpaper")}
              aria-pressed={liked}
              className={cn(btn, "mr-1.5", liked && "text-rose-400")}
            >
              <Heart
                className={cn("h-3.5 w-3.5 transition-all duration-200", liked && "fill-rose-400")}
              />
            </button>

            {/* 画廊：打开收藏列表 */}
            <button
              type="button"
              onClick={() => setGalleryOpen((v) => !v)}
              title={t("a11y.openGallery")}
              aria-label={t("a11y.openGallery")}
              aria-expanded={galleryOpen}
              className={cn(btn, "mr-1.5", galleryOpen && "scale-110 bg-black/40 text-white")}
            >
              <Images className="h-3.5 w-3.5" />
            </button>

            {/* 换一张：默认显示 i，hover 切换为刷新图标 */}
            <button
              type="button"
              onClick={advance}
              title={t("a11y.changeWallpaper")}
              aria-label={t("a11y.changeWallpaper")}
              className={btn}
            >
              <span className="absolute text-[15px] font-semibold leading-none transition-opacity duration-200 group-hover/btn:opacity-0">
                i
              </span>
              <RefreshCw className="absolute h-3.5 w-3.5 rotate-180 opacity-0 transition-all duration-200 group-hover/btn:rotate-0 group-hover/btn:opacity-100" />
            </button>
          </div>

          {galleryOpen && (
            <WallpaperGallery
              items={collection}
              currentId={current.kind === "collection" ? current.collectionId : null}
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
