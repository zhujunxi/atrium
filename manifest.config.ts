import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "__MSG_name__",
  description: "__MSG_description__",
  default_locale: "en",
  version: pkg.version,
  // 用本扩展页面覆盖 Chrome 新标签页
  chrome_url_overrides: {
    newtab: "index.html",
  },
  icons: {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png",
  },
  // 工具栏按钮：无 popup，点击时由 background 打开导航新标签页（否则图标灰色且点击无响应）
  action: {
    default_title: "__MSG_action_title__",
    default_icon: {
      "16": "icons/16.png",
      "48": "icons/48.png",
      "128": "icons/128.png",
    },
  },
  permissions: [
    "storage", // 导航数据 chrome.storage.local
    "bookmarks", // 同步 Chrome 收藏夹（打开/刷新新标签时双向对账）
  ],
  // 默认仅需 Bing（每日壁纸），主机权限极小
  host_permissions: ["https://www.bing.com/*"],
  // 高清图标（抓取目标站 HTML 解析 apple-touch-icon）为可选能力，
  // 仅当用户在设置里开启「高清图标」时才动态申请，隐私友好
  optional_host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
});
