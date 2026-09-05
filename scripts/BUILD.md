# Building Tonnet Browser Binaries

This document describes how to build the platform binaries used by Tonnet Browser.

## Overview

Tonnet Browser requires six binary components:

1. **tonutils-proxy** - HTTP proxy for TON sites (from TONresistor/Tonutils-Proxy)
2. **tonutils-storage** - TON storage daemon (from xssnick/tonutils-storage)
3. **tonutils-bridge** - standalone WebSocket-ADNL bridge (from TONresistor/tonutils-bridge)
4. **gocoon** - Cocoon CLI used for wallet/channel operations (from TONresistor/gocoon)
5. **cocoon-runner** - Cocoon local runner used by the browser runtime (from TONresistor/gocoon)
6. **tonnet-messenger** - standalone Messenger leaf client (from TONresistor/tonnet-messenger)

## Supported Platforms

| Platform | Architecture | Notes |
|----------|--------------|-------|
| macOS    | Universal (x86_64 + arm64) | Runs natively on Intel and Apple Silicon |
| Linux    | x86_64 + ARM64 | 64-bit Linux |
| Windows  | x86_64 | 64-bit Windows |

## Quick Start

### Automated Build (all platforms)

Use the unified build script, which fetches each pinned Go commit and builds for the target platform:

```bash
# From the project root. Auto-detects OS if no argument is given.
./scripts/build-binaries-from-source.sh              # current platform
./scripts/build-binaries-from-source.sh linux        # target linux x86_64
./scripts/build-binaries-from-source.sh linux arm64  # target linux ARM64
./scripts/build-binaries-from-source.sh mac          # target mac (universal)
./scripts/build-binaries-from-source.sh win          # target win
```

### GitHub Actions

The project includes a GitHub Actions workflow that automatically builds binaries for all platforms:

- **Trigger**: Push a tag starting with `v` (e.g., `v1.0.0`)
- **Workflow file**: `.github/workflows/build.yml`
- **Output**: Artifacts uploaded to the release

## Manual Build Instructions

### Prerequisites

- Go 1.26 or later
- Git
- For macOS universal binaries: Xcode Command Line Tools (provides `lipo`)

### macOS Universal Binaries

Universal binaries combine x86_64 (Intel) and arm64 (Apple Silicon) architectures into a single executable.

```bash
# Build for both architectures
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o binary-amd64 .
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o binary-arm64 .

# Combine into universal binary
lipo -create -output binary-universal binary-amd64 binary-arm64

# Verify the universal binary
lipo -info binary-universal
file binary-universal
```

### Linux x86_64

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o binary-linux .
```

### Linux ARM64

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o binary-linux-arm64 .
```

### Windows x86_64

```bash
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o binary.exe .
```

## Build Flags Explained

| Flag | Purpose |
|------|---------|
| `CGO_ENABLED=0` | Disable CGO for static linking |
| `-ldflags="-s -w"` | Strip debug symbols to reduce binary size |
| `GOOS` | Target operating system |
| `GOARCH` | Target CPU architecture |

## Directory Structure

After building, binaries should be placed in:

```
resources/
  bin/
    mac/
      tonutils-proxy        # Universal binary
      tonutils-storage      # Universal binary
      tonutils-bridge       # Universal binary
      gocoon                # Universal binary
      cocoon-runner         # Universal binary
      tonnet-messenger      # Universal binary
    linux/
      tonutils-proxy
      tonutils-storage
      tonutils-bridge
      gocoon
      cocoon-runner
      tonnet-messenger
    win/
      tonutils-proxy.exe
      tonutils-storage.exe
      tonutils-bridge.exe
      gocoon.exe
      cocoon-runner.exe
      tonnet-messenger.exe
```

## Building Individual Components

### tonutils-proxy

Preferred: use the unified build script (see Automated Build above).

Or manually:
```bash
git clone https://github.com/TONresistor/Tonutils-Proxy.git ../Tonutils-Proxy
cd ../Tonutils-Proxy
go build -ldflags="-s -w -X main.GitCommit=$(git describe --tags --always)" -o tonutils-proxy ./cmd/proxy-cli
```

### tonutils-storage

```bash
git clone https://github.com/xssnick/tonutils-storage.git
cd tonutils-storage
go build -ldflags="-s -w" -o tonutils-storage ./cmd/tonutils-storage
```

### tonutils-bridge

Standalone WebSocket-ADNL bridge, separated from tonutils-proxy. Exposes a local WebSocket endpoint that the browser uses to communicate with the ADNL network directly.

Preferred: use the unified build script (see Automated Build above).

Or manually:
```bash
git clone https://github.com/TONresistor/tonutils-bridge.git ../tonutils-bridge
cd ../tonutils-bridge
go build -ldflags="-s -w -X main.GitCommit=$(git describe --tags --always)" -o tonutils-bridge .
```

### gocoon and cocoon-runner

Preferred: use the unified build script (see Automated Build above).

Or manually:
```bash
git clone https://github.com/TONresistor/gocoon.git ../gocoon
cd ../gocoon
go build -ldflags="-s -w -X 'github.com/TONresistor/gocoon/pkg/cocoon.Version=$(git describe --tags --always)'" -o gocoon ./cmd/gocoon
go build -ldflags="-s -w -X 'github.com/TONresistor/gocoon/pkg/cocoon.Version=$(git describe --tags --always)'" -o cocoon-runner ./cmd/cocoon-runner
```

## Verifying Universal Binaries

On macOS, verify that a binary is truly universal:

```bash
# Check architectures
lipo -info resources/bin/mac/tonutils-proxy
# Output: Architectures in the fat file: resources/bin/mac/tonutils-proxy are: x86_64 arm64

# Detailed info
file resources/bin/mac/tonutils-proxy
# Output: resources/bin/mac/tonutils-proxy: Mach-O universal binary with 2 architectures:
#         [x86_64:Mach-O 64-bit executable x86_64] [arm64:Mach-O 64-bit executable arm64]
```

## Troubleshooting

### "lipo: command not found"

Install Xcode Command Line Tools:
```bash
xcode-select --install
```

### Go module issues

If you encounter Go module issues:
```bash
go mod download
go mod tidy
```

### Binary not executable

Make sure to set executable permissions:
```bash
chmod +x resources/bin/mac/*
chmod +x resources/bin/linux/*
```

## Continuous Integration

The GitHub Actions workflow (`.github/workflows/build.yml`) handles:

1. Building on the appropriate runner for each platform
2. Creating macOS universal binaries using `lipo`
3. Uploading binaries as artifacts
4. Creating releases with all binaries attached

To publish, create an annotated `v*` tag on `main` and push it. A manual workflow run builds packages without creating a GitHub release.
