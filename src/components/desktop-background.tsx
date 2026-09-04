"use client";

import * as React from "react";
import { Download, Heart, Images, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { todayStamp } from "@/lib/wallpaper-store";
import { uhdUrl } from "@/lib/wallpaper-cache";
import { formatDayStamp } from "@/lib/utils";
import { useWallpaper } from "@/lib/use-wallpaper";
import { WallpaperGallery } from "@/components/wallpaper-gallery";
import { readEntrance } from "@/lib/store";

/** localStorage 读取「开启动效」开关（与 nav:engine 同机制，同步读出、不闪首屏） */
export function entranceEnabled(): boolean {
  return readEntrance();
}

/**
 * 当前壁纸的日期戳（YYYY-MM-DD）。
 * 首选快照自带的 date（必应接口给的发布日）；历史快照没有该字段时，
 * 必应图回退 dayStamp（每日一图模式下两者一致），自定义收藏图则无日期可用。
 */
function wallpaperDateStamp(
  current: { date?: string; dayStamp: string; kind: "bing" | "collection" } | null
): string {
  if (!current) return "";
  return current.date || (current.kind === "bing" ? current.dayStamp : "");
}

/**
 * 桌面壁纸（纯渲染层）。
 *
 * 产品逻辑（图池、指针、轮换、下载、收藏）全部在 useWallpaper 里，这一层只管怎么画：
 * - `displayUrl` 由控制器给出，字节已在本地图库，通常几十毫秒内即可解码上屏；
 * - 首帧（还没有旧图）直接呈现，不做渐入——配合 boot.js 的模糊兜底图，
 *   观感是「模糊 → 清晰」，全程无白屏；
 * - 后续切换走 700ms 交叉淡入。
 *
 * 刻意不在这里做加载中占位或分辨率回退：控制器已经保证「能切过来的图都已下好」，
 * 渲染层再掺入选图逻辑就是重蹈旧版「状态与画面对不上」的覆辙。
 */
export function DesktopBackground() {
  const { t, locale } = useI18n();
  const animateIn = entranceEnabled();
  const {
    settings,
    collection,
    displayed,
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
  // - 首帧（shown 为空，无旧图兜底）：直接呈现，不做渐入，避免灰底停留 + 渐入被跳过造成闪屏；
  // - 切换（已有旧图）：走交叉淡入层，700ms 平滑过渡。
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
  // 这一帧之差决定了过渡是「生效」还是「被 React 批处理跳过、图片啪地出现」。
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
    if (!displayed) return;
    // 原图未必有 UHD 变体，取不到时回退到展示用的 1080p
    const hiRes = uhdUrl(displayed.url);
    try {
      let res = await fetch(hiRes, { cache: "force-cache" });
      if (!res.ok && hiRes !== displayed.url) {
        res = await fetch(displayed.url, { cache: "force-cache" });
      }
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const ext =
        /\.([a-z0-9]+)$/i.exec(new URL(displayed.url).pathname)?.[1] ??
        blob.type.split("/")[1] ??
        "jpg";
      // 文件名带壁纸自己的日期（必应每日一图，一天一张）：同一张图在任何时候下载
      // 名字都一致，且按文件名排序即是按日期排序。
      const stamp = wallpaperDateStamp(displayed) || todayStamp();
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
  const wpDate = wallpaperDateStamp(displayed);
  const infoLine = wpDate
    ? `${formatDayStamp(wpDate, locale)} · ${displayed?.copyright || displayed?.title || ""}`.trim()
    : displayed?.copyright || displayed?.title || "";

  const btn =
    "group/btn relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 backdrop-blur-md transition-all duration-200 hover:scale-110 hover:bg-black/40 hover:text-white active:scale-90";
  // 次要按钮：默认隐藏（连占位也收起），悬停整组时从右侧滑入展开——
  // 平时右下角只有一个安静的「i」，悬停才露出下载 / 收藏 / 画廊
  const btnHidden =
    "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100";

  return (
    <>
      {/* 容器刻意不设背景色：底色与刷新兜底图由 boot.js 画在 body/画布层（更底下），
          若在此加不透明背景，会在 React 挂载后、真图就绪前把画布兜底盖掉造成闪屏 */}
      <div className={cn("fixed inset-0 -z-10", animateIn && "lp-wp-enter")}>
        {/* 刷新首屏兜底不在这里：boot.js 已在首帧前把下次要显示的壁纸缩略图画在 body/
            画布层（本容器之下），真图 decode 完成前它一直可见，dim 遮罩同样罩得住它 */}
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
        {/* 可读性遮罩：压暗保证图标 / 文字清晰（深/浅色分别适配），常驻不参与淡入。
            由设置项「压暗壁纸」控制是否启用。 */}
        {settings?.dimMask && (
          <>
            <div className="absolute inset-0 bg-black/25 dark:bg-black/45" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30" />
          </>
        )}
      </div>

      {displayed && (
        <div ref={barRef} className="contents">
          <div className="group fixed bottom-2 right-3 z-30 flex items-center">
            {/* 悬停时向左展开版权文字，默认只显示圆形按钮 */}
            <span className="pointer-events-none mr-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] text-white/80 opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-[60vw] group-hover:opacity-100">
              {infoLine}
            </span>

            {/* 下载：悬停整组时出现 */}
            <button
              type="button"
              onClick={onDownload}
              title={t("a11y.downloadWallpaper")}
              aria-label={t("a11y.downloadWallpaper")}
              className={cn(btn, btnHidden, "mr-1.5")}
            >
              <Download className="h-3.5 w-3.5" />
            </button>

            {/* 收藏：已收藏显示实心红心 */}
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

            {/* 画廊：打开收藏列表 */}
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

            {/* 换一张（顺序循环）：常驻显示的唯一点位；hover 按钮本体时 i 切换为刷新图标。
                后台预载新图期间显示转圈——壁纸本身不会变，直到新图字节就绪才交叉淡入。 */}
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
                // 后台预载新图中：转圈提示，壁纸保持不动，下完再交叉淡入
                <Loader2 className="absolute h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="absolute h-3.5 w-3.5 rotate-180 opacity-0 transition-all duration-200 group-hover/btn:rotate-0 group-hover/btn:opacity-100" />
              )}
            </button>
          </div>

          {galleryOpen && (
            <WallpaperGallery
              items={collection}
              currentId={displayed.kind === "collection" ? displayed.collectionId : null}
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
