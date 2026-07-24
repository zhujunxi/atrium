<div align="center">

# Atrium

**把 Chrome 收藏夹同步到新标签页、常用网站一键直达的 Chrome 扩展。**

[English](README.md) · [中文](README.zh-CN.md)

[![Build Extension](https://github.com/zhujunxi/atrium/actions/workflows/build.yml/badge.svg)](https://github.com/zhujunxi/atrium/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)

</div>

## 简介

**Atrium 把 Chrome 收藏夹同步到新标签页，整理并一键直达你的常用网站。**

它会把 Chrome 收藏夹（含嵌套子文件夹）直接镜像到新标签页，常用网站触手可及。点开文件夹可逐级进入子文件夹，关掉就退回上一级；拖拽任意图标即可排序，把一个叠到另一个上就能建组，拖出来则解除归属。每天自动换一张 Bing 壁纸，顶部搜索框可一键在必应 / Google / 百度 / GitHub 之间切换。支持深色、浅色与跟随系统。你手动添加的内容全部存在本地，Atrium 不上传任何数据。

## 功能

- 🧊 **液态玻璃 UI** — 真 SVG 位移折射的玻璃控件，全出血 squircle 应用图标
- 🖼️ **每日壁纸** — Bing 每日图，支持「换一张」与自动轮播
- 🗂️ **Launchpad 交互** — 长按进入编辑、拖拽排序、拖叠建文件夹、分页翻动
- 🔍 **聚合搜索** — 必应 / Google / 百度 / GitHub 一键切换
- 🌗 **深色 / 浅色 / 跟随系统**
- 💾 **纯本地存储** — 数据存 `chrome.storage.local`，支持一键导出 / 导入备份
- 🔒 **隐私优先** — 默认仅需 Bing 一个主机权限；高清图标为可选能力，按需申请
- 🔖 **Chrome 收藏夹同步** — 双向同步，把 Chrome 收藏夹（含嵌套子文件夹）镜像到新标签页；在 Atrium 里的改动会写回 Chrome，打开/刷新新标签自动对账

## 截图

![Atrium 新标签页](screenshot/04.png)

## Chrome 收藏夹同步

Atrium 可以把你的 Chrome 收藏夹镜像到新标签页，并保持双向同步。

- **双向同步** — 在 Atrium 里重命名、新增或删除收藏夹 / 网址，会在下次同步时写回 Chrome；在 Chrome 里删除，Atrium 里也会消失。
- **嵌套文件夹** — 完整保留 Chrome 里的文件夹层级结构。
- **自动同步** — 每次打开或刷新新标签页时自动对账一次（10 秒节流，连开多个标签页不会反复请求）；也可在「设置 → Chrome 收藏夹 → 立即同步」手动触发。
- **本地另存，而非破坏** — 把 Chrome 网址从文件夹里「拖出」，或把两个网址「叠放合并」成新文件夹，Atrium 会生成一份本地副本，原 Chrome 收藏夹保持不变、继续同步；而「解散 / 删除」文件夹是双向的（也会从 Chrome 移除）。
- **书签栏 / 其他书签** — Chrome 顶层的容器会被展开，它们的内容直接出现在桌面，而不是包在一层「书签栏」文件夹里。

你在 Atrium 里手动新建的（非 Chrome）网址和文件夹会单独保留，不会改动你的 Chrome 收藏夹。

## 安装

Atrium 提供三种安装方式，按需选择。

### 方式一 · Chrome 网上应用店（推荐）

> 🚧 即将上线。发布后点击以下按钮即可一键安装：
>
> [![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-%E5%8D%B3%E5%B0%86%E4%B8%8A%E7%BA%BF-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
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

## 开发

```bash
npm run dev
```

`npm run dev` 启动 Vite 开发服务器（含热更新 HMR）。首次需在 `chrome://extensions` 加载 `@crxjs` 生成的 `dist/`；之后修改组件保存，新标签页会自动热更新。

```bash
npm run build       # 生产构建，产物在 dist/
npm run build:zip   # 构建并打包为 atrium.zip
```

## 隐私

Atrium 不收集、不上传任何数据，没有任何分析 / 追踪代码。

| 权限 | 用途 | 类型 |
| --- | --- | --- |
| `storage` | 保存你的导航数据与设置 | 必需 |
| `https://www.bing.com/*` | 获取每日壁纸 | 必需（主机）|
| `<all_urls>` | 「高清图标」开启时抓取网站图标 | **可选**，仅在你手动开启开关时申请，可随时关闭并撤销 |
| `bookmarks` | 将 Chrome 收藏夹同步到新标签页（读取收藏夹，并写回你在 Atrium 中的改动） | 必需 |

网站图标默认走 [DuckDuckGo 图标服务](https://icons.duckduckgo.com)（无需任何主机权限）。只有当你在设置中开启「高清图标」时，才会向你申请 `<all_urls>` 权限用于解析目标站的 apple-touch-icon 等高清图标。

## 技术栈

- [Vite](https://vitejs.dev/) 5 + [React](https://react.dev/) 18 + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (Radix)
- [@crxjs/vite-plugin](https://crxjs.dev/) — MV3 打包与开发热更新

## 项目结构

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

## 许可证

[MIT](./LICENSE)
