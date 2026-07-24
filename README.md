<div align="center">

# Atrium

**A liquid-glass, macOS Launchpad-style new tab page for Chrome.**

[English](README.md) · [中文](README.zh-CN.md)

[![Build Extension](https://github.com/zhujunxi/atrium/actions/workflows/build.yml/badge.svg)](https://github.com/zhujunxi/atrium/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)

</div>

## Overview

Atrium replaces your new tab with a glass atrium for the web: a daily Bing wallpaper, your links laid out Launchpad-style with liquid-glass icons, drag-to-reorder, drag-to-fold folders, and paged navigation. Everything stays on your device. Visual and interaction inspiration comes from macOS Launchpad and iOS 26 Liquid Glass.

## Features

- 🧊 **Liquid-glass UI** — real SVG displacement-refraction glass controls, full-bleed squircle app icons
- 🖼️ **Daily wallpaper** — Bing daily image, with "next" shuffle and auto-rotation
- 🗂️ **Launchpad interaction** — long-press to edit, drag-to-reorder, drag-to-fold folders, paged navigation
- 🔍 **Unified search** — Bing / Google / Baidu / GitHub one-click switch
- 🌗 **Dark / Light / System**
- 💾 **Local-only storage** — data in `chrome.storage.local`, with one-click export / import backup
- 🔒 **Privacy-first** — only the Bing host permission by default; high-res icons are an optional, on-demand capability

## Screenshots

![Atrium new tab](screenshot/04.png)

## Install

Atrium offers three install methods — pick whichever fits.

### Method 1 · Chrome Web Store (recommended)

> 🚧 Coming soon. Once published, install with one click:
>
> [![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-coming%20soon-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
>
> Store builds update automatically — no manual steps.

### Method 2 · Download a prebuilt package from Release

1. Go to the [Releases page](https://github.com/zhujunxi/atrium/releases) and download the latest `atrium.zip`.
2. Unzip to get the `dist/` folder.
3. In Chrome open `chrome://extensions` → enable **Developer mode** (top-right) → **Load unpacked** → select the unzipped `dist/` folder.
4. Open a new tab (`Cmd/Ctrl + T`) and Atrium appears.

### Method 3 · Build from source (developers)

```bash
git clone https://github.com/zhujunxi/atrium.git
cd atrium
npm install
npm run build
```

Then in Chrome open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the project's `dist/` folder.

Open a new tab (`Cmd/Ctrl + T`) and Atrium appears.

## Development

```bash
npm run dev
```

`npm run dev` starts the Vite dev server (with HMR). First time, load the `@crxjs`-generated `dist/` via `chrome://extensions`; afterward, editing a component and saving hot-reloads the new tab automatically.

```bash
npm run build       # production build, output in dist/
npm run build:zip   # build and package into atrium.zip
```

## Privacy

Atrium collects and uploads nothing — no analytics, no tracking of any kind.

| Permission | Purpose | Type |
| --- | --- | --- |
| `storage` | Save your nav data and settings | Required |
| `https://www.bing.com/*` | Fetch the daily wallpaper | Required (host) |
| `bookmarks` | Sync your Chrome bookmarks into the new tab (read your bookmarks and write back edits you make in Atrium) | Required |
| `<all_urls>` | Fetch high-res site icons when "HD icons" is on | **Optional** — requested only when you toggle it on; revocable anytime |

Site icons default to the [DuckDuckGo icon service](https://icons.duckduckgo.com) (no host permission needed). Only when you enable "HD icons" in Settings is the `<all_urls>` permission requested, used to parse the target site's `apple-touch-icon` and similar high-res icons.

## Tech Stack

- [Vite](https://vitejs.dev/) 5 + [React](https://react.dev/) 18 + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (Radix)
- [@crxjs/vite-plugin](https://crxjs.dev/) — MV3 bundling and dev HMR

## Project Structure

```
atrium/
├─ manifest.config.ts     # MV3 manifest (@crxjs)
├─ vite.config.ts
├─ index.html             # new-tab entry
├─ public/
│  ├─ icons/              # extension icons 16/48/128
│  └─ nav.seed.json       # sample data on first run
└─ src/
   ├─ main.tsx            # React root
   ├─ background.ts       # service worker (HD icon parsing)
   ├─ components/         # UI components
   └─ lib/                # store (storage) / favicon / pager / glass etc.
```

## License

[MIT](./LICENSE)
