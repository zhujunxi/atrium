import * as React from "react";
import type { SavedWallpaper, WallpaperSettings } from "@/lib/types";

/**
 * 壁纸模块（重构版）——「显示一张图」这件事的全部逻辑。
 *
 * ── 速度模型 ─────────────────────────────────────────────────
 *   打开新标签页只有一条路径：
 *     boot.js（首帧前，同步）读 localStorage 里的完整清晰图 dataURL → 画上 body。
 *     React 挂载后初始 state 同步读同一份 localStorage → <img src=dataURL>。
 *   两步都是同步 API，像素一致，全程零闪、零网络、零 IndexedDB、零异步等待。
 *
 * ── 每日更新 ─────────────────────────────────────────────────
 *   新的一天第一次打开：后台刷新图池后，自动切到必应图池当前的头图（最新）。
 *   切换永远走「老图垫底 → 新图下载并 decode 完成 → 交叉淡入」，全程无空白。
 *   当天已换过图（手动换一张 / 选中收藏）则不再动；钉住的收藏不因日期被覆盖。
 *
 * ── 存储（只有两套）─────────────────────────────────────────
 *   localStorage（同步，首屏专用）：
 *     wp:cur   当前壁纸元数据 JSON（key/url/title/copyright/date）
 *     wp:img   当前壁纸完整 dataURL（boot.js 首帧直接画）
 *     wp:next  空闲预取的下一张 { key, data }（「换一张」毫秒级切换）
 *     wp:base  首帧底色 "r,g,b"（图缺失时兜底，避免白闪）
 *     wp:day   每日更新标记（今天已对齐/换过图的日期戳）
 *   chrome.storage.local（异步，功能数据）：
 *     wallpaper-settings  设置（自动轮换 / 间隔 / 压暗蒙版）
 *     wallpaper-collection 收藏列表（url + 缩略图 dataURL，不存原图）
 *     bing-cache-<locale>  必应图池缓存（市场跟随界面语言，30 分钟 TTL）
 *
 * ── 刻意删掉的东西 ───────────────────────────────────────────
 *   IndexedDB 本地图库、32px 模糊兜底图、chrome.storage 壁纸指针、
 *   预热状态机（readyRef / preloadRef / switchTo 时序）。
 *   字节在「换图那一刻」就已经在手（dataURL），顺手写进 localStorage 即可，
 *   不需要再为「下次打开」维护一套缓存基础设施。
 */

// --- localStorage 键 -------------------------------------------------------

const CUR_KEY = "wp:cur";
const IMG_KEY = "wp:img";
const NEXT_KEY = "wp:next";
const BASE_KEY = "wp:base";
const DAY_KEY = "wp:day";
// 旧版遗留键：只读不写，老用户首次打开仍然秒出图，之后自然迁移到新键
const LEGACY_IMG_KEY = "wp:display";
const LEGACY_BASE_KEY = "wp:backdrop-color";

const SETT_KEY = "wallpaper-settings";
const COLL_KEY = "wallpaper-collection";
/**
 * 壁纸市场跟随界面语言（设置里可切换）：zh-CN → 必应中国区每日图，en → 美国区。
 * 各市场当天的头图经常不同，切换语言后图池与每日对齐都会跟着切到对应市场。
 */
const poolKeyOf = (locale: string) => `bing-cache-${locale}`;

/** localStorage 单图上限：展示图是必应 1080p（约 300KB），超过说明拿错了源，放弃写入 */
const MAX_LS_BYTES = 1.5 * 1024 * 1024;

const BING_BASE = "https://www.bing.com";
/** 图池缓存 TTL（只影响「换一张」候选的新鲜度，不影响展示） */
const POOL_TTL = 30 * 60 * 1000;
/** 页面长期开着时，定期回看图池，让新图有机会进入轮换 */
const POLL_INTERVAL = 10 * 60 * 1000;
/** 空闲预取的等待上限：宁可晚一点，也不跟首屏抢带宽 */
const IDLE_TIMEOUT = 3000;

