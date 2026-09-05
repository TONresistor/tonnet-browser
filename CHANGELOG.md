# Changelog

All notable changes to Tonnet Browser are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Standalone Messenger 0.4 client with persistent public rooms, verified history, room moderation and online encrypted direct messages.
- Room joining by canonical key or TON DNS alias, separate presence snapshots and pinned-message navigation.

### Changed

- Messenger owns its identity and connects directly over TON QUIC, independently of the Browser proxy and Bridge.
- The former Messenger network opt-in becomes an autostart preference; opening Messenger starts its client on demand.
- The default Resistance Dog background uses the updated dark palette.
- Bundled helpers retain Bridge v0.5.1 and GoCoon v0.3.0, with Messenger pinned to v0.4.0+dev.b164900.

### Compatibility

- Messenger 0.4 rooms and identities are incompatible with the legacy overlay chat. Existing standalone-client state is preserved; legacy room names, wallet attribution and offline DM history are not converted.
- Browser settings migrate to schema 4. Use a pre-upgrade profile backup when returning to an older build that only supports schema 3.

## [2.6.0] - 2026-08-30

### Added

- Experimental setting to advertise the built-in TON Connect wallet to .ton sites.
- Experimental Messenger with DHT discovery and automatic reconnect.
- Encrypted wallet vault with password, backup and recovery flows.
- Optional encrypted transaction comments.

### Changed

- Tracking protection is simplified; the path-based content filter is gone.
- Wallet transaction details now render inline in full-page and sidebar layouts.
- Bundled TON binaries updated to proxy v1.10.1, bridge v0.5.1, storage v1.5.3 and GoCoon v0.3.0, built with Go 1.26.
- `ton://storage` opens bag details in the left sidebar (back to filters) instead of a floating bar, with more compact bag rows.

### Fixed

- DevTools shortcut works while a page has focus.
- Cocoon displays non-bounceable `UQ` funding addresses.
- Wallet locking, password errors, transaction preflight and recovery flows are hardened.

## [2.5.0] - 2026-08-07

### Added

- Dedicated `ton://theme` workspace for selecting, creating, editing, importing and exporting browser themes.
- Per-tab page zoom controls in the status bar with a configurable default zoom.
- Experimental Unicode domain display for internationalized and emoji domains while navigation remains canonical Punycode.

### Changed

- Theme creation and editing now use an inline, responsive workbench with semantic color controls and an explicit temporary preview.
- Runtime settings changes now apply transactionally across proxy, storage, history, bridge and renderer state.
- Browser windows, tabs, overlays and native services now use stricter lifecycle ownership and cleanup.

### Fixed

- New, duplicated and imported themes remain local drafts until explicitly saved; canceling no longer persists partial themes.
- Wallet imports replace the active wallet atomically and preserve the previous wallet when validation fails.
- Cross-domain navigation, redirects and site subscriptions remain isolated to their owning domain session.
- macOS window recreation restores browser state without leaking views, listeners or native processes.
- Storage polling is single-flight, and internal `data:` or `file:` presentation URLs no longer enter navigation history or crash IPC.
- Settings migrations preserve payment spending data and reject unsupported future schema versions.
- Ordinary cleartext HTTP requests are blocked explicitly by the proxy runtime.

## [2.4.0] - 2026-07-11

### Added

- Canonical runtime-validated IPC contracts with typed preload and handler boundaries.
- Shared supervision for proxy, bridge, storage and Cocoon native processes.
- Versioned repositories and compatibility fixtures for persisted browser data.
- Automated architecture, bundle-budget, native-binary and release-metadata gates.
- Structured, bounded diagnostics with a temporary verbose mode and copyable reports.

### Changed

- Reconstructed internal ownership boundaries across wallet, TON bridge, payments, TonConnect, tabs, Messenger, Cocoon and the renderer.
- Split renderer code into feature-owned routes, clients, stores and components.
- Pinned bundled native helpers to immutable upstream commits and added build provenance, SBOM and artifact verification.
- Reduced main and preload bundle sizes while keeping the initial renderer bundle within its regression budget.
- Short, redacted application logs with isolated native-process output and bounded rotation.

