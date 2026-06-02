// Small shared helpers for dates, nights, and invite tokens.

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  // iso is a YYYY-MM-DD date string; render without timezone surprises.
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Whole nights between two YYYY-MM-DD dates (departure - arrival).
export function nightsBetween(
  arrival: string | null | undefined,
  departure: string | null | undefined,
): number | null {
  if (!arrival || !departure) return null
  const a = new Date(arrival).getTime()
  const d = new Date(departure).getTime()
  if (Number.isNaN(a) || Number.isNaN(d)) return null
  const diff = Math.round((d - a) / (1000 * 60 * 60 * 24))
  return diff >= 0 ? diff : null
}

// URL-safe random token for a hotel's /rfp/{token} link.
export function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
