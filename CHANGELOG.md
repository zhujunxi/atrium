# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
