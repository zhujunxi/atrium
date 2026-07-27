import * as React from "react";
import {
  COLL_KEY,
  SETT_KEY,
  addToCollection,
  canonicalWallpaperId,
  generateThumb,
  loadCollection,
  loadWallpaperBackdrop,
  loadWallpaperCurrent,
  loadWallpaperSettings,
  removeFromCollection,
  saveWallpaperCurrent,
  saveWallpaperSettings,
  todayStamp,
} from "@/lib/wallpaper-store";
import type {
  SavedWallpaper,
  WallpaperCurrent,
  WallpaperSettings,
} from "@/lib/types";

/**
 * 壁纸控制器（产品逻辑单一来源）。
 *
 * 设计原则：壁纸只在「可预期的时刻」变化——
 * 1. 打开新标签页：永远先显示上次那张（渲染只依赖 WallpaperCurrent 的 url 快照，
 *    不依赖必应图池的加载结果与顺序）；
 * 2. 跨天且处于「每日一图」模式：换成当日新图，一天最多一次；
 * 3. 用户点「换一张」或在画廊中选择；
 * 4. 自动轮换到期：若在打开瞬间就已到期，首屏直接以新图呈现（打开前决策，
 *    不做「旧图→新图」的可见闪切）；页面开着时到期则正常交叉淡入。
 * 切换界面语言只影响后续新图的来源与文案，不改变当前展示的图。
 */

export interface BingImage {
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
}

// 扩展页无 CORS 限制（配合 host_permissions），直连必应每日图接口。
// mkt 跟随界面语言：中文界面取 zh-CN（中文文案），其余取 en-US。
const BING_BASE = "https://www.bing.com";
const CACHE_TTL = 30 * 60 * 1000; // 图池缓存 30 分钟（只影响「换一张」的池子新鲜度）

function bingApiUrl(mkt: string) {
  return `https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=${mkt}`;
}

function mktForLocale(locale: string): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

async function fetchBing(mkt: string): Promise<BingImage[]> {
  const res = await fetch(bingApiUrl(mkt), { cache: "no-store" });
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
  };
}

/** 按模式从对应池子里随机挑一张与 currentKey 不同的图（无候选时返回 null） */
function pickNext(
  mode: WallpaperSettings["mode"],
  pool: BingImage[],
  collection: SavedWallpaper[],
  currentKey: string | null
): WallpaperCurrent | null {
  type Cand = { cid: string; snap: () => WallpaperCurrent };
  let cands: Cand[] = [];
  if (mode === "collection") {
    cands = collection.map((w) => ({
      cid: canonicalWallpaperId(w.url),
      snap: () => snapFromSaved(w),
    }));
  } else if (mode === "shuffle-all") {
    // 同一张图可能同时在必应池与收藏池（url 串不同但归一 id 相同），按归一 id 去重
    const collCands = collection.map((w) => ({
      cid: canonicalWallpaperId(w.url),
      snap: () => snapFromSaved(w),
    }));
    const collIds = new Set(collCands.map((c) => c.cid));
    const bingCands = pool
      .map((img) => ({ cid: canonicalWallpaperId(img.url), snap: () => snapFromBing(img) }))
      .filter((c) => !collIds.has(c.cid));
    cands = [...bingCands, ...collCands];
  } else {
    cands = pool.map((img) => ({
      cid: canonicalWallpaperId(img.url),
      snap: () => snapFromBing(img),
    }));
  }
  const others = cands.filter((c) => c.cid !== currentKey);
  if (others.length === 0) return null;
  const pick = others[Math.floor(Math.random() * others.length)];
  return pick.snap();
}

/** 自动轮换是否已到期 */
function rotationExpired(sett: WallpaperSettings, cur: WallpaperCurrent): boolean {
  if (!sett.autoRotate) return false;
  const intervalMs = Math.max(1, sett.rotateIntervalMin) * 60 * 1000;
  return Date.now() - new Date(cur.setAt).getTime() >= intervalMs;
}

/**
 * 首屏指针决策（在任何图片呈现之前执行一次）：
 * - 有快照：优先原样沿用；仅当「轮换已到期」或「每日一图跨天」时换成新图——
 *   由于发生在首屏之前，用户看到的直接就是新图，没有旧图→新图的闪切。
 * - 无快照（首次使用 / v1 迁移）：按模式取默认第一张。
 */
