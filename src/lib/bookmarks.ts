/**
 * Chrome 收藏夹双向同步引擎。
 *
 * 设计要点：
 * - Chrome 收藏夹是「结构真相源」。每次打开/刷新新标签（或手动同步）时，
 *   Atrium 会先用 Chrome.getTree() 重新镜像出 chrome 子树（保留完整嵌套层级与顺序）。
 * - Atrium 侧对 chrome 项目的改动（新增链接/文件夹、改名、删除）通过 `dirty` 标记
 *   或「尚无 bmId 的新建项」，在重新镜像之前写回 Chrome；删除则通过持久化的
 *   `lastKnownBmIds` 基线检测。
 * - 用户在 Atrium 里把 chrome 项目「拖出/合并」视为本地另存（detach），
 *   原 Chrome 书签保持不变、继续同步；通过 detachedBmIds 避免重复导入。
 *   但「解散/删除」chrome 文件夹或链接是双向的——会从 Chrome 也一并移除。
 */

import type { NavFolder, NavItem, NavLink } from "@/lib/types";
import { saveNav } from "@/lib/store";

const SYNC_META_KEY = "chrome-sync-meta";
/** 节流：距上次同步不足该时长且非强制时跳过（避免连开多个新标签狂跑） */
const THROTTLE_MS = 10_000;
/** 新建 chrome 项未指定父文件夹时，默认落到「其他书签」(id=2) */
const DEFAULT_CHROME_PARENT = "2";
/** Chrome 永久容器节点（根 0 / 书签栏 1 / 其他书签 2 / 移动书签 3），不可删除，
 *  也不作为 Atrium 文件夹呈现，需从删除检测中排除 */
const PERMANENT_BM_IDS = new Set(["0", "1", "2", "3"]);

interface SyncMeta {
  lastSyncAt: number;
  /** 上次同步时已知的全部 chrome 书签 id（用于检测 Atrium 侧删除） */
  lastKnownBmIds: string[];
  /** 已被用户「本地另存」(detach) 的 chrome 书签 id（重新镜像时跳过导入） */
  detachedBmIds: string[];
}

async function getSyncMeta(): Promise<SyncMeta> {
  const r = await chrome.storage.local.get(SYNC_META_KEY);
  return r[SYNC_META_KEY] ?? { lastSyncAt: 0, lastKnownBmIds: [], detachedBmIds: [] };
}

async function setSyncMeta(m: SyncMeta): Promise<void> {
  await chrome.storage.local.set({ [SYNC_META_KEY]: m });
}

/** 记录被 detach 的 chrome 书签 id（与 Chrome 同步时不再重新导入它们） */
export async function addDetached(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const m = await getSyncMeta();
  const set = new Set(m.detachedBmIds);
  for (const id of ids) set.add(id);
  await setSyncMeta({ ...m, detachedBmIds: [...set] });
}

export interface SyncCounts {
  added: number;
  updated: number;
  removed: number;
}

export interface SyncResult {
  items: NavItem[];
  changed: boolean;
  updatedAt: string;
  counts: SyncCounts;
}

/* ----------------- 由 Chrome 树递归构建嵌套导航（与 Chrome 层级/顺序完全一致） ----------------- */

function buildChromeNav(
  tree: chrome.bookmarks.BookmarkTreeNode[],
  detached: string[]
): NavItem[] {
  const detachedSet = new Set(detached);

  const buildItems = (node: chrome.bookmarks.BookmarkTreeNode): NavItem[] => {
    const out: NavItem[] = [];
    for (const c of node.children ?? []) {
      if (c.children) {
        out.push(buildFolder(c));
      } else if (c.url && !detachedSet.has(c.id)) {
        const link: NavLink = {
          id: `bm:${c.id}`,
          type: "link",
          title: c.title || c.url,
          url: c.url,
          source: "chrome",
          bmId: c.id,
        };
        out.push(link);
      }
    }
    return out;
  };

  const buildFolder = (node: chrome.bookmarks.BookmarkTreeNode): NavFolder => ({
    id: `bmf:${node.id}`,
    type: "folder",
    name: node.title || "Bookmarks",
    items: buildItems(node),
    source: "chrome",
    bmId: node.id,
  });

  // getTree() 通常返回根节点 "0"，其 children 是 Chrome 的顶层容器
  // （书签栏 id=1 / 其他书签 id=2 / 移动书签 id=3）。这些是 Chrome 的「伪文件夹」，
  // Atrium 桌面直接展开它们的内容（不再包裹一层「Bookmarks Bar」），
  // 但容器内部的嵌套子文件夹仍完整保留层级。
  const containers =
    tree.length === 1 && tree[0].id === "0" ? tree[0].children ?? [] : tree;
  const out: NavItem[] = [];
  for (const c of containers) {
    for (const child of c.children ?? []) {
      if (child.children) {
        out.push(buildFolder(child));
      } else if (child.url && !detachedSet.has(child.id)) {
        out.push({
          id: `bm:${child.id}`,
          type: "link",
          title: child.title || child.url,
          url: child.url,
          source: "chrome",
          bmId: child.id,
        });
      }
    }
  }
  return out;
}

/* --------------------------------- 工具 --------------------------------- */

