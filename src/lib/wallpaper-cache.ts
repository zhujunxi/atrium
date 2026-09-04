/**
 * 壁纸本地图库（IndexedDB）。
 *
 * 存在的理由：整个壁纸体验的地基是「屏幕上的图，字节必定已经在本地」。
 * 只靠 HTTP 缓存做不到这一点——它会被淘汰、会 miss、隐私模式下不落盘，
 * 于是「打开新标签页」总有几率退化成「先糊着、几秒后当着用户的面换图」。
 *
 * 这里把下载过的壁纸按归一化 id（canonicalWallpaperId）持久化成 Blob：
 * - 命中：直接 createObjectURL 交给 <img>，本地 IO，几十毫秒内上屏；
 * - 未命中：后台下载 → 入库 → 下次就是毫秒级。
 *
 * 图库是**纯缓存**：内容可随时重建，任何异常（无 IDB / 配额满 / 隐私模式）
 * 都只降级为「重新走网络」，绝不阻断展示。
 */

const DB_NAME = "atrium-wallpapers";
const DB_VERSION = 1;
const STORE = "images";
/** 图库上限（LRU 淘汰）。UHD 图多为 1–4MB，12 张足以覆盖轮换与每日图需求 */
const MAX_RECORDS = 12;

const BING_BASE = "https://www.bing.com";

interface WallpaperRecord {
  /** 归一化 id（canonicalWallpaperId）：跨语言 / 跨分辨率稳定，同一张图只有一个条目 */
  key: string;
  /** 实际取到字节的 url（可能是 1080p 回退地址，与快照里的 UHD url 不同） */
  url: string;
  blob: Blob;
  bytes: number;
  savedAt: number;
  usedAt: number;
}

// --- IndexedDB 基础封装 ---------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** 打开图库；不可用时返回 null（调用方据此降级，不抛错） */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "key" });
        os.createIndex("usedAt", "usedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

// --- URL 工具 -------------------------------------------------------------

/**
 * 1080p 源升级为 UHD（3840x2160）源：把 id 参数的 _1920x1080.jpg 后缀换成 _UHD.。
 *
 * **只用于「下载原图」**，不作为展示源——UHD 通常 1–4MB，首次加载要几秒；
 * 展示统一用必应 API 直接给的 1080p（约 300KB），与 Bing 搜索首页一致，
 * 注意到画面的是「被压暗、上面还盖着图标文字的背景」，4K 的细节收益远小于等待成本。
 */
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

/** UHD 源取不到时的 1080p 回退地址（少数老必应图没有 _UHD 变体） */
export function loResFallback(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id && id.includes("_UHD.")) {
      return `${u.origin}${u.pathname}?id=${encodeURIComponent(
        id.replace(/_UHD\./, "_1920x1080.")
      )}`;
    }
  } catch {
    /* 非法 URL：无回退 */
  }
  return null;
}

// --- 下载 -----------------------------------------------------------------

/** 按候选顺序取字节：UHD 优先，失败自动回退 1080p */
async function fetchBytes(url: string): Promise<{ blob: Blob; url: string } | null> {
  const candidates = [url, loResFallback(url)].filter((u): u is string => !!u);
  for (const c of candidates) {
    try {
      const res = await fetch(c, { cache: "force-cache" });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;
      return { blob, url: c };
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

// --- 图库读写 -------------------------------------------------------------

/** 读取壁纸字节（并刷新 LRU 时间戳） */
export async function getWallpaperBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, "readonly");
    const rec = await wrap<WallpaperRecord>(tx.objectStore(STORE).get(key));
    if (!rec) return null;
    void touchWallpaper(key);
    return rec.blob ?? null;
  } catch {
    return null;
  }
}

/** 该壁纸的字节是否已在本地（同步返回 false 表示需要下载） */
export async function hasWallpaper(key: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, "readonly");
    const rec = await wrap<WallpaperRecord>(tx.objectStore(STORE).get(key));
    return !!rec?.blob;
  } catch {
    return false;
  }
}

async function touchWallpaper(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rec = await wrap<WallpaperRecord>(store.get(key));
    if (rec) {
      rec.usedAt = Date.now();
      store.put(rec);
    }
    await done(tx);
  } catch {
    /* LRU 时间戳失败无副作用 */
  }
}

async function putWallpaper(key: string, url: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const now = Date.now();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      key,
      url,
      blob,
      bytes: blob.size,
      savedAt: now,
      usedAt: now,
    } satisfies WallpaperRecord);
    await done(tx);
  } catch {
    /* 配额满等写入失败：本次不入库，退化为走网络 */
  }
}

/** 按最近使用时间淘汰，保留最近 max 张 */
async function pruneWallpapers(max = MAX_RECORDS): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const all = await wrap<WallpaperRecord[]>(store.getAll());
    if (!all || all.length <= max) return;
    const stale = all
      .slice()
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(max);
    for (const rec of stale) store.delete(rec.key);
    await done(tx);
  } catch {
    /* 淘汰失败不影响使用，下次再试 */
  }
}

// --- 对外主入口 -----------------------------------------------------------

/**
 * 确保该壁纸的字节已在本地图库。
 * 已命中直接返回；未命中则后台下载（UHD→1080p 回退）并入库。
 * 返回是否成功——调用方据此决定「能否立刻切换过去」。
 */
export async function cacheWallpaper(url: string, key: string): Promise<boolean> {
  if (await hasWallpaper(key)) return true;
  const got = await fetchBytes(url);
  if (!got) return false;
  await putWallpaper(key, got.url, got.blob);
  void pruneWallpapers();
  return true;
}

export interface ResolvedWallpaper {
  /** 可直接交给 <img src> 的地址：本地命中为 blob:，否则为远程地址 */
  url: string;
  /** true 表示 blob: 地址，调用方负责 URL.revokeObjectURL */
  isBlob: boolean;
}

/**
 * 取可展示地址：本地图库命中就用 blob（本地 IO，毫秒级上屏），
 * 否则**原样返回远程地址**（冷启动 / 图库不可用时由渲染层等网络加载）。
 * 刻意不在这里隐式下载：是否下载由控制器的状态机决定，避免打乱切换时序。
 */
export async function resolveWallpaperUrl(url: string, key: string): Promise<ResolvedWallpaper> {
  const blob = await getWallpaperBlob(key);
  if (blob) return { url: URL.createObjectURL(blob), isBlob: true };
  return { url, isBlob: false };
}

/** 清空图库（设置里的「数据」分区可调用；当前未暴露，保留给后续清理入口） */
export async function clearWallpaperCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await done(tx);
  } catch {
    /* 忽略 */
  }
}
