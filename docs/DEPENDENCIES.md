# Dependencies

## Native runtime

Exact immutable commits and build entrypoints live in `scripts/binary-versions.json`.

| Dependency       | Version | Source                        | Purpose                              |
| ---------------- | ------- | ----------------------------- | ------------------------------------ |
| Tonutils Proxy   | v1.10.1 | `TONresistor/Tonutils-Proxy`  | TON Site proxy and ADNL/RLDP routing |
| Tonutils Bridge  | v0.5.1  | `TONresistor/tonutils-bridge` | TON, DHT, ADNL, and Overlay JSON-RPC |
| Tonutils Storage | v1.5.3  | `xssnick/tonutils-storage`    | TON Storage daemon                   |
| GoCoon           | v0.3.0  | `TONresistor/gocoon`          | Cocoon wallet and channel operations |
| Cocoon Runner    | v0.3.0  | `TONresistor/gocoon`          | Local Cocoon runtime                 |
| Messenger        | v0.4.0+dev.b164900 | `TONresistor/tonnet-messenger` | Independent TON QUIC room client |

## Application packages

| Dependency                 | Version | Purpose                                 |
| -------------------------- | ------- | --------------------------------------- |
| `@dnd-kit/core`            | ^6.3.1  | Drag-and-drop primitives                |
| `@dnd-kit/sortable`        | ^10.0.0 | Sortable UI                             |
| `@dnd-kit/utilities`       | ^3.2.2  | Drag-and-drop helpers                   |
| `@fontsource/inter`        | ^5.2.8  | Bundled Inter font                      |
| `@ton/core`                | 0.63.1  | TON cells, addresses, and serialization |
| `@ton/crypto`              | 3.3.0   | Mnemonics and key derivation            |
| `@ton/ton`                 | 16.3.0  | TON wallet contracts                    |
| `class-variance-authority` | ^0.7.1  | Component variants                      |
| `clsx`                     | ^2.1.1  | Conditional CSS classes                 |
| `electron-log`             | ^5.4.3  | Application logging                     |
| `i18next`                  | ^26.0.8 | Internationalization                    |
| `lottie-react`             | ^2.4.1  | Lottie animations                       |
| `lucide-react`             | ^1.8.0  | UI icons                                |
| `punycode`                 | 2.3.1   | Internationalized domains               |
| `qrcode`                   | 1.5.4   | QR code generation                      |
| `react`                    | 19.2.5  | Renderer UI                             |
| `react-dom`                | 19.2.5  | React DOM renderer                      |
| `react-i18next`            | 17.0.4  | React translations                      |
| `react-markdown`           | ^10.1.0 | Markdown rendering                      |
| `remark-gfm`               | ^4.0.1  | GitHub-flavored Markdown                |
| `tailwind-merge`           | ^3.5.0  | Tailwind class merging                  |
| `ws`                       | ^8.20.0 | WebSocket client                        |
| `zod`                      | ^4.3.6  | Runtime schemas and IPC validation      |
| `zustand`                  | ^5.0.12 | Renderer state management               |

## Development and packaging

| Dependency                    | Version   | Purpose                           |
| ----------------------------- | --------- | --------------------------------- |
| `@electron-toolkit/utils`     | ^4.0.0    | Electron helpers                  |
| `@electron/fuses`             | ^1.8.0    | Packaged Electron hardening       |
| `@eslint/js`                  | ^9.39.4   | Base lint rules                   |
| `@tailwindcss/vite`           | ^4.2.4    | Tailwind Vite integration         |
| `@types/node`                 | ^22.19.19 | Node.js types                     |
| `@types/qrcode`               | 1.5.6     | QR code types                     |
| `@types/react`                | ^19.0.1   | React types                       |
| `@types/react-dom`            | ^19.0.2   | React DOM types                   |
| `@types/ws`                   | ^8.18.1   | WebSocket types                   |
| `@vitejs/plugin-react`        | ^4.3.4    | React Vite integration            |
| `@vitest/coverage-v8`         | ^4.1.5    | Test coverage                     |
| `babel-plugin-react-compiler` | ^1.0.0    | React compiler                    |
| `electron`                    | ^41.3.0   | Desktop runtime                   |
| `electron-builder`            | ^26.0.12  | Platform packaging                |
| `electron-vite`               | ^5.0.0    | Electron development and build    |
| `eslint`                      | ^9.39.4   | Linting                           |
| `eslint-config-prettier`      | ^10.1.5   | ESLint and Prettier compatibility |
| `eslint-plugin-react`         | ^7.37.5   | React lint rules                  |
| `eslint-plugin-react-hooks`   | ^5.2.0    | React Hooks lint rules            |
| `globals`                     | ^17.5.0   | Lint environment globals          |
| `happy-dom`                   | ^20.9.0   | Test DOM environment              |
| `husky`                       | ^9.1.7    | Git hooks                         |
| `lint-staged`                 | ^16.4.0   | Staged-file checks                |
| `prettier`                    | ^3.8.3    | Formatting                        |
| `tailwindcss`                 | ^4.2.4    | Styling                           |
| `typescript`                  | ^5.7.2    | Type checking                     |
| `typescript-eslint`           | ^8.59.0   | TypeScript linting                |
| `vite`                        | ^7.3.0    | Bundling                          |
| `vitest`                      | ^4.0.16   | Tests                             |