function collectBmIds(items: NavItem[], into: Set<string>) {
  for (const it of items) {
    if (it.bmId) into.add(it.bmId);
    if (it.type === "folder") collectBmIds(it.items, into);
  }
}

function collectBmIdsFromTree(tree: chrome.bookmarks.BookmarkTreeNode[], into: Set<string>) {
  for (const n of tree) {
    into.add(n.id);
    if (n.children) collectBmIdsFromTree(n.children, into);
  }
}

/* ----------- 把 Atrium 侧未同步的改动（dirty / 新建 chrome 项）写回 Chrome ----------- */

async function pushToChrome(
  items: NavItem[],
  chromeParentId: string
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const it of items) {
    if (it.source !== "chrome") continue;
    if (it.type === "folder") {
      let bmId = it.bmId;
      if (!bmId) {
        const node = await chrome.bookmarks
          .create({ parentId: chromeParentId, title: it.name })
          .catch(() => null);
        if (node?.id) {
          bmId = node.id;
          created++;
        }
      } else if (it.dirty) {
        await chrome.bookmarks.update(bmId, { title: it.name }).catch(() => {});
        updated++;
      }
      if (bmId) {
        const r = await pushToChrome(it.items, bmId);
        created += r.created;
        updated += r.updated;
      }
    } else {
      if (!it.bmId) {
        await chrome.bookmarks
          .create({ parentId: chromeParentId, title: it.title, url: it.url })
          .catch(() => {});
        created++;
      } else if (it.dirty) {
        await chrome.bookmarks
          .update(it.bmId, { title: it.title, url: it.url })
          .catch(() => {});
        updated++;
      }
    }
  }
  return { created, updated };
}

/* ------------------------------- 主同步流程 ------------------------------- */

export async function syncBookmarks(
  current: NavItem[],
  opts: { force?: boolean } = {}
): Promise<SyncResult> {
  const meta = await getSyncMeta();
  const now = Date.now();
  const noop = (): SyncResult => ({
    items: current,
    changed: false,
    updatedAt: new Date(meta.lastSyncAt).toISOString(),
    counts: { added: 0, updated: 0, removed: 0 },
  });

  if (!opts.force && now - meta.lastSyncAt < THROTTLE_MS) return noop();
  // 没有 bookmarks API（权限缺失 / 非扩展环境）→ 静默跳过
  if (typeof chrome === "undefined" || !chrome.bookmarks?.getTree) return noop();

  const manual = current.filter((i) => i.source !== "chrome");
  const chromeItems = current.filter((i) => i.source === "chrome");

  let tree: chrome.bookmarks.BookmarkTreeNode[];
  try {
    tree = await chrome.bookmarks.getTree();
  } catch {
    return noop();
  }

  // 当前 chrome 子树里已知的全部 bmId
  const currentBmIds = new Set<string>();
  collectBmIds(chromeItems, currentBmIds);

  let counts: SyncCounts = { added: 0, updated: 0, removed: 0 };

  // 1) 把 Atrium 侧未同步改动写回 Chrome（含新建 chrome 文件夹/链接，递归保持层级）
  const push = await pushToChrome(current, DEFAULT_CHROME_PARENT);
  counts.added += push.created;
  counts.updated += push.updated;

  // 2) 检测 Atrium 侧删除：上次已知、现已不在 Atrium，且未被 detach、也非 Chrome 永久容器 → 从 Chrome 删除
  const removedBmIds = meta.lastKnownBmIds.filter(
    (id) => !PERMANENT_BM_IDS.has(id) && !currentBmIds.has(id) && !meta.detachedBmIds.includes(id)
  );
  for (const id of removedBmIds) {
    try {
      const nodes = await chrome.bookmarks.get(id);
      if (nodes && nodes.length) {
        await chrome.bookmarks.remove(id).catch(() => {});
        counts.removed++;
      }
    } catch {
      /* 已不存在则忽略 */
    }
  }

  // 3) 重新镜像（写回已生效），得到与 Chrome 一致的最新结构
  const tree2 = await chrome.bookmarks.getTree();
  const newChrome = buildChromeNav(tree2, meta.detachedBmIds);
  const merged: NavItem[] = [...manual, ...newChrome];

  // 结构变化计数（用于 toast）
  const before = new Set<string>();
  collectBmIds(chromeItems, before);
  const after = new Set<string>();
  collectBmIds(newChrome, after);
  const structuralAdded = [...after].filter((k) => !before.has(k)).length;
  const structuralRemoved = [...before].filter((k) => !after.has(k)).length;
  const changed =
    structuralAdded > 0 ||
    structuralRemoved > 0 ||
    push.created > 0 ||
    push.updated > 0 ||
    counts.removed > 0;

  const updatedAt = new Date().toISOString();
  await saveNav(merged);

  const allBmIds = new Set<string>();
  collectBmIdsFromTree(tree2, allBmIds);
  await setSyncMeta({
    lastSyncAt: now,
    lastKnownBmIds: [...allBmIds],
    detachedBmIds: meta.detachedBmIds,
  });

  return {
    items: merged,
    changed,
    updatedAt,
    counts: {
      added: structuralAdded + push.created,
      updated: push.updated,
      removed: structuralRemoved + counts.removed,
    },
  };
}
