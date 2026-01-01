<h1 align="center">Tonnet Browser</h1>

<p align="center">
  <strong>The TON Network Browser</strong>
</p>

<p align="center">
  <a href="#about">About</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#faq">FAQ</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#contact">Contact</a>
</p>

<p align="center">
  <a href="https://tonnet.resistance.dog"><img src="https://img.shields.io/badge/website-tonnet.resistance.dog-blue" alt="Website"></a>
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey" alt="Platform">
</p>

<h3 align="center">Download</h3>

<p align="center">
  <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.Setup.1.0.0.exe">
    <img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  </a>
  &nbsp;
  <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0-universal.dmg">
    <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS">
  </a>
  &nbsp;
  <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0.AppImage">
    <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux">
  </a>
</p>

<p align="center">
  <sub>
    <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/ton-browser_1.0.0_amd64.deb">Linux .deb</a> ·
    <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.1.0.0.exe">Windows Portable</a> ·
    <a href="https://github.com/TONresistor/Tonnet-Browser/releases">All releases</a>
  </sub>
</p>

---

<table>
  <tr>
    <td align="center"><img src="assets/screenshot1.jpg" width="400"><br><em>Home</em></td>
    <td align="center"><img src="assets/screenshot2.jpg" width="400"><br><em>Start Page</em></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshot3.jpg" width="400"><br><em>Storage</em></td>
    <td align="center"><img src="assets/screenshot4.jpg" width="400"><br><em>Settings</em></td>
  </tr>
</table>

## About

Tonnet Browser is the first native cross-platform desktop browser for the TON Network with built-in anonymous garlic routing. It connects to `.ton` sites through the decentralized TON DNS and RLDP protocol - no centralized gateways, no third-party proxies.

It also includes a built-in TON Storage client for downloading and seeding bags on TON's decentralized storage network.

### Why TON?

TON combines the anonymity concepts of Tor, the P2P file sharing of BitTorrent, and adds a blockchain layer for decentralized DNS and payments - all in one protocol stack.

## Features

- Native `.ton`, `.adnl` and `.t.me` domain browsing
- Anonymous mode: 3-hop garlic circuit with rotation
- Decentralized DNS resolution via TON blockchain
- Built-in TON Storage client (download, seed, pause)
- Standard browser features
- Privacy focused & Security hardened
- Cross-platform: Linux, Windows, macOS

## Installation

| Platform | Download |
|----------|----------|
| **Windows** | [Installer](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.Setup.1.0.0.exe) · [Portable](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.1.0.0.exe) |
| **macOS** | [DMG (Universal)](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0-universal.dmg) |
| **Linux** | [AppImage](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0.AppImage) · [.deb](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/ton-browser_1.0.0_amd64.deb) |

### Windows

Your browser may warn that the file is from an unknown source. Click **"Keep"** to download.

1. Download and run **TON.Browser.Setup.1.0.0.exe**
2. Follow the installation prompts
3. Launch **TON Browser** from the Start menu

**One-line install:** Open PowerShell and run:

```powershell
irm https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.Setup.1.0.0.exe -OutFile TonBrowser.exe; Unblock-File TonBrowser.exe; .\TonBrowser.exe
```

### macOS

Open the `.dmg` and drag TON Browser to Applications.

```bash
# If blocked by Gatekeeper
xattr -cr /Applications/TON\ Browser.app
```

**One-line install:** Open Terminal and run:

```bash
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0-universal.dmg && hdiutil attach TON.Browser-1.0.0-universal.dmg && cp -R "/Volumes/TON Browser/TON Browser.app" /Applications/ && hdiutil detach "/Volumes/TON Browser" && xattr -cr /Applications/TON\ Browser.app && open /Applications/TON\ Browser.app
```

### Linux

```bash
# AppImage
chmod +x TON.Browser-1.0.0.AppImage
./TON.Browser-1.0.0.AppImage

# Debian/Ubuntu
sudo dpkg -i ton-browser_1.0.0_amd64.deb
```

**One-line install:** Open Terminal and run:

```bash
# AppImage
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0.AppImage && chmod +x TON.Browser-1.0.0.AppImage && ./TON.Browser-1.0.0.AppImage

# Debian/Ubuntu
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/ton-browser_1.0.0_amd64.deb && sudo dpkg -i ton-browser_1.0.0_amd64.deb
```

## Usage