function resolveInitial(
  sett: WallpaperSettings,
  collection: SavedWallpaper[],
  pool: BingImage[],
  stored: WallpaperCurrent | null
): WallpaperCurrent | null {
  if (stored) {
    if (rotationExpired(sett, stored)) {
      const next = pickNext(sett.mode, pool, collection, stored.key);
      if (next) return next;
    }
    if (sett.mode === "bing-daily" && stored.dayStamp !== todayStamp() && pool[0]) {
      const cid = canonicalWallpaperId(pool[0].url);
      if (cid !== stored.key) return snapFromBing(pool[0]);
      return { ...stored, dayStamp: todayStamp() };
    }
    return stored;
  }
  if (sett.mode === "collection" && collection[0]) return snapFromSaved(collection[0]);
  if (pool[0]) return snapFromBing(pool[0]);
  if (collection[0]) return snapFromSaved(collection[0]);
  return null;
}

export interface WallpaperApi {
  settings: WallpaperSettings | null;
  collection: SavedWallpaper[];
  current: WallpaperCurrent | null;
  backdrop: string;
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
  const [current, setCurrent] = React.useState<WallpaperCurrent | null>(null);
  const [backdrop, setBackdrop] = React.useState("");
  const initedRef = React.useRef(false);

  // 异步回调中取最新值用（避免闭包吃到过期 state）
  const poolRef = React.useRef(pool);
  poolRef.current = pool;
  const collRef = React.useRef(collection);
  collRef.current = collection;
  const settRef = React.useRef(settings);
  settRef.current = settings;
  const curRef = React.useRef(current);
  curRef.current = current;

  const commit = React.useCallback((next: WallpaperCurrent) => {
    setCurrent(next);
    void saveWallpaperCurrent(next);
  }, []);

  /**
   * 新图池就绪后的唯一「被动换图」规则：每日一图模式跨天 → 切到当日新图。
   * 其余情况（缓存刷新、切换语言、列表滚动）一律不动当前展示的图。
   */
  const applyDailyUpdate = React.useCallback(
    (freshPool: BingImage[]) => {
      const sett = settRef.current;
      const cur = curRef.current;
      if (!sett || !cur) return;
      if (sett.mode !== "bing-daily") return;
      const today = todayStamp();
      if (cur.dayStamp === today) return;
      const img = freshPool[0];
      if (!img) return;
      if (canonicalWallpaperId(img.url) === cur.key) {
        commit({ ...cur, dayStamp: today });
      } else {
        commit(snapFromBing(img));
      }
    },
    [commit]
  );

  // 初始化：一次性并行读齐所有存储，在呈现任何图片之前完成首屏指针决策。
  // 网络请求不阻塞首屏——先用缓存图池决策，新池到达后仅按「跨天」规则被动换图。
  React.useEffect(() => {
    let alive = true;
    const mkt = mktForLocale(locale);
    const cacheKey = `bing-cache-${locale}`;
    (async () => {
      const [coll, sett, stored, bg, cacheRes] = await Promise.all([
        loadCollection(),
        loadWallpaperSettings(),
        loadWallpaperCurrent(),
        loadWallpaperBackdrop(),
        chrome.storage.local.get(cacheKey),
      ]);
      if (!alive) return;
      const entry = cacheRes[cacheKey] as { at: number; images: BingImage[] } | undefined;
      const cachedPool = entry?.images ?? [];

      setCollection(coll);
      setSettings(sett);
      setBackdrop(bg);
      setPool(cachedPool);

      const initial = resolveInitial(sett, coll, cachedPool, stored);
      if (initial) {
        setCurrent(initial);
        if (initial !== stored) void saveWallpaperCurrent(initial);
      }
      initedRef.current = true;

      if (!entry || Date.now() - entry.at > CACHE_TTL) {
        try {
          const fresh = await fetchBing(mkt);
          if (!fresh.length || !alive) return;
          await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), images: fresh } });
          if (!alive) return;
          setPool(fresh);
          if (!curRef.current) {
            // 首次使用且当时无缓存：用新池补建指针
            const sett2 = settRef.current;
            const built = sett2
              ? resolveInitial(sett2, collRef.current, fresh, null)
              : null;
            if (built) commit(built);
          } else {
            applyDailyUpdate(fresh);
          }
        } catch {
          /* 网络异常：保留缓存池 / 当前快照，展示不受影响 */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // locale 变化时重跑：只会换图池与文案来源；current 渲染自快照，不受影响。
  }, [locale, commit, applyDailyUpdate]);

