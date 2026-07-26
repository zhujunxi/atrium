"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { store } from "@/lib/store";
import { cn } from "@/lib/utils";
import { LaunchpadPager } from "@/lib/pager";
import type { NavData, NavFolder, NavItem, NavLink } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { LpItem } from "@/components/lp-item";
import { SettingsMenu } from "@/components/settings-menu";
import { FolderOverlay } from "@/components/folder-overlay";
import { AppIcon, FolderIcon } from "@/components/app-icon";
import { LiquidGlass } from "@/components/liquid-glass";
import { LinkDialog, type LinkDialogState, type LinkFormValues } from "@/components/dialogs/link-dialog";
import { useI18n, translate } from "@/lib/i18n";
import { loadNav, saveMode, readEntrance } from "@/lib/store";
import {
  BOOKMARK_BAR_ID,
  createBmFolder,
  createBmLink,
  dissolveBmFolder,
  hasBookmarksApi,
  isPermanentBm,
  loadChromeNav,
  moveBm,
  removeBm,
  subscribeBookmarks,
  updateBm,
} from "@/lib/bookmarks";

const ENGINES = [
  { key: "bing", nameKey: "engine.bing", url: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { key: "google", nameKey: "engine.google", url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { key: "baidu", nameKey: "engine.baidu", url: (q: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { key: "github", nameKey: "engine.github", url: (q: string) => `https://github.com/search?q=${encodeURIComponent(q)}` },
] as const;

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "greet.lateNight";
  if (h < 12) return "greet.morning";
  if (h < 14) return "greet.noon";
  if (h < 18) return "greet.afternoon";
  return "greet.evening";
}

const LONG_PRESS_MS = 480;
const DRAG_SLOP_PX = 12;
const MERGE_DWELL_MS = 650;
const FOLDER_DWELL_MS = 450;
/** 编辑模式拖拽到屏幕左右边缘翻页 */
const EDGE_PX = 64;
const EDGE_DWELL_MS = 550;
const EDGE_REPEAT_MS = 800;

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

/** 首屏图标入场延迟（毫秒）：行优先波浪，叠加 id 确定性微抖动避免机械感。
 *  仅在「开启动效」且第 0 页时调用；其余页面返回 undefined（不入场）。 */
function iconEnterDelay(id: string, index: number, cols: number): number {
  const row = Math.floor(index / cols);
  const col = index % cols;
  let delay = 200 + row * 60 + col * 25;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  delay += (h % 25) / 100 * 60; // 0 ~ 15ms 抖动
  return Math.round(delay);
}

/** 与网格断点一致的列数：base 4 / sm 6 / lg 6 / xl 8（每页固定 4 行，见 pages memo） */
function useLpColumns() {
  return React.useSyncExternalStore(
    (cb) => {
      const sm = window.matchMedia("(min-width: 640px)");
      const lg = window.matchMedia("(min-width: 1024px)");
      const xl = window.matchMedia("(min-width: 1280px)");
      sm.addEventListener("change", cb);
      lg.addEventListener("change", cb);
      xl.addEventListener("change", cb);
      return () => {
        sm.removeEventListener("change", cb);
        lg.removeEventListener("change", cb);
        xl.removeEventListener("change", cb);
      };
    },
    () =>
      window.matchMedia("(min-width: 1280px)").matches
        ? 8
        : window.matchMedia("(min-width: 1024px)").matches
          ? 6
          : window.matchMedia("(min-width: 640px)").matches
            ? 6
            : 4,
    () => 8
  );
}

/** "root" 表示桌面，否则为文件夹 id */
type Container = "root" | string;

function findContainer(items: NavItem[], id: string): Container | null {
  if (items.some((i) => i.id === id)) return "root";
  for (const f of items) {
    if (f.type === "folder") {
      if (f.items.some((l) => l.id === id)) return f.id;
      const r = findContainer(f.items, id);
      if (r) return r;
    }
  }
  return null;
}

function findItem(items: NavItem[], id: string): NavItem | null {
  for (const i of items) {
    if (i.id === id) return i;
    if (i.type === "folder") {
      const r = findItem(i.items, id);
      if (r) return r;
    }
  }
  return null;
}

function findFolder(items: NavItem[], id: string): NavFolder | null {
  for (const i of items) {
    if (i.type === "folder" && i.id === id) return i;
    if (i.type === "folder") {
      const r = findFolder(i.items, id);
      if (r) return r;
    }
  }
  return null;
}

function containerArr(items: NavItem[], c: Container): { id: string }[] {
  if (c === "root") return items;
  const f = findFolder(items, c);
  return f ? f.items : [];
}

/** 返回 id 所在容器的下标（容器内为 folder 或 root 的 items 数组） */
function indexInContainer(items: NavItem[], c: Container, id: string): number {
  const arr = c === "root" ? items : findFolder(items, c)?.items ?? [];
  return arr.findIndex((x) => x.id === id);
}

function findParent(items: NavItem[], id: string, parent: Container = "root"): Container | null {
  for (const i of items) {
    if (i.type === "folder" && i.id === id) return parent;
    if (i.type === "folder") {
      const r = findParent(i.items, id, i.id);
      if (r !== null) return r;
    }
  }
  return null;
}

/** 在容器内指定下标插入单个 item（递归定位嵌套容器） */
function insertAt(items: NavItem[], c: Container, index: number, item: NavItem): NavItem[] {
  if (c === "root") {
    const next = [...items];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
    return next;
  }
  return items.map((f) => {
    if (f.type === "folder" && f.id === c) {
      const arr = [...f.items];
      arr.splice(Math.max(0, Math.min(index, arr.length)), 0, item);
      return { ...f, items: arr };
    }
    if (f.type === "folder") return { ...f, items: insertAt(f.items, c, index, item) };
    return f;
  });
}

/** 同一容器内把 id 移动到 toIndex（toIndex 为移除自身后的目标下标） */
function moveWithin(items: NavItem[], c: Container, id: string, toIndex: number): NavItem[] {
  if (c === "root") {
    const from = items.findIndex((i) => i.id === id);
    if (from < 0) return items;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, it);
    return next;
  }
  return items.map((f) => {
    if (f.type !== "folder" || f.id !== c) {
      return f.type === "folder" ? { ...f, items: moveWithin(f.items, c, id, toIndex) } : f;
    }
    const from = f.items.findIndex((l) => l.id === id);
    if (from < 0) return f;
    const arr = [...f.items];
    const [it] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(toIndex, arr.length)), 0, it);
    return { ...f, items: arr };
  });
}

