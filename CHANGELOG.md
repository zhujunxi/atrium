# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-26

### Added

- **Dual-mode toggle (local desktop / Chrome bookmarks sync).** A new switch in Settings lets you choose between a local desktop (independent of Chrome bookmarks) and sync mode, where the grid IS your Chrome bookmarks and every change syncs both ways in real time. Import/export remains local-only.
- **iPadOS-style entrance animation.** Each new-tab open plays a wallpaper settle + staggered icon-wave entrance. It is blur-safe (only animates `transform`/`opacity` on the compositor, never isolating the backdrop, so the liquid-glass blur stays intact during the animation) and can be turned off via a new **Entrance animation** setting.
- **Wallpaper overlay toggle.** Settings now expose a "Wallpaper overlay" (dim mask) switch to darken the background for better icon contrast.

### Changed

- Settings panel refactored to share a single `SegmentedControl` component (entries, wallpaper section); cleaner and more consistent UI.
- App bootstrap rewritten with `async`/`await` for data loading (`main.tsx`), removing promise chains.

### Fixed

- Folder icon no longer clipped at the edges; search grid alignment corrected.
- Favicon cache now detects DuckDuckGo placeholder images on non-200 responses and caches the negative result, avoiding repeated failed fetches.

### Build

- Release artifact is now versioned: `build:zip` produces `atrium-<version>.zip` (e.g. `atrium-0.5.0.zip`) derived from `package.json`, and the CI workflow attaches `atrium-*.zip` to tag releases. The install steps in the README were simplified (dropped a misleading `dist/` reference and merged "unzip" + "load unpacked" into one step).

## [0.4.0] - 2026-07-25

### Fixed

- Wallpaper favorites: the same Bing image can no longer be saved twice. URLs are now canonicalized (volatile `rf`/`pid`/resolution params ignored) so the heart state stays consistent across daily / collection / shuffle modes.
- Closed a rapid-click / cross-tab race that could insert duplicate favorites; collection writes are now serialized.
- Wallpaper no longer flashes when opening a new tab (cached blurred backdrop).
- Letter avatars no longer reload on every refresh ("no-icon" results are cached).

### Changed

- Polished settings menu layout and the hi-res toggle color.
- Refined toggle colors and button styling; simplified the "rotate interval" label in EN/ZH.

## [0.3.0] - 2026-07-24

### Added

- Wallpaper collection: like (♥) any Bing wallpaper to save it permanently in `chrome.storage.local` (URL + thumbnail only, no new permissions).
- Wallpaper gallery (▦): browse, pick, and delete saved wallpapers.
- Three display modes: daily picks / my collection / shuffle all.
- Auto-rotate wallpaper with a configurable interval (5 / 15 / 30 / 60 min).
- Restore the last wallpaper on new tab; sync across open tabs via `chrome.storage.onChanged`.

### Changed

- Bottom-bar controls extended with like and gallery buttons while preserving the existing glass style.

## [0.2.0] - 2026-07-24

### Added

- Bilingual EN/ZH i18n with auto-detect and manual switch.
- Chrome bookmarks two-way sync with nested-folder support.
- English seed data; Bing wallpaper description follows the UI language.
- Bilingual (EN + ZH) privacy policy for the Chrome Web Store.

### Changed

- Polished store listing descriptions (`messages.js`) and README taglines.
- README split into English (default) + Chinese; personal attribution removed.
- Overview streamlined (folded inspiration line, removed Acknowledgements section).

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
