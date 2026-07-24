# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-24

### Added

- Initial release of Atrium, a macOS Launchpad-style new tab extension (MV3).
- Liquid-glass application icons and controls with real SVG displacement refraction.
- Daily Bing wallpaper with shuffle and auto-rotation.
- Launchpad interactions: long-press to edit, drag to reorder, drag to create folders, paged navigation.
- Aggregated search across Bing / Google / Baidu / GitHub.
- Light / dark / system theme.
- Local-only data via `chrome.storage.local` with JSON export / import.
- Privacy-friendly permissions: only Bing host permission by default; high-resolution favicon parsing is optional and requests `<all_urls>` on demand.