function removeFrom(items: NavItem[], c: Container, id: string): NavItem[] {
  if (c === "root") return items.filter((i) => i.id !== id);
  return items.map((f) => {
    if (f.type === "folder" && f.id === c) return { ...f, items: f.items.filter((l) => l.id !== id) };
    if (f.type === "folder") return { ...f, items: removeFrom(f.items, c, id) };
    return f;
  });
}

function pruneEmptyFolders(items: NavItem[]): NavItem[] {
  return items
    .map((i) => (i.type === "folder" ? { ...i, items: pruneEmptyFolders(i.items) } : i))
    .filter((i) => i.type !== "folder" || i.items.length > 0);
}

function insertLink(items: NavItem[], folderId: string | null, item: NavItem): NavItem[] {
  if (!folderId) return [...items, item];
  return items.map((f) =>
    f.type === "folder" && f.id === folderId ? { ...f, items: [...f.items, item] } : f
  );
}

/** 递归地在树中给某文件夹打补丁（改名 / 标 dirty 等） */
function patchFolder(items: NavItem[], id: string, patch: Partial<NavFolder>): NavItem[] {
  return items.map((f) => {
    if (f.type === "folder") {
      if (f.id === id) return { ...f, ...patch };
      return { ...f, items: patchFolder(f.items, id, patch) };
    }
    return f;
  });
}

/** 把文件夹树拍平成可选列表（带缩进），供「添加链接」的位置下拉用 */
function flattenFolderOptions(
  items: NavItem[],
  depth = 0,
  out: { id: string; name: string }[] = []
): { id: string; name: string }[] {
  for (const i of items) {
    if (i.type === "folder") {
      out.push({ id: i.id, name: depth === 0 ? i.name : " ".repeat(depth) + i.name });
      flattenFolderOptions(i.items, depth + 1, out);
    }
  }
  return out;
}

/** 桌面上把 dragged 叠放到 target 上，生成新文件夹（占据 target 原位置）——仅本地模式 */
function mergeIntoFolder(items: NavItem[], dragId: string, targetId: string): NavItem[] {
  const dragged = findItem(items, dragId);
  const target = findItem(items, targetId);
  if (!dragged || !target || dragged.type !== "link" || target.type !== "link") return items;
  const folder: NavFolder = {
    id: newId("fd"),
    type: "folder",
    name: translate("common.newFolder"),
    items: [target, dragged],
  };
  const targetContainer = findContainer(items, targetId) ?? "root";
  const targetIdx = indexInContainer(items, targetContainer, targetId);
  let next = removeFrom(items, targetContainer, targetId);
  next = removeFrom(next, findContainer(next, dragId) ?? "root", dragId);
  next = insertAt(next, targetContainer, targetIdx, folder);
  return next;
}

/** 解散文件夹：子项按原顺序提升到父容器——仅本地模式 */
function dissolveFolder(items: NavItem[], folderId: string): NavItem[] {
  const folder = findFolder(items, folderId);
  if (!folder) return items;
  const parent = findParent(items, folderId) ?? "root";
  const idx = indexInContainer(items, parent, folderId);
  let next = removeFrom(items, parent, folderId);
  folder.items.forEach((it, i) => {
    next = insertAt(next, parent, idx + i, it);
  });
  return next;
}

interface DragState {
  id: string;
  container: Container;
  x: number;
  y: number;
  mergeTargetId: string | null;
  folderTargetId: string | null;
}

