import * as React from "react";
import {
  COLL_KEY,
  SETT_KEY,
  addToCollection,
  canonicalWallpaperId,
  generateThumb,
  loadCollection,
  loadWallpaperCurrent,
  loadWallpaperSettings,
  removeFromCollection,
  saveWallpaperBackdrop,
  saveWallpaperCurrent,
  saveWallpaperSettings,
  saveDisplayedImage,
  todayStamp,
} from "@/lib/wallpaper-store";
import {
  cacheWallpaper,
  hasWallpaper,
  resolveWallpaperUrl,
} from "@/lib/wallpaper-cache";
import type {
  SavedWallpaper,
  WallpaperCurrent,
  WallpaperSettings,
} from "@/lib/types";

/**
 * 壁纸控制器（产品逻辑的唯一来源）。
 *
 * ── 核心不变量 ────────────────────────────────────────────────
 *   1. 屏幕上展示的那张图，字节必定已在本地图库 → 打开即可呈现，无需等网络。
 *   2. 当前壁纸是**全局唯一**的一份（所有标签页共用同一个指针）
 *      → 同时开几个新标签页，看到的必然是同一张。
 *   3. 画面只在三个时机变化：轮换到点、用户操作、以及首次安装的那一次。
 *
 * ── 为什么没有「预备图指针」─────────────────────────────────────
 *   曾经有过：后台下好一张写进全局指针，下个标签页打开时切过去。
 *   结果是每开一个标签页就消费一次，三个面板三张图——全局指针被各自消费，
 *   必然发散。所以预备图**只下字节、不动指针**：
 *   预热的是本地图库，切换的时机由每个页面自己决定（轮换到点 / 用户点换一张）。
 *
 * ── 慢路径只有一条 ──────────────────────────────────────────────
 *   首次安装（本地图库为空、无任何指针）时不得不等一次网络。
 *   除此之外，打开永远是「读本地字节 → 解码 → 上屏」，几十毫秒。
 */

export interface BingImage {
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
  /** 该图属于哪一天（YYYY-MM-DD，来自接口 startdate），必应每日一图的身份 */
  date: string;
}

// 扩展页无 CORS 限制（配合 host_permissions），直连必应每日图接口。
const BING_BASE = "https://www.bing.com";
/** 图池缓存 30 分钟（只影响「换一张」候选的新鲜度，不影响展示） */
const BING_CACHE_TTL = 30 * 60 * 1000;
/** 页面长期开着时，每 10 分钟回看一次图池，让新图有机会进入轮换 */
const POLL_INTERVAL = 10 * 60 * 1000;
/** 交叉淡入时长，blob URL 延后释放要覆盖它 */
const REVOKE_DELAY = 3000;
/** 空闲预载的等待上限：宁可晚一点，也不跟首屏抢带宽 */
const IDLE_TIMEOUT = 3000;

function bingApiUrl(mkt: string) {
  return `https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=${mkt}`;
}

function mktForLocale(locale: string): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

function poolCacheKey(locale: string): string {
  return `bing-cache-${locale}`;
}

/** 浏览器空闲时再跑，避免和首屏抢带宽；不支持 requestIdleCallback 时退化成定时器 */
function whenIdle(fn: () => void): void {
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") ric(fn, { timeout: IDLE_TIMEOUT });
  else window.setTimeout(fn, 800);
}

// --- 日期本地化 -----------------------------------------------------------
// 必应的 startdate 是**美国太平洋时间**的日历日，与请求的 mkt 无关。而本扩展按
// **用户本地午夜**算「今天」——两套日历错开，东八区每天 00:00～15:00 拿到的
// 「今日壁纸」都顶着昨天的日期，与页面按本地时间渲染的日期差一天。
// 修正：以 pool[0] 对齐本地当天为准，池内其余图按同一偏移量平移。

