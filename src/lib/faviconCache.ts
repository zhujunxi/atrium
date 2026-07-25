/**
 * 本地 favicon 字节缓存（IndexedDB + 内存预热）。
 *
 * 首次按候选链成功抓取后把字节存入本地；之后所有刷新都直接出 dataURL：
 * 消除闪屏、不再消耗远程流量、可离线。
 *
 * 字节由 background service worker 抓取——SW 的 fetch 不受页面 CORS 限制，
 * 但读取 icons.duckduckgo.com 的字节需要针对它声明 host_permissions。
 * 缓存未命中（如抓取失败）时调用方退化为远程直连，行为等同于改造前。
 */

const DB_NAME = "atrium";
const STORE = "favicons";
const TTL = 30 * 24 * 60 * 60 * 1000; // 30 天

interface Entry {
  domain: string;
  variant: string;
  dataUrl: string;
  at: number;
}

const memCache = new Map<string, string>(); // `${domain}|${variant}` -> dataUrl
const keyOf = (domain: string, variant: string) => `${domain}|${variant}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 升版本清空旧库：早期版本曾误缓存 DDG 默认占位图（箭头），需丢弃重抓
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: ["domain", "variant"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 仅查内存（同步），用于首屏在 IndexedDB 就绪前也能瞬时出图 */
export function getCachedSync(domain: string, variant = "std"): string | null {
  return memCache.get(keyOf(domain, variant)) ?? null;
}

/** 内存 → IndexedDB（命中且在 TTL 内） */
export async function getCached(domain: string, variant = "std"): Promise<string | null> {
  const k = keyOf(domain, variant);
  const mem = memCache.get(k);
  if (mem) return mem;
  try {
    const db = await openDB();
    const rec = await new Promise<Entry | undefined>((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get([domain, variant]);
      r.onsuccess = () => res(r.result as Entry | undefined);
      r.onerror = () => rej(r.error);
    });
    if (rec && Date.now() - rec.at < TTL) {
      memCache.set(k, rec.dataUrl);
      return rec.dataUrl;
    }
  } catch {
    /* IndexedDB 不可用时退化为远程直连 */
  }
  return null;
}

export async function setCached(domain: string, variant: string, dataUrl: string): Promise<void> {
  const k = keyOf(domain, variant);
  memCache.set(k, dataUrl);
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ domain, variant, dataUrl, at: Date.now() });
  } catch {
    /* 忽略写入失败 */
  }
}

/** 让 background SW 抓取远程图标字节并返回 dataURL（跨域读字节需 host 权限） */
function fetchIconBytes(remoteUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "fetchIconBytes", url: remoteUrl }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res?.dataUrl ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * 返回本地缓存的 dataURL；缓存未命中则按候选链顺序回源抓取并入库。
 * 全部失败返回 null（调用方退化为远程直连，行为等同于改造前）。
 */
export async function ensureFavicon(
  domain: string,
  candidateUrls: string[],
  variant = "std"
): Promise<string | null> {
  const cached = await getCached(domain, variant);
  if (cached) return cached;
  for (const u of candidateUrls) {
    const dataUrl = await fetchIconBytes(u);
    if (dataUrl) {
      await setCached(domain, variant, dataUrl);
      return dataUrl;
    }
  }
  return null;
}

/** 启动时一次性把 IndexedDB 全量预热到内存，确保首屏也是瞬时出图 */
export async function primeCache(): Promise<void> {
  try {
    const db = await openDB();
    const all = await new Promise<Entry[]>((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () => res((r.result as Entry[]) || []);
      r.onerror = () => rej(r.error);
    });
    const now = Date.now();
    for (const e of all) {
      if (now - e.at < TTL) memCache.set(keyOf(e.domain, e.variant), e.dataUrl);
    }
  } catch {
    /* 忽略 */
  }
}

// 模块加载即预热（fire-and-forget）
if (typeof indexedDB !== "undefined") {
  primeCache();
}
