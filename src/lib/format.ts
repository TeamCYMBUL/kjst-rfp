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

// Render the meeting-space details JSON (stored in rfp_responses.meeting_space_notes)
// as readable text instead of a raw JSON blob. Falls back to the raw string if it
// isn't the expected JSON shape.
const MEETING_SPACE_TYPE_LABELS: Record<string, string> = {
  function_room: 'Function Room / Ballroom',
  restaurant: 'Restaurant / F&B outlet',
  suite_converted: 'Suite (furniture removed)',
  other: 'Other',
}

export function formatMeetingSpaceNotes(raw: string | null | undefined): string {
  if (!raw) return ''
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw // plain text note — show as-is
  }
  if (!parsed || typeof parsed !== 'object') return raw

  const spaces: any[] = []
  if (parsed.__details && typeof parsed.__details === 'object') {
    spaces.push(...Object.values(parsed.__details))
  }
  if (Array.isArray(parsed.__additional)) {
    spaces.push(...parsed.__additional)
  }

  const fmtSpace = (s: any): string | null => {
    if (!s || typeof s !== 'object') return null
    const parts: string[] = []
    if (s.name) parts.push(String(s.name))
    if (s.space_type) parts.push(MEETING_SPACE_TYPE_LABELS[s.space_type] ?? String(s.space_type))
    if (s.dimensions) parts.push(`Size: ${s.dimensions}`)
    if (s.fb_minimum) parts.push(`F&B min: ${s.fb_minimum}`)
    if (s.wifi) parts.push(`Wi-Fi: ${s.wifi}`)
    if (s.additional_info) parts.push(String(s.additional_info))
    return parts.length ? parts.join(' · ') : null
  }

  const lines = spaces.map(fmtSpace).filter(Boolean) as string[]

  // Named, fixed sub-spaces (e.g. Meal Room / Treatment Room / Coaches Meeting
  // Room) required for a single yes_no item — keyed by item id, then space key.
  if (parsed.__named && typeof parsed.__named === 'object') {
    for (const itemSpaces of Object.values(parsed.__named)) {
      if (!itemSpaces || typeof itemSpaces !== 'object') continue
      for (const [, s] of Object.entries(itemSpaces as Record<string, any>)) {
        if (!s || typeof s !== 'object') continue
        const valueParts: string[] = []
        if (s.name) valueParts.push(String(s.name))
        if (s.dimensions) valueParts.push(`Size: ${s.dimensions}`)
        if (!valueParts.length) continue
        lines.push(s.spaceLabel ? `${s.spaceLabel}: ${valueParts.join(' · ')}` : valueParts.join(' · '))
      }
    }
  }

  return lines.join('\n')
}

// URL-safe random token for a hotel's /rfp/{token} link.
export function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
