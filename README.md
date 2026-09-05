<h1 align="center">Tonnet Browser</h1>
<p align="center">
  <strong>Browse the TON Network, privately.</strong>
</p>
<p align="center">
  <a href="https://tonnet.resistance.dog/download/">
    <img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  </a>
  &nbsp;
  <a href="https://tonnet.resistance.dog/download/">
    <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS">
  </a>
  &nbsp;
  <a href="https://tonnet.resistance.dog/download/">
    <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=white" alt="Linux">
  </a>
  &nbsp;
  <img src="https://img.shields.io/badge/TON-Blockchain-0088CC?style=for-the-badge&logo=telegram&logoColor=white" alt="TON Blockchain">
  &nbsp;
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License">
</p>

---

<p align="center">
  <img src="assets/2-6-0.jpg" width="800">
</p>

> [!CAUTION]
> **No external security audit.** This browser and its embedded wallet have not undergone a third-party audit. The code is open-source and subject to internal reviews, but has not been independently verified. Use at your own risk;

## About

Tonnet Browser is a native desktop browser for the TON Network. It resolves `.ton`, `.t.me`, `.adnl`, `.eth` (ENS), and `.sol` (SNS) through decentralized DNS and delivers content over RLDP directly from the network.

TON Site traffic goes through ADNL, either peer-to-peer or via multi-hop tunnels. A WebSocket bridge provides TON blockchain access. Experimental Messenger uses its own authenticated TON QUIC client and DHT discovery, independently of the proxy and its tunnel settings. Anti-fingerprinting, per-domain isolation and built-in TON Storage are included. No telemetry, no tracking, fully open source.

## Features

<table>
  <tr>
    <td align="center" width="200"><br><b>Browsing</b><br><br><sub>.ton .t.me .adnl<br>TON Storage Bags<br>+ more TLDs</sub><br><br></td>
    <td align="center" width="200"><br><b>Wallet</b><br><br><sub>W5 v5r1, send/receive<br>Experimental HTTP 402</sub><br><br></td>
    <td align="center" width="200"><br><b>Privacy</b><br><br><sub>Garlic routing<br>Anti-fingerprinting<br>Per-domain isolation<br>No telemetry</sub><br><br></td>
    <td align="center" width="200"><br><b>Storage</b><br><br><sub>TON Storage P2P<br>File browser<br>Download & seed</sub><br><br></td>
  </tr>
  <tr>
    <td align="center" width="200"><br><b>Bridge</b><br><br><sub>WebSocket JSON-RPC<br>Direct to TON<br>No centralized API dependency</sub><br><br></td>
    <td align="center" width="200"><br><b>Security</b><br><br><sub>Process sandboxing<br>SSRF protection<br>IPC hardening<br>Encrypted history</sub><br><br></td>
    <td align="center" width="200"><br><b>Messenger</b><br><br><sub>Persistent public rooms<br>TON QUIC and DHT<br>Independent client</sub><br><br></td>
    <td align="center" width="200"><br><b>Fingerprint</b><br><br><sub>Canvas, WebGL, Audio<br>WebRTC leak blocking<br>Generic User-Agent</sub><br><br></td>
  </tr>
</table>

## Installation

| ![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white) | ![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white) | ![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=white) |
|:---:|:---:|:---:|
| [Installer](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-Setup-2.6.0.exe) | [DMG (Universal)](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-2.6.0-universal.dmg) | [AppImage x64](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-2.6.0-x86_64.AppImage) · [.deb x64](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-2.6.0-amd64.deb) |

### Windows

Your browser may warn that the file is from an unknown source. Click **"Keep"** to download.

1. Download and run **TON-Browser-Setup-2.6.0.exe**
2. Follow the installation prompts
3. Launch **TON Browser** from the Start menu

**One-line install:** Open PowerShell and run:

```powershell
irm https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-Setup-2.6.0.exe -OutFile TonBrowser.exe; Unblock-File TonBrowser.exe; .\TonBrowser.exe
```

### macOS

Open the `.dmg` and drag TON Browser to Applications.

The app is ad-hoc signed (no paid Apple Developer ID), so Gatekeeper does not
trust it yet. Clear the quarantine flag once:

