# Experimental features

Experimental controls are exposed under **Settings > Advanced > Experimental**.
Messenger can be opened directly; its autostart preference controls startup only.

| Feature           | Setting                          | Purpose                                               | Main dependency                   |
| ----------------- | -------------------------------- | ----------------------------------------------------- | --------------------------------- |
| Messenger         | `messenger.autostart`            | Start the standalone client when Browser starts       | Messenger 0.4 client and room node |
| Unicode domains   | `advanced.displayUnicodeDomains` | Display decoded internationalized TON domains         | `punycode`                        |
| TON Connect       | `advanced.tonConnectEnabled`     | Advertise the embedded wallet to compatible TON Sites | Embedded wallet                   |
| HTTP 402 payments | `wallet.paymentMode`             | Approve or automate payment requests from TON Sites   | Embedded wallet + Tonutils Bridge |

Defaults live in `src/shared/defaults.ts`. The controls live in `AdvancedSection.tsx`; feature-specific settings stay in their owning module.

Messenger uses authenticated TON QUIC for room traffic and classic ADNL for DHT
discovery. It operates independently of the proxy and Bridge: their disconnect
and tunnel settings do not route or stop Messenger traffic. Opening Messenger
starts the client even when autostart is disabled.

Existing `messenger/` identity and verified room data are preserved on upgrade.
Legacy `tonnet:*` rooms and wallet-linked identities are not migrated into the
0.4 protocol. Direct messages require both identities online; there is no
offline mailbox. Legacy local files are retained without being used by the
new client.

Closing the Messenger view only deactivates its selection: joined rooms and
verified history remain in `messenger/`. Leaving or removing a room explicitly
invokes the client's leave operation and deletes that room's cached membership.
Compatible favorites are copied from `groupchat.rooms` to `messenger.rooms.v1`;
the legacy key is not overwritten.

Direct-message reception belongs to the Browser session, including when another
tab is active or the Messenger view has not been opened. Conversations remain in
renderer memory across navigation and helper reconnects. They are cleared when
the client identity changes or the renderer restarts; no DM archive is written
to disk. Listening for messages does not start a disabled client.

The Browser validates the private stdio protocol and bounds each UTF-8 frame to
64 KiB. Room operations carry an explicit canonical room key; stale joins and
history refreshes cannot replace another selected room. The adapter converts
Unix seconds to renderer milliseconds and preserves direct-message direction,
deduplicating send replies and notifications. Unexpected helper exits trigger
up to three restart attempts while a room is active or autostart is enabled.
