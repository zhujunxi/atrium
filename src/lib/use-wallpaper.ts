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
 * 4. 自动轮换：仅按「页面可见时长」推进，后台逗留不计入；切回标签页不会因后台流逝的
 *    时间而在回来瞬间换图，用户每次切回来看到的就是离开时的那张；页面开着、可见且
 *    累计可见时长到期时正常交叉淡入。
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

/**
 * 首屏指针决策（在任何图片呈现之前执行一次）：
 * - 有快照：原样沿用，绝不在「打开/重载」时因轮换间隔已到而换图（否则被 Chrome 丢弃后台
 *   标签页后重载，会因 stored.setAt 过旧而每次回来都换一张，体验极差）。轮换只在页面持续
 *   打开、用户正在观看时由页内计时器推进。仅「每日一图跨天」这类每日一次的预期变化会换图。
 * - 无快照（首次使用 / v1 迁移）：按模式取默认第一张。
 */
function resolveInitial(
  sett: WallpaperSettings,
  collection: SavedWallpaper[],
  pool: BingImage[],
  stored: WallpaperCurrent | null
): WallpaperCurrent | null {
  if (stored) {
    // 打开/重载时不因「轮换间隔已到」换图：轮换计时不再依赖 stored.setAt（旧时间戳曾在
    // 回来瞬间误触发轮换），改由底部 rotation effect 按「页面可见时长」累计推进，从首屏图
    // 呈现、用户开始观看时起算。
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
  const initedRef = React.useRef(false);

  // 页面可见性：切到后台（或被 Chrome 内存节省丢弃重载）时置 false。
  // 自动轮换只在可见时计时，后台逗留不计入轮换时长，回来看到的就是离开时的那张。
  const [visible, setVisible] = React.useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  React.useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

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
      const [coll, sett, stored, cacheRes] = await Promise.all([
        loadCollection(),
        loadWallpaperSettings(),
        loadWallpaperCurrent(),
        chrome.storage.local.get(cacheKey),
      ]);
      if (!alive) return;
      const entry = cacheRes[cacheKey] as { at: number; images: BingImage[] } | undefined;
      const cachedPool = entry?.images ?? [];

      setCollection(coll);
      setSettings(sett);
      setPool(cachedPool);

      const initial = resolveInitial(sett, coll, cachedPool, stored);
      if (initial) {
        // 直接沿用首屏决策结果；轮换计时不再依赖 stored.setAt（旧时间戳曾在回来瞬间误触发
        // 轮换），改由底部 rotation effect 按「页面可见时长」累计推进。
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
  // 例外：程序性回退（收藏被清空时自动切回 bing-daily）不视为用户操作，
  // 由 suppressModeEffectRef 抑制一次，保证「取消收藏不换当前图」的承诺成立。
  const prevModeRef = React.useRef<WallpaperSettings["mode"] | null>(null);
  const suppressModeEffectRef = React.useRef(false);
  React.useEffect(() => {
    const mode = settings?.mode;
    if (!mode) return;
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (suppressModeEffectRef.current) {
      suppressModeEffectRef.current = false;
      return;
    }
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

  // 自动轮换：只按「页面可见时长」推进，后台逗留不计入。
  // rotateAccumRef 累计本轮已可见的毫秒数；rotateStartRef 记录本轮可见计时的墙钟起点。
  // 切到后台时把已可见片段并入 accum 并暂停；切回时从「剩余时长」继续，绝不因后台流逝的
  // 时间在回来的瞬间立即换图。每次真正轮换后置零，重新计满整段间隔。
  const rotateAccumRef = React.useRef(0);
  const rotateStartRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!settings?.autoRotate || !current || !visible) return;
    const intervalMs = Math.max(1, settings.rotateIntervalMin) * 60 * 1000;
    if (rotateStartRef.current == null) rotateStartRef.current = Date.now();
    const remaining = Math.max(0, intervalMs - rotateAccumRef.current);
    const id = window.setTimeout(() => {
      rotateAccumRef.current = 0;
      rotateStartRef.current = null;
      advance();
    }, remaining);
    return () => {
      window.clearTimeout(id);
      if (rotateStartRef.current != null) {
        rotateAccumRef.current += Date.now() - rotateStartRef.current;
        rotateStartRef.current = null;
      }
    };
  }, [settings?.autoRotate, settings?.rotateIntervalMin, visible, advance, current]);

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
        // 若收藏被清空且模式为收藏，回退为每日一图，展示图保持不动
        // （抑制模式切换 effect 的联动换图）。
        if (next.length === 0 && settRef.current?.mode === "collection") {
          suppressModeEffectRef.current = true;
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
          // 收藏清空：模式回退每日一图；当前展示的图不动（快照仍可渲染，
          // 抑制模式切换 effect 的联动换图）
          if (sett.mode === "collection") {
            suppressModeEffectRef.current = true;
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
    liked,
    advance,
    toggleLike,
    selectFromGallery,
    removeFromGallery,
  };
}
