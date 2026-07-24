/** 同步元数据：用于在 Atrium 导航与 Chrome 收藏夹之间做双向对账 */
export interface SyncMeta {
  /** 来源：chrome = 来自 Chrome 收藏夹（参与双向同步）；manual / 缺省 = 本地手动 */
  source?: "chrome" | "manual";
  /** Chrome 书签节点的稳定 id，是双向匹配的主键 */
  bmId?: string;
  /** Atrium 本地的未同步改动标记；同步时据此写回 Chrome */
  dirty?: boolean;
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
