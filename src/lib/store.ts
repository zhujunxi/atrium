import type { NavData, NavItem, NavLink, NavMode } from "@/lib/types";
import { translate } from "@/lib/i18n";

const STORAGE_KEY = "nav-data";
const MODE_KEY = "nav-mode";
const ENTRANCE_KEY = "nav:entrance";

/** 同步读取「开启动效」开关（默认开），与 nav:engine 同机制，避免首屏闪烁 */
export function readEntrance(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(ENTRANCE_KEY);
  return v === null ? true : v === "1";
}

/** 写入「开启动效」开关（"1" / "0"），下次打开页面生效 */
export function writeEntrance(on: boolean): void {
  try {
    localStorage.setItem(ENTRANCE_KEY, on ? "1" : "0");
  } catch {
    /* 隐私模式等写入失败时静默，不影响当前页面 */
  }
}

/** 读取当前模式（local = 本地桌面 / sync = 网格即 Chrome 收藏夹），缺省 local */
export async function loadMode(): Promise<NavMode> {
  try {
    const r = await chrome.storage.local.get(MODE_KEY);
    return r[MODE_KEY] === "sync" ? "sync" : "local";
  } catch {
    return "local";
  }
}

export async function saveMode(mode: NavMode): Promise<void> {
  await chrome.storage.local.set({ [MODE_KEY]: mode });
}

/** 本地模式数据是纯本地的：剥离历史版本遗留的同步元数据（source/dirty/bmId） */
function stripSyncMeta(items: NavItem[]): NavItem[] {
  return items.map((it) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { bmId: _b, ...rest } = it as any;
    delete rest.source;
    delete rest.dirty;
    if (rest.type === "folder") rest.items = stripSyncMeta(rest.items ?? []);
    return rest as NavItem;
  });
}

/** 兼容旧版「分类」数据：categories[] 整体迁移为 桌面文件夹（沿用原 server/data.ts 逻辑） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(raw: any): NavData {
  if (Array.isArray(raw?.items))
    return { items: stripSyncMeta(raw.items), updatedAt: raw.updatedAt ?? new Date().toISOString() };
  if (Array.isArray(raw?.categories)) {
    const items: NavItem[] = raw.categories
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c && typeof c.id === "string")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => ({
        id: c.id as string,
        type: "folder" as const,
        name: String(c.name ?? translate("common.untitled")),
        items: (Array.isArray(c.links) ? c.links : [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((l: any) => l && typeof l.id === "string")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((l: any): NavLink => ({
            id: l.id as string,
            type: "link",
            title: String(l.title ?? ""),
            url: String(l.url ?? ""),
            description: typeof l.description === "string" ? l.description : undefined,
          })),
      }));
    return { items, updatedAt: raw.updatedAt ?? new Date().toISOString() };
  }
  return { items: [], updatedAt: new Date().toISOString() };
}

/** 首次运行：读取打包的种子数据 public/nav.seed.json 初始化 */
async function readSeed(): Promise<NavData> {
  try {
    const res = await fetch(chrome.runtime.getURL("nav.seed.json"));
    return migrate(await res.json());
  } catch {
    return { items: [], updatedAt: new Date().toISOString() };
  }
}

/**
 * 读取导航数据（替代原 GET /api/nav）。
 * chrome.storage.local 为空时用 seed 初始化并落盘；旧分类格式自动迁移。
 */
export async function loadNav(): Promise<NavData> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  if (raw && Array.isArray(raw.items)) return migrate(raw);
  const seed = await readSeed();
  await chrome.storage.local.set({ [STORAGE_KEY]: seed });
  return seed;
}

/** 全量保存桌面结构（替代原 PUT /api/nav） */
export async function saveNav(items: NavItem[]): Promise<NavData> {
  const data: NavData = { items, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
  return data;
}

/** 导出为 JSON 字符串（供设置菜单下载备份） */
export async function exportNav(): Promise<string> {
  const data = await loadNav();
  return JSON.stringify(data, null, 2);
}

/** 从 JSON 字符串导入并覆盖（供设置菜单恢复备份），返回导入后的数据 */
export async function importNav(json: string): Promise<NavData> {
  const parsed = migrate(JSON.parse(json));
  await chrome.storage.local.set({ [STORAGE_KEY]: parsed });
  return parsed;
}

/** 与原 lib/api.ts 保持同名接口，方便组件里最小改动替换 */
export const store = {
  getNav: loadNav,
  saveNav,
};

export type { NavData, NavItem, NavLink };
