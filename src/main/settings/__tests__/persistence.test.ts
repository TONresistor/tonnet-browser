/**
 * Settings Persistence Tests
 * Tests for file I/O, caching, and error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

const atomicFile = vi.hoisted(() => ({
  writeFile: vi.fn(),
  sync: vi.fn(),
  close: vi.fn(),
}))

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/mock/userData'
      return `/mock/${name}`
    }),
  },
}))

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
  promises: {
    mkdir: vi.fn(),
    open: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  },
}))

import { existsSync, readFileSync, promises as fsp } from 'fs'

describe('Settings Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReset()
    vi.mocked(readFileSync).mockReset()
    // clearAllMocks does not undo mockImplementation, so explicitly reset the
    // write mock to a no-op (a prior test sets it to throw to test error paths).
    vi.mocked(fsp.mkdir).mockReset()
    vi.mocked(fsp.open).mockReset()
    vi.mocked(fsp.rename).mockReset()
    vi.mocked(fsp.unlink).mockReset()
    vi.mocked(fsp.mkdir).mockResolvedValue(undefined)
    atomicFile.writeFile.mockReset().mockResolvedValue(undefined)
    atomicFile.sync.mockReset().mockResolvedValue(undefined)
    atomicFile.close.mockReset().mockResolvedValue(undefined)
    vi.mocked(fsp.open).mockResolvedValue(atomicFile as never)
    vi.mocked(fsp.rename).mockResolvedValue(undefined)
    vi.mocked(fsp.unlink).mockResolvedValue(undefined)
    // Reset the internal cache by importing fresh
    vi.resetModules()
  })

  describe('loadSettings()', () => {
    it('returns cached settings on subsequent calls', async () => {
      // Re-import to get fresh module with cleared cache
      vi.resetModules()
      const { loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          general: { homepage: 'ton://cached' },
        })
      )

      const first = freshLoad()
      const second = freshLoad()

      // Should only read file once (cached)
      expect(readFileSync).toHaveBeenCalledTimes(1)
      expect(first).toBe(second) // Same reference
    })

    it('does not expose mutable cached settings', async () => {
      const { loadSettings: freshLoad } = await import('../index')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ network: { proxyPort: 8080 } }))

      const settings = freshLoad()

      expect(Object.isFrozen(settings)).toBe(true)
      expect(Object.isFrozen(settings.network)).toBe(true)
      expect(() => {
        settings.network.proxyPort = 9000
      }).toThrow()
      expect(freshLoad().network.proxyPort).toBe(8080)
    })

    it('creates defaults when file does not exist', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(false)

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
      await vi.waitFor(() => expect(atomicFile.writeFile).toHaveBeenCalled()) // Saves defaults asynchronously
    })

    it('merges partial settings with defaults', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          general: { homepage: 'http://custom.ton' },
          // network is present but sparse — Zod fills in missing fields with defaults
          network: { autoConnect: true },
          // privacy is present but sparse
          privacy: { clearOnExit: false },
        })
      )

      const settings = freshLoad()

      // Custom values preserved
      expect(settings.general.homepage).toBe('http://custom.ton')
      expect(settings.network.autoConnect).toBe(true)
      expect(settings.privacy.clearOnExit).toBe(false)
      // Defaults filled in for fields not specified in each present category
      expect(settings.network.proxyPort).toBe(8080)
      expect(settings.privacy.cookieAutoDelete).toBe(true)
    })

    it('falls back to defaults on JSON parse error', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }}}')

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
    })

    it('falls back to defaults on invalid settings structure', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          network: { proxyPort: 'not-a-number' }, // Invalid type
        })
      )

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.network.proxyPort).toBe(defaults.network.proxyPort)
    })

    it('does not overwrite settings written by a future application version', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')
      const future = JSON.stringify({ schemaVersion: 5, general: { homepage: 'ton://future' } })
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(future)

      const settings = freshLoad()

      expect(settings.general.homepage).toBe(getDefaults().general.homepage)
      expect(atomicFile.writeFile).not.toHaveBeenCalled()
      expect(readFileSync).toHaveReturnedWith(future)
    })

    it('falls back to defaults when file is an array', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('[]')

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
    })

    it('falls back to defaults when file is null', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('null')

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
    })

    it('repairs legacy duplicate ports without resetting unrelated settings', async () => {
      const { loadSettings: freshLoad } = await import('../index')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          general: { homepage: 'ton://custom' },
          network: { proxyPort: 5555 },
          wallet: { indexerEnabled: true },
          bridge: {
            defaultPolicy: 'deny',
            permissions: [{ domain: 'example.ton', scope: 'blockchain', decision: 'granted', grantedAt: 123 }],
          },
        })
      )

      const settings = freshLoad()

      expect(settings.network).toMatchObject({ proxyPort: 5555, storagePort: 8080, wsPort: 8081 })
      expect(settings.general.homepage).toBe('ton://custom')
      expect(settings.wallet.indexerEnabled).toBe(true)
      expect(settings.bridge).toMatchObject({
        defaultPolicy: 'deny',
        permissions: [expect.objectContaining({ domain: 'example.ton', decision: 'granted' })],
      })
      await vi.waitFor(() => expect(atomicFile.writeFile).toHaveBeenCalled())
      const written = JSON.parse(atomicFile.writeFile.mock.calls[0][0] as string)
      expect(written.network).toMatchObject({ proxyPort: 5555, storagePort: 8080, wsPort: 8081 })
      expect(written.bridge.permissions).toHaveLength(1)
    })
  })

  describe('saveSettings()', () => {
    it('creates directory if it does not exist', async () => {
      vi.resetModules()
      const { saveSettings: freshSave, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(false)

      await freshSave(getDefaults())

      expect(fsp.mkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
    })

    it('writes formatted JSON to file', async () => {
      vi.resetModules()
      const { saveSettings: freshSave, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      const defaults = getDefaults()

      await freshSave(defaults)

      // Atomic write: writes to .tmp with 0o600, then renames
      expect(fsp.open).toHaveBeenCalledWith(path.join('/mock/userData', 'app-settings.json.tmp'), 'w', 0o600)
      expect(atomicFile.writeFile).toHaveBeenCalledWith(expect.stringContaining('"homepage"'), 'utf8')
      expect(fsp.rename).toHaveBeenCalledWith(
        path.join('/mock/userData', 'app-settings.json.tmp'),
        path.join('/mock/userData', 'app-settings.json')
      )
      // Check it's formatted (indented)
      const writtenContent = atomicFile.writeFile.mock.calls[0][0] as string
      expect(writtenContent).toContain('\n')
    })

    it('propagates write errors so callers can surface the failure', async () => {
      vi.resetModules()
      const { saveSettings: freshSave, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      atomicFile.writeFile.mockRejectedValueOnce(new Error('Disk full'))

      // saveSettings now rethrows so SETTINGS_SET reports failure honestly.
      await expect(freshSave(getDefaults())).rejects.toThrow('Disk full')
    })
  })

  describe('getSetting()', () => {
    it('returns specific category', async () => {
      vi.resetModules()
      const { getSetting: freshGet } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          network: { proxyPort: 9999 },
        })
      )

      const network = freshGet('network')

      expect(network.proxyPort).toBe(9999)
    })
  })

  describe('setSetting()', () => {
    it('merges partial updates into category', async () => {
      vi.resetModules()
      const { setSetting: freshSet, loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          network: { proxyPort: 8080, autoConnect: false },
        })
      )

      // Load first to populate cache
      freshLoad()

      // Update only proxyPort
      await freshSet('network', { proxyPort: 9000 })

      // Check write was called with merged values (atomic write to .tmp)
      const lastCallIndex = atomicFile.writeFile.mock.calls.length - 1
      const writtenContent = atomicFile.writeFile.mock.calls[lastCallIndex][0] as string
      const parsed = JSON.parse(writtenContent)

      expect(parsed.network.proxyPort).toBe(9000)
      expect(parsed.network.autoConnect).toBe(false) // Preserved
    })

    it('serializes concurrent category updates without losing either mutation', async () => {
      const { setSetting: freshSet, loadSettings: freshLoad } = await import('../index')
      vi.mocked(existsSync).mockReturnValue(false)
      freshLoad()

      await Promise.all([freshSet('network', { proxyPort: 9001 }), freshSet('privacy', { clearOnExit: false })])

      const latest = freshLoad()
      expect(latest.network.proxyPort).toBe(9001)
      expect(latest.privacy.clearOnExit).toBe(false)
      const finalDocument = JSON.parse(atomicFile.writeFile.mock.calls.at(-1)?.[0] as string)
      expect(finalDocument.network.proxyPort).toBe(9001)
      expect(finalDocument.privacy.clearOnExit).toBe(false)
    })

    it('preserves nested wallet limits in memory and on disk', async () => {
      const { setSetting: freshSet, loadSettings: freshLoad } = await import('../index')
      vi.mocked(existsSync).mockReturnValue(false)
      freshLoad()

      await freshSet('wallet', { limits: { perRequest: '42' } })

      expect(freshLoad().wallet.limits).toEqual({ perRequest: '42', perDay: '0', perSitePerMonth: '0' })
      const finalDocument = JSON.parse(atomicFile.writeFile.mock.calls.at(-1)?.[0] as string)
      expect(finalDocument.wallet.limits).toEqual({ perRequest: '42', perDay: '0', perSitePerMonth: '0' })
    })
  })

  describe('transactSettings()', () => {
    it('rejects explicit undefined patch values', async () => {
      const { getDefaultSettings, mergeSettingsPatch } = await import('../index')
      const settings = getDefaultSettings()

      expect(() => mergeSettingsPatch(settings, { network: undefined } as never)).toThrow(
        'Settings patch values must be defined'
      )
      expect(() => mergeSettingsPatch(settings, { network: { proxyPort: undefined } } as never)).toThrow(
        'Settings patch values must be defined'
      )
    })

    it('skips runtime and persistence work for an unchanged transaction', async () => {
      const { getDefaultSettings, loadSettings: freshLoad, transactSettings } = await import('../index')
      const defaults = getDefaultSettings()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(defaults))
      freshLoad()
      const reconcile = vi.fn(async () => undefined)

      await transactSettings((current) => current, reconcile)

      expect(reconcile).not.toHaveBeenCalled()
      expect(atomicFile.writeFile).not.toHaveBeenCalled()
    })

    it('can explicitly reconcile an unchanged transaction', async () => {
      const { getDefaultSettings, loadSettings: freshLoad, transactSettings } = await import('../index')
      const defaults = getDefaultSettings()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(defaults))
      freshLoad()
      const reconcile = vi.fn(async () => undefined)

      await transactSettings((current) => current, reconcile, undefined, undefined, { applyUnchanged: true })

      expect(reconcile).toHaveBeenCalledOnce()
      expect(atomicFile.writeFile).toHaveBeenCalledOnce()
    })

    it('restores persistence, cache and runtime after apply failure', async () => {
      const {
        getDefaultSettings,
        loadSettings: freshLoad,
        mergeSettingsPatch,
        transactSettings,
      } = await import('../index')
      const defaults = getDefaultSettings()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(defaults))
      const appliedPorts: number[] = []

      await expect(
        transactSettings(
          (current) => mergeSettingsPatch(current, { network: { proxyPort: 9000 } }),
          async (_previous, current) => {
            appliedPorts.push(current.network.proxyPort)
            if (current.network.proxyPort === 9000) throw new Error('port unavailable')
          }
        )
      ).rejects.toMatchObject({ name: 'SettingsRuntimeApplyError' })

      expect(appliedPorts).toEqual([9000, 8080])
      expect(freshLoad().network.proxyPort).toBe(8080)
      expect(atomicFile.writeFile).not.toHaveBeenCalled()
    })

    it('serializes persistence and runtime reconciliation together', async () => {
      const {
        getDefaultSettings,
        loadSettings: freshLoad,
        mergeSettingsPatch,
        transactSettings,
      } = await import('../index')
      const defaults = getDefaultSettings()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(defaults))
      freshLoad()
      let release!: () => void
      const blocked = new Promise<void>((resolve) => {
        release = resolve
      })
      const appliedPorts: number[] = []

      const first = transactSettings(
        (current) => mergeSettingsPatch(current, { network: { proxyPort: 9001 } }),
        async (_previous, current) => {
          appliedPorts.push(current.network.proxyPort)
          await blocked
        }
      )
      await vi.waitFor(() => expect(appliedPorts).toEqual([9001]))
      const second = transactSettings(
        (current) => mergeSettingsPatch(current, { network: { proxyPort: 9002 } }),
        async (_previous, current) => {
          appliedPorts.push(current.network.proxyPort)
        }
      )
      await Promise.resolve()
      expect(appliedPorts).toEqual([9001])
      expect(freshLoad().network.proxyPort).toBe(8080)
      expect(atomicFile.writeFile).not.toHaveBeenCalled()

      release()
      await Promise.all([first, second])
      expect(appliedPorts).toEqual([9001, 9002])
      expect(freshLoad().network.proxyPort).toBe(9002)
    })

    it('restores runtime and cache when the candidate write fails', async () => {
      const {
        getDefaultSettings,
        loadSettings: freshLoad,
        mergeSettingsPatch,
        transactSettings,
      } = await import('../index')
      const defaults = getDefaultSettings()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(defaults))
      freshLoad()
      atomicFile.writeFile.mockRejectedValueOnce(new Error('Disk full'))
      const appliedPorts: number[] = []

      await expect(
        transactSettings(
          (current) => mergeSettingsPatch(current, { network: { proxyPort: 9000 } }),
          async (_previous, current) => {
            appliedPorts.push(current.network.proxyPort)
          }
        )
      ).rejects.toThrow('Disk full')

      expect(appliedPorts).toEqual([9000, 8080])
      expect(freshLoad().network.proxyPort).toBe(8080)
    })

    it('restores persistence, cache and runtime when finalization fails', async () => {
      const {
        getDefaultSettings,
        loadSettings: freshLoad,
        mergeSettingsPatch,
        transactSettings,
      } = await import('../index')
      const defaults = getDefaultSettings()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(defaults))
      freshLoad()
      const appliedPorts: number[] = []

      await expect(
        transactSettings(
          (current) => mergeSettingsPatch(current, { network: { proxyPort: 9000 } }),
          async (_previous, current) => {
            appliedPorts.push(current.network.proxyPort)
          },
          async () => {
            throw new Error('history write failed')
          }
        )
      ).rejects.toMatchObject({ name: 'SettingsRuntimeApplyError' })

      expect(appliedPorts).toEqual([9000, 8080])
      expect(freshLoad().network.proxyPort).toBe(8080)
      const restored = JSON.parse(atomicFile.writeFile.mock.calls.at(-1)?.[0] as string)
      expect(restored.network.proxyPort).toBe(8080)
    })

    it('keeps cache aligned with the candidate when persistence rollback fails', async () => {
      const {
        getDefaultSettings,
        loadSettings: freshLoad,
        mergeSettingsPatch,
        transactSettings,
      } = await import('../index')
      const defaults = getDefaultSettings()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(defaults))
      freshLoad()
      atomicFile.writeFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rollback disk full'))
      const appliedPorts: number[] = []

      await expect(
        transactSettings(
          (current) => mergeSettingsPatch(current, { network: { proxyPort: 9000 } }),
          async (_previous, current) => {
            appliedPorts.push(current.network.proxyPort)
          },
          async () => {
            throw new Error('history write failed')
          }
        )
      ).rejects.toMatchObject({ name: 'SettingsRuntimeApplyError', rollbackError: expect.any(AggregateError) })

      expect(appliedPorts).toEqual([9000])
      expect(freshLoad().network.proxyPort).toBe(9000)
    })
  })

  describe('resetSettings()', () => {
    it('saves default settings to file', async () => {
      vi.resetModules()
      const { resetSettings: freshReset, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)

      await freshReset()

      const defaults = getDefaults()
      const lastCallIndex = atomicFile.writeFile.mock.calls.length - 1
      const writtenContent = atomicFile.writeFile.mock.calls[lastCallIndex][0] as string
      const parsed = JSON.parse(writtenContent)

      expect(parsed.general.homepage).toBe(defaults.general.homepage)
      expect(parsed.network.proxyPort).toBe(defaults.network.proxyPort)
    })
  })

  describe('getDownloadPath() / setDownloadPath()', () => {
    it('getDownloadPath returns storage.downloadPath', async () => {
      vi.resetModules()
      const { getDownloadPath: freshGet } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          storage: { downloadPath: '/custom/path' },
        })
      )

      expect(freshGet()).toBe('/custom/path')
    })

    it('setDownloadPath updates storage.downloadPath', async () => {
      vi.resetModules()
      const { setDownloadPath: freshSet, loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}))

      freshLoad()
      await freshSet('/new/path')

      const lastCallIndex = atomicFile.writeFile.mock.calls.length - 1
      const writtenContent = atomicFile.writeFile.mock.calls[lastCallIndex][0] as string
      const parsed = JSON.parse(writtenContent)

      expect(parsed.storage.downloadPath).toBe('/new/path')
    })
  })

  describe('migrateSettings()', () => {
    it('maps circuitRotation+rotateInterval to tunnelMode standard', async () => {
      vi.resetModules()
      const { migrateSettings } = await import('../index')

      const legacy = {
        network: {
          proxyPort: 8080,
          circuitRotation: false,
          rotateInterval: '10m',
        },
      }

      const { migrated, data } = migrateSettings(legacy)

      expect(migrated).toBe(true)
      const net = (data as Record<string, unknown>)['network'] as Record<string, unknown>
      expect(net['tunnelMode']).toBe('standard')
      expect(net).not.toHaveProperty('circuitRotation')
      expect(net).not.toHaveProperty('rotateInterval')
      expect(net['proxyPort']).toBe(8080)
    })

    it('maps circuitRotation true to tunnelMode standard', async () => {
      vi.resetModules()
      const { migrateSettings } = await import('../index')

      const legacy = {
        network: {
          circuitRotation: true,
        },
      }

      const { migrated, data } = migrateSettings(legacy)

      expect(migrated).toBe(true)
      const net = (data as Record<string, unknown>)['network'] as Record<string, unknown>
      expect(net['tunnelMode']).toBe('standard')
      expect(net).not.toHaveProperty('circuitRotation')
    })

    it('does not overwrite tunnelMode if already set alongside legacy keys', async () => {
      vi.resetModules()
      const { migrateSettings } = await import('../index')

      // Edge case: both legacy and new key present (partial migration)
      const mixed = {
        network: {
          circuitRotation: true,
          tunnelMode: 'maximum',
        },
      }

      const { migrated, data } = migrateSettings(mixed)

      expect(migrated).toBe(true)
      const net = (data as Record<string, unknown>)['network'] as Record<string, unknown>
      expect(net['tunnelMode']).toBe('maximum') // Preserved
      expect(net).not.toHaveProperty('circuitRotation')
    })

    it('passes through v1.6.0-shaped settings untouched', async () => {
      vi.resetModules()
      const { migrateSettings } = await import('../index')

      const current = {
        network: {
          proxyPort: 8080,
          tunnelMode: 'maximum',
          autoConnect: true,
        },
      }

      const { migrated, data } = migrateSettings(current)

      expect(migrated).toBe(false)
      expect(data).toBe(current) // Same reference — no copy made
    })

    it('is safe for non-object input', async () => {
      vi.resetModules()
      const { migrateSettings } = await import('../index')

      expect(migrateSettings(null)).toEqual({ migrated: false, data: null })
      expect(migrateSettings([])).toEqual({ migrated: false, data: [] })
      expect(migrateSettings('string')).toEqual({ migrated: false, data: 'string' })
    })
  })

  describe('migrateThemeColors()', () => {
    it('migrates v1 custom themes to independent semantic roles', async () => {
      const { migrateThemeColors } = await import('../index')
      const { BUILT_IN_THEME_COLORS } = await import('../../../shared/theme-tokens')
      const colors = { ...BUILT_IN_THEME_COLORS['resistance-dog'] } as Record<string, string>
      colors.foreground = colors.textPrimary
      colors.mutedForeground = colors.textSecondary
      delete colors.textPrimary
      delete colors.textSecondary
      delete colors.heading
      delete colors.chromeForeground
      delete colors.icon

      const { migrated, data } = migrateThemeColors({
        appearance: {
          customThemes: [{ id: 'legacy', colors, isDark: true }],
        },
      })

      expect(migrated).toBe(true)
      const appearance = (data as { appearance: { customThemes: Array<{ colors: Record<string, string> }> } })
        .appearance
      expect(appearance.customThemes[0].colors).toMatchObject({
        textPrimary: colors.foreground,
        textSecondary: colors.mutedForeground,
        heading: colors.foreground,
        chromeForeground: colors.foreground,
        icon: colors.foreground,
      })
      expect(appearance.customThemes[0].colors).not.toHaveProperty('foreground')
      expect(appearance.customThemes[0].colors).not.toHaveProperty('mutedForeground')
    })

    it('preserves the independent v2 icon value during migration', async () => {
      const { migrateThemeColors } = await import('../index')
      const { BUILT_IN_THEME_COLORS } = await import('../../../shared/theme-tokens')
      const colors = { ...BUILT_IN_THEME_COLORS['resistance-dog'], icon: '180 50% 50%' } as Record<string, string>
      colors.foreground = colors.textPrimary
      colors.mutedForeground = colors.textSecondary
      delete colors.textPrimary
      delete colors.textSecondary
      delete colors.heading
      delete colors.chromeForeground
      const current = { appearance: { customThemes: [{ colors }] } }

      const result = migrateThemeColors(current)

      expect(result.migrated).toBe(true)
      const migratedColors = (result.data as typeof current).appearance.customThemes[0].colors
      expect(migratedColors.icon).toBe('180 50% 50%')
      expect(migratedColors.chromeForeground).toBe(colors.foreground)
    })

    it('is idempotent for v3 themes', async () => {
      const { migrateThemeColors } = await import('../index')
      const { BUILT_IN_THEME_COLORS } = await import('../../../shared/theme-tokens')
      const current = {
        appearance: { customThemes: [{ colors: { ...BUILT_IN_THEME_COLORS['resistance-dog'] } }] },
      }

      expect(migrateThemeColors(current)).toEqual({ migrated: false, data: current })
    })
  })

  describe('migratePageZoom()', () => {
    it('clamps persisted zoom to the supported range', async () => {
      const { migratePageZoom } = await import('../index')

      expect(migratePageZoom({ appearance: { defaultZoom: 300 } })).toMatchObject({
        migrated: true,
        data: { appearance: { defaultZoom: 200 } },
      })
      expect(migratePageZoom({ appearance: { defaultZoom: 20 } })).toMatchObject({
        migrated: true,
        data: { appearance: { defaultZoom: 30 } },
      })
      const current = { appearance: { defaultZoom: 100 } }
      expect(migratePageZoom(current)).toEqual({ migrated: false, data: current })
    })
  })

  describe('migrateMessengerAutostart()', () => {
    it('preserves the former Messenger opt-in', async () => {
      const { migrateMessengerAutostart } = await import('../index')

      expect(migrateMessengerAutostart({ messenger: { networkEnabled: true } })).toEqual({
        migrated: true,
        data: { messenger: { autostart: true } },
      })
    })

    it('keeps an explicit autostart value and removes the legacy field', async () => {
      const { migrateMessengerAutostart } = await import('../index')

      expect(migrateMessengerAutostart({ messenger: { networkEnabled: true, autostart: false } })).toEqual({
        migrated: true,
        data: { messenger: { autostart: false } },
      })
    })
  })

  describe('loadSettings() — v1.5.3 upgrade', () => {
    it('migrates legacy network fields and persists the result', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          network: {
            proxyPort: 8080,
            circuitRotation: false,
            rotateInterval: '10m',
          },
        })
      )

      const settings = freshLoad()

      // Migration applied: tunnelMode should be present
      expect(settings.network.tunnelMode).toBe('standard')
      // Legacy keys should not appear in validated output
      expect(settings.network).not.toHaveProperty('circuitRotation')
      expect(settings.network).not.toHaveProperty('rotateInterval')
      // Settings should have been saved back to disk (atomic write to .tmp)
      await vi.waitFor(() => expect(atomicFile.writeFile).toHaveBeenCalled())
      const writtenContent = atomicFile.writeFile.mock.calls[0][0] as string
      const parsed = JSON.parse(writtenContent)
      expect(parsed.network.tunnelMode).toBe('standard')
      expect(parsed.network).not.toHaveProperty('circuitRotation')
    })
  })

  describe('getDefaultSettings()', () => {
    it('returns complete settings structure', async () => {
      vi.resetModules()
      const { getDefaultSettings: getDefaults } = await import('../index')

      const defaults = getDefaults()

      // Check all categories exist
      expect(defaults).toHaveProperty('general')
      expect(defaults).toHaveProperty('network')
      expect(defaults).toHaveProperty('storage')
      expect(defaults).toHaveProperty('appearance')
      expect(defaults).toHaveProperty('privacy')
      expect(defaults).toHaveProperty('advanced')

      // Check critical defaults
      expect(defaults.general.homepage).toBe('ton://start')
      expect(defaults.network.proxyPort).toBe(8080)
      expect(defaults.network.autoConnect).toBe(false)
      expect(defaults.privacy.clearOnExit).toBe(true)
    })
  })
})
