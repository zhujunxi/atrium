/**
 * 同步模式引擎：网格即 Chrome 收藏夹（实时双向）。
 *
 * 设计要点：
 * - 不再有对账 / dirty / detach——Chrome 就是唯一数据源。
 * - 读：getTree() → 网格结构。书签栏（id=1）的内容平铺为桌面顶层；
 *   「其他书签」（id=2）/「移动书签」（id=3）非空时作为文件夹图标出现在末尾。
 * - 写：网格里的增 / 删 / 改 / 移动 / 排序直接调 chrome.bookmarks API。
 * - 监听：onCreated / onChanged / onMoved / onRemoved 等事件 → 防抖刷新网格，
 *   Chrome 侧（书签管理器 / 其他设备）的改动实时反映到桌面。
 */

import type { NavFolder, NavItem, NavLink } from "@/lib/types";

/** 书签栏：同步模式下桌面顶层的宿主容器 */
export const BOOKMARK_BAR_ID = "1";
/** Chrome 永久容器（根 0 / 书签栏 1 / 其他书签 2 / 移动书签 3）：不可删除 / 改名 / 移动 */
const PERMANENT_BM_IDS = new Set(["0", "1", "2", "3"]);

export function hasBookmarksApi(): boolean {
  return typeof chrome !== "undefined" && !!chrome.bookmarks?.getTree;
}

export function isPermanentBm(bmId?: string): boolean {
  return !!bmId && PERMANENT_BM_IDS.has(bmId);
}

/* --------------------------------- 读：镜像 --------------------------------- */

function buildLink(node: chrome.bookmarks.BookmarkTreeNode): NavLink {
  return {
    id: `bm:${node.id}`,
    type: "link",
    title: node.title || node.url || "",
    url: node.url || "",
    bmId: node.id,
  };
}

function buildFolder(node: chrome.bookmarks.BookmarkTreeNode): NavFolder {
  return {
    id: `bmf:${node.id}`,
    type: "folder",
    name: node.title || "Bookmarks",
    items: (node.children ?? []).map((c) => (c.children ? buildFolder(c) : buildLink(c))),
    bmId: node.id,
  };
}

/**
 * 由 Chrome 树构建网格：书签栏内容平铺为顶层，其余容器非空时作为文件夹追加在末尾。
 */
export async function loadChromeNav(): Promise<NavItem[]> {
  const tree = await chrome.bookmarks.getTree();
  const containers =
    tree.length === 1 && tree[0].id === "0" ? (tree[0].children ?? []) : tree;
  const out: NavItem[] = [];
  const rest: NavItem[] = [];
  for (const c of containers) {
    if (c.id === BOOKMARK_BAR_ID) {
      for (const child of c.children ?? []) {
        out.push(child.children ? buildFolder(child) : buildLink(child));
      }
    } else if ((c.children ?? []).length > 0) {
      rest.push(buildFolder(c));
    }
  }
  return [...out, ...rest];
}

/* --------------------------------- 写：代理 --------------------------------- */

export async function createBmLink(
  parentBmId: string,
  title: string,
  url: string
): Promise<void> {
  await chrome.bookmarks.create({ parentId: parentBmId, title, url });
}

export async function createBmFolder(parentBmId: string, title: string, index?: number): Promise<string | null> {
  const node = await chrome.bookmarks.create({ parentId: parentBmId, title, index });
  return node?.id ?? null;
}

export async function updateBm(
  bmId: string,
  changes: { title?: string; url?: string }
): Promise<void> {
  await chrome.bookmarks.update(bmId, changes);
}

export async function removeBm(bmId: string, isFolder: boolean): Promise<void> {
  if (isFolder) await chrome.bookmarks.removeTree(bmId);
  else await chrome.bookmarks.remove(bmId);
}

/**
 * 移动 / 排序。index 为「目标位置的最终下标」（移除自身后的语义）。
 * Chromium 的 BookmarkModel::Move 对同父后移会自动 -1，因此同父且目标在原位置之后时需 +1 补偿。
 */
export async function moveBm(bmId: string, parentBmId: string, index?: number): Promise<void> {
  let idx = index;
  if (idx != null) {
    try {
      const [node] = await chrome.bookmarks.get(bmId);
      if (node?.parentId === parentBmId && node.index != null && idx > node.index) idx += 1;
    } catch {
      /* 节点不存在时让 move 自行报错 */
    }
  }
  await chrome.bookmarks.move(bmId, { parentId: parentBmId, index: idx });
}

/** 解散文件夹：子项按序移到文件夹所在父容器（追加），然后删除空文件夹 */
export async function dissolveBmFolder(bmId: string): Promise<void> {
  const [node] = await chrome.bookmarks.get(bmId);
  const parentId = node?.parentId ?? BOOKMARK_BAR_ID;
  const children = await chrome.bookmarks.getChildren(bmId);
  for (const c of children) {
    await chrome.bookmarks.move(c.id, { parentId });
  }
  await chrome.bookmarks.removeTree(bmId);
}

/* --------------------------------- 监听 --------------------------------- */

const DEBOUNCE_MS = 250;

/**
 * 订阅 Chrome 收藏夹变更（含本扩展自身操作的回声——刷新是幂等的，无回环风险）。
 * 返回取消订阅函数。
 */
export function subscribeBookmarks(onChange: () => void): () => void {
  if (!hasBookmarksApi()) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, DEBOUNCE_MS);
  };
  const b = chrome.bookmarks;
  b.onCreated.addListener(fire);
  b.onRemoved.addListener(fire);
  b.onChanged.addListener(fire);
  b.onMoved.addListener(fire);
  b.onChildrenReordered?.addListener(fire);
  b.onImportEnded?.addListener(fire);
  return () => {
    if (timer) clearTimeout(timer);
    b.onCreated.removeListener(fire);
    b.onRemoved.removeListener(fire);
    b.onChanged.removeListener(fire);
    b.onMoved.removeListener(fire);
    b.onChildrenReordered?.removeListener(fire);
    b.onImportEnded?.removeListener(fire);
  };
}