### Fixed

- Settings category IPC responses now preserve the requested category instead of being coerced to another settings shape.
- Tabs, views, sessions, listeners and timers are disposed by their owning lifecycle.
- Native helper restarts use bounded backoff and settle concurrent start attempts consistently.
- Bridge and chat requests now fail cleanly instead of remaining pending during reconnects.

### Security

- Centralized redaction of secrets, authorization values, binary payloads and sensitive IPC failures.
- Runtime validation now rejects malformed IPC inputs, outputs and unsupported persisted schema versions.

## [2.2.0] - 2026-06-25

### Added

- TON Connect support for tonsites.
- In-app file browser for storage bags with a bag sidebar.
- Table viewer for CSV and JSONL files in storage bags.
- DNS page resolves full records with an open-site shortcut.
- Tab title and favicon for internal pages.

### Changed

- Redesigned settings, wallet, storage, cocoon, bookmarks, history and DNS pages.
- Redesigned the TON Connect approval popup.
- Cocoon chat renders markdown; setup wizard redesigned with a reset option.
- Coin amounts shown as GRAM.
- More reliable wallet transaction history.

### Fixed

- Orphaned native daemons no longer block startup.
- Single-instance lock prevents a second launch from deadlocking on daemon ports.
- Native daemons are terminated with their child tree on Windows.
- Wallet key storage writes are atomic and durable.

### Security

- File browser escapes bag file names and adds a nonce CSP; update check drops the identifying User-Agent; sign-data prompt shows payload details.

## [2.1.0] - 2026-06-20

### Added

- Storage page: peers column with per-row hover actions.

### Changed

- Bundled proxy updated to v1.10.0: ENSIP-7 contenthash resolution for `.eth` (ADNL multicodec `0xb69910`) with legacy `adnl` text-record fallback; tonutils-go v1.17.2 (fixes 32-bit Android build).
- Bundled bridge updated to v0.3.0: tonutils-go v1.17.2 (fixes 32-bit Android build).
- Bundled storage updated to v1.5.1: faster downloads and speed calc, parallel filesystem reads, and optimized DHT bag-overlay store/refresh; tonutils-go v1.17.1.
- Bundled cocoon runtime (gocoon/cocoon-runner) updated to v0.2.1: transport keepalive ping, OpenAI tools translation; tonutils-go v1.17.2 (fixes 32-bit Android build).
- BookmarksBar context menu and Wallet strings fully localized across all 10 locales.
- Storage page: completed bag status uses primary color.
- Dependencies bumped: Electron 41.3.0, Tailwind 4.2.4, i18next 26.0.8, react-i18next 17.0.4, @ton/ton 16.3.0, happy-dom 20.9.0, globals 17.5.0.
- CI runs on `dev` branch pushes and PRs; Dependabot capped at 5 npm PRs.

### Security

- Resolved all high/moderate `npm audit` advisories: axios 1.15.0 → 1.18.0 (via @ton/ton 16.3.0), plus ws 8.21.0, tmp 0.2.7, form-data 4.0.6, vite 7.3.5 and other transitive build-tooling bumps.

## [2.0.0] - 2026-04-25

### Added

- `.eth` and `.sol` resolver toggles with optional custom RPC URLs.

### Changed

- History writes use atomic secure-fs helpers.
- CI workflow actions pinned to commit SHAs.

### Fixed

- Clear browsing data covers all isolated domain sessions.
- Settings reset reapplies runtime state for every service.
- Address bar focus outline covers the full bubble.
- Uniform background on storage-bag loading page.
- Tabs defer view attach until first paint to show loading on Linux.

### Security

- `shell.openExternal` allowlisted to `github.com` and `resistance.dog`.
- Encrypted wallet key file written with `0o600`.
- `app-settings.json` written with `0o600` to protect user-supplied RPC URLs.
- 402 payment retry aborts on cross-origin redirect.
- 402 requests with `maxTimeoutSeconds` below 5 seconds rejected.

## [1.6.2] - 2026-04-21

### Added

