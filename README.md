<div align="center">

# Atrium

**A new tab page that syncs your Chrome bookmarks and keeps your favorites one tap away.**

[English](README.md) · [中文](README.zh-CN.md)

[![Build Extension](https://github.com/zhujunxi/atrium/actions/workflows/build.yml/badge.svg)](https://github.com/zhujunxi/atrium/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)

</div>

## Overview

**Atrium syncs your Chrome bookmarks to a new tab and keeps your favorites one tap away.**

It mirrors your Chrome bookmarks — nested folders included — straight into the page, so the sites you use every day are right there. Open a folder to drill into subfolders; close it to step back one level. Drag any tile to reorder, drop one onto another to group them, or drag it out to detach. A fresh Bing wallpaper loads each day, and the search bar up top switches between Bing, Google, Baidu, and GitHub in a click. Pick light, dark, or system theme. Everything you add stays on your device — Atrium uploads nothing.

## Features

- 🧊 **Liquid-glass UI** — real SVG displacement-refraction glass controls, full-bleed squircle app icons
- 🖼️ **Daily wallpaper** — Bing daily image, with "next" shuffle and auto-rotation
- 🗂️ **Launchpad interaction** — long-press to edit, drag-to-reorder, drag-to-fold folders, paged navigation
- 🔍 **Unified search** — Bing / Google / Baidu / GitHub one-click switch
- 🌗 **Dark / Light / System**
- 💾 **Local-only storage** — data in `chrome.storage.local`, with one-click export / import backup
- 🔒 **Privacy-first** — only the Bing host permission by default; high-res icons are an optional, on-demand capability
- 🔖 **Chrome bookmarks sync** — two-way sync mirrors your Chrome bookmarks (nested folders included) into the new tab; edits sync back to Chrome, and open/refresh auto-syncs

## Screenshots

![Atrium new tab](screenshot/04.png)

## Chrome Bookmarks Sync

Atrium can mirror your Chrome bookmarks into the new tab and keep them in sync.

- **Two-way sync** — rename, add, or delete a bookmark/folder in Atrium and the change is written back to Chrome on the next sync. Delete a bookmark in Chrome and it disappears from Atrium.
- **Nested folders** — the full folder hierarchy is preserved, exactly as in Chrome.
- **Auto-sync** — runs once each time you open or refresh a new tab (throttled to 10s so opening many tabs won't hammer the API). You can also trigger it manually from Settings → Chrome Bookmarks → Sync Now.
- **Detach, don't destroy** — dragging a Chrome bookmark *out* of a folder, or merging two bookmarks into a new folder, makes a local copy in Atrium; the original stays in Chrome and keeps syncing. Dissolving or deleting a folder is two-way (removed from Chrome too).
- **Bookmarks Bar / Other Bookmarks** — Chrome's top-level containers are unwrapped, so their contents appear directly on your desktop rather than inside a "Bookmarks Bar" folder.

Manual (non-Chrome) links and folders you create in Atrium are kept separate and never touch your Chrome bookmarks.

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
