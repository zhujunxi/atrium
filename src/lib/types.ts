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

export interface WallpaperCurrent {
  /** bing-daily / shuffle-all 当前展示的必应图下标 */
  bingIndex: number;
  /** collection / shuffle-all 当前展示的收藏 id（可能为 null） */
  collectionId: string | null;
  /** shuffle-all 模式下，上一张来自哪个池子（用于恢复/轮换去重） */
  pool: "bing" | "collection";
  /** 上次设置时间（ISO），自动轮换据此判断到期 */
  setAt: string;
}
