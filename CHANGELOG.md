# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-09-18

### Changed

- **Pagination rebuilt on native scrolling.** The launchpad no longer intercepts trackpad wheel events (the custom momentum path with `preventDefault` is gone): the viewport is a real `overflow-x` scroller with CSS `scroll-snap`, so a two-finger swipe runs entirely on the compositor — no main-thread listener to block it, and the browser's own momentum and snapping. The pager now only syncs the page number, jumps discretely, and drives drag plus the rubber-band. The scrollbar is hidden (`.lp-viewport`) so the clean look is preserved.
- **Mouse drag pages from anywhere on the grid.** Pressing and dragging horizontally pages from anywhere on the page — including on top of icons — instead of only the empty background, matching touch. Vertical drags are unaffected, an open folder still swallows the gesture, and the drag axis is decided by horizontal travel alone (a mouse press carries a few pixels of jitter, so judging the axis up front used to kill horizontal drags).
- **A traditional mouse wheel steps exactly one page.** A discrete wheel (`deltaMode ≠ 0` or `|deltaY| ≥ 40`) advances one page per notch, throttled to 180 ms per direction so a fast flick cannot skip pages; trackpad deltas are left entirely to native scrolling.

### Fixed

- **The edge rubber-band no longer bounces twice.** The over-scroll displacement is written on the **scroll container** instead of the content: transforming the content grows/shrinks the container's scrollable overflow area, so the browser re-clamped and re-snapped the last page — that was the "it already snapped back, then bounced once more". It is now an explicit `idle → pulling → returning` state machine with a damped displacement (52 px max), new pushes swallowed while returning, and a return animation without overshoot.
- **No more half-second stall before the rubber-band returns.** macOS keeps delivering momentum-tail events for a few hundred ms after the fingers lift, and waiting for them to go silent made the release feel stuck. Release is now detected from the push force itself (peak force, a drop to 65% of it, three consecutive falling samples) and the rest of that gesture's tail is ignored, so the snap-back starts the moment the fingers leave.
- **A stuck gesture could disable paging until reload.** Losing focus mid-drag (switching apps, opening DevTools) meant Chrome never delivered the matching `pointerup`, leaving the pager permanently "dragging" so press-and-drag stopped working. A window `blur` handler now settles the gesture, and a new `pointerdown` from the same pointer always starts a fresh one.
- **Press-and-drag no longer jumps when it starts mid-animation.** Starting a drag while a page flip was still running could measure the release from a half-page offset and snap in the wrong direction; the drag baseline now lands on the current whole page first, and the release point can never be opposite to the drag direction.
- **Rapid arrow-key paging is no longer dropped.** Arrow paging read the page number from React state, which had not re-rendered yet, so quick presses repeated or skipped a page. It now reads the pager's current target page directly.

## [0.6.4] - 2026-09-05

### Added

- **Daily wallpaper update.** On the first open of a new day the wallpaper aligns itself to the current head of the Bing pool for the active language market — previously it stayed on whatever was last set, no matter how old. Pinned collection wallpapers are never overridden, a same-day manual "change wallpaper" is respected, and a new day re-aligns automatically. Alignment self-heals: it is retried every 10 minutes and whenever the tab regains focus until it succeeds.
- **"Follow system" language option.** The language setting now defaults to following the browser language; choosing 中文 / English pins it explicitly and can be reset back to "Follow system" at any time.

### Changed

- **Wallpaper module rewritten for first-frame speed.** The four-layer storage stack (IndexedDB blob gallery, 32px blur fallback image, chrome.storage wallpaper pointer and the preload state machine) is replaced by a single synchronous localStorage path: `boot.js` paints the full-resolution image before the first frame and React reads the exact same bytes synchronously — opening a new tab no longer flashes, blurs or waits on any async storage. "Change wallpaper" stays instant via an idle-time prefetch of the next pool image.
- **Wallpaper switches never show a blank frame.** The old image always stays underneath while the new one downloads and decodes; the 700 ms cross-fade runs only after the new pixels are fully ready. If local bytes are missing (first install), the remote URL is used as the display source so the wallpaper area never falls back to a plain colour while loading.
- **HD favicons enabled by default.** The optional `<all_urls>` permission is only exercised when granted; without it icon loading silently falls back to the standard sources. Users who explicitly turned HD icons off keep that choice.
- **The wallpaper market follows the language setting.** Switching the UI language re-aligns the wallpaper to that market's current daily image (zh-CN → Bing China, en → Bing US), with the same no-blank cross-fade.

### Fixed

- **Wallpaper date was one day behind.** Bing's `startdate` is a US-Pacific calendar day and is identical for every `mkt` (verified against zh-CN / en-US / ja-JP / en-GB / en-AU / en-IN / de-DE), while the daily image rolls over at the user's local midnight. East of UTC-7 that left today's wallpaper labelled with yesterday's date for most of the local day, contradicting the header clock. The whole image pool is now shifted onto the user's local calendar (offset derived from `pool[0]`, capped at ±1 day so a stale pool is never rewritten), for both freshly fetched and cached pools. Existing snapshots self-heal on the next open; wallpapers already saved to the collection keep the date they were saved with.
- **Wallpaper could stick to an old image after a language change.** The daily alignment previously ran against every pool in parallel (initialisation and language switching raced, last writer won) and could mistake a previous-day photo for "already up to date" because same photos across markets normalise to the same id. Alignment now runs on a single path driven by the effective language, only on fresh pools, and the aligned head is recorded as `date|image-id` so a new day or a market change always re-aligns.

