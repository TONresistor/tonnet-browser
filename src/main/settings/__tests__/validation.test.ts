import { describe, it, expect } from 'vitest'
import { isValidSettingsObject, validateSettings, validateCategoryValues, getDefaultSettingsBase } from '../validation'
import { WalletSettingsSchema, WalletSettingsPartialSchema } from '../../../shared/schemas'

describe('isValidSettingsObject', () => {
  describe('valid inputs', () => {
    it('accepts an empty object', () => {
      expect(isValidSettingsObject({})).toBe(true)
    })

    it('accepts an object with valid categories', () => {
      const validSettings = {
        general: { homepage: 'ton://start' },
        network: { proxyPort: 8080 },
        storage: { downloadPath: '/tmp/storage' },
        appearance: { defaultZoom: 100 },
        privacy: { clearOnExit: true },
        advanced: { proxyVerbosity: 2 },
      }
      expect(isValidSettingsObject(validSettings)).toBe(true)
    })

    it('accepts partial settings with only some categories', () => {
      expect(isValidSettingsObject({ general: { homepage: 'ton://test' } })).toBe(true)
      expect(isValidSettingsObject({ network: { proxyPort: 9000 } })).toBe(true)
      expect(isValidSettingsObject({ privacy: { clearOnExit: false } })).toBe(true)
    })

    it('accepts empty category objects', () => {
      expect(isValidSettingsObject({ general: {}, network: {} })).toBe(true)
    })
  })

  describe('invalid inputs - non-objects', () => {
    it('rejects null', () => {
      expect(isValidSettingsObject(null)).toBe(false)
    })

    it('rejects arrays', () => {
      expect(isValidSettingsObject([])).toBe(false)
      expect(isValidSettingsObject([{ general: {} }])).toBe(false)
    })

    it('rejects primitives', () => {
      expect(isValidSettingsObject('string')).toBe(false)
      expect(isValidSettingsObject(123)).toBe(false)
      expect(isValidSettingsObject(true)).toBe(false)
      expect(isValidSettingsObject(undefined)).toBe(false)
    })
  })

  describe('invalid inputs - category format', () => {
    it('rejects if a category is not an object', () => {
      expect(isValidSettingsObject({ general: 'not an object' })).toBe(false)
      expect(isValidSettingsObject({ network: 123 })).toBe(false)
      expect(isValidSettingsObject({ storage: true })).toBe(false)
    })

    it('rejects if a category is null', () => {
      expect(isValidSettingsObject({ general: null })).toBe(false)
      expect(isValidSettingsObject({ network: null })).toBe(false)
    })

    it('rejects if a category is an array', () => {
      expect(isValidSettingsObject({ general: [] })).toBe(false)
      expect(isValidSettingsObject({ network: [8080] })).toBe(false)
    })
  })

  describe('field type validation', () => {
    describe('network settings', () => {
      it('rejects if proxyPort is not a number', () => {
        expect(isValidSettingsObject({ network: { proxyPort: '8080' } })).toBe(false)
        expect(isValidSettingsObject({ network: { proxyPort: true } })).toBe(false)
        expect(isValidSettingsObject({ network: { proxyPort: null } })).toBe(false)
      })

      it('accepts valid proxyPort number', () => {
        expect(isValidSettingsObject({ network: { proxyPort: 8080 } })).toBe(true)
        expect(isValidSettingsObject({ network: { proxyPort: 1024 } })).toBe(true)
      })

      it('rejects proxyPort out of valid range', () => {
        // Port 0 and values below 1024 are not valid listen ports
        expect(isValidSettingsObject({ network: { proxyPort: 0 } })).toBe(false)
        expect(isValidSettingsObject({ network: { proxyPort: 1023 } })).toBe(false)
        // Port > 65535 exceeds TCP range
        expect(isValidSettingsObject({ network: { proxyPort: 99999 } })).toBe(false)
      })

      it('rejects if storagePort is not a number', () => {
        expect(isValidSettingsObject({ network: { storagePort: '5555' } })).toBe(false)
      })

      it('accepts valid storagePort number', () => {
        expect(isValidSettingsObject({ network: { storagePort: 5555 } })).toBe(true)
      })

      it('rejects storagePort out of valid range', () => {
        expect(isValidSettingsObject({ network: { storagePort: 0 } })).toBe(false)
        expect(isValidSettingsObject({ network: { storagePort: 65536 } })).toBe(false)
      })

      it('rejects if autoConnect is not a boolean', () => {
        expect(isValidSettingsObject({ network: { autoConnect: 'true' } })).toBe(false)
        expect(isValidSettingsObject({ network: { autoConnect: 1 } })).toBe(false)
      })

      it('accepts valid autoConnect boolean', () => {
        expect(isValidSettingsObject({ network: { autoConnect: true } })).toBe(true)
        expect(isValidSettingsObject({ network: { autoConnect: false } })).toBe(true)
      })
    })

    describe('privacy settings', () => {
      it('rejects if clearOnExit is not a boolean', () => {
        expect(isValidSettingsObject({ privacy: { clearOnExit: 'true' } })).toBe(false)
        expect(isValidSettingsObject({ privacy: { clearOnExit: 1 } })).toBe(false)
      })

      it('accepts valid clearOnExit boolean', () => {
        expect(isValidSettingsObject({ privacy: { clearOnExit: true } })).toBe(true)
        expect(isValidSettingsObject({ privacy: { clearOnExit: false } })).toBe(true)
      })
    })

    describe('appearance settings', () => {
      it('rejects if defaultZoom is not a number', () => {
        expect(isValidSettingsObject({ appearance: { defaultZoom: '100' } })).toBe(false)
        expect(isValidSettingsObject({ appearance: { defaultZoom: true } })).toBe(false)
      })

      it('accepts valid defaultZoom number', () => {
        expect(isValidSettingsObject({ appearance: { defaultZoom: 100 } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { defaultZoom: 150 } })).toBe(true)
      })

      it('accepts built-in theme names', () => {
        expect(isValidSettingsObject({ appearance: { theme: 'resistance-dog' } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { theme: 'utya-duck' } })).toBe(true)
      })

      it('accepts legacy theme names for migration compatibility', () => {
        // Old names still accepted — migration happens in loadSettings
        expect(isValidSettingsObject({ appearance: { theme: 'midnight-blue' } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { theme: 'canard-yellow' } })).toBe(true)
      })

      it('accepts custom theme IDs with custom: prefix', () => {
        expect(isValidSettingsObject({ appearance: { theme: 'custom:myTheme' } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { theme: 'custom:dark-variant' } })).toBe(true)
      })

      it('rejects invalid theme names', () => {
        expect(isValidSettingsObject({ appearance: { theme: 'invalid-theme' } })).toBe(false)
        expect(isValidSettingsObject({ appearance: { theme: '' } })).toBe(false)
        expect(isValidSettingsObject({ appearance: { theme: 'my-theme' } })).toBe(false)
      })
    })

    describe('messenger settings', () => {
      it('accepts a valid autostart boolean', () => {
        expect(isValidSettingsObject({ messenger: { autostart: true } })).toBe(true)
        expect(isValidSettingsObject({ messenger: { autostart: false } })).toBe(true)
      })

      it('rejects if autostart is not a boolean', () => {
        expect(isValidSettingsObject({ messenger: { autostart: 'true' } })).toBe(false)
        expect(isValidSettingsObject({ messenger: { autostart: 1 } })).toBe(false)
      })
    })

    describe('advanced settings', () => {
      it('accepts a boolean Unicode-domain display preference', () => {
        expect(isValidSettingsObject({ advanced: { displayUnicodeDomains: true } })).toBe(true)
        expect(isValidSettingsObject({ advanced: { displayUnicodeDomains: false } })).toBe(true)
      })

      it('rejects a non-boolean Unicode-domain display preference', () => {
        expect(isValidSettingsObject({ advanced: { displayUnicodeDomains: 'true' } })).toBe(false)
      })

      it('accepts a boolean experimental TON Connect preference', () => {
        expect(isValidSettingsObject({ advanced: { tonConnectEnabled: true } })).toBe(true)
        expect(isValidSettingsObject({ advanced: { tonConnectEnabled: false } })).toBe(true)
      })

      it('rejects a non-boolean experimental TON Connect preference', () => {
        expect(isValidSettingsObject({ advanced: { tonConnectEnabled: 'true' } })).toBe(false)
      })
    })
  })

  describe('unknown categories', () => {
    it('ignores unknown categories (stripped/logged, object still valid)', () => {
      // Unknown categories are not a security risk — they are stripped or ignored
      expect(isValidSettingsObject({ unknownCategory: { foo: 'bar' } })).toBe(true)
    })
  })
})

