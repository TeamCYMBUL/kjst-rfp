// Small shared helpers for dates, nights, and invite tokens.

// Sponsor/partner blocks are stored as "<Team> — Sponsor Block" so we can tell
// them apart internally (dashboard, template list). Anything a hotel or client
// sees — RFP form, emails, grid, proposals — must show the team name only.
export function publicClientName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s*—\s*Sponsor Block\s*$/i, '')
}

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

// A single hotel-offered meeting space, paired with what it's FOR. `purpose` is
// the short human reason (e.g. "Coaches Meeting Room", "meals/meetings"), pulled
// from the requested concession item's label when the id->label map is provided.
export type MeetingSpaceEntry = { purpose: string | null; detail: string }

// The requested item labels read like "Complimentary Meeting space (800 sq. ft.
// requested) for Coaches Meeting Room, for duration of stay". Pull out just the
// "for <purpose>" so the proposal can say which room is for what.
function shortMeetingPurpose(label: string): string {
  const m = label.match(/for\s+(.+?)\s*,?\s+for\s+(?:the\s+)?duration/i)
  if (m && m[1]) return m[1].trim()
  // Fallbacks: strip the boilerplate prefix if present, else return as-is.
  const m2 = label.match(/for\s+(.+)$/i)
  return (m2 && m2[1] ? m2[1] : label).trim()
}

// Parse the stored meeting_space_notes JSON into labeled, per-space entries.
// Pass itemLabelById (concession item id -> label) to resolve each __details
// space to its requested purpose; without it, purpose is left null (unchanged
// behavior for callers that don't have the items on hand).
export function parseMeetingSpaces(
  raw: string | null | undefined,
  itemLabelById?: Record<string, string>,
): MeetingSpaceEntry[] {
  if (!raw) return []
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [{ purpose: null, detail: raw }] // plain-text legacy note
  }
  if (!parsed || typeof parsed !== 'object') return [{ purpose: null, detail: raw }]

  const detailOf = (s: any): string | null => {
    if (!s || typeof s !== 'object') return null
    const parts: string[] = []
    if (s.name) parts.push(String(s.name))
    if (s.space_type) parts.push(MEETING_SPACE_TYPE_LABELS[s.space_type] ?? String(s.space_type))
    if (s.dimensions) parts.push(`Size: ${s.dimensions}`)
    return parts.length ? parts.join(' · ') : null
  }

  const out: MeetingSpaceEntry[] = []

  // __details: keyed by concession item id — the item's label carries the purpose.
  if (parsed.__details && typeof parsed.__details === 'object') {
    for (const [itemId, s] of Object.entries(parsed.__details as Record<string, any>)) {
      const detail = detailOf(s)
      if (!detail) continue
      const label = itemLabelById?.[itemId]
      out.push({ purpose: label ? shortMeetingPurpose(label) : null, detail })
    }
  }
  // __additional: free-form extra spaces, no fixed purpose.
  if (Array.isArray(parsed.__additional)) {
    for (const s of parsed.__additional) {
      const detail = detailOf(s)
      if (detail) out.push({ purpose: null, detail })
    }
  }
  // __named: fixed sub-spaces that carry their own spaceLabel (Meal/Treatment/…).
  if (parsed.__named && typeof parsed.__named === 'object') {
    for (const itemSpaces of Object.values(parsed.__named)) {
      if (!itemSpaces || typeof itemSpaces !== 'object') continue
      for (const s of Object.values(itemSpaces as Record<string, any>)) {
        if (!s || typeof s !== 'object') continue
        const parts: string[] = []
        if (s.name) parts.push(String(s.name))
        if (s.dimensions) parts.push(`Size: ${s.dimensions}`)
        if (!parts.length) continue
        out.push({ purpose: s.spaceLabel ? String(s.spaceLabel) : null, detail: parts.join(' · ') })
      }
    }
  }
  return out
}

export function formatMeetingSpaceNotes(raw: string | null | undefined): string {
  const entries = parseMeetingSpaces(raw)
  if (!entries.length) return ''
  return entries.map((e) => (e.purpose ? `${e.purpose}: ${e.detail}` : e.detail)).join('\n')
}

// Human-readable elapsed duration between two timestamps (or a raw ms span).
// Used by the admin lifecycle Timeline for cycle-time metrics.
// Examples: "3d 4h", "6h", "45m", "under a minute".
export function humanizeDuration(
  from: number | string | Date,
  to?: number | string | Date,
): string {
  const start = from instanceof Date ? from.getTime() : typeof from === 'string' ? new Date(from).getTime() : from
  const end =
    to === undefined
      ? start // single-arg form treats `from` as a raw ms span below
      : to instanceof Date
        ? to.getTime()
        : typeof to === 'string'
          ? new Date(to).getTime()
          : to
  let ms = to === undefined ? (typeof from === 'number' ? from : NaN) : end - start
  if (Number.isNaN(ms)) return '—'
  if (ms < 0) ms = 0

  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'under a minute'
  if (mins < 60) return `${mins}m`

  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return remMins ? `${hours}h ${remMins}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours ? `${days}d ${remHours}h` : `${days}d`
}

// URL-safe random token for a hotel's /rfp/{token} link.
export function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Count trips as the number of VISITS: a trip with a second visit (stay2) counts
// as 2, so a team's "trips" total reflects the real schedule even though same-city
// visits are merged into one trip row. Used everywhere a trip count is shown.
export function countVisits(
  trips: { stay2_arrival_date?: string | null }[] | null | undefined,
): number {
  return (trips ?? []).reduce((n, t) => n + (t.stay2_arrival_date ? 2 : 1), 0)
}

// Display label for a passed invitation: "Passed" when the hotel actually
// submitted a bid we turned down (bad terms / client declined), vs
// "Passed - Not Available" when they never bid (couldn't do the proposed dates).
export function passedLabel(submittedAt: string | null | undefined): string {
  return submittedAt ? 'Passed' : 'Passed - Not Available'
}

// Game time may arrive from an Excel import as a time fraction of a day
// (e.g. 0.79166… = 7:00 PM). Convert those to a readable "h:mm AM/PM"; pass any
// already-formatted string through unchanged.
export function formatGameTime(v: string | null | undefined): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s)
  if (Number.isFinite(n) && n >= 0 && n < 1) {
    const mins = Math.round(n * 24 * 60)
    const h = Math.floor(mins / 60) % 24
    const m = mins % 60
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }
  return s
}