// --- 类型 -----------------------------------------------------------------

/** 当前壁纸的展示快照（渲染与下载只依赖它自己，不依赖图池） */
export interface WallpaperSnap {
  /** 归一化 id：同一张必应图跨语言 / 跨分辨率 / 跨参数稳定 */
  key: string;
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
  /** 来自收藏画廊时对应的收藏 id，否则 null */
  collectionId: string | null;
  /** 壁纸自身日期（YYYY-MM-DD，必应发布日）；收藏图可能没有 */
  date?: string;
}

export interface BingImage {
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
  date: string;
}

const DEFAULT_SETTINGS: WallpaperSettings = {
  autoRotate: false,
  rotateIntervalMin: 30,
  dimMask: true,
};

// --- 小工具 ---------------------------------------------------------------

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 配额满 / 隐私模式：静默，下次打开退化为纯色首帧 */
  }
}

function lsDel(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/** 本地日期戳 YYYY-MM-DD */
export function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * 把壁纸 URL 归一成稳定标识：必应图取照片本名（OHR.Name），
 * 剥掉市场码 / 时间戳 / 分辨率 / 杂参数，同一张图永远映射到同一个 key。
 */
export function canonicalWallpaperId(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host.endsWith("bing.com") || host.endsWith("bing.net")) {
      const id = u.searchParams.get("id");
      if (id) {
        const base = id.replace(/_[\dx]+x[\dx]+\.[a-z]+$/i, "");
        const m = base.match(/^(OHR\.[^_]+)_/i);
        return `bing:${m ? m[1] : base}`;
      }
    }
    return `${host}${u.pathname}`;
  } catch {
    return rawUrl;
  }
}

/** 1080p 展示源 → UHD 4K 源（只用于「下载原图」） */
export function uhdUrl(url: string): string {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id) {
      const uhd = id.replace(/_\d+x\d+\./, "_UHD.");
      if (uhd !== id) return `${BING_BASE}/th?id=${encodeURIComponent(uhd)}`;
    }
  } catch {
    /* 非法 URL 兜底：原样返回 */
  }
  return url;
}

/** 下载任意图片为 dataURL（扩展页有 host_permissions，无跨域问题）；失败返回 null */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > MAX_LS_BYTES) return null;
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 采样图片平均色（"r,g,b"），作下次打开的首帧底色；失败返回 null */
async function avgColorOf(dataUrl: string): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const w = 16;
    const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    if (typeof bmp.close === "function") bmp.close();
    const px = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n++;
    }
    return `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`;
  } catch {
    return null;
  }
}

/** 压缩缩略图 dataURL（画廊网格用）；输入已是 dataURL，无跨域污染问题 */
async function thumbFrom(dataUrl: string, maxW = 160): Promise<string> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(bmp, 0, 0, w, h);
    if (typeof bmp.close === "function") bmp.close();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}

/** 浏览器空闲时再跑，避免和首屏抢带宽 */
function whenIdle(fn: () => void): void {
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") ric(fn, { timeout: IDLE_TIMEOUT });
  else window.setTimeout(fn, 800);
}

// --- 同步首屏读取（React 初始 state / boot.js 共用同一份数据） -------------

function readSnapSync(): WallpaperSnap | null {
  const raw = lsGet(CUR_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<WallpaperSnap>;
    if (typeof c.url === "string" && c.url && typeof c.key === "string") {
      return {
        key: c.key,
        url: c.url,
        title: typeof c.title === "string" ? c.title : "",
        copyright: typeof c.copyright === "string" ? c.copyright : "",
        copyrightlink: typeof c.copyrightlink === "string" ? c.copyrightlink : "",
        collectionId: typeof c.collectionId === "string" ? c.collectionId : null,
        date: typeof c.date === "string" ? c.date : undefined,
      };
    }
  } catch {
    /* 脏数据按无壁纸处理 */
  }
  return null;
}