- HTTP 402 payments on `fetch` and `XHR` requests.
- Payment approval popup and address bar pill notification styles.

### Changed

- Bundled proxy updated to v1.9.5 (multi-chain resolver).
- Zustand store selectors refactored, dead IPC channels and build scripts removed.

### Fixed

- x402 payments on fresh (undeployed) W5 wallets.
- Wallet seqno synchronizes to on-chain value after a failed broadcast.
- Address bar menu strings localized across all 8 locales.

### Security

- Hardened 402 flow: XHR request deduplication, token reference counting, request body cloning, popup rate limiting.

## [1.6.1] - 2026-04-15

### Changed

- Bundled proxy updated to v1.9.4 with multi-chain resolver support.

## [1.6.0] - 2026-04-13

### Added

- Embedded wallet: auto-lock with configurable timeout, import, delete, and mnemonic backup.
- Bridge permission system for `tonsite://` dApps, with per-domain and per-scope decisions.
- Native ADNL tunnel for multi-hop anonymous routing.
- DHT discovery of tunnel relay nodes at startup.
- Local WebSocket bridge replacing centralized TON APIs.
- File browser for TON Storage bags.
- Overlay system (glass blur `WebContentsView` pool) for menus, permissions, and forms.
- Manual update checker (`node:https` fetch of `tonnet.resistance.dog/updates.json`, opens the download page via `shell.openExternal`).
- Configurable tunnel mode for anonymous routing.
- Seeding toggle and bandwidth limits for TON Storage.
- Redesigned error page with Lottie animation.
- Winget manifest and auto-publish workflow.
- Wallet resolves `.ton` domains and subdomains for transfers.

### Changed

- Dependency injection architecture via `ServiceRegistry`.
- Bundled proxy v1.9.3, bridge v0.2.0, storage v1.4.1, compiled from source in CI.
- `userData` path migrated to a canonical directory.
- `electron-updater` replaced by the manual `node:https` checker.
- Overlay assets packaged in the ASAR archive and loaded via the `app://` custom protocol.
- Atomic file writes for settings and sensitive data via `writeJsonAtomic` helpers.
- Electron-log output redirected to the canonical `userData` path.
- Legacy network settings fields migrated to `tunnelMode`.
- Upstream Go binaries pinned to tested versions.
- React upgraded to 19.2.5, `lucide-react` upgraded to 1.7.0.

### Fixed

