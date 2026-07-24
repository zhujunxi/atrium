<div align="center">

# Atrium

**A liquid-glass, macOS Launchpad-style new tab page for Chrome.**

一个液态玻璃质感、macOS Launchpad 风格的新标签页导航扩展。

[![Build Extension](https://github.com/zhujunxi/atrium/actions/workflows/build.yml/badge.svg)](https://github.com/zhujunxi/atrium/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)

</div>

## Overview

Atrium 把浏览器的新标签页变成一块「玻璃中庭」——每天一张 Bing 壁纸作背景，你收藏的网站以 macOS Launchpad 的方式陈列其上：全出血 squircle 图标、液态玻璃质感、拖拽排序、拖叠成文件夹、分页翻动。所有数据都存在本地，不上传任何服务器。

> Atrium replaces your new tab with a glass atrium for the web: a daily Bing wallpaper, your links laid out Launchpad-style with liquid-glass icons, drag-to-reorder, drag-to-fold folders, and paged navigation. Everything stays on your device.

## Features

- 🧊 **液态玻璃 UI** — 真 SVG 位移折射的玻璃控件，全出血 squircle 应用图标
- 🖼️ **每日壁纸** — Bing 每日图，支持「换一张」与自动轮播
- 🗂️ **Launchpad 交互** — 长按进入编辑、拖拽排序、拖叠建文件夹、分页翻动
- 🔍 **聚合搜索** — 必应 / Google / 百度 / GitHub 一键切换
- 🌗 **深色 / 浅色 / 跟随系统**
- 💾 **纯本地存储** — 数据存 `chrome.storage.local`，支持一键导出 / 导入备份
- 🔒 **隐私优先** — 默认仅需 Bing 一个主机权限；高清图标为可选能力，按需申请

## Install

Atrium 提供三种安装方式，按需选择。

### 方式一 · Chrome 网上应用店（推荐）

> 🚧 即将上线。发布后点击以下按钮即可一键安装：
>
> [![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-即将上线-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
>
> 商店版会自动更新，无需手动操作。

### 方式二 · 从 Release 下载预构建包

1. 前往 [Releases 页面](https://github.com/zhujunxi/atrium/releases) 下载最新的 `atrium.zip`。
2. 解压得到 `dist/` 目录。
3. 在 Chrome 打开 `chrome://extensions` → 开启右上角「开发者模式」→「加载已解压的扩展程序」→ 选择解压出来的 `dist/` 目录。
4. 打开一个新标签页（`Cmd/Ctrl + T`）即可看到 Atrium。

### 方式三 · 自行构建（开发者）

```bash
git clone https://github.com/zhujunxi/atrium.git
cd atrium
npm install
npm run build
```

然后在 Chrome 打开 `chrome://extensions` → 开启右上角「开发者模式」→「加载已解压的扩展程序」→ 选择项目下的 `dist/` 目录。

打开一个新标签页（`Cmd/Ctrl + T`）即可看到 Atrium。

## Development

```bash
npm run dev
```

`npm run dev` 启动 Vite 开发服务器（含热更新 HMR）。首次需在 `chrome://extensions` 加载 `@crxjs` 生成的 `dist/`；之后修改组件保存，新标签页会自动热更新。

```bash
npm run build       # 生产构建，产物在 dist/
npm run build:zip   # 构建并打包为 atrium.zip
```

## Privacy

Atrium 不收集、不上传任何数据，没有任何分析 / 追踪代码。

| 权限 | 用途 | 类型 |
| --- | --- | --- |
| `storage` | 保存你的导航数据与设置 | 必需 |
| `https://www.bing.com/*` | 获取每日壁纸 | 必需（主机）|
| `<all_urls>` | 「高清图标」开启时抓取网站图标 | **可选**，仅在你手动开启开关时申请，可随时关闭并撤销 |

网站图标默认走 [DuckDuckGo 图标服务](https://icons.duckduckgo.com)（无需任何主机权限）。只有当你在设置中开启「高清图标」时，才会向你申请 `<all_urls>` 权限用于解析目标站的 apple-touch-icon 等高清图标。

## Tech Stack

- [Vite](https://vitejs.dev/) 5 + [React](https://react.dev/) 18 + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (Radix)
- [@crxjs/vite-plugin](https://crxjs.dev/) — MV3 打包与开发热更新

## Project Structure

```
atrium/
├─ manifest.config.ts     # MV3 清单（@crxjs）
├─ vite.config.ts
├─ index.html             # 新标签页入口
├─ public/
│  ├─ icons/              # 扩展图标 16/48/128
│  └─ nav.seed.json       # 首次运行的示例数据
└─ src/
   ├─ main.tsx            # React 根
   ├─ background.ts       # service worker（高清图标解析）
   ├─ components/         # UI 组件
   └─ lib/                # store（存储）/ favicon / pager / glass 等
```

## Acknowledgements

本项目由个人 Next.js 导航站移植而来，视觉与交互灵感来自 macOS Launchpad 与 iOS 26 的 Liquid Glass。

## License

[MIT](./LICENSE) © zhujunxi