function readImgSync(): string {
  return lsGet(IMG_KEY) ?? lsGet(LEGACY_IMG_KEY) ?? "";
}

function readBaseSync(): string {
  return lsGet(BASE_KEY) ?? lsGet(LEGACY_BASE_KEY) ?? "";
}

/**
 * 旧版指针迁移：重构前的版本把当前壁纸存在 chrome.storage（wallpaper-current），
 * 升级后 localStorage 里没有 wp:cur。这里只读一次搬过来——配合遗留的 wp:display
 * 首帧图（readImgSync 已兼容），老用户升级后第一次打开依旧无缝。
 */
async function loadLegacySnap(): Promise<WallpaperSnap | null> {
  try {
    const res = await chrome.storage.local.get("wallpaper-current");
    const c = res["wallpaper-current"] as Partial<WallpaperSnap> | undefined;
    if (!c || typeof c.url !== "string" || !c.url) return null;
    return {
      key: typeof c.key === "string" && c.key ? c.key : canonicalWallpaperId(c.url),
      url: c.url,
      title: typeof c.title === "string" ? c.title : "",
      copyright: typeof c.copyright === "string" ? c.copyright : "",
      copyrightlink: typeof c.copyrightlink === "string" ? c.copyrightlink : "",
      collectionId: typeof c.collectionId === "string" ? c.collectionId : null,
      date: typeof c.date === "string" ? c.date : undefined,
    };
  } catch {
    return null;
  }
}

// --- 必应图池 --------------------------------------------------------------

function bingApiUrl(mkt: string) {
  return `https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=${mkt}`;
}

function mktForLocale(locale: string): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

function parseBingDate(raw?: string): string {
  if (raw && /^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return "";
}

// 必应的 startdate 是美西日历日；本页按用户本地日历展示日期，东八区 00:00~15:00
// 会差一天。以图池头图对齐本地当天为准，池内其余图按同一偏移量整体平移（±1 天封顶）。

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

function localizeBingDates(images: BingImage[]): BingImage[] {
  if (!images.length) return images;
  const head = dayStampToUTC(images[0].date);
  const today = dayStampToUTC(todayStamp());
  if (head == null || today == null) return images;
  const offset = Math.round((today - head) / 86400000);
  if (offset === 0 || Math.abs(offset) > 1) return images;
  return images.map((img) => {
    const ms = dayStampToUTC(img.date);
    return ms == null ? img : { ...img, date: utcToDayStamp(ms + offset * 86400000) };
  });
}

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
      // 刻意用接口直接给的 1080p（约 300KB）：背景图不值得让用户等 UHD 的几秒
      url: img.url!.startsWith("http") ? img.url! : BING_BASE + img.url,
      title: img.title ?? "",
      copyright: img.copyright ?? "",
      copyrightlink: img.copyrightlink ?? "",
      date: parseBingDate(img.startdate),
    }));
}

async function readPool(locale: string): Promise<{ at: number; images: BingImage[] }> {
  try {
    const key = poolKeyOf(locale);
    const res = await chrome.storage.local.get(key);
    const e = res[key] as { at?: number; images?: BingImage[] } | undefined;
    return {
      at: typeof e?.at === "number" ? e.at : 0,
      images: localizeBingDates(
        (e?.images ?? []).filter((i): i is BingImage => !!i && typeof i.url === "string")
      ),
    };
  } catch {
    return { at: 0, images: [] };
  }
}

async function writePool(locale: string, images: BingImage[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [poolKeyOf(locale)]: { at: Date.now(), images } });
  } catch {
    /* 写缓存失败不影响展示 */
  }
}

/** 图池里当前图之后的那一张（循环推进，连点「换一张」能走完一圈） */
function pickNext(pool: BingImage[], currentKey: string | null): BingImage | null {
  if (pool.length < 2) return null;
  const keys = pool.map((img) => canonicalWallpaperId(img.url));
  const idx = keys.indexOf(currentKey ?? "");
  const next = pool[(idx + 1) % pool.length];
  return keys[(idx + 1) % pool.length] === currentKey ? null : next;
}