  // 多标签页 / 设置面板同步：只同步收藏与设置。
  // 刻意不同步 wallpaper-current——另一个标签页「换一张」不应让本页背景突然变化。
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

  // 模式切换（设置面板）是用户主动操作，立即生效是符合预期的变化：
  // - 切到「我的收藏」：当前图不在收藏中时，换成收藏里的对应图 / 第一张；
  // - 切到「每日一图」：当前图不是必应图时，换成今日图；
  // - 切到「随机」：不动，保持当前图，仅影响后续「换一张」的池子。
  const prevModeRef = React.useRef<WallpaperSettings["mode"] | null>(null);
  React.useEffect(() => {
    const mode = settings?.mode;
    if (!mode) return;
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (!initedRef.current || prev === null || prev === mode) return;
    const cur = curRef.current;
    if (mode === "collection") {
      if (cur?.kind !== "collection") {
        const w =
          collRef.current.find((x) => canonicalWallpaperId(x.url) === cur?.key) ??
          collRef.current[0];
        if (w) commit(snapFromSaved(w));
      }
    } else if (mode === "bing-daily") {
      if (cur?.kind !== "bing") {
        const img = poolRef.current[0];
        if (img) commit(snapFromBing(img));
      }
    }
  }, [settings?.mode, commit]);

  // 换一张：按模式在对应池子里随机选一张不同的
  const advance = React.useCallback(() => {
    const sett = settRef.current;
    const cur = curRef.current;
    if (!sett) return;
    const next = pickNext(sett.mode, poolRef.current, collRef.current, cur?.key ?? null);
    if (next) commit(next);
  }, [commit]);

  // 自动轮换：页面开着时到期换下一张（交叉淡入）。
  // 打开时已到期的情况在初始化阶段处理（首屏直接是新图），此处只管在场计时。
  React.useEffect(() => {
    if (!settings?.autoRotate || !current) return;
    const intervalMs = Math.max(1, settings.rotateIntervalMin) * 60 * 1000;
    const elapsed = Date.now() - new Date(current.setAt).getTime();
    const delay = Math.max(0, intervalMs - elapsed);
    const id = window.setTimeout(() => advance(), delay);
    return () => window.clearTimeout(id);
  }, [settings?.autoRotate, settings?.rotateIntervalMin, current?.setAt, advance, current]);

  // 已收藏判定：按归一化 id 比对（跨语言 / 跨分辨率一致）
  const liked =
    !!current && collection.some((w) => canonicalWallpaperId(w.url) === current.key);

  // 防止快速连点 / 并发重复入库
  const likePendingRef = React.useRef(false);
  const toggleLike = React.useCallback(async (): Promise<{ liked: boolean } | null> => {
    const cur = curRef.current;
    if (!cur || likePendingRef.current) return null;
    likePendingRef.current = true;
    try {
      const existing = collRef.current.find(
        (w) => canonicalWallpaperId(w.url) === cur.key
      );
      if (existing) {
        const next = await removeFromCollection(existing.id);
        setCollection(next);
        // 取消收藏不切换当前展示的图（快照仍可渲染）；
        // 若收藏被清空且模式为收藏，回退为每日一图，展示图保持不动。
        if (next.length === 0 && settRef.current?.mode === "collection") {
          const s = await saveWallpaperSettings({ mode: "bing-daily" });
          setSettings(s);
        }
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
      commit(snapFromSaved(w));
      void saveWallpaperSettings({ mode: "collection" }).then(setSettings);
    },
    [commit]
  );

  const removeFromGallery = React.useCallback(
    (id: string) => {
      void removeFromCollection(id).then(async (next) => {
        setCollection(next);
        const cur = curRef.current;
        const sett = settRef.current;
        if (!sett) return;
        if (next.length === 0) {
          // 收藏清空：模式回退每日一图；当前展示的图不动（快照仍可渲染）
          if (sett.mode === "collection") {
            const s = await saveWallpaperSettings({ mode: "bing-daily" });
            setSettings(s);
          }
          return;
        }
        // 删的是当前展示图且处于收藏模式：平滑切到收藏里的下一张
        if (sett.mode === "collection" && cur?.collectionId === id) {
          commit(snapFromSaved(next[0]));
        }
      });
    },
    [commit]
  );

  return {
    settings,
    collection,
    current,
    backdrop,
    liked,
    advance,
    toggleLike,
    selectFromGallery,
    removeFromGallery,
  };
}
