let sequence = 0

/**
 * `crypto.randomUUID()` is unavailable on plain-HTTP LAN origins in Chromium.
 * Keep client-only IDs working on 3091 without requiring HTTPS.
 */
export function createClientId(prefix = 'diywx'): string {
  const cryptoApi = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`
  }
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