describe('validateSettings', () => {
  it('returns valid:true with defaults for an empty object', () => {
    const result = validateSettings({})
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.general.homepage).toBe('ton://start')
      expect(result.data.network.proxyPort).toBe(8080)
      expect(result.data.privacy.clearOnExit).toBe(true)
      expect(result.data.wallet.paymentMode).toBe('off')
      expect(result.data.messenger.autostart).toBe(false)
      expect(result.data.advanced.displayUnicodeDomains).toBe(false)
      expect(result.data.advanced.tonConnectEnabled).toBe(false)
    }
  })

  it('returns valid:true and fills field-level defaults for partial category', () => {
    const result = validateSettings({ network: { autoConnect: true } })
    expect(result.valid).toBe(true)
    if (result.valid) {
      // autoConnect was provided
      expect(result.data.network.autoConnect).toBe(true)
      // proxyPort gets its default since network object was present
      expect(result.data.network.proxyPort).toBe(8080)
      expect(result.data.network.storagePort).toBe(5555)
    }
  })

  it('returns valid:false for null', () => {
    const result = validateSettings(null)
    expect(result.valid).toBe(false)
  })

  it('returns valid:false for arrays', () => {
    const result = validateSettings([])
    expect(result.valid).toBe(false)
  })

  it('returns valid:false for primitives', () => {
    expect(validateSettings('string').valid).toBe(false)
    expect(validateSettings(123).valid).toBe(false)
  })

  describe('range validation — proxyPort', () => {
    it('rejects proxyPort: 0 (below minimum 1024)', () => {
      const result = validateSettings({ network: { proxyPort: 0 } })
      expect(result.valid).toBe(false)
    })

    it('rejects proxyPort: 99999 (above maximum 65535)', () => {
      const result = validateSettings({ network: { proxyPort: 99999 } })
      expect(result.valid).toBe(false)
    })

    it('rejects proxyPort: 1023 (one below minimum)', () => {
      const result = validateSettings({ network: { proxyPort: 1023 } })
      expect(result.valid).toBe(false)
    })

    it('accepts proxyPort: 1024 (minimum boundary)', () => {
      const result = validateSettings({ network: { proxyPort: 1024 } })
      expect(result.valid).toBe(true)
    })

    it('accepts proxyPort: 65535 (maximum boundary)', () => {
      const result = validateSettings({ network: { proxyPort: 65535 } })
      expect(result.valid).toBe(true)
    })

    it('accepts proxyPort: 8080 (typical value)', () => {
      const result = validateSettings({ network: { proxyPort: 8080 } })
      expect(result.valid).toBe(true)
    })
  })

  describe('range validation — storagePort', () => {
    it('rejects storagePort: 0 (below minimum)', () => {
      const result = validateSettings({ network: { storagePort: 0 } })
      expect(result.valid).toBe(false)
    })

    it('rejects storagePort: 65536 (above maximum)', () => {
      const result = validateSettings({ network: { storagePort: 65536 } })
      expect(result.valid).toBe(false)
    })

    it('accepts storagePort: 5555 (typical value)', () => {
      const result = validateSettings({ network: { storagePort: 5555 } })
      expect(result.valid).toBe(true)
    })
  })

  describe('theme validation', () => {
    it('accepts built-in theme names', () => {
      expect(validateSettings({ appearance: { theme: 'resistance-dog' } }).valid).toBe(true)
      expect(validateSettings({ appearance: { theme: 'utya-duck' } }).valid).toBe(true)
    })

    it('accepts legacy theme names (migration)', () => {
      expect(validateSettings({ appearance: { theme: 'midnight-blue' } }).valid).toBe(true)
      expect(validateSettings({ appearance: { theme: 'canard-yellow' } }).valid).toBe(true)
    })

    it('accepts custom theme IDs with custom: prefix', () => {
      expect(validateSettings({ appearance: { theme: 'custom:myTheme' } }).valid).toBe(true)
      expect(validateSettings({ appearance: { theme: 'custom:dark-variant' } }).valid).toBe(true)
    })

    it('rejects invalid theme names', () => {
      expect(validateSettings({ appearance: { theme: 'invalid-theme' } }).valid).toBe(false)
      expect(validateSettings({ appearance: { theme: '' } }).valid).toBe(false)
      expect(validateSettings({ appearance: { theme: 'my-theme' } }).valid).toBe(false)
    })
  })

  it('includes error message on failure', () => {
    const result = validateSettings({ network: { proxyPort: 0 } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})

describe('validateCategoryValues', () => {
  describe('valid inputs', () => {
    it('accepts empty object for any category', () => {
      expect(validateCategoryValues('general', {}).valid).toBe(true)
      expect(validateCategoryValues('network', {}).valid).toBe(true)
      expect(validateCategoryValues('privacy', {}).valid).toBe(true)
    })

    it('accepts partial update for network', () => {
      const result = validateCategoryValues('network', { proxyPort: 9000 })
      expect(result.valid).toBe(true)
    })

    it('accepts partial update for general', () => {
      const result = validateCategoryValues('general', { homepage: 'ton://custom' })
      expect(result.valid).toBe(true)
    })

    it('accepts partial update for appearance', () => {
      const result = validateCategoryValues('appearance', { theme: 'resistance-dog' })
      expect(result.valid).toBe(true)
    })

    it('accepts the Unicode-domain display preference', () => {
      const result = validateCategoryValues('advanced', { displayUnicodeDomains: true })
      expect(result.valid).toBe(true)
    })

    it('accepts the experimental TON Connect preference', () => {
      const result = validateCategoryValues('advanced', { tonConnectEnabled: true })
      expect(result.valid).toBe(true)
    })
  })

  describe('invalid inputs', () => {
    it('rejects unknown category', () => {
      // @ts-expect-error testing invalid input
      const result = validateCategoryValues('unknownCategory', {})
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('Unknown category')
      }
    })

    it('rejects invalid field type', () => {
      const result = validateCategoryValues('network', { proxyPort: 'not-a-number' })
      expect(result.valid).toBe(false)
    })

    it('rejects explicit undefined values', () => {
      expect(validateCategoryValues('network', { proxyPort: undefined }).valid).toBe(false)
    })

    it('rejects out-of-range port value', () => {
      const result = validateCategoryValues('network', { proxyPort: 0 })
      expect(result.valid).toBe(false)
    })

    it('rejects invalid theme in appearance', () => {
      const result = validateCategoryValues('appearance', { theme: 'invalid-theme' })
      expect(result.valid).toBe(false)
    })

    it('rejects an invalid Unicode-domain display preference', () => {
      const result = validateCategoryValues('advanced', { displayUnicodeDomains: 'true' })
      expect(result.valid).toBe(false)
    })

    it('rejects an invalid experimental TON Connect preference', () => {
      const result = validateCategoryValues('advanced', { tonConnectEnabled: 'true' })
      expect(result.valid).toBe(false)
    })
  })
})

describe('getDefaultSettingsBase', () => {
  // The only property worth asserting: the defaults are internally valid.
  // Re-asserting each literal value would just duplicate DEFAULT_SETTINGS
  // and break on every legitimate default change without catching a bug.
  it('produces an object that passes structural validation', () => {
    expect(isValidSettingsObject(getDefaultSettingsBase())).toBe(true)
  })

  it('produces an object that passes Zod validation', () => {
    expect(validateSettings(getDefaultSettingsBase()).valid).toBe(true)
  })
})

describe('WalletSettingsPartialSchema drift guard', () => {
  it('exposes exactly the same keys as the full wallet schema', () => {
    const full = Object.keys(WalletSettingsSchema.shape).sort()
    const partial = Object.keys(WalletSettingsPartialSchema.shape).sort()
    expect(partial).toEqual(full)
  })

  it('does not strip indexer fields on a partial wallet update', () => {
    const res = validateCategoryValues('wallet', {
      indexerEnabled: true,
      indexerEndpoint: 'https://toncenter.com/api/v3',
      indexerApiKey: 'secret',
    })
    expect(res.valid).toBe(true)
    if (res.valid) {
      expect(res.data).toEqual({
        indexerEnabled: true,
        indexerEndpoint: 'https://toncenter.com/api/v3',
        indexerApiKey: 'secret',
      })
    }
  })

  it('requires HTTPS for remote indexers but permits a local HTTP indexer', () => {
    expect(validateCategoryValues('wallet', { indexerEndpoint: 'http://indexer.example/api/v3' }).valid).toBe(false)
    expect(validateCategoryValues('wallet', { indexerEndpoint: 'http://localhost:8080/api/v3' }).valid).toBe(true)
  })
})
