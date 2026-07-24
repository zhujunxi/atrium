"use client";

import * as React from "react";
import { Heart, Images, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  COLL_KEY,
  SETT_KEY,
  addToCollection,
  generateThumb,
  loadCollection,
  loadWallpaperCurrent,
  loadWallpaperSettings,
  removeFromCollection,
  saveWallpaperCurrent,
  saveWallpaperSettings,
} from "@/lib/wallpaper-store";
import { WallpaperGallery } from "@/components/wallpaper-gallery";
import type { SavedWallpaper, WallpaperCurrent, WallpaperMode, WallpaperSettings } from "@/lib/types";

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

/** 从池子里随机挑一个与 cur 不同的元素（池子 ≤1 时原样返回） */
function pickDifferent<T>(arr: T[], same: (a: T, b: T) => boolean, cur: T): T {
  if (arr.length <= 1) return arr[0];
  let pick = cur;
  while (same(pick, cur)) pick = arr[Math.floor(Math.random() * arr.length)];
  return pick;
}

interface ActiveImage {
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
  fromCollection: boolean;
  id: string | null;
}

/** 桌面壁纸：必应每日图 + 收藏画廊，支持多模式、收藏、自动轮换与持久化 */
export function DesktopBackground() {
  const { t, locale } = useI18n();
  const [images, setImages] = React.useState<BingImage[]>([]);
  const [collection, setCollection] = React.useState<SavedWallpaper[]>([]);
  const [settings, setSettings] = React.useState<WallpaperSettings | null>(null);
  const [current, setCurrent] = React.useState<WallpaperCurrent | null>(null);
  const [imgUrl, setImgUrl] = React.useState(""); // 当前已显示的图（始终为已加载）
  const [next, setNext] = React.useState<{ url: string; ready: boolean } | null>(null); // 待交叉淡入的新图
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const barRef = React.useRef<HTMLDivElement | null>(null);

  // 初始化：拉取必应图、读取收藏 / 设置 / 当前指针
  React.useEffect(() => {
    let active = true;
    const mkt = mktForLocale(locale);
    const cacheKey = `bing-cache-${locale}`;
    (async () => {
      try {
        const cached = await chrome.storage.local.get(cacheKey);
        const entry = cached[cacheKey] as { at: number; images: BingImage[] } | undefined;
        if (entry?.images?.length && active) setImages(entry.images);
        if (!entry || Date.now() - entry.at > CACHE_TTL) {
          const imgs = await fetchBing(mkt);
          if (imgs.length) {
            await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), images: imgs } });
            if (active) setImages(imgs);
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

  React.useEffect(() => {
    let alive = true;
    Promise.all([
      loadCollection(),
      loadWallpaperSettings(),
      loadWallpaperCurrent(),
    ]).then(([coll, sett, cur]) => {
      if (!alive) return;
      setCollection(coll);
      setSettings(sett);
      setCurrent(cur);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 画廊打开时，点击容器外区域关闭（容器含底栏与画廊本身，故点击切换按钮不会误关）
  React.useEffect(() => {
    if (!galleryOpen) return;
    function onDown(e: PointerEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setGalleryOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [galleryOpen]);

  // 多标签页 / 设置面板改动后，实时同步收藏与设置
  React.useEffect(() => {
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== "local") return;
      if (changes[COLL_KEY]) {
        const v = changes[COLL_KEY].newValue;
        if (Array.isArray(v)) setCollection(v as SavedWallpaper[]);
      }
      if (changes[SETT_KEY]) {
        const v = changes[SETT_KEY].newValue;
        if (v && typeof v === "object") {
          setSettings((prev) => ({ ...(prev ?? ({} as WallpaperSettings)), ...(v as WallpaperSettings) }));
        }
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // 当前应展示的壁纸（按模式推导）
  const activeImg = React.useMemo<ActiveImage | null>(() => {
    if (!settings || !current) return null;
    if (settings.mode === "collection") {
      const wp = collection.find((w) => w.id === current.collectionId) ?? collection[0];
      if (wp)
        return {
          url: wp.url,
          title: wp.title,
          copyright: wp.copyright,
          copyrightlink: wp.copyrightlink,
          fromCollection: true,
          id: wp.id,
        };
    } else if (settings.mode === "shuffle-all" && current.pool === "collection") {
      const wp = collection.find((w) => w.id === current.collectionId);
      if (wp)
        return {
          url: wp.url,
          title: wp.title,
          copyright: wp.copyright,
          copyrightlink: wp.copyrightlink,
          fromCollection: true,
          id: wp.id,
        };
    }
    // 必应池（collection 模式但收藏为空 / 未命中时回退此处）
    const img = images[current.bingIndex] ?? images[0];
    if (!img) return null;
    return {
      url: img.url,
      title: img.title,
      copyright: img.copyright,
      copyrightlink: img.copyrightlink,
      fromCollection: false,
      id: null,
    };
  }, [settings, current, collection, images]);

  // 目标图变化且不同于当前显示图时，启动交叉淡入
  React.useEffect(() => {
    if (!activeImg?.url || activeImg.url === imgUrl) return;
    setNext({ url: activeImg.url, ready: false });
  }, [activeImg?.url, imgUrl]);

  // 新图层挂载后下一帧置为可见，触发 CSS 过渡
  React.useEffect(() => {
    if (!next) return;
    const id = requestAnimationFrame(() =>
      setNext((n) => (n ? { ...n, ready: true } : n))
    );
    return () => cancelAnimationFrame(id);
  }, [next?.url]);

  // 换一张：按模式在对应池子里随机选一张不同的
  const advance = React.useCallback(() => {
    if (!settings || !current) return;
    const nowIso = new Date().toISOString();
    const setCur = (next: WallpaperCurrent) => {
      setCurrent(next);
      void saveWallpaperCurrent(next);
    };
    if (settings.mode === "collection") {
      if (collection.length <= 1) return;
      const cur = collection.find((w) => w.id === current.collectionId) ?? collection[0];
      const pick = pickDifferent(collection, (a, b) => a.id === b.id, cur);
      setCur({ ...current, collectionId: pick.id, pool: "collection", setAt: nowIso });
      return;
    }
    if (settings.mode === "shuffle-all") {
      const pool = [
        ...images.map((img, i) => ({ type: "bing" as const, i, url: img.url, key: `b${i}` })),
        ...collection.map((w) => ({ type: "collection" as const, id: w.id, url: w.url, key: `c${w.id}` })),
      ];
      if (pool.length <= 1) return;
      const curDesc =
        current.pool === "collection" && current.collectionId
          ? pool.find((p) => p.type === "collection" && p.id === current.collectionId)
          : pool.find((p) => p.type === "bing" && p.i === current.bingIndex);
      const pick = pickDifferent(pool, (a, b) => a.key === b.key, curDesc ?? pool[0]);
      if (pick.type === "bing")
        setCur({ ...current, bingIndex: pick.i, pool: "bing", setAt: nowIso });
      else setCur({ ...current, collectionId: pick.id, pool: "collection", setAt: nowIso });
      return;
    }
    // bing-daily
    if (images.length <= 1) return;
    let n = current.bingIndex;
    while (n === current.bingIndex) n = Math.floor(Math.random() * images.length);
    setCur({ ...current, bingIndex: n, pool: "bing", setAt: nowIso });
  }, [settings, current, collection, images]);

  // 自动轮换：setAt 到期即切下一张；设置/时间变化都会重置计时
  React.useEffect(() => {
    if (!settings?.autoRotate || !current) return;
    const intervalMs = Math.max(1, settings.rotateIntervalMin) * 60 * 1000;
    const elapsed = Date.now() - new Date(current.setAt).getTime();
    const delay = Math.max(0, intervalMs - elapsed);
    const id = window.setTimeout(() => advance(), delay);
    return () => window.clearTimeout(id);
  }, [settings?.autoRotate, settings?.rotateIntervalMin, current?.setAt, advance]);

  const liked = !!activeImg && collection.some((w) => w.url === activeImg.url);

  async function toggleLike() {
    if (!activeImg) return;
    const existing = collection.find((w) => w.url === activeImg.url);
    if (existing) {
      const next = await removeFromCollection(existing.id);
      handleRemoved(existing.id, next);
      toast.success(t("toast.wallpaperRemoved"));
    } else {
      const thumb = await generateThumb(activeImg.url);
      const next = await addToCollection({
        url: activeImg.url,
        title: activeImg.title,
        copyright: activeImg.copyright,
        copyrightlink: activeImg.copyrightlink,
        thumb,
        source: activeImg.fromCollection ? "custom" : "bing",
      });
      setCollection(next);
      toast.success(t("toast.wallpaperAdded"));
    }
  }

  function selectFromGallery(id: string) {
    if (!current) return;
    const next: WallpaperCurrent = {
      ...current,
      collectionId: id,
      pool: "collection",
      setAt: new Date().toISOString(),
    };
    setCurrent(next);
    void saveWallpaperCurrent(next);
    void saveWallpaperSettings({ mode: "collection" }).then(setSettings);
    setGalleryOpen(false);
    toast.success(t("toast.wallpaperSet"));
  }

  /** 删除收藏后的收尾：若删的是当前展示图则平滑切到下一张；若清空则回退每日推荐 */
  function handleRemoved(removedId: string, nextColl: SavedWallpaper[]) {
    setCollection(nextColl);
    if (!current || !settings) return;
    const wasCurrent =
      current.collectionId === removedId &&
      (settings.mode === "collection" ||
        (settings.mode === "shuffle-all" && current.pool === "collection"));
    if (nextColl.length === 0) {
      const s: WallpaperSettings = { ...settings, mode: "bing-daily" };
      setSettings(s);
      void saveWallpaperSettings(s);
      const c: WallpaperCurrent = {
        ...current,
        collectionId: null,
        pool: "bing",
        setAt: new Date().toISOString(),
      };
      setCurrent(c);
      void saveWallpaperCurrent(c);
      return;
    }
    if (wasCurrent) {
      const c: WallpaperCurrent = {
        ...current,
        collectionId: nextColl[0].id,
        pool: "collection",
        setAt: new Date().toISOString(),
      };
      setCurrent(c);
      void saveWallpaperCurrent(c);
    }
  }

  function removeFromGallery(id: string) {
    void removeFromCollection(id).then((next) => handleRemoved(id, next));
  }

  const btn =
    "group/btn relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-110 hover:bg-black/40 hover:text-white active:scale-90";

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

      {activeImg && (
        <div ref={barRef} className="contents">
          <div className="group fixed bottom-2 right-3 z-30 flex items-center">
            {/* 悬停时向左展开版权文字，默认只显示圆形按钮 */}
            <span className="pointer-events-none mr-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] text-white/80 opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-[60vw] group-hover:opacity-100">
              {activeImg.copyright || activeImg.title}
            </span>

            {/* 收藏：已收藏显示实心红心 */}
            <button
              type="button"
              onClick={toggleLike}
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
              currentId={activeImg?.fromCollection ? activeImg.id : null}
              onClose={() => setGalleryOpen(false)}
              onSelect={selectFromGallery}
              onRemove={removeFromGallery}
            />
          )}
        </div>
      )}
    </>
  );
}
