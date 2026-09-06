import { describe, expect, it } from 'vitest'
import { isMessengerDomain, isMessengerReference } from '../domain'

describe('Messenger domain references', () => {
  it.each(['alice.ton', ' Alice.T.ME ', 'team_member.t.me', 'chat.alice.t.me', 'chat.alice.ton'])(
    'accepts %s',
    (domain) => {
      expect(isMessengerDomain(domain)).toBe(true)
      expect(isMessengerReference(domain)).toBe(true)
    }
  )
  it.each([
    '',
    't.me',
    '.t.me',
    'alice.t.me.evil',
    'https://t.me/alice',
    '@alice',
    '-alice.t.me',
    'alice-.t.me',
    'alice..t.me',
    'team_member.ton',
    `${'a'.repeat(122)}.t.me`,
  ])('rejects %s', (domain) => expect(isMessengerDomain(domain)).toBe(false))
  it('preserves raw room keys', () => {
    const key = 'Ab'.repeat(21) + '_'
    expect(isMessengerDomain(key)).toBe(false)
    expect(isMessengerReference(key)).toBe(true)
  })
})
