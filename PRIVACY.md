# Atrium — Privacy Policy

## English

Atrium is a Chrome extension that replaces your new tab page. **We do not collect, transmit, or store any of your personal data on any server.**

- **Local-only storage.** All data you create — your bookmarks / quick links, folders, and settings — is stored exclusively in `chrome.storage.local` on your own device. It is never uploaded, synced to, or shared with any remote server.
- **No accounts, no analytics, no tracking.** Atrium has no backend, no telemetry, and no third-party analytics. We cannot see what you save.
- **Network requests.** Atrium makes only the requests necessary to function:
  - Fetching the daily Bing wallpaper from `https://www.bing.com` (required host permission).
  - Fetching site icons. By default these come from the DuckDuckGo icon service (no extra permission). Only if you enable **"HD icons"** do we request the optional `<all_urls>` permission to read a site's own `apple-touch-icon`; this is on-demand and revocable at any time.
- **Permissions used.** `storage` (save locally), `https://www.bing.com/*` (wallpaper), and optional `<all_urls>` (HD icons, only when you turn it on).
- **Children.** Atrium does not knowingly collect data from anyone.

If you have questions, please open an issue on the project repository.

## 中文

Atrium 是一款接管 Chrome 新标签页的扩展程序。**我们不会收集、传输或在任何服务器上存储您的任何个人数据。**

- **纯本地存储。** 您创建的所有数据——书签 / 常用网站、文件夹与设置——仅保存在您本机的 `chrome.storage.local` 中，绝不上传、不同步、不与任何远程服务器共享。
- **无账号、无分析、无追踪。** Atrium 没有后端、没有遥测、没有第三方分析，我们无法看到您保存的内容。
- **网络请求。** Atrium 仅发起功能所必需的网络请求：
  - 从 `https://www.bing.com` 获取每日壁纸（必需主机权限）。
  - 获取网站图标。默认走 DuckDuckGo 图标服务（无需额外权限）；仅当您开启「高清图标」时，才会申请可选权限 `<all_urls>` 以读取目标站自身的 `apple-touch-icon`，该权限按需申请、可随时撤销。
- **所用权限。** `storage`（本地保存）、`https://www.bing.com/*`（壁纸），以及可选 `<all_urls>`（高清图标，仅在您开启时使用）。
- **未成年人。** Atrium 不会有意收集任何人的数据。

如有疑问，请在项目仓库提交 Issue。
