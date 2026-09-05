# Code architecture

```text
src/
|-- main/                         Electron process
|   |-- index.ts                  Starts and stops the application
|   |-- services.ts               Creates and injects services
|   |-- ipc/                      Validates IPC calls and invokes services
|   |-- ports/                    Interfaces used by services
|   |-- adapters/                 Electron implementations of ports
|   |-- persistence/              Versioned JSON repositories
|   |-- native-process/           Starts and stops native binaries
|   |-- ton-bridge/               Bridge transport and RPC capabilities
|   |-- proxy/                    Proxy and Bridge processes
|   |-- storage/                  TON Storage daemon and HTTP client
|   |-- windows/                  Windows, tabs, sessions, and WebContents
|   |-- wallet/                   Wallet state, signing, and transfers
|   |-- cocoon/                   Cocoon setup and lifecycle
|   |-- messenger/                Standalone Messenger client supervision and JSON-RPC
|   |-- tonconnect/               TON Connect sessions and approvals
|   |-- indexer/                  TON HTTP indexer client
|   `-- settings/                 Settings storage and updates
|-- preload/
|   `-- index.ts                  Exposes the typed IPC API
|-- renderer/src/                 React application
|   |-- app-shell/                Bootstrap and internal routes
|   |-- features/<feature>/       UI, IPC client, and local state
|   |-- components/               Shared browser components
|   |-- stores/                   State shared across features
|   `-- locales/                  Translations
`-- shared/
    |-- ipc-contract/             IPC channels and payload schemas
    |-- defaults.ts               Default settings
    |-- schemas.ts                Shared Zod schemas
    `-- types.ts                  Shared TypeScript types
```

## Boundaries

- `shared` cannot import `main`, `preload`, or `renderer`.
- `main`, `preload`, and `renderer` cannot import one another.
- Renderer components call the client in their feature folder.
- Backend modules receive dependencies from `services.ts` through `ports/`.

These rules are checked by `npm run architecture` using `architecture.config.json`.