```bash
xattr -cr /Applications/TON\ Browser.app
```

**One-line install:** Open Terminal and run:

```bash
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-2.6.0-universal.dmg && hdiutil attach TON-Browser-2.6.0-universal.dmg && cp -R "/Volumes/TON Browser 2.6.0-universal/TON Browser.app" /Applications/ && hdiutil detach "/Volumes/TON Browser 2.6.0-universal" && xattr -cr /Applications/TON\ Browser.app && open /Applications/TON\ Browser.app
```

> **Still crashes on launch (Apple Silicon)?** Older builds (≤ 2.2.0) shipped
> unsigned and crash immediately on M1/M2/M3. Re-sign once, then reopen:
>
> ```bash
> codesign --force --deep --sign - /Applications/TON\ Browser.app
> ```

### Linux

```bash
# AppImage
chmod +x TON-Browser-2.6.0-x86_64.AppImage
./TON-Browser-2.6.0-x86_64.AppImage

# Debian/Ubuntu
sudo dpkg -i TON-Browser-2.6.0-amd64.deb
```

**One-line install:** Open Terminal and run:

```bash
# AppImage
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-2.6.0-x86_64.AppImage && chmod +x TON-Browser-2.6.0-x86_64.AppImage && ./TON-Browser-2.6.0-x86_64.AppImage

# Debian/Ubuntu
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON-Browser-2.6.0-amd64.deb && sudo dpkg -i TON-Browser-2.6.0-amd64.deb
```

ARM64 Linux builds are also published as `TON-Browser-2.6.0-arm64.AppImage` and `TON-Browser-2.6.0-arm64.deb`.

## Building

### Prerequisites

- Node.js 22+
- npm 9+
- The Go version declared in [`scripts/binary-versions.json`](scripts/binary-versions.json) (currently 1.26)

### Development

```bash
git clone https://github.com/TONresistor/Tonnet-Browser.git
cd Tonnet-Browser
npm install
bash scripts/build-binaries-from-source.sh
npm run dev
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Experimental features](docs/EXPERIMENTAL.md)
- [Dependencies](docs/DEPENDENCIES.md)

## Tech Stack

| Component   | Technology                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Framework   | Electron 41                                                                                         |
| Frontend    | React 19, TypeScript                                                                                |
| Styling     | Tailwind CSS v4                                                                                     |
| State       | Zustand                                                                                             |
| TON Proxy   | [Tonutils-Proxy](https://github.com/TONresistor/Tonutils-Proxy) - HTTP proxy, decentralized gateway |
| WS Bridge   | [tonutils-bridge](https://github.com/TONresistor/tonutils-bridge) - JSON-RPC 2.0 over WebSocket     |
| TON Storage | [tonutils-storage](https://github.com/xssnick/tonutils-storage) - P2P file storage daemon           |
| Anonymity   | [adnl-tunnel](https://github.com/ton-blockchain/adnl-tunnel) - garlic routing, DHT relay discovery  |
| Transport   | RLDP over ADNL over UDP                                                                             |

## Socials

- **Website**: [tonnet.resistance.dog](https://tonnet.resistance.dog)
- **Community**: [@ResistanceForum](https://t.me/ResistanceForum)
- **Channel**: [@ResistanceTools](https://t.me/ResistanceTools)

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Tor Project](https://www.torproject.org/) - Inspiration for anonymous browsing
- [BitTorrent](https://www.bittorrent.org/) - Inspiration for P2P file sharing
- [tonutils-go](https://github.com/xssnick/tonutils-go) - TON protocol implementation
- [Tonutils-Proxy](https://github.com/TONresistor/Tonutils-Proxy) - HTTP proxy for decentralized .ton site access
- [tonutils-bridge](https://github.com/TONresistor/tonutils-bridge) - WebSocket-ADNL bridge for wallet and blockchain queries
- [adnl-tunnel](https://github.com/ton-blockchain/adnl-tunnel) - Garlic routing relay for anonymous browsing
- [tonutils-storage](https://github.com/xssnick/tonutils-storage) - TON Storage daemon
