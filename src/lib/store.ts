import type { NavData, NavItem, NavLink } from "@/lib/types";

const STORAGE_KEY = "nav-data";

/** 兼容旧版「分类」数据：categories[] 整体迁移为 桌面文件夹（沿用原 server/data.ts 逻辑） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(raw: any): NavData {
  if (Array.isArray(raw?.items)) return raw as NavData;
  if (Array.isArray(raw?.categories)) {
    const items: NavItem[] = raw.categories
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c && typeof c.id === "string")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => ({
        id: c.id as string,
        type: "folder" as const,
        name: String(c.name ?? "未命名"),
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