/** 必应接口的 startdate（"20260901"）→ "2026-09-01"（字符串切分，避免时区漂移） */
function parseBingDate(raw?: string): string {
  if (raw && /^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return "";
}

/** "2026-09-01" → UTC 毫秒。纯日历日换算，避开本地时区与夏令时导致的 ±1 天漂移 */
function dayStampToUTC(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcToDayStamp(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** 日期戳平移 n 天（n 可为负）；非法输入原样返回 */
function shiftDay(day: string, n: number): string {
  const ms = dayStampToUTC(day);
  if (ms == null) return day;
  return utcToDayStamp(ms + n * 86400000);
}

/** to - from，单位「天」；任一侧非法返回 null */
function dayDiff(from: string, to: string): number | null {
  const a = dayStampToUTC(from);
  const b = dayStampToUTC(to);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * 把必应图池的日期整体平移到用户本地日历（幂等：head 已对齐本地当天时原样返回）。
 * 偏移量只允许 -1 / 0 / +1：必应日期与本地日期最多差一天。超出范围说明图池已严重
 * 过期（如断网数日）或数据异常——此时宁可不平移，也绝不把一张老图的日期硬改成今天。
 */
function localizeBingDates(images: BingImage[]): BingImage[] {
  if (!images.length) return images;
  const head = images[0].date;
  if (!head) return images;
  const offset = dayDiff(head, todayStamp());
  if (offset === null || offset === 0 || Math.abs(offset) > 1) return images;
  return images.map((img) => (img.date ? { ...img, date: shiftDay(img.date, offset) } : img));
}

// --- 图池 -----------------------------------------------------------------

async function fetchBing(mkt: string): Promise<BingImage[]> {
  const res = await fetch(bingApiUrl(mkt), { cache: "no-store" });
  const data = (await res.json()) as {
    images?: {
      url?: string;
      title?: string;
      copyright?: string;
      copyrightlink?: string;
      startdate?: string;
    }[];
  };
  return (data.images || [])
    .filter((img) => img.url)
    .map((img) => ({
      // 刻意用接口直接给的 1080p：约 300KB，与 Bing 搜索首页同源同尺寸。
      // UHD（1–4MB）只用于「下载原图」，不作为展示源——背景图不值得让用户等几秒。
      url: img.url!.startsWith("http") ? img.url! : BING_BASE + img.url,
      title: img.title ?? "",
      copyright: img.copyright ?? "",
      copyrightlink: img.copyrightlink ?? "",
      date: parseBingDate(img.startdate),
    }));
}

async function readCachedPool(locale: string): Promise<{ at: number; images: BingImage[] }> {
  try {
    const key = poolCacheKey(locale);
    const res = await chrome.storage.local.get(key);
    const e = res[key] as { at?: number; images?: BingImage[] } | undefined;
    // 读缓存时也本地化一次：缓存可能是昨夜写的，当时算出的偏移量与现在未必相同。
    // 本地化是幂等的，重复调用无副作用。
    const images = localizeBingDates(
      (e?.images ?? []).filter((i): i is BingImage => !!i && typeof i.url === "string")
    );
    return { at: typeof e?.at === "number" ? e.at : 0, images };
  } catch {
    return { at: 0, images: [] };
  }
}

async function writeCachedPool(locale: string, images: BingImage[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [poolCacheKey(locale)]: { at: Date.now(), images } });
  } catch {
    /* 写缓存失败不影响展示 */
  }
}

// --- 快照 -----------------------------------------------------------------

function snapFromBing(img: BingImage): WallpaperCurrent {
  return {
    kind: "bing",
    key: canonicalWallpaperId(img.url),
    url: img.url,
    title: img.title,
    copyright: img.copyright,
    copyrightlink: img.copyrightlink,
    collectionId: null,
    setAt: new Date().toISOString(),
    dayStamp: todayStamp(),
    date: img.date || undefined,
  };
}

function snapFromSaved(w: SavedWallpaper): WallpaperCurrent {
  return {
    kind: "collection",
    key: canonicalWallpaperId(w.url),
    url: w.url,
    title: w.title,
    copyright: w.copyright,
    copyrightlink: w.copyrightlink,
    collectionId: w.id,
    setAt: new Date().toISOString(),
    dayStamp: todayStamp(),
    date: w.date,
  };
}

// --- 选图规则 -------------------------------------------------------------

/**
 * 必应图库里当前图之后的那一张（循环推进，不是随机——连点「换一张」能走完一圈回到起点）。
 * 壁纸来源永远是必应图库：当前图若是钉选的收藏（不在图池里），则跳回图池头图，
 * 重新进入必应轮换。池内只有当前这一张时返回 null（无需切换）。
 */
function pickNext(
  pool: BingImage[],
  currentKey: string | null
): WallpaperCurrent | null {
  if (!pool.length) return null;
  const cands = pool.map((img) => ({
    key: canonicalWallpaperId(img.url),
    snap: () => snapFromBing(img),
  }));
  const idx = cands.findIndex((c) => c.key === currentKey);
  const next = cands[(idx + 1) % cands.length];
  if (next.key === currentKey) return null; // 池里只有当前这张
  return next.snap();
}

// --- Hook -----------------------------------------------------------------

export interface WallpaperApi {
  settings: WallpaperSettings | null;
  collection: SavedWallpaper[];
  /** 当前展示的壁纸（不变量：字节已在本地图库，且全局唯一） */
  displayed: WallpaperCurrent | null;
  /** 可直接交给 <img src> 的展示地址（本地 blob 或远程地址） */
  displayUrl: string;
  /** 是否正在为「用户发起的切换」预载（底栏可显示 loading） */
  switching: boolean;
  liked: boolean;
  advance: () => void;
  toggleLike: () => Promise<{ liked: boolean } | null>;
  selectFromGallery: (id: string) => void;
  removeFromGallery: (id: string) => void;
}

export function useWallpaper(locale: string): WallpaperApi {
  const [pool, setPool] = React.useState<BingImage[]>([]);
  const [collection, setCollection] = React.useState<SavedWallpaper[]>([]);
  const [settings, setSettings] = React.useState<WallpaperSettings | null>(null);
  const [displayed, setDisplayed] = React.useState<WallpaperCurrent | null>(null);
  const [displayUrl, setDisplayUrl] = React.useState("");
  const [switching, setSwitching] = React.useState(false);

  // 页面可见性：自动轮换只在可见时计时，后台逗留不计入——
  // 切回标签页不会因后台流逝的时间而在回来瞬间换图。
  const [visible, setVisible] = React.useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  React.useEffect(() => {
    const onVis = () => {
      const v = document.visibilityState !== "hidden";
      setVisible(v);
      if (v) void refreshRef.current?.(false); // 回到前台顺带看一眼图池是否更新了
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // 异步回调取最新值用（避免闭包吃到过期 state）
  const localeRef = React.useRef(locale);
  localeRef.current = locale;
  const poolRef = React.useRef(pool);
  poolRef.current = pool;
  const collRef = React.useRef(collection);
  collRef.current = collection;
  const settRef = React.useRef(settings);
  settRef.current = settings;
  const displayedRef = React.useRef(displayed);
  displayedRef.current = displayed;

  const initedRef = React.useRef(false);
  const preloadingRef = React.useRef(false);
  const preloadRef = React.useRef<() => Promise<void>>(async () => {});
  const rotateRef = React.useRef<() => void>(() => {});
  const refreshRef = React.useRef<(force: boolean) => Promise<void>>(async () => {});
  /** 初始化完成的闸门：图池刷新必须等它，否则会误判成首次安装 */
  const readyRef = React.useRef<Promise<void>>(Promise.resolve());

  /**
   * 首帧兜底图（boot.js 在首帧前画的那张 32px 模糊图）必须与当前展示的图一致，
   * 否则首帧会出现「模糊的是 A、清晰后是 B」的错配。
   */
  const syncBackdrop = React.useCallback((target: WallpaperCurrent | null) => {
    if (!target) return;
    // 模糊兜底 + 完整清晰图 dataURL 一并落 localStorage：
    // 下次打开首帧由 boot.js 直接画清晰图，瞬时上屏，不再先糊后清。
    void saveWallpaperBackdrop(target.url, target.key);
    void saveDisplayedImage(target.key);
  }, []);

  /** 提交为当前展示图（调用方须保证字节已在本地） */
  const commit = React.useCallback(
    (next: WallpaperCurrent) => {
      displayedRef.current = next;
      setDisplayed(next);
      void saveWallpaperCurrent(next);
      void syncBackdrop(next);
      whenIdle(() => void preloadRef.current?.());
    },
    [syncBackdrop]
  );

  /**
   * 后台预热下一张：**只下载字节到本地图库，不动任何指针**。
   * 于是轮换到点或用户点「换一张」时，字节已就位，切换是瞬时的；
   * 而「当前是哪张」始终只有 displayed 一个答案，多标签页必然一致。
   */
  const preload = React.useCallback(async () => {
    const sett = settRef.current;
    const disp = displayedRef.current;
    if (!sett || !disp || preloadingRef.current) return;
    const next = pickNext(poolRef.current, disp.key);
    if (!next) return;
    preloadingRef.current = true;
    try {
      await cacheWallpaper(next.url, next.key);
    } finally {
      preloadingRef.current = false;
    }
  }, []);
  preloadRef.current = preload;

  /**
   * 切到指定图（用户操作 / 轮换到点 / 首次安装）。
   * 字节不在本地时**先在后台下载，画面保持不动**，下完再切——
   * 这样绝不会出现「底栏信息先变、图片几秒后才跟上」的错位。
   */
  const switchTo = React.useCallback(
    async (target: WallpaperCurrent | null) => {
      if (!target) return false;
      if (displayedRef.current?.key === target.key) return true;
      if (!(await hasWallpaper(target.key))) {
        setSwitching(true);
        try {
          const ok = await cacheWallpaper(target.url, target.key);
          if (!ok) return false;
        } finally {
          setSwitching(false);
        }
      }
      if (displayedRef.current?.key === target.key) return true; // 期间已被换过
      commit(target);
      return true;
    },
    [commit]
  );

  /** 轮换到点 / 点「换一张」：字节通常已由 preload 下好，所以是秒切 */
  const advanceToNext = React.useCallback(() => {
    const sett = settRef.current;
    const disp = displayedRef.current;
    if (!sett || !disp) return;
    const next = pickNext(poolRef.current, disp.key);
    if (!next) return;
    void switchTo(next);
  }, [switchTo]);
  rotateRef.current = advanceToNext;

  /** 刷新图池；必要时用首图建立首次安装的第一张 */
  const refreshPool = React.useCallback(
    async (force: boolean) => {
      const loc = localeRef.current;
      const cached = await readCachedPool(loc);
      setPool(cached.images);
      let fresh = cached.images;

      const stale = force || !cached.at || Date.now() - cached.at > BING_CACHE_TTL;
      if (stale) {
        try {
          // 必应给的是美西日期，统一平移到用户本地日历后再缓存
          const got = localizeBingDates(await fetchBing(mktForLocale(loc)));
          if (got.length) {
            await writeCachedPool(loc, got);
            setPool(got);
            fresh = got;
          }
        } catch {
          /* 网络异常：保留缓存池，展示不受影响 */
        }
      }

      // 首次安装（还没有任何壁纸）：用图池头图建立第一张，这是唯一一次必须等网络
      if (!displayedRef.current && fresh.length) {
        await switchTo(snapFromBing(fresh[0]));
        return;
      }
      whenIdle(() => void preloadRef.current?.());
    },
    [switchTo]
  );
  refreshRef.current = refreshPool;

  // 初始化：一次性读齐所有存储，在呈现任何图片之前定下展示指针。
  React.useEffect(() => {
    let alive = true;
    let markReady: () => void = () => {};
    readyRef.current = new Promise<void>((r) => {
      markReady = r;
    });
    void (async () => {
      try {
        const [coll, sett, disp, cached] = await Promise.all([
          loadCollection(),
          loadWallpaperSettings(),
          loadWallpaperCurrent(),
          readCachedPool(localeRef.current),
        ]);
        if (!alive) return;
        setCollection(coll);
        setSettings(sett);
        setPool(cached.images);

        // 有指针就原样沿用——**绝不在打开时做任何替换**，
        // 这是「多开几个标签页看到的是同一张」的根本保证。
        displayedRef.current = disp;
        setDisplayed(disp);
        initedRef.current = true;
        void syncBackdrop(disp);

        // 首次安装且图池缓存是今天写的：直接用它建图，省掉一次串行等待
        if (!disp && cached.images.length && cached.at) {
          const sameDay =
            new Date(cached.at).toDateString() === new Date().toDateString();
          if (sameDay) await switchTo(snapFromBing(cached.images[0]));
        }
      } finally {
        markReady();
      }
    })();
    return () => {
      alive = false;
    };
  }, [syncBackdrop, switchTo]);

  // 图池刷新：挂载时一次，切换界面语言时一次（语言只换图池与文案来源，不换当前图）
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      await readyRef.current; // 等初始化决策，避免把已有壁纸误判成首次安装
      if (!alive) return;
      await refreshPool(false);
    })();
    return () => {
      alive = false;
    };
  }, [locale, refreshPool]);

  // 页面长期开着时定期回看图池，让当天的新图有机会进入轮换
  React.useEffect(() => {
    const id = window.setInterval(() => void refreshRef.current?.(false), POLL_INTERVAL);
    return () => window.clearInterval(id);
  }, []);

  // 多标签页 / 设置面板同步：只同步收藏与设置。
  // 刻意不同步 displayed——另一个标签页「换一张」不应让本页背景突然变化；
  // 新开的标签页会读到最新的 displayed，那时才跟进。
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
          setSettings((prev) => ({
            ...(prev ?? ({} as WallpaperSettings)),
            ...(v as WallpaperSettings),
          }));
        }
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // 展示地址：本地图库命中 → blob（毫秒级上屏）；未命中 → 远程地址（首次安装等网络）
  React.useEffect(() => {
    const d = displayed;
    if (!d) {
      setDisplayUrl("");
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    void (async () => {
      const res = await resolveWallpaperUrl(d.url, d.key);
      if (cancelled) {
        if (res.isBlob) URL.revokeObjectURL(res.url);
        return;
      }
      created = res.isBlob ? res.url : null;
      setDisplayUrl(res.url);
    })();
    return () => {
      cancelled = true;
      const u = created;
      // 延后释放：交叉淡入期间旧图仍在渲染，立刻 revoke 会让旧图变空白
      if (u) window.setTimeout(() => URL.revokeObjectURL(u), REVOKE_DELAY);
    };
  }, [displayed]);

  // 收藏变化后重新预热下一张（钉选的图被改动了，下一张是谁也跟着变）
  React.useEffect(() => {
    if (!initedRef.current || !displayedRef.current) return;
    whenIdle(() => void preloadRef.current?.());
  }, [collection]);

  // 自动轮换：只按「页面可见时长」推进，后台逗留不计入。
  // 计时器自我续排：到点后无论是否真的换了图（可能池内只有一张），都排下一段。
  const elapsedRef = React.useRef(0);
  const startedRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!settings?.autoRotate) {
      elapsedRef.current = 0;
      startedRef.current = null;
      return;
    }
    if (!visible) return;
    const intervalMs = Math.max(1, settings.rotateIntervalMin) * 60 * 1000;
    if (startedRef.current == null) startedRef.current = Date.now();
    let id = 0;
    const schedule = () => {
      const remaining = Math.max(500, intervalMs - elapsedRef.current);
      id = window.setTimeout(() => {
        elapsedRef.current = 0;
        startedRef.current = Date.now();
        rotateRef.current?.();
        schedule();
      }, remaining);
    };
    schedule();
    return () => {
      window.clearTimeout(id);
      if (startedRef.current != null) {
        elapsedRef.current += Date.now() - startedRef.current;
        startedRef.current = null;
      }
    };
  }, [settings?.autoRotate, settings?.rotateIntervalMin, visible]);

  // 已收藏判定：按归一化 id 比对（跨语言 / 跨分辨率一致）
  const liked =
    !!displayed && collection.some((w) => canonicalWallpaperId(w.url) === displayed.key);

  // 换一张：字节通常已预热好，是秒切；没预热就先下载，画面保持不动
  const advance = advanceToNext;

  // 防止快速连点 / 并发重复入库
  const likePendingRef = React.useRef(false);
  const toggleLike = React.useCallback(async (): Promise<{ liked: boolean } | null> => {
    const cur = displayedRef.current;
    if (!cur || likePendingRef.current) return null;
    likePendingRef.current = true;
    try {
      const existing = collRef.current.find((w) => canonicalWallpaperId(w.url) === cur.key);
      if (existing) {
        // 取消收藏不切换当前展示的图（字节仍在本地，画面照常）。
        const next = await removeFromCollection(existing.id);
        setCollection(next);
        return { liked: false };
      }
      const thumb = await generateThumb(cur.url);
      const next = await addToCollection({
        url: cur.url,
        title: cur.title,
        copyright: cur.copyright,
        copyrightlink: cur.copyrightlink,
        thumb,
        source: cur.kind === "collection" ? "custom" : "bing",
        date: cur.date,
      });
      setCollection(next);
      return { liked: true };
    } finally {
      likePendingRef.current = false;
    }
  }, []);

  const selectFromGallery = React.useCallback(
    (id: string) => {
      const w = collRef.current.find((x) => x.id === id);
      if (!w) return;
      void (async () => {
        // 选中收藏 = 钉住这张图并关闭自动轮换（其余时间壁纸始终来自必应图库）
        const s = settRef.current;
        if (s && s.autoRotate) {
          setSettings(await saveWallpaperSettings({ autoRotate: false }));
        }
        await switchTo(snapFromSaved(w));
      })();
    },
    [switchTo]
  );

  const removeFromGallery = React.useCallback((id: string) => {
    void removeFromCollection(id).then((next) => {
      setCollection(next);
    });
  }, []);

  return {
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
  };
}
