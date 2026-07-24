export interface NavLink {
  id: string;
  type: "link";
  title: string;
  url: string;
  description?: string;
}

export interface NavFolder {
  id: string;
  type: "folder";
  name: string;
  items: NavLink[];
}

/** 桌面根级项目：网址 或 文件夹（macOS Launchpad 模型，文件夹不可嵌套） */
export type NavItem = NavLink | NavFolder;

export interface NavData {
  items: NavItem[];
  updatedAt: string;
}