export function NavApp({
  initialData,
  initialSyncMode,
}: {
  initialData: NavData;
  initialSyncMode: boolean;
}) {
  const [items, setItems] = React.useState<NavItem[]>(initialData.items);
  const [updatedAt, setUpdatedAt] = React.useState(initialData.updatedAt);
  /** 同步模式：网格即 Chrome 收藏夹（实时双向）；关闭时为本地桌面 */
  const [syncMode, setSyncMode] = React.useState(initialSyncMode);
  const syncModeRef = React.useRef(syncMode);
  syncModeRef.current = syncMode;
  const { t, locale } = useI18n();
  const [query, setQuery] = React.useState("");
  // 记住「开启动效」开关：首屏同步读出（不闪）；切换在设置菜单内完成、下次打开生效
  const [animateIn] = React.useState(() => readEntrance());
  // 记住上次选的搜索引擎：首屏直接从 localStorage 同步读出（不闪）；切换时直接写回
  const [engine, setEngine] = React.useState<(typeof ENGINES)[number]["key"]>(() => {
    if (typeof window === "undefined") return "bing";
    const saved = localStorage.getItem("nav:engine");
    const found = ENGINES.find((e) => e.key === saved);
    return found ? found.key : "bing";
  });
  // 水合时 React 可能保留 SSR 渲染的 <select value="bing">，用 layout effect 在绘制前强制把显示值对齐到 state
  const engineSelectRef = React.useRef<HTMLSelectElement>(null);
  const useIsoLayoutEffect =
    typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;
  useIsoLayoutEffect(() => {
    if (engineSelectRef.current) engineSelectRef.current.value = engine;
  }, [engine]);
  // 引擎下拉在客户端拿到存储值前先隐形，挂载后再淡入，避免「先 bing 再闪成已选」的一帧
  const [engineReady, setEngineReady] = React.useState(false);
  React.useEffect(() => setEngineReady(true), []);
  const [edit, setEdit] = React.useState(false);
  const [openFolderId, setOpenFolderId] = React.useState<string | null>(null);
  /** 打开文件夹时记录源图标位置，供展开/收起缩放动画用 */
  const [originRect, setOriginRect] = React.useState<DOMRect | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [linkDialog, setLinkDialog] = React.useState<LinkDialogState>({ open: false, folderId: null });
  /** Launchpad 分页：当前页码（由 pager 物理层回报） */
  const [page, setPage] = React.useState(0);

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const pagerRef = React.useRef<LaunchpadPager | null>(null);
  /** 背景/触控横扫的翻页手势 */
  const panRef = React.useRef<{ id: number; startX: number; moved: boolean } | null>(null);
  /** 编辑模式拖图标到屏幕边缘的驻留计时 */
  const edgeRef = React.useRef<{ dir: number; since: number }>({ dir: 0, since: 0 });
  /** 翻页手势后抑制 main 的「点空白退出编辑」 */
  const suppressMainClickRef = React.useRef(false);
  const pressRef = React.useRef<{
    id: string;
    x: number;
    y: number;
    lp: boolean;
    dragging: boolean;
    timer: number | null;
  } | null>(null);
  const hoverRef = React.useRef<{ id: string | null; since: number }>({ id: null, since: 0 });
  const saveTimer = React.useRef<number | null>(null);

  // window 级监听器里避免闭包过期
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const dragRef = React.useRef(drag);
  dragRef.current = drag;
  const editRef = React.useRef(edit);
  editRef.current = edit;
  const openFolderRef = React.useRef(openFolderId);
  openFolderRef.current = openFolderId;
  const pageRef = React.useRef(page);
  pageRef.current = page;
  const pageCountRef = React.useRef(1);
  const perPageRef = React.useRef(32);
  const dialogOpenRef = React.useRef(false);
  dialogOpenRef.current = linkDialog.open;
  /** 搜索框原生 input，供「未聚焦时键入即搜索」聚焦使用 */
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  /** 搜索表单，用于判断失焦是否落在表单外（表单外失焦才清空搜索词） */
  const searchFormRef = React.useRef<HTMLElement | null>(null);

  /* ---------- 分页数据：每页 cols × 4 行（lg 6×4 / xl+ 8×4） ---------- */
  const cols = useLpColumns();
  const perPage = cols * 4;
  const pages = React.useMemo(() => {
    const out: NavItem[][] = [];
    for (let i = 0; i < items.length; i += perPage) out.push(items.slice(i, i + perPage));
    if (out.length === 0) out.push([]);
    // 编辑模式下「添加」按钮占一格：末页满了就另起一页放它
    if (edit && out[out.length - 1].length >= perPage) out.push([]);
    return out;
  }, [items, perPage, edit]);
  const pageCount = pages.length;
  pageCountRef.current = pageCount;
  perPageRef.current = perPage;

  const today = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" }).format(
        new Date()
      ),
    [locale]
  );

  const persist = React.useCallback((next: NavItem[]) => {
    setItems(next);
    // 同步模式：Chrome 即数据库，结构由 API 调用落地，不写本地存储
    if (syncModeRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const data = await store.saveNav(next);
        setUpdatedAt(data.updatedAt);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toast.saveFail"));
      }
    }, 350);
  }, []);

  /* ---------- 同步模式：网格即 Chrome 收藏夹 ---------- */

  const refreshChrome = React.useCallback(async () => {
    try {
      setItems(await loadChromeNav());
    } catch {
      /* 瞬断静默：下一次事件会再触发刷新 */
    }
  }, []);

  // 开启同步模式时：加载镜像 + 订阅 Chrome 侧变更（书签管理器 / 其他标签页 / 其他设备）
  React.useEffect(() => {
    if (!syncMode) return;
    refreshChrome();
    return subscribeBookmarks(() => {
      if (dragRef.current) return; // 拖拽中不打断，落手后统一刷新
      refreshChrome();
    });
  }, [syncMode, refreshChrome]);

  const handleToggleSyncMode = React.useCallback(
    async (on: boolean) => {
      if (on && !hasBookmarksApi()) {
        toast.error(t("toast.syncUnavailable"));
        return;
      }
      await saveMode(on ? "sync" : "local");
      setSyncMode(on);
      if (on) {
        toast.success(t("toast.syncModeOn"));
        // 网格数据由订阅 effect 的 refreshChrome 加载
      } else {
        const data = await loadNav();
        setItems(data.items);
        setUpdatedAt(data.updatedAt);
        toast.success(t("toast.syncModeOff"));
      }
    },
    [t]
  );

  /** 同步模式：容器 → Chrome 父节点 id */
  const bmParentOf = React.useCallback((c: Container): string | null => {
    if (c === "root") return BOOKMARK_BAR_ID;
    const f = findFolder(itemsRef.current, c);
    return f?.bmId ?? null;
  }, []);

  /** 同步模式：root 网格下标 → 书签栏内下标（末尾的「其他书签」等伪文件夹不占位） */
  const barIndexOf = React.useCallback((idx: number): number => {
    const barCount = itemsRef.current.filter((i) => !isPermanentBm(i.bmId)).length;
    return Math.max(0, Math.min(idx, barCount));
  }, []);

  /* ---------- 指针编排：长按进编辑 / 拖拽 / 点击 ---------- */

  // useCallback 固定引用：配合 LpItem 的 memo，翻页码变化时图标不整树重渲染
  const handlePointerDown = React.useCallback((e: React.PointerEvent, item: NavItem) => {
    if (e.button !== 0 || pressRef.current) return;
    const timer = window.setTimeout(() => {
      const p = pressRef.current;
      if (p) {
        p.lp = true;
        setEdit(true);
        navigator.vibrate?.(10);
      }
    }, LONG_PRESS_MS);
    pressRef.current = { id: item.id, x: e.clientX, y: e.clientY, lp: false, dragging: false, timer };
  }, []);

  function handleItemClick(item: NavItem, origin?: { x: number; y: number }) {
    if (!editRef.current) {
      if (item.type === "link") window.open(item.url, "_blank", "noreferrer");
      else setOpenFolderId(item.id);
      return;
    }
    // 编辑模式：点网址 = 编辑，点文件夹 = 进入文件夹
    if (item.type === "link") {
      const c = findContainer(itemsRef.current, item.id);
      setLinkDialog({ open: true, folderId: c && c !== "root" ? c : null, initial: item, origin });
    } else {
      setOpenFolderId(item.id);
    }
  }

  /** 同步模式落手：把拖拽结果直接提交给 Chrome（合并建夹 / 收纳 / 拖出 / 排序），然后重新镜像 */
  const finalizeDropSync = React.useCallback(
    async (d: DragState, e: PointerEvent) => {
      try {
        const cur = itemsRef.current;
        const dragged = findItem(cur, d.id);
        // 伪文件夹（其他书签等）不可移动：直接刷新弹回
        if (!dragged || isPermanentBm(dragged.bmId)) return void (await refreshChrome());

        if (d.mergeTargetId) {
          const target = findItem(cur, d.mergeTargetId);
          if (dragged.type === "link" && target?.type === "link" && dragged.bmId && target.bmId) {
            const tIdx = indexInContainer(cur, "root", d.mergeTargetId);
            const folderId = await createBmFolder(
              BOOKMARK_BAR_ID,
              translate("common.newFolder"),
              barIndexOf(tIdx)
            );
            if (folderId) {
              await moveBm(target.bmId, folderId);
              await moveBm(dragged.bmId, folderId);
              toast.success(t("toast.folderCreated"));
            }
          }
          return void (await refreshChrome());
        }

        if (d.folderTargetId) {
          const folder = findFolder(cur, d.folderTargetId);
          if (dragged.bmId && folder?.bmId) {
            await moveBm(dragged.bmId, folder.bmId);
            toast.success(t("toast.filedIntoFolder"));
          }
          return void (await refreshChrome());
        }

        if (d.container !== "root") {
          const rect = panelRef.current?.getBoundingClientRect();
          const inside =
            !!rect &&
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;
          if (!inside && dragged.type === "link" && dragged.bmId) {
            // 拖出文件夹 → 移到书签栏末尾（真实 move，双向生效）
            await moveBm(dragged.bmId, BOOKMARK_BAR_ID);
            return void (await refreshChrome());
          }
        }

        // 同容器排序：把拖拽期间的实时顺序提交给 Chrome
        const c = findContainer(cur, d.id) ?? "root";
        const parentBm = bmParentOf(c);
        if (dragged.bmId && parentBm) {
          const idx = indexInContainer(cur, c, d.id);
          await moveBm(dragged.bmId, parentBm, c === "root" ? barIndexOf(idx) : idx);
        }
        await refreshChrome();
      } catch {
        toast.error(t("toast.opFail"));
        await refreshChrome();
      }
    },
    [refreshChrome, bmParentOf, barIndexOf, t]
  );

  const finalizeDrop = React.useCallback(
    (d: DragState, e: PointerEvent) => {
      if (syncModeRef.current) {
        void finalizeDropSync(d, e);
        return;
      }
      let next = itemsRef.current;
      if (d.mergeTargetId) {
        next = mergeIntoFolder(next, d.id, d.mergeTargetId);
        persist(next);
        toast.success(t("toast.folderCreated"));
        return;
      }
      if (d.folderTargetId) {
        const dragged = findItem(next, d.id);
        if (dragged && dragged.type === "link") {
          next = removeFrom(next, "root", d.id);
          next = insertLink(next, d.folderTargetId, dragged);
          persist(next);
          toast.success(t("toast.filedIntoFolder"));
        }
        return;
      }
      if (d.container !== "root") {
        const rect = panelRef.current?.getBoundingClientRect();
        const inside =
          !!rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (!inside) {
          // 拖出文件夹 → 放到桌面末尾；空文件夹自动移除
          const dragged = findItem(next, d.id);
          if (dragged && dragged.type === "link") {
            next = removeFrom(next, d.container, d.id);
            next = [...next, dragged];
            next = pruneEmptyFolders(next);
            if (openFolderRef.current && !next.some((f) => f.id === openFolderRef.current)) {
              setOpenFolderId(null);
            }
            // 落点在桌面末尾：翻到最后一页让用户看到它
            const lastPage = Math.max(0, Math.ceil(next.length / perPageRef.current) - 1);
            if (lastPage !== pageRef.current) {
              requestAnimationFrame(() => pagerRef.current?.goTo(lastPage));
            }
          }
        }
      }
      persist(next);
    },
    [persist, finalizeDropSync]
  );

  React.useEffect(() => {
    function onMove(e: PointerEvent) {
      const p = pressRef.current;
      if (!p) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_SLOP_PX) return;
        if (p.timer) {
          window.clearTimeout(p.timer);
          p.timer = null;
        }
        // 非编辑态下的移动视为滚动/误触，取消本次按压
        if (!p.lp && !editRef.current) {
          // 触控横向滑动 → 移交给翻页（跟手），与 Launchpad 一致
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          if (
            e.pointerType === "touch" &&
            pageCountRef.current > 1 &&
            !openFolderRef.current &&
            Math.abs(dx) > Math.abs(dy)
          ) {
            pagerRef.current?.beginDrag(p.x);
            pagerRef.current?.moveDrag(e.clientX);
            panRef.current = { id: e.pointerId, startX: p.x, moved: true };
          }
          pressRef.current = null;
          return;
        }
        p.dragging = true;
        const container = findContainer(itemsRef.current, p.id) ?? "root";
        setDrag({ id: p.id, container, x: e.clientX, y: e.clientY, mergeTargetId: null, folderTargetId: null });
        hoverRef.current = { id: null, since: 0 };
        return;
      }

      const d = dragRef.current;
      if (!d) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-lp-id]");
      const overId = el?.dataset.lpId ?? null;
      const now = Date.now();
      if (overId !== hoverRef.current.id) hoverRef.current = { id: overId, since: now };

      // 桌面层拖拽到屏幕左右边缘 → 驻留翻页（Launchpad 边缘翻页），按住可连续翻
      if (d.container === "root" && pageCountRef.current > 1) {
        let dir = 0;
        if (e.clientX < EDGE_PX) dir = -1;
        else if (e.clientX > window.innerWidth - EDGE_PX) dir = 1;
        const edge = edgeRef.current;
        if (dir === 0) {
          if (edge.dir !== 0) edgeRef.current = { dir: 0, since: 0 };
        } else if (edge.dir !== dir) {
          edgeRef.current = { dir, since: now };
        } else if (now - edge.since > EDGE_DWELL_MS) {
          pagerRef.current?.goTo(pageRef.current + dir);
          // 按住不放每隔 EDGE_REPEAT_MS 续翻一页
          edgeRef.current = { dir, since: now + EDGE_REPEAT_MS - EDGE_DWELL_MS };
        }
      }

      let mergeTargetId: string | null = null;
      let folderTargetId: string | null = null;

      if (el && overId && overId !== d.id) {
        const overContainer = findContainer(itemsRef.current, overId);
        if (overContainer === d.container) {
          const overType = el.dataset.lpType;
          const draggedItem = findItem(itemsRef.current, d.id);
          const rect = el.getBoundingClientRect();
          const relX = (e.clientX - rect.left) / rect.width;
          const dwell = now - hoverRef.current.since;
          const center = relX > 0.32 && relX < 0.68;

          const reorderTo = () => {
            const before = relX <= 0.32;
            setItems((prev) => {
              const arr = containerArr(prev, d.container);
              const targetIdx = arr.findIndex((i) => i.id === overId);
              const fromIdx = arr.findIndex((i) => i.id === d.id);
              if (targetIdx < 0 || fromIdx < 0) return prev;
              let to = before ? targetIdx : targetIdx + 1;
              if (fromIdx < to) to -= 1;
              if (to === fromIdx) return prev;
              return moveWithin(prev, d.container, d.id, to);
            });
          };

          if (overType === "folder" && d.container === "root") {
            // 网址悬停文件夹中央 → 收纳预览；其余情况文件夹同样参与排序
            if (center && draggedItem?.type === "link") {
              if (dwell > FOLDER_DWELL_MS) folderTargetId = overId;
            } else {
              reorderTo();
            }
          } else if (overType === "link") {
            if (center) {
              // 叠放建文件夹仅桌面层、仅限网址（文件夹不可嵌套）
              if (d.container === "root" && draggedItem?.type === "link" && dwell > MERGE_DWELL_MS) {
                mergeTargetId = overId;
              }
            } else {
              reorderTo();
            }
          }
        }
      }
      setDrag({ ...d, x: e.clientX, y: e.clientY, mergeTargetId, folderTargetId });
    }

    function onUp(e: PointerEvent) {
      const p = pressRef.current;
      if (!p) return;
      if (p.timer) window.clearTimeout(p.timer);
      pressRef.current = null;
      if (p.dragging) {
        const d = dragRef.current;
        setDrag(null);
        if (d) finalizeDrop(d, e);
        return;
      }
      if (p.lp) return; // 长按仅用于进入编辑模式
      const item = findItem(itemsRef.current, p.id);
      if (item) {
        if (item.type === "folder") {
          const iconEl = document.querySelector<HTMLElement>(
            `[data-lp-id="${p.id}"] .liquid-glass`
          );
          setOriginRect(iconEl ? iconEl.getBoundingClientRect() : null);
        }
        handleItemClick(item, { x: e.clientX, y: e.clientY });
      }
    }

    function onCancel() {
      const p = pressRef.current;
      if (!p) return;
      if (p.timer) window.clearTimeout(p.timer);
      pressRef.current = null;
      if (p.dragging) {
        setDrag(null);
        // 同步模式：取消拖拽 → 从 Chrome 重新镜像弹回；本地模式照旧落盘
        if (syncModeRef.current) refreshChrome();
        else persist(itemsRef.current);
      }
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [finalizeDrop, persist, refreshChrome]);

  // Esc：先关文件夹，再退出编辑
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (openFolderRef.current) setOpenFolderId(null);
      else if (editRef.current) setEdit(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 焦点不在搜索框时，直接键入字符也能触发搜索（类 Spotlight / Launchpad 的 type-to-search）
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 输入法组字中（中文/日文等），交给 IME 自行处理
      if (e.isComposing || e.keyCode === 229) return;
      const ae = document.activeElement as HTMLElement | null;
      // 已落在可输入元素（搜索框 / 文本框 / 下拉 / 富文本）上 → 交给它们自己处理
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable))
        return;
      // 文件夹展开层 / 对话框打开时，按键留给它们
      if (openFolderRef.current || dialogOpenRef.current) return;
      // 组合键（Ctrl / Cmd / Alt）不拦，留给浏览器 / 系统快捷键
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = e.key;
      const isActivatable = !!ae && (ae.tagName === "BUTTON" || ae.tagName === "A");

      // 退格：把焦点交给搜索框，由原生删除最后一个字符（空查询时无副作用）
      if (k === "Backspace") {
        searchInputRef.current?.focus();
        return;
      }
      // 空格落在按钮 / 链接上：保留默认激活行为，不抢
      if (k === " " && isActivatable) return;
      // 非打印键（方向键、Tab、功能键等）不拦截：←/→ 继续翻页、Tab 正常移焦
      if (k.length !== 1) return;

      // 单字符可打印 → 把焦点交给搜索框，由浏览器原生把字符写进去（含回车提交）
      searchInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- Launchpad 分页 ---------- */

  // 挂载物理分页器：直接操作 track 的 transform，页码变化回报给 React。
  // 注：翻页运动期间不再降级液态玻璃——会动的只有文件夹图标(scale=8 很轻量)，
  // 搜索框/设置齿轮在静止的 <main> 里，背景不变、折射零成本，故全程保持真折射，
  // 既无「闪一下」也无停手时的边缘位移差。
  React.useEffect(() => {
    const vp = viewportRef.current;
    const track = trackRef.current;
    if (!vp || !track) return;
    const pager = new LaunchpadPager();
    pager.attach(track, (p) => setPage(p));
    pagerRef.current = pager;
    pager.setLayout(pageCountRef.current, vp.clientWidth);
    const ro = new ResizeObserver(() => {
      pager.setLayout(pageCountRef.current, vp.clientWidth);
    });
    ro.observe(vp);
    return () => {
      ro.disconnect();
      pager.destroy();
      pagerRef.current = null;
    };
  }, []);

  // 页数变化（增删项目/断点切换/进出编辑模式）→ 立即对齐，页码越界自动夹紧
  React.useEffect(() => {
    const vp = viewportRef.current;
    pagerRef.current?.setLayout(pageCount, vp ? vp.clientWidth : undefined);
  }, [pageCount]);

  // 背景按下：空白处按住拖动 = 翻页手势（图标各自处理自己的按下，互不干扰）
  function handleViewportPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || panRef.current) return;
    if (pageCountRef.current < 2) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-lp-id],[data-lp-add],input,button,a,select,textarea")) return;
    pagerRef.current?.beginDrag(e.clientX);
    panRef.current = { id: e.pointerId, startX: e.clientX, moved: false };
  }

  // 翻页手势的移动/抬起（含图标上触控横扫移交过来的手势）
  React.useEffect(() => {
    function onMove(e: PointerEvent) {
      const pan = panRef.current;
      if (!pan || e.pointerId !== pan.id) return;
      if (!pan.moved && Math.abs(e.clientX - pan.startX) > 4) pan.moved = true;
      pagerRef.current?.moveDrag(e.clientX);
    }
    function onUp(e: PointerEvent) {
      const pan = panRef.current;
      if (!pan || e.pointerId !== pan.id) return;
      panRef.current = null;
      pagerRef.current?.endDrag();
      if (pan.moved) {
        // 这次按压是翻页不是点击：别触发「点空白退出编辑」
        suppressMainClickRef.current = true;
        window.setTimeout(() => {
          suppressMainClickRef.current = false;
        }, 0);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // 触控板双指横滑 / 鼠标横滚：跟手 + 惯性吸附；preventDefault 阻断浏览器前进/后退手势
  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    function onWheel(e: WheelEvent) {
      if (pageCountRef.current < 2 || openFolderRef.current) return;
      const scale = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * scale;
      const dy = e.deltaY * scale;
      if (dx === 0 || Math.abs(dx) <= Math.abs(dy)) return;
      e.preventDefault();
      pagerRef.current?.feedWheel(dx);
    }
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  // 键盘 ←/→ 翻页（输入框聚焦、文件夹/对话框打开时不抢按键）
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)
      )
        return;
      if (openFolderRef.current || dialogOpenRef.current || pageCountRef.current < 2) return;
      pagerRef.current?.goTo(pageRef.current + (e.key === "ArrowLeft" ? -1 : 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- 结构操作 ---------- */

  const handleDeleteItem = React.useCallback(
    async (item: NavItem) => {
      // 同步模式：直接操作 Chrome 收藏夹（网格即 Chrome）
      if (syncModeRef.current) {
        if (!item.bmId) return;
        if (isPermanentBm(item.bmId)) {
          toast.error(t("toast.permanentFolder"));
          return;
        }
        try {
          if (item.type === "link") {
            if (!window.confirm(t("confirm.deleteLink", { title: item.title }))) return;
            await removeBm(item.bmId, false);
            toast.success(t("toast.deleted"));
          } else {
            const n = item.items.length;
            if (n > 0 && !window.confirm(t("confirm.dissolveFolder", { name: item.name, n }))) return;
            await dissolveBmFolder(item.bmId);
            toast.success(n > 0 ? t("toast.folderDissolved") : t("toast.emptyFolderDeleted"));
            // 注：同步模式下解散文件夹 = 子项提升到父容器（与本地一致，避免误删）
          }
        } catch {
          toast.error(t("toast.opFail"));
        }
        await refreshChrome();
        return;
      }
      if (item.type === "link") {
        if (!window.confirm(t("confirm.deleteLink", { title: item.title }))) return;
        const c = findContainer(itemsRef.current, item.id);
        let next = removeFrom(itemsRef.current, c ?? "root", item.id);
        next = pruneEmptyFolders(next);
        if (openFolderRef.current && !next.some((f) => f.id === openFolderRef.current)) {
          setOpenFolderId(null);
        }
        persist(next);
        toast.success(t("toast.deleted"));
      } else {
        const n = item.items.length;
        if (n > 0 && !window.confirm(t("confirm.dissolveFolder", { name: item.name, n }))) return;
        persist(dissolveFolder(itemsRef.current, item.id));
        toast.success(n > 0 ? t("toast.folderDissolved") : t("toast.emptyFolderDeleted"));
      }
    },
    [persist, refreshChrome, t]
  );

  async function handleRenameFolder(id: string, name: string) {
    const folder = findFolder(itemsRef.current, id);
    if (!folder) return;
    if (syncModeRef.current) {
      if (!folder.bmId || isPermanentBm(folder.bmId)) {
        toast.error(t("toast.permanentFolder"));
        return;
      }
      try {
        await updateBm(folder.bmId, { title: name });
      } catch {
        toast.error(t("toast.opFail"));
      }
      await refreshChrome();
      return;
    }
    const patch: Partial<NavFolder> = { name };
    persist(patchFolder(itemsRef.current, id, patch));
  }

  async function handleAddFolder(parentId: string | null) {
    if (syncModeRef.current) {
      const parentBm = bmParentOf(parentId ?? "root");
      if (!parentBm) return;
      try {
        await createBmFolder(parentBm, translate("common.newFolder"));
        toast.success(t("toast.folderCreated"));
      } catch {
        toast.error(t("toast.opFail"));
      }
      await refreshChrome();
      return;
    }
    const folder: NavFolder = {
      id: newId("fd"),
      type: "folder",
      name: translate("common.newFolder"),
      items: [],
    };
    const next = insertLink(itemsRef.current, parentId, folder);
    persist(next);
    toast.success(t("toast.folderCreated"));
  }

  async function handleLinkSubmit(values: LinkFormValues) {
    const { initial } = linkDialog;
    let next = itemsRef.current;
    if (syncModeRef.current) {
      try {
        if (initial?.bmId) {
          const curContainer = findContainer(itemsRef.current, initial.id) ?? "root";
          const curParentBm = bmParentOf(curContainer);
          const targetParentBm = bmParentOf(values.folderId ?? "root");
          await updateBm(initial.bmId, { title: values.title, url: values.url });
          if (targetParentBm && targetParentBm !== curParentBm) {
            await moveBm(initial.bmId, targetParentBm);
          }
          toast.success(t("toast.linkUpdated"));
        } else {
          const parentBm = bmParentOf(values.folderId ?? "root");
          if (parentBm) {
            await createBmLink(parentBm, values.title, values.url);
            toast.success(t("toast.linkAdded"));
          }
        }
      } catch {
        toast.error(t("toast.opFail"));
      }
      await refreshChrome();
      return;
    }
    if (initial) {
      const link: NavLink = {
        ...initial,
        title: values.title,
        url: values.url,
        description: values.description || undefined,
      };
      const c = findContainer(next, initial.id);
      next = removeFrom(next, c ?? "root", initial.id);
      next = insertLink(next, values.folderId, link);
      toast.success(t("toast.linkUpdated"));
    } else {
      const link: NavLink = {
        id: newId("lk"),
        type: "link",
        title: values.title,
        url: values.url,
        description: values.description || undefined,
      };
      next = insertLink(next, values.folderId, link);
      toast.success(t("toast.linkAdded"));
    }
    persist(pruneEmptyFolders(next));
  }

  function openExternalSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const target = ENGINES.find((en) => en.key === engine) ?? ENGINES[0];
    window.open(target.url(q), "_blank", "noreferrer");
  }

  /* ---------- 渲染 ---------- */

  const searching = query.trim().length > 0;
  const searchResults = React.useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    const out: NavLink[] = [];
    const hit = (l: NavLink) =>
      l.title.toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q) ||
      (l.description ?? "").toLowerCase().includes(q);
    // 递归遍历（含任意层级嵌套子文件夹）
    const walk = (arr: NavItem[]) => {
      for (const it of arr) {
        if (it.type === "link") {
          if (hit(it)) out.push(it);
        } else {
          walk(it.items);
        }
      }
    };
    walk(items);
    return out;
  }, [items, query, searching]);

  const folders = React.useMemo(() => flattenFolderOptions(items), [items]);
  const openFolder = openFolderId
    ? (items.find((i): i is NavFolder => i.type === "folder" && i.id === openFolderId) ?? null)
    : null;
  const dragItem = drag ? findItem(items, drag.id) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SettingsMenu
        onImported={(data) => {
          setItems(data.items);
          setUpdatedAt(data.updatedAt);
        }}
        onAdd={(origin) => setLinkDialog({ open: true, folderId: null, origin })}
        syncMode={syncMode}
        onToggleSyncMode={handleToggleSyncMode}
      />

      <main
        className="flex flex-1 flex-col space-y-12 px-4 pb-24 sm:px-6 lg:px-8"
        onClick={(e) => {
          // 编辑模式下点击空白处完成
          if (!edit) return;
          if (suppressMainClickRef.current) return; // 刚做完翻页手势，不是点击
          const t = e.target as HTMLElement;
          if (t.closest("[data-lp-id],[data-lp-add],input,button,a,select,textarea")) return;
          setEdit(false);
        }}
      >
        {/* Hero */}
        <div className="flex flex-col items-center pb-2 pt-16 text-center">
          <p
            className={cn("text-sm text-white/90 drop-shadow", animateIn && "lp-fade-up")}
            style={animateIn ? { animationDelay: "150ms" } : undefined}
          >
            {today}
          </p>
          <h1
            className={cn(
              "mt-2 text-4xl font-bold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] sm:text-5xl",
              animateIn && "lp-fade-up"
            )}
            style={animateIn ? { animationDelay: "250ms" } : undefined}
          >
            {t(greeting())}
          </h1>

          <LiquidGlass
            as="form"
            ref={searchFormRef}
            onSubmit={openExternalSearch}
            mode="rect"
            corner={24}
            scale={16}
            blur={10}
            className={cn(
              "mt-8 flex w-full max-w-md items-center gap-2 rounded-full p-1.5",
              animateIn && "lp-fade-up"
            )}
            style={animateIn ? { animationDelay: "350ms" } : undefined}
          >
            <select
              ref={engineSelectRef}
              value={engine}
              onChange={(e) => {
                const v = e.target.value as (typeof ENGINES)[number]["key"];
                setEngine(v);
                localStorage.setItem("nav:engine", v);
              }}
              className={cn(
                "h-9 shrink-0 rounded-full border-transparent bg-transparent px-2 text-sm text-white/80 focus:outline-none transition-opacity duration-150",
                engineReady ? "opacity-100" : "opacity-0"
              )}
              aria-label={t("a11y.engine")}
            >
              {ENGINES.map((en) => (
                <option key={en.key} value={en.key} className="text-foreground">
                  {t(en.nameKey)}
                </option>
              ))}
            </select>
            <div className="h-5 w-px bg-white/20" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={(e) => {
                // 失焦到「搜索表单」或「搜索结果网格」之外（点桌面等）才清空；
                // 点搜索结果图标时不能清空 query，否则结果网格会在 click 之前卸载，
                // 导致 <a> 的默认跳转被取消、图标点不开网页。
                const rt = e.relatedTarget as HTMLElement | null;
                if (searchFormRef.current?.contains(rt) || rt?.closest("[data-search-results]")) return;
                setQuery("");
              }}
              placeholder={t("search.placeholder")}
              className="h-9 flex-1 border-transparent bg-transparent text-base text-white shadow-none placeholder:text-white/50 focus-visible:ring-0"
            />
            <button
              type="submit"
              aria-label={t("a11y.search")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Search className="h-4 w-4" />
            </button>
          </LiquidGlass>
        </div>

        {searching && (
          /* 搜索结果：扁平网格，只读 */
          <div
            key={query}
            data-search-results
            className="mx-auto grid w-full max-w-none grid-cols-4 gap-x-8 gap-y-8 sm:grid-cols-6 lg:grid-cols-6 lg:max-w-6xl xl:grid-cols-8 xl:[--lp-icon:72px] 2xl:[--lp-icon:80px] xl:gap-x-14 xl:gap-y-12"
          >
            {searchResults.map((l, i) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                title={l.description || l.url}
                onClick={() => setQuery("")}
                className="group flex w-full flex-col items-center gap-3"
              >
                <span
                  className={cn(
                    "relative transition-transform duration-200 group-hover:-translate-y-1",
                    animateIn && "lp-icon-enter"
                  )}
                  style={animateIn ? { animationDelay: `${60 + Math.min(i, 40) * 30}ms` } : undefined}
                >
                  <AppIcon link={l} />
                </span>
                <span className="w-full truncate px-0.5 text-center text-xs leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                  {l.title}
                </span>
              </a>
            ))}
            {searchResults.length === 0 && (
              <p className="col-span-full py-16 text-center text-sm text-white/80 drop-shadow">
                {t("search.empty", { query: query.trim() })}
              </p>
            )}
          </div>
        )}

        {/* 桌面：Launchpad 分页（每页最多 lg 6 / xl+ 8 列 × 4 行），横向跟手翻页 + 首尾橡皮筋回弹。
            视口负边距全幅出血：图标正好在屏幕边缘滑入滑出；页内补回 padding 保持网格原位。 */}
        <div
          ref={viewportRef}
          onPointerDown={handleViewportPointerDown}
          className={cn(
            "relative -mx-4 -my-1 flex min-h-0 flex-1 flex-col overflow-hidden py-2 [touch-action:pan-y] sm:-mx-6 lg:-mx-8",
            searching && "hidden"
          )}
        >
          <div ref={trackRef} className="flex h-full min-h-0 flex-1 will-change-transform">
            {pages.map((pageItems, pi) => (
              <div
                key={pi}
                className="flex h-full w-full shrink-0 items-center justify-center px-4 sm:px-6 lg:px-8"
              >
                <div className="mx-auto grid w-full max-w-none grid-cols-4 gap-x-8 gap-y-8 sm:grid-cols-6 lg:grid-cols-6 lg:max-w-6xl xl:grid-cols-8 xl:[--lp-icon:72px] 2xl:[--lp-icon:80px] xl:gap-x-14 xl:gap-y-12">
                  {pageItems.map((it, i) => (
                    <LpItem
                      key={it.id}
                      item={it}
                      edit={edit}
                      dragging={drag?.id === it.id}
                      mergeTarget={drag?.mergeTargetId === it.id}
                      folderTarget={drag?.folderTargetId === it.id}
                      enterDelay={
                        animateIn && pi === 0 ? iconEnterDelay(it.id, i, cols) : undefined
                      }
                      onPointerDownItem={handlePointerDown}
                      onDelete={handleDeleteItem}
                    />
                  ))}

                  {edit && pi === pages.length - 1 && (
                    <button
                      data-lp-add
                      onClick={(e) =>
                        setLinkDialog({ open: true, folderId: null, origin: { x: e.clientX, y: e.clientY } })
                      }
                      className="group flex w-full flex-col items-center gap-3"
                    >
                      <span className="flex h-[var(--lp-icon,70px)] w-[var(--lp-icon,70px)] items-center justify-center rounded-[24%] border-2 border-dashed border-white/30 text-white/70 transition-colors group-hover:border-primary/60 group-hover:text-primary">
                        <Plus className="h-5 w-5" />
                      </span>
                      <span className="text-xs text-white/70 transition-colors group-hover:text-primary">
                        {t("common.add")}
                      </span>
                    </button>
                  )}

                  {pageItems.length === 0 && !edit && (
                    <p className="col-span-full py-16 text-center text-sm text-white/80 drop-shadow">
                      {t("desktop.empty")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 页码点（Launchpad 底部 dots，点击跳页） */}
        {!searching && pageCount > 1 && (
          <div
            className={cn(
              "fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1",
              animateIn && "lp-fade-in"
            )}
            style={animateIn ? { animationDelay: "620ms" } : undefined}
          >
            {pages.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t("a11y.page", { n: i + 1, m: pageCount })}
                aria-current={i === page}
                onClick={() => pagerRef.current?.goTo(i)}
                className="group flex h-5 w-5 items-center justify-center"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-all duration-200",
                    i === page
                      ? "scale-125 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.45)]"
                      : "bg-white/40 group-hover:bg-white/75"
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </main>

      {/* 编辑模式提示（有页码点时上移让位） */}
      {edit && !searching && (
        <div
          className={cn(
            "pointer-events-none fixed left-1/2 z-30 -translate-x-1/2",
            pageCount > 1 ? "bottom-16" : "bottom-6"
          )}
        >
          <div className="whitespace-nowrap rounded-full border border-white/15 bg-black/30 px-5 py-2 text-xs text-white/90 shadow-lg backdrop-blur-md">
            {t("edit.hint")}
          </div>
        </div>
      )}

      {/* 文件夹展开层 */}
      {openFolder && (
        <FolderOverlay
          folder={openFolder}
          items={items}
          edit={edit}
          dragId={drag?.id ?? null}
          panelRef={panelRef}
          originRect={originRect}
          onPointerDownItem={handlePointerDown}
          onDeleteItem={handleDeleteItem}
          onRename={handleRenameFolder}
          onAddLink={(origin) => setLinkDialog({ open: true, folderId: openFolder.id, origin })}
          onAddFolder={(parentId) => handleAddFolder(parentId)}
          onClose={() => setOpenFolderId(null)}
        />
      )}

      {/* 拖拽跟随图标 */}
      {drag && dragItem && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: drag.x - 32, top: drag.y - 32 }}
        >
          <div className="scale-110 opacity-90 drop-shadow-2xl">
            {dragItem.type === "link" ? (
              <AppIcon link={dragItem} />
            ) : (
              <FolderIcon name={dragItem.name} items={dragItem.items} />
            )}
          </div>
        </div>
      )}

      <LinkDialog
        state={linkDialog}
        folders={folders}
        onOpenChange={(open) => setLinkDialog((s) => ({ ...s, open }))}
        onSubmit={handleLinkSubmit}
      />
    </div>
  );
}
