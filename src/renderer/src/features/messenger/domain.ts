export function isMessengerDomain(value: string): boolean {
  const domain = value.trim().toLowerCase()
  const telegram = domain.endsWith('.t.me')
  if (domain.length > 126 || (!domain.endsWith('.ton') && !telegram)) return false
  const labelPattern = telegram ? /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/ : /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
  return domain.split('.').every((label) => labelPattern.test(label))
}

export function isMessengerReference(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value.trim()) || isMessengerDomain(value)
}