## [0.6.3] - 2026-08-30

### Added

- **Wallpaper download button.** The bottom-right controls now include a download action that saves the current wallpaper as a file (fetched as a blob and handed to `<a download>`, with an error toast on failure).

### Changed

- **Wallpaper switching is now sequential.** "Change wallpaper" walks the active pool in order and wraps around, instead of picking randomly — repeated clicks traverse the whole pool and return to the start.
- **Bing wallpapers upgraded to UHD sources (3840×2160).** The 1080p URLs returned by the API are rewritten to their `_UHD` variants, so the wallpaper no longer looks soft on high-DPI displays; a 1080p fallback chain kicks in if the UHD variant fails to load.
- **Bottom-right controls are collapsed by default.** Only the quiet "i" button is visible; hovering the group fades in the download / like / gallery buttons and the copyright text.
- App icons now fill their container edge-to-edge (no inner padding around the favicon) with a unified **26% corner radius** (main icons and folder-grid mini icons).
- Header refined: the greeting is smaller (30/36px, semibold) with a lighter, wider-tracked date line above it.
- The "Shuffle all" mode is renamed **"Cycle all"** (ZH: 混合轮换) to match the new sequential behavior.

### Fixed

- **No more visible wallpaper switch right after opening a new tab.** Cross-day updates are now prepared silently in the background: the pointer is saved to the new daily image, its blurred first-paint backdrop is pre-generated, and the image is prewarmed into the HTTP cache. The open page keeps showing the old image; the next open presents the new wallpaper directly (blurred-to-sharp, no swap animation).
- **Cross-day edge case:** the cached image pool is now only trusted when it was written *today* (`cacheIsToday`). Previously a cache written shortly before midnight could stamp yesterday's image as "today", blocking the real daily image for the rest of the day.
- **Auto-rotate can no longer die silently.** The rotation timer now reschedules itself after every tick, so an idle `advance()` (empty pool, or a pool containing only the current image) no longer stops rotation permanently.

## [0.6.2] - 2026-08-15

### Fixed

- **Daily wallpaper (`bing-daily`) now rolls over across days again.** First-paint pointer resolution used to trust the (possibly stale) cached image pool (`bing-cache-*`) and, on a cross-day open, would treat yesterday's image as today's and stamp it with today's `dayStamp`. The arriving fresh pool then hit the early-return in `applyDailyUpdate` (since `dayStamp` already equaled today), so today's image never got applied — every day the user saw yesterday's (or older) photo. The cached pool is now only trusted when fresh (≤ 30 min); when stale, the old snapshot is kept untouched and the real cross-day switch happens via `applyDailyUpdate` once the fresh pool lands.

## [0.6.1] - 2026-07-30

### Changed

- **Icon clicks now load the URL in the current tab** instead of opening a new tab. This applies to launchpad icons on the desktop and inside folders; `Ctrl`/`Cmd`/`Shift`+click and middle-click still open the link in a new tab.
- Search-result icons and the search submit now also navigate the current tab to the result, instead of opening a new tab.

### Fixed

- Removed the redundant query-clearing that fired after clicking a search result — the page navigates away anyway, so clearing was just confusing noise.

## [0.6.0] - 2026-07-27

### Added

- Search result icons now play the same staggered entrance animation as the launchpad grid (replayed per query, gated by the Entrance-animation setting and `prefers-reduced-motion`).

### Changed

- Wallpaper engine rebuilt on an **identity-snapshot model** (`WallpaperCurrent` v2 holds `kind/key/url/copy/dayStamp`). Rendering now depends only on the snapshot, never on Bing's rolling daily pool order — so the wallpaper no longer visibly swaps when you open a new tab, after the daily rollover / 30-minute cache refresh, or when you switch the UI language. `canonicalWallpaperId` strips the market code + timestamp so the same photo matches across locales and resolutions. A new `useWallpaper()` controller hook owns pool fetching, first-paint pointer resolution, and advance/like/gallery/mode-switch logic; `desktop-background.tsx` is now a pure rendering layer. Legacy v1 pointers are discarded and rebuilt once on upgrade.

### Fixed

- **First-paint white flash fully eliminated.** A blocking `boot.js` (allowed under MV3's CSP) now runs before first paint to set the `.dark` class and paint the last wallpaper's cached blurred thumbnail as the body background, and the first frame uses the wallpaper's **average color** as its base instead of a near-white theme color — removing the residual lower-half white flash on refresh. This also fixes the dark-mode first frame, where `next-themes`' anti-flash inline script was previously blocked by MV3 CSP.
- Search result icons now actually open the page when clicked: moving focus into the results grid no longer clears the query (and unmounts the grid) before the click fires; the query now clears on result click instead.

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