1. Launch TON Browser
2. Click **"Connect to TON Network"**
3. Wait for sync to complete (status bar shows "Connected to TON Network")
4. Enter a `.ton` address in the URL bar (e.g., `foundation.ton`)
5. Browse the decentralized web

### TON Storage

1. Navigate to `ton://storage` or click the Storage icon
2. Click **"Add Bag"**
3. Paste a 64-character hex bag ID
4. Monitor download progress in real-time

## Settings

Access settings via the gear icon or navigate to `ton://settings`.

| Category | Settings |
|----------|----------|
| **General** | Homepage, Restore tabs, Anonymous mode, Circuit rotation |
| **Network** | Proxy port, Storage port, Auto-connect, Connection timeout |
| **Storage** | Download path, Update interval, Auto-seed |
| **Appearance** | Zoom levels, Bookmarks bar, Status bar |
| **Privacy** | Clear browsing data, Clear on exit |
| **Advanced** | Verbosity levels, Sync test domain |

## FAQ

<details>
<summary><strong>What is garlic routing?</strong></summary>

Garlic routing encrypts your traffic in multiple layers and routes it through 3 independent relays. Each relay only knows its immediate neighbors, never the full path or your identity.
</details>

<details>
<summary><strong>How is it different from Tor?</strong></summary>

Both use multi-hop encrypted circuits. Tonnet operates on the TON Network with native support for .ton domains, decentralized DNS, and built-in file storage. Tor operates on the traditional internet.
</details>

<details>
<summary><strong>What .ton sites can I visit?</strong></summary>

Try `foundation.ton`, `ton.ton`, or `dns.ton`. More sites are listed on [ton.app](https://ton.app).
</details>

<details>
<summary><strong>Is my traffic anonymous by default?</strong></summary>

No. By default, Tonnet connects directly for faster browsing. Enable Anonymous Mode in General settings to route traffic through the garlic circuit.
</details>

## Building

### Prerequisites

- Node.js 18+
- npm 9+

### Development

```bash
git clone https://github.com/TONresistor/Tonnet-Browser.git
cd Tonnet-Browser
npm install
npm run dev
```

### Production Build

```bash
# Linux
npm run build:linux

# Windows
npm run build:win

# macOS
npm run build:mac
```

Builds are output to the `release/` directory.

### Tests

```bash
npm test
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron 39 |
| Frontend | React 19, TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| TON Proxy | [tonutils-proxy](https://github.com/xssnick/tonutils-proxy) |
| TON Storage | [tonutils-storage](https://github.com/xssnick/tonutils-storage) |
| Transport | RLDP over ADNL over UDP |

## Roadmap

### Phase 1: Core (Current)

- [x] Cross-platform Electron app
- [x] Direct P2P browsing (.ton, .adnl)
- [x] TON DNS resolution
- [x] TON Storage client (download, seed, pause)
- [x] Multi-tab browser with bookmarks
- [x] Real-time status indicators

### Phase 2: Enhanced Privacy

- [x] Garlic routing (multi-hop circuits)
- [x] Circuit rotation
- [ ] Relay node mode
- [ ] TON payments for relays

## Contributing

Contributions are welcome! Here's how to get started:

1. **Open an issue first** — Discuss your idea before writing code
2. **Fork the repository** — Create your own copy
3. **Create a feature branch** — `git checkout -b feature/your-feature`
4. **Make your changes** — Follow existing code style
5. **Submit a pull request** — Reference the related issue

Looking for something to work on? Check issues labeled [`good first issue`](https://github.com/TONresistor/Tonnet-Browser/labels/good%20first%20issue).

## Contact

- **Website** — [tonnet.resistance.dog](https://tonnet.resistance.dog)
- **Telegram** — [@zkproof](https://t.me/zkproof)
- **Issues** — [Report bugs or request features](https://github.com/TONresistor/Tonnet-Browser/issues)

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Tor Project](https://www.torproject.org/) - Inspiration for anonymous browsing
- [BitTorrent](https://www.bittorrent.org/) - Inspiration for P2P file sharing
- [tonutils-go](https://github.com/xssnick/tonutils-go) - TON protocol implementation
- [tonutils-proxy](https://github.com/xssnick/tonutils-proxy) - HTTP proxy for TON sites
- [tonutils-storage](https://github.com/xssnick/tonutils-storage) - TON Storage daemon
