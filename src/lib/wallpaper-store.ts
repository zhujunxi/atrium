import type {
  SavedWallpaper,
  WallpaperCurrent,
  WallpaperMode,
  WallpaperSettings,
} from "@/lib/types";

// 与 nav-data / bing-cache-* 同级，全部落在 chrome.storage.local（无需新权限）
export const COLL_KEY = "wallpaper-collection";
export const SETT_KEY = "wallpaper-settings";
const CUR_KEY = "wallpaper-current";

/**
 * 把壁纸 URL 归一成稳定标识。
 * 必应每日图的 url 含易变参数（如 &rf=…、&pid=hp）与分辨率后缀（_1920x1080.jpg），
 * 同一张图在不同时刻 / 不同模式下拿到的 url 字符串并不相同。若按整串相等去重，
 * 会出现「同一张图有的有红心、有的没有」以及「同一张图被重复收藏」的问题。
 * 这里只取 th?id= 的稳定主体（OHR.Name_MARKET<ts>），忽略分辨率与杂参数，
 * 让同一张图在任何来源 / 任何模式下都映射到同一个 key。
 */
export function canonicalWallpaperId(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host.endsWith("bing.com") || host.endsWith("bing.net")) {
      const id = u.searchParams.get("id");
      if (id) {
        // OHR.Name_MARKET<ts>_1920x1080.jpg → OHR.Name_MARKET<ts>
        const base = id.replace(/_[\dx]+x[\dx]+\.[a-z]+$/i, "");
        return `bing:${base}`;
      }
    }
    return `${host}${u.pathname}`;
  } catch {
    return rawUrl; // 非法 URL 兜底：原样返回，不崩溃
  }
}

// 串行化收藏的写入，避免并发（快速连点 / 跨标签页）对同一张图产生重复入库：
// 两次 addToCollection 同时读到的都是写入前的列表，就会各插一条。锁住写入链即可。
let writeChain: Promise<unknown> = Promise.resolve();
function withCollectionWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const DEFAULT_SETTINGS: WallpaperSettings = {
  mode: "bing-daily",
  autoRotate: false,
  rotateIntervalMin: 30,
  dimMask: true,
};

const DEFAULT_CURRENT: WallpaperCurrent = {
  bingIndex: 0,
  collectionId: null,
  pool: "bing",
  setAt: new Date().toISOString(),
};

// --- 收藏列表 -------------------------------------------------------------

export async function loadCollection(): Promise<SavedWallpaper[]> {
  const res = await chrome.storage.local.get(COLL_KEY);
  const arr = res[COLL_KEY];
  if (!Array.isArray(arr)) return [];
  // 折叠历史遗留的重复（同一张图因 url 串不同而被存了多条）：保留首次出现的一条。
  const seen = new Set<string>();
  const out: SavedWallpaper[] = [];
  for (const w of arr as SavedWallpaper[]) {
    const cid = canonicalWallpaperId(w.url);
    if (seen.has(cid)) continue;
    seen.add(cid);
    out.push(w);
  }
  return out;
}

async function saveCollection(items: SavedWallpaper[]): Promise<void> {
  await chrome.storage.local.set({ [COLL_KEY]: items });
}

/**
 * 收藏当前壁纸。按「归一化 id」去重：同一张必应图（即使 url 串因 rf/pid/分辨率而不同）
 * 不会重复入库。返回更新后的列表（未变化时原样返回，便于上层判断是否真的新增）。
 * 写入经 withCollectionWrite 串行化，并发调用也不会产生重复条目。
 */
export async function addToCollection(
  img: Omit<SavedWallpaper, "id" | "savedAt">
): Promise<SavedWallpaper[]> {
  return withCollectionWrite(async () => {
    const items = await loadCollection();
    const cid = canonicalWallpaperId(img.url);
    if (items.some((w) => canonicalWallpaperId(w.url) === cid)) return items;
    const item: SavedWallpaper = {
      id: `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      ...img,
    };
    const next = [item, ...items]; // 最新收藏排在最前
    await saveCollection(next);
    return next;
  });
}

export async function removeFromCollection(id: string): Promise<SavedWallpaper[]> {
  return withCollectionWrite(async () => {
    const items = await loadCollection();
    const next = items.filter((w) => w.id !== id);
    await saveCollection(next);
    return next;
  });
}

/** 按给定 id 顺序重排收藏（画廊拖拽排序用） */
export async function reorderCollection(ids: string[]): Promise<SavedWallpaper[]> {
  const items = await loadCollection();
  const map = new Map(items.map((w) => [w.id, w]));
  const next: SavedWallpaper[] = [];
  for (const id of ids) {
    const w = map.get(id);
    if (w) {
      next.push(w);
      map.delete(id);
    }
  }
  // 兜底：把不在 ids 中的（理论上不应出现）追加在末尾
  for (const w of map.values()) next.push(w);
  await saveCollection(next);
  return next;
}

// --- 设置 -----------------------------------------------------------------

export async function loadWallpaperSettings(): Promise<WallpaperSettings> {
  const res = await chrome.storage.local.get(SETT_KEY);
  const s = res[SETT_KEY];
  if (s && typeof s === "object") return { ...DEFAULT_SETTINGS, ...s } as WallpaperSettings;
  return { ...DEFAULT_SETTINGS };
}

export async function saveWallpaperSettings(
  patch: Partial<WallpaperSettings>
): Promise<WallpaperSettings> {
  const cur = await loadWallpaperSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [SETT_KEY]: next });
  return next;
}

// --- 当前壁纸指针 ---------------------------------------------------------

export async function loadWallpaperCurrent(): Promise<WallpaperCurrent> {
  const res = await chrome.storage.local.get(CUR_KEY);
  const c = res[CUR_KEY];
  if (c && typeof c === "object" && typeof c.setAt === "string") {
    return { ...DEFAULT_CURRENT, ...c } as WallpaperCurrent;
  }
  return { ...DEFAULT_CURRENT };
}

export async function saveWallpaperCurrent(c: WallpaperCurrent): Promise<void> {
  await chrome.storage.local.set({ [CUR_KEY]: c });
}

// --- 刷新首屏兜底 ---------------------------------------------------------
// 缓存上一张壁纸的极小缩略图（dataURL），刷新后立即拉伸模糊显示，
// 避免图片下载期间露出页面底色造成的灰色闪屏。

const BACKDROP_KEY = "wallpaper-backdrop";

export async function loadWallpaperBackdrop(): Promise<string> {
  const res = await chrome.storage.local.get(BACKDROP_KEY);
  return (res[BACKDROP_KEY] as string) || "";
}

/**
 * 把指定壁纸压缩为 32px 宽的极小缩略图并缓存，用作刷新首屏的模糊兜底。
 * 失败静默忽略（兜底图缺失时上层会回退到纯色底）。
 */
export async function saveWallpaperBackdrop(url: string): Promise<void> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 32 / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bmp, 0, 0, w, h);
    if (typeof bmp.close === "function") bmp.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
    await chrome.storage.local.set({ [BACKDROP_KEY]: dataUrl });
  } catch {
    /* 忽略 */
  }
}

// --- 缩略图生成 -----------------------------------------------------------

/**
 * 把图片压缩为缩略图 dataURL（画廊网格用）。
 * 通过 fetch→blob→ImageBitmap 绕开跨域污染：blob URL 同源，canvas 不会被 taint，toDataURL 可用。
 * 失败返回空串，上层据此跳过缩略图（仍可用原图兜底）。
 */
export async function generateThumb(url: string, maxW = 160): Promise<string> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    const blob = await res.blob();
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

export type { WallpaperMode };
