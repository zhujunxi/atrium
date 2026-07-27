/** 双模式：local = 本地桌面（chrome.storage 持久化）；sync = 网格即 Chrome 收藏夹（实时双向） */
export type NavMode = "local" | "sync";

/** 同步模式下的 Chrome 书签节点 id（本地模式下的项目没有该字段） */
export interface SyncMeta {
  bmId?: string;
}

export interface NavLink extends SyncMeta {
  id: string;
  type: "link";
  title: string;
  url: string;
  description?: string;
}

export interface NavFolder extends SyncMeta {
  id: string;
  type: "folder";
  name: string;
  /** 可嵌套：既放链接，也可放子文件夹（与 Chrome 收藏夹层级一致） */
  items: NavItem[];
}

/** 桌面根级项目：网址 或 文件夹（macOS Launchpad 模型，文件夹不可嵌套） */
export type NavItem = NavLink | NavFolder;

export interface NavData {
  items: NavItem[];
  updatedAt: string;
}

// --- 壁纸收藏 -------------------------------------------------------------

/** 壁纸来源：bing = 来自必应每日图；custom = 用户本地收藏（未来可扩展上传） */
export type WallpaperSource = "bing" | "custom";

/** 一张被永久收藏的壁纸（仅存 URL + 缩略图 dataURL，不下载原图，Bing 的 th?id= 链接长期有效） */
export interface SavedWallpaper {
  id: string;
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
  /** 缩略图 dataURL（约 3-5KB），画廊网格展示用 */
  thumb: string;
  savedAt: string;
  source: WallpaperSource;
}

/** 壁纸展示模式：每日推荐 / 我的收藏 / 混合随机 */
export type WallpaperMode = "bing-daily" | "collection" | "shuffle-all";

export interface WallpaperSettings {
  mode: WallpaperMode;
  /** 是否自动轮换 */
  autoRotate: boolean;
  /** 轮换间隔（分钟） */
  rotateIntervalMin: number;
  /** 是否在壁纸上叠加压暗蒙版以提升图标 / 文字可读性 */
  dimMask: boolean;
}

/**
 * 当前壁纸指针（v2，身份快照模型）。
 *
 * v1 存的是 `bingIndex` 下标，而必应接口返回的是每日滚动窗口——每天头部插入新图、
 * 整体后移一位。同一个下标隔天就解析成另一张图，导致「打开新标签页时壁纸乱换」。
 * v2 直接存「这张图是谁」的完整快照：url / 文案 / 归一化 id。渲染只依赖快照本身，
 * 不再依赖图池加载与顺序，打开新标签页永远先显示上次那张图。
 */
export interface WallpaperCurrent {
  /** 来源池：必应每日图 / 我的收藏 */
  kind: "bing" | "collection";
  /** 归一化 id（canonicalWallpaperId），跨语言 / 跨分辨率稳定 */
  key: string;
  /** 渲染快照：直接展示该 url，Bing th?id= 链接长期有效 */
  url: string;
  title: string;
  copyright: string;
  copyrightlink: string;
  /** kind = collection 时对应的收藏 id */
  collectionId: string | null;
  /** 上次设置时间（ISO），自动轮换据此判断到期 */
  setAt: string;
  /** 设置当天的本地日期戳（YYYY-MM-DD），bing-daily 模式跨天更新的依据 */
  dayStamp: string;
}
