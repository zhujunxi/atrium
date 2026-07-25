/**
 * 本地 favicon 字节缓存（IndexedDB + 内存预热）。
 *
 * 首次按候选链成功抓取后把字节存入本地；之后所有刷新都直接出 dataURL：
 * 消除闪屏、不再消耗远程流量、可离线。
 *
 * 同时缓存「确认无图标」的负结果（negative cache）：命中 DDG 默认占位图等
 * 确凿无图标的情形会写入一条 dataUrl=null 的记录，刷新时直接走字母头像，
 * 不再重复请求远程、不再闪白底。
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
  /** 图标 dataURL；为 null 表示「确认无图标」（负缓存） */
  dataUrl: string | null;
  at: number;
}

const memCache = new Map<string, Entry>(); // `${domain}|${variant}` -> Entry
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

function fresh(e: Entry): boolean {
  return Date.now() - e.at < TTL;
}

/** 仅查内存（同步），用于首屏在 IndexedDB 就绪前也能瞬时出图 */
export function getCachedSync(domain: string, variant = "std"): string | null {
  const e = memCache.get(keyOf(domain, variant));
  return e && fresh(e) && typeof e.dataUrl === "string" ? e.dataUrl : null;
}

/** 仅查内存（同步）：是否已知该域名在 TTL 内「确认无图标」 */
export function isNoIconCachedSync(domain: string, variant = "std"): boolean {
  const e = memCache.get(keyOf(domain, variant));
  return !!e && fresh(e) && e.dataUrl === null;
}

/** 内存 → IndexedDB（命中且在 TTL 内），返回完整 Entry 或 null */
export async function getCachedEntry(
  domain: string,
  variant = "std"
): Promise<Entry | null> {
  const k = keyOf(domain, variant);
  const mem = memCache.get(k);
  if (mem) return fresh(mem) ? mem : null;
  try {
    const db = await openDB();
    const rec = await new Promise<Entry | undefined>((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get([domain, variant]);
      r.onsuccess = () => res(r.result as Entry | undefined);
      r.onerror = () => rej(r.error);
    });
    if (rec && fresh(rec)) {
      memCache.set(k, rec);
      return rec;
    }
  } catch {
    /* IndexedDB 不可用时退化为远程直连 */
  }
  return null;
}

/** 兼容旧签名：返回正图 dataURL；无正图（未命中或负缓存）返回 null */
export async function getCached(domain: string, variant = "std"): Promise<string | null> {
  const e = await getCachedEntry(domain, variant);
  return e && typeof e.dataUrl === "string" ? e.dataUrl : null;
}

export async function setCached(
  domain: string,
  variant: string,
  dataUrl: string | null
): Promise<void> {
  const k = keyOf(domain, variant);
  memCache.set(k, { domain, variant, dataUrl, at: Date.now() });
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ domain, variant, dataUrl, at: Date.now() });
  } catch {
    /* 忽略写入失败 */
  }
}

type FetchResult = { dataUrl: string } | { noIcon: true } | null;

/** 让 background SW 抓取远程图标字节并返回结果（跨域读字节需 host 权限） */
function fetchIconBytes(remoteUrl: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "fetchIconBytes", url: remoteUrl }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        if (!res) return resolve(null);
        if (res.noIcon) return resolve({ noIcon: true });
        if (typeof res.dataUrl === "string") return resolve({ dataUrl: res.dataUrl });
        return resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

export type EnsureResult =
  | { status: "positive"; dataUrl: string }
  | { status: "negative" } // 确凿无图标，已写入负缓存
  | { status: "miss" }; // 瞬断等不确定失败，未缓存，下次可重试

/**
 * 返回本地缓存结果；缓存未命中则按候选链顺序回源抓取并入库。
 * - positive：命中/成功抓到图标（dataURL）；
 * - negative：确认无图标（如命中 DDG 占位图），已写负缓存，刷新不再请求；
 * - miss：纯瞬断/超时等不确定失败，不写缓存，调用方退化为远程直连兜底。
 */
export async function ensureFavicon(
  domain: string,
  candidateUrls: string[],
  variant = "std"
): Promise<EnsureResult> {
  // 已知结果（正图或负缓存）直接返回，不再回源
  const cached = await getCachedEntry(domain, variant);
  if (cached) {
    return cached.dataUrl
      ? { status: "positive", dataUrl: cached.dataUrl }
      : { status: "negative" };
  }

  let dataUrl: string | null = null;
  let definitiveNoIcon = false; // 命中 DDG 占位图等确凿无图标信号
  let transient = false; // 超时/跨域/瞬断等不确定失败
  for (const u of candidateUrls) {
    const r = await fetchIconBytes(u);
    if (r === null) {
      transient = true;
      continue;
    }
    if ("noIcon" in r) {
      definitiveNoIcon = true;
      continue;
    }
    dataUrl = r.dataUrl;
    break;
  }

  // 仅当「确有证据无图标」才写负缓存；瞬断等不确定失败不缓存，避免误判为「无图标」。
  const negative = !dataUrl && definitiveNoIcon && !transient;
  if (dataUrl !== null || negative) {
    await setCached(domain, variant, dataUrl);
  }

  if (dataUrl !== null) return { status: "positive", dataUrl };
  if (negative) return { status: "negative" };
  return { status: "miss" };
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
      if (now - e.at < TTL) memCache.set(keyOf(e.domain, e.variant), e);
    }
  } catch {
    /* 忽略 */
  }
}

// 模块加载即预热（fire-and-forget）
if (typeof indexedDB !== "undefined") {
  primeCache();
}