- Payment flow TOCTOU via reserve/confirm/rollback pattern.
- Startup sequence, bridge deferred start, parallel storage init, process cleanup.
- Screen dimensions letterboxed dynamically to prevent fingerprinting drift.
- Raw seed file backed up before encrypted migration.
- Wallet send validates recipient address and checks balance.
- Storage download path clickable (#48).
- Invalid `BridgeTransaction.now` fallback removed.

### Security

- Hardened anti-fingerprinting, WebSocket blocking, bridge isolation.
- SSRF bypass closed, storage authentication enforced, CSP scoped to web responses, session cleanup.
- Config file permissions tightened, payment flush on exit.
- `happy-dom` bumped to fix CVE-2026-33943.
- `vite` and `yaml` bumped to resolve audit vulnerabilities.
- Symlink resolution before `bagfile://` path validation.

## [1.5.3] - 2026-03-25

### Fixed

- NSIS `.exe_` renaming on Windows installer.

## [1.5.2] - 2026-03-25

### Fixed

- Proxy startup parsing updated for v0.6.0 output format.

## [1.5.1] - 2026-03-25

### Fixed

- Updater double-registration on macOS.
- Binary download failure on Windows.

## [1.5.0] - 2026-03-24

### Added

- Embedded TON wallet.
- DNS resolution for `.ton` domains.
- UI improvements across browser chrome.

### Changed

- Release artifact filenames stabilized (version-less) for predictable download URLs.

### Security

- `flatted` bumped to resolve a prototype pollution vulnerability.

## [1.4.2] - 2026-03-16

### Added

- CI pipeline hardened with coverage thresholds and dependency review.
- React Compiler enabled, dynamic Lottie imports, prefetch of lazy pages on proxy connect.
- Renderer test suite.

### Changed

- Upgraded to Electron 41, Node 22, ESLint 9, Tailwind 4.
- `BrowserView` migrated to `WebContentsView`.
- Anti-fingerprinting script extracted, IPC handlers split.
- User-Agent aligned with Chrome/146.

### Fixed

- Static imports restored for `StartPage` and `LandingPage` to eliminate `ton://start` delay and black screen on first load.
- `history-reset` bug.
- Hardcoded UI strings translated across 6 components.
- Native `confirm()` replaced in `HistoryPage`, `ErrorBoundary` localized.
- `BookmarksBar` modal localized.

### Security

- WebRTC STUN IP leak closed.
- DNS leak, device permissions, `navigator.connection` exposure hardened.
- 8 findings from deep security scan resolved.
- `flatted` and `tar` high-severity vulnerabilities patched.

## [1.4.1] - 2026-03-01

### Fixed

- Custom `app://` protocol replaces `file://` in packaged builds.

## [1.4.0] - 2026-03-01

### Added

- Manual update checker.
- CI pipeline for push/PR validation and cross-platform builds.

### Changed

- Audit findings applied: DRY, type safety, renderer performance.
- Download links redirected to `tonnet.resistance.dog/download`.

### Fixed

- Auto-connect loading animation and proxy status restored.

## [1.3.0] - 2026-02-09

### Added

- Vertical tab mode with resizable sidebar and configurable orientation.
- Adaptive sidebar tabs with optimized resize handling.

### Changed

- Type safety strengthened across the preload boundary.
- Context menu, content filter, IPC channels, and bookmarks deduplicated.
- React re-renders, window bounds debouncing, `TabBar` optimized.

### Fixed

- `HistoryPage` and `StoragePage` localized, `StatusBar` locale restored, modal focus trap repaired.
- Invalid JSON repaired in 9 locale files.
- Window controls positioned at top-right in vertical tab mode.

### Security

- Input validation hardened for proxy, history, and bookmarks.
- `shell.openExternal` validated, error page XSS closed, `permissionCheckHandler` added.

## [1.1.0] - 2026-01-23

### Added

- Multilingual support (English, Russian) with modular locale files.
- Content filtering with settings UI (ads, trackers, miners, malware).
- Drag and drop for tabs and bookmarks.
- Bookmark folders with context menu, bookmark favicons, tab favicons.
- Encrypted browsing history with autocomplete.
- Privacy settings panel with toggles for protection features.
- First-Party Isolation, Cookie Auto-Delete, Letterboxing.
- Anti-fingerprinting, font fingerprinting protection, cache control, window security hardening.

### Changed

- Settings modularized, main-process logging centralized.
- Renderer performance and error handling optimized.

### Fixed

- `BrowserView` memory leak (listener accumulation via `setBrowserView`).
- `EventEmitter` max listeners raised to 50.
- Letterboxing visual artifacts and viewport resizing.
- Page load failure handling.

## [1.0.1] - 2026-01-09

### Fixed

- DevTools, cache headers, and URL scheme handling.
- Download links aligned with v1.0.0 filenames.
- macOS volume name in installer one-liner.

### Security

- Proxy binds `127.0.0.1` instead of `0.0.0.0`.

## [1.0.0] - 2025-12-31

### Added

- Initial public release.
- Anonymous mode with ADNL circuit rotation and garlic routing.
- Theming system (Resistance Dog, Utya Duck).
- `.t.me` domain badge support.
- Liquid glass UI with interactive garlic routing visualization.
- Default bookmarks set.
- Platform binaries for Linux, macOS, Windows.

### Fixed

- macOS crashes and copy/paste support.
- Preload script path for ES module builds.
- Utya Duck theme persistence and colors.

[Unreleased]: https://github.com/TONresistor/Tonnet-Browser/compare/v2.6.0...HEAD
[2.6.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v2.3.1...v2.4.0
[2.2.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.6.2...v2.0.0
[1.6.2]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/TONresistor/Tonnet-Browser/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/TONresistor/Tonnet-Browser/releases/tag/v1.0.0