// --- 设置 / 收藏（chrome.storage） -----------------------------------------

export async function loadWallpaperSettings(): Promise<WallpaperSettings> {
  try {
    const res = await chrome.storage.local.get(SETT_KEY);
    const s = res[SETT_KEY];
    if (s && typeof s === "object") return { ...DEFAULT_SETTINGS, ...(s as WallpaperSettings) };
  } catch {
    /* 忽略 */
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveWallpaperSettings(
  patch: Partial<WallpaperSettings>
): Promise<WallpaperSettings> {
  const next = { ...(await loadWallpaperSettings()), ...patch };
  try {
    await chrome.storage.local.set({ [SETT_KEY]: next });
  } catch {
    /* 忽略 */
  }
  return next;
}

export async function loadCollection(): Promise<SavedWallpaper[]> {
  try {
    const res = await chrome.storage.local.get(COLL_KEY);
    const arr = res[COLL_KEY];
    if (!Array.isArray(arr)) return [];
    // 折叠历史遗留的重复（同一张图因 url 串不同被存了多条）：保留首次出现的一条
    const seen = new Set<string>();
    const out: SavedWallpaper[] = [];
    for (const w of arr as SavedWallpaper[]) {
      const cid = canonicalWallpaperId(w.url);
      if (seen.has(cid)) continue;
      seen.add(cid);
      out.push(w);
    }
    return out;
  } catch {
    return [];
  }
}

// 串行化收藏写入，避免快速连点 / 跨标签页并发产生重复条目
let writeChain: Promise<unknown> = Promise.resolve();
function withCollectionWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function addToCollection(img: Omit<SavedWallpaper, "id" | "savedAt">): Promise<SavedWallpaper[]> {
  return withCollectionWrite(async () => {
    const items = await loadCollection();
    const cid = canonicalWallpaperId(img.url);
    if (items.some((w) => canonicalWallpaperId(w.url) === cid)) return items;
    const item: SavedWallpaper = {
      id: `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      ...img,
    };
    const next = [item, ...items];
    try {
      await chrome.storage.local.set({ [COLL_KEY]: next });
    } catch {
      return items;
    }
    return next;
  });
}

async function removeFromCollection(id: string): Promise<SavedWallpaper[]> {
  return withCollectionWrite(async () => {
    const items = await loadCollection();
    const next = items.filter((w) => w.id !== id);
    try {
      await chrome.storage.local.set({ [COLL_KEY]: next });
    } catch {
      return items;
    }
    return next;
  });
}

// --- Hook ------------------------------------------------------------------

function whenIdlePrefetch(pool: BingImage[], snap: WallpaperSnap | null): void {
  if (!snap) return;
  const next = pickNext(pool, snap.key);
  if (!next) return;
  const nextKey = canonicalWallpaperId(next.url);
  // 已预取同一张就跳过
  try {
    const raw = lsGet(NEXT_KEY);
    if (raw && (JSON.parse(raw) as { key?: string }).key === nextKey) return;
  } catch {
    /* 继续预取 */
  }
  whenIdle(() => {
    void fetchAsDataUrl(next.url).then((data) => {
      if (data) lsSet(NEXT_KEY, JSON.stringify({ key: nextKey, data }));
    });
  });
}

export interface WallpaperApi {
  settings: WallpaperSettings | null;
  collection: SavedWallpaper[];
  /** 当前壁纸快照（元数据） */
  snap: WallpaperSnap | null;
  /**
   * 可直接交给 <img src> 的展示地址：本地字节（dataURL）优先，与 boot.js 首帧同源；
   * 本地字节缺失（首次安装 / 写入失败）时回退远程 url——先出图，不露纯色底。
   */
  displayUrl: string;
  /** 是否正在为一次切换下载新图（底栏可显示 loading） */
  switching: boolean;
  liked: boolean;
  advance: () => void;
  toggleLike: () => Promise<{ liked: boolean } | null>;
  selectFromGallery: (id: string) => void;
  removeFromGallery: (id: string) => void;
}

export function useWallpaper(locale: string): WallpaperApi {
  // 初始 state 全部同步读 localStorage：React 第一帧就是最终画面，没有二次上屏
  const [snap, setSnap] = React.useState<WallpaperSnap | null>(() => readSnapSync());
  const [img, setImg] = React.useState<string>(() => readImgSync());
  const [pool, setPool] = React.useState<BingImage[]>([]);
  const [collection, setCollection] = React.useState<SavedWallpaper[]>([]);
  const [settings, setSettings] = React.useState<WallpaperSettings | null>(null);
  const [switching, setSwitching] = React.useState(false);

  const localeRef = React.useRef(locale);
  localeRef.current = locale;
  const poolRef = React.useRef(pool);
  poolRef.current = pool;
  const snapRef = React.useRef(snap);
  snapRef.current = snap;
  /** 旧版指针迁移只跑一次的闸门 */
  const legacyDoneRef = React.useRef(false);

  const prefetchRef = React.useRef<(p: BingImage[]) => void>(() => {});
  prefetchRef.current = (p) => whenIdlePrefetch(p, snapRef.current);

  /**
   * 提交为当前壁纸：字节（dataUrl）已在手，同步写 localStorage，
   * 下次打开 boot.js 直接画它。平均色后台补写，不阻塞切换。
   */
  const commit = React.useCallback((next: WallpaperSnap, dataUrl: string) => {
    snapRef.current = next;
    setSnap(next);
    setImg(dataUrl);
    lsSet(CUR_KEY, JSON.stringify(next));
    lsSet(IMG_KEY, dataUrl);
    lsDel(NEXT_KEY); // 旧预取已消费，等空闲后为新下一张重建
    void avgColorOf(dataUrl).then((color) => {
      if (color) lsSet(BASE_KEY, color);
    });
    whenIdle(() => prefetchRef.current?.(poolRef.current));
  }, []);

  /** 切换到指定图：预取命中直接用，否则现场下载；下载完成前画面保持不动 */
  const switchTo = React.useCallback(
    async (next: BingImage | SavedWallpaper) => {
      const nextSnap: WallpaperSnap = {
        key: canonicalWallpaperId(next.url),
        url: next.url,
        title: next.title,
        copyright: next.copyright,
        copyrightlink: "copyrightlink" in next ? next.copyrightlink : "",
        collectionId: "id" in next && "thumb" in next ? next.id : null,
        date: next.date || undefined,
      };
      if (snapRef.current?.key === nextSnap.key) return;
      setSwitching(true);
      try {
        let data: string | null = null;
        try {
          const raw = lsGet(NEXT_KEY);
          const pre = raw ? (JSON.parse(raw) as { key?: string; data?: string }) : null;
          if (pre?.key === nextSnap.key && pre.data) data = pre.data;
        } catch {
          /* 预取脏数据按未命中处理 */
        }
        if (!data) data = await fetchAsDataUrl(next.url);
        if (!data || snapRef.current?.key === nextSnap.key) return;
        commit(nextSnap, data);
      } finally {
        setSwitching(false);
      }
    },
    [commit]
  );

  /** 换一张 / 轮换到点：下一张通常已被空闲预取，毫秒级切换 */
  const advance = React.useCallback(() => {
    const next = pickNext(poolRef.current, snapRef.current?.key ?? null);
    if (next) void switchTo(next);
  }, [switchTo]);

  /**
   * 每日更新：打开时把壁纸对齐到必应图池当前的头图（最新）。
   * - 标记 wp:day 记的是「日期|头图key」：对齐过这张头图就不再动；
   *   头图换新（新的一天 / 市场更新）时标记自动失效，重新对齐；
   * - 手动「换一张」当天不会被拉回（头图当天不变，标记持续命中），
   *   但第二天头图更新后会重新对齐到最新——「最新」优先级最高；
   * - 钉住的收藏不覆盖；切换由 switchTo 完成：老图垫底，
   *   新图下载 decode 完成后交叉淡入，无空白；下载失败不写标记，下次重试。
   */
  const maybeDailySwitch = React.useCallback(
    async (images: BingImage[]) => {
      const head = images[0];
      if (!head) return;
      const headKey = canonicalWallpaperId(head.url);
      const aligned = `${todayStamp()}|${headKey}`;
      if (lsGet(DAY_KEY) === aligned) return; // 已对齐到这张头图
      const cur = snapRef.current;
      if (!cur) return; // 首次安装走建图路径
      if (cur.collectionId != null) {
        lsSet(DAY_KEY, aligned); // 钉住的收藏不覆盖
        return;
      }
      if (cur.key === headKey) {
        lsSet(DAY_KEY, aligned); // 已是最新
        return;
      }
      await switchTo(head);
      if (snapRef.current?.key === headKey) lsSet(DAY_KEY, aligned);
    },
    [switchTo]
  );

  // 首次加载：读设置与收藏。图池与每日对齐统一在下面的 locale effect 里做，
  // 保证「对齐到哪个市场」只由生效语言这一条路径决定，不与初始化并发竞争。
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [sett, coll] = await Promise.all([
        loadWallpaperSettings(),
        loadCollection(),
      ]);
      if (!alive) return;
      setSettings(sett);
      setCollection(coll);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 图池加载 + 每日对齐：唯一路径。挂载时跑一次，生效语言变化时重跑。
  // locale 来自 Provider 首帧同步镜像（见 i18n），不会再出现「先用检测语言
  // 对齐、设置异步加载后又切回来」的双路径竞态。
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      // 旧版迁移（只跑一次）：升级后 localStorage 里没有 wp:cur 时，读一次
      // chrome.storage 的旧指针接过来（配合遗留 wp:display 首帧图，无缝升级）
      if (!legacyDoneRef.current) {
        legacyDoneRef.current = true;
        if (!snapRef.current) {
          const legacy = await loadLegacySnap();
          if (legacy && readImgSync()) {
            snapRef.current = legacy;
            setSnap(legacy);
          }
        }
      }

      const cached = await readPool(locale);
      if (!alive) return;
      setPool(cached.images);
      let fresh = cached.images;
      // 图池「新鲜」= 缓存是今天写的且未过 TTL，或本次刚拉取成功。
      // 每日对齐只在新鲜池子上做：过期池的头图可能是前几天的图，且不同市场的
      // 同名照片归一化后同 key，会把旧图误判成「已是最新」而卡住不更新。
      let poolFresh =
        !!cached.at &&
        Date.now() - cached.at <= POOL_TTL &&
        new Date(cached.at).toDateString() === new Date().toDateString();
      if (!poolFresh) {
        try {
          const got = localizeBingDates(await fetchBing(mktForLocale(locale)));
          if (got.length) {
            await writePool(locale, got);
            if (alive) {
              setPool(got);
              fresh = got;
              poolFresh = true;
            }
          }
        } catch {
          /* 网络异常：保留缓存池，展示不受影响 */
        }
      }

      if (!snapRef.current && fresh.length) {
        // 真正的首次安装：建立第一张
        await switchTo(fresh[0]);
        return;
      }

      // 每日更新：自动切到必应当前的新图。
      // 老图已画在底层（boot.js / shown），新图下载 decode 完成后交叉淡入，无空白。
      if (poolFresh) await maybeDailySwitch(fresh);
      prefetchRef.current?.(fresh);
    })();
    return () => {
      alive = false;
    };
  }, [locale, maybeDailySwitch]);

  // 页面长期开着时定期复查；回到前台时也复查一次。
  // 复查 = 图池过期就拉新 + 每日对齐重查。对齐有 wp:day 标记挡着，
  // 已对齐时是零开销空转；一旦此前对齐失败（下载失败 / 上次 races），
  // 这里会在 10 分钟内、或用户切回标签页的瞬间自动重试，绝不静默卡死。
  React.useEffect(() => {
    const refresh = async () => {
      const cached = await readPool(localeRef.current);
      let fresh = cached.images;
      let poolFresh =
        !!cached.at &&
        Date.now() - cached.at <= POOL_TTL &&
        new Date(cached.at).toDateString() === new Date().toDateString();
      if (!poolFresh) {
        try {
          const got = localizeBingDates(
            await fetchBing(mktForLocale(localeRef.current))
          );
          if (got.length) {
            await writePool(localeRef.current, got);
            setPool(got);
            fresh = got;
            poolFresh = true;
          }
        } catch {
          /* 网络异常：保留缓存池，下次再试 */
        }
      }
      if (poolFresh) await maybeDailySwitch(fresh);
    };
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [maybeDailySwitch]);

  // 多标签页 / 设置面板同步：只同步设置与收藏；当前壁纸刻意不同步
  // （别的标签页「换一张」不应让本页背景突变；新开的标签页读到的自然是最新值）
  React.useEffect(() => {
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== "local") return;
      if (changes[COLL_KEY] && Array.isArray(changes[COLL_KEY].newValue)) {
        setCollection(changes[COLL_KEY].newValue as SavedWallpaper[]);
      }
      if (changes[SETT_KEY] && typeof changes[SETT_KEY].newValue === "object") {
        setSettings((prev) => ({
          ...(prev ?? DEFAULT_SETTINGS),
          ...(changes[SETT_KEY].newValue as WallpaperSettings),
        }));
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // 自动轮换：只在页面可见时计时（切后台暂停，切回前台重新计满一个周期）
  React.useEffect(() => {
    if (!settings?.autoRotate || !visibleNow()) return;
    const intervalMs = Math.max(1, settings.rotateIntervalMin) * 60 * 1000;
    const id = window.setTimeout(advance, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "hidden") window.clearTimeout(id);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [settings?.autoRotate, settings?.rotateIntervalMin, advance]);

  // 已收藏判定：按归一化 id 比对（跨语言 / 跨分辨率一致）
  const liked =
    !!snap && collection.some((w) => canonicalWallpaperId(w.url) === snap.key);

  const toggleLike = React.useCallback(async (): Promise<{ liked: boolean } | null> => {
    const cur = snapRef.current;
    if (!cur) return null;
    const existing = (await loadCollection()).find(
      (w) => canonicalWallpaperId(w.url) === cur.key
    );
    if (existing) {
      setCollection(await removeFromCollection(existing.id));
      return { liked: false };
    }
    // 本地字节在手直接压缩略图；缺失（远程兜底展示中）就取远程 url，同样可行
    const thumb = await thumbFrom(img || cur.url);
    setCollection(
      await addToCollection({
        url: cur.url,
        title: cur.title,
        copyright: cur.copyright,
        copyrightlink: cur.copyrightlink,
        thumb,
        source: cur.collectionId ? "custom" : "bing",
        date: cur.date,
      })
    );
    return { liked: true };
  }, [img]);

  const selectFromGallery = React.useCallback(
    (id: string) => {
      void (async () => {
        const items = await loadCollection();
        const target = items.find((x) => x.id === id);
        if (!target) return;
        // 选中收藏 = 钉住这张图并关闭自动轮换
        const s = await loadWallpaperSettings();
        if (s.autoRotate) setSettings(await saveWallpaperSettings({ autoRotate: false }));
        await switchTo(target);
      })();
    },
    [switchTo]
  );

  const removeFromGallery = React.useCallback((id: string) => {
    void removeFromCollection(id).then((next) => setCollection(next));
  }, []);

  return {
    settings,
    collection,
    snap,
    displayUrl: img || snap?.url || "",
    switching,
    liked,
    advance,
    toggleLike,
    selectFromGallery,
    removeFromGallery,
  };
}

function visibleNow(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}
