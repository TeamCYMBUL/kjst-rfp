// Compares a hotel's CURRENT bid against the snapshot of its ORIGINAL submission
// (rfp_invitations.original_bid, captured at first submit) so the grid, web bid
// view, and Word proposal can flag exactly what the hotel changed on a reopened
// update — highlight the field and show the original value ("was $350").
//
// Baseline = the hotel's first submission (per KJST's choice), so changes are
// cumulative: everything different from the original is flagged, across reopens.

export type OriginalBid =
  | {
      captured_at?: string
      backfilled?: boolean
      response?: Record<string, unknown> | null
      answers?: Record<string, { answer_yes_no: boolean | null; answer_value: string | null; comment: string | null }> | null
    }
  | null
  | undefined

// Normalize for comparison so "350" === 350, "" === null, trimmed strings match,
// and booleans compare cleanly. Anything uncomparable falls back to trimmed text.
function norm(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? 'Y' : 'N'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  const s = String(v).trim()
  if (s !== '' && Number.isFinite(Number(s))) return String(Number(s))
  return s
}

const money = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `$${n.toLocaleString()}` : String(v)
}
const plain = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v))
const ynOrVal = (a?: { answer_yes_no: boolean | null; answer_value: string | null } | null): string => {
  if (!a) return '—'
  if (a.answer_yes_no != null) return a.answer_yes_no ? 'Yes' : 'No'
  return a.answer_value != null && a.answer_value !== '' ? String(a.answer_value) : '—'
}

// The hotel's currently-stored bid values, as the exports/views already have them.
export type HotelBidNow = {
  original_bid?: OriginalBid
  best_king_rate?: number | null
  best_suite_rate?: number | null
  stay2_king_rate?: number | null
  stay2_suite_rate?: number | null
  current_selling_rate?: string | null
  occupancy_tax?: string | null
  resort_fee?: string | null
  meeting_space_type?: string | null
  meeting_space_count?: number | null
  general_comments?: string | null
  answers?: Record<string, { answer_yes_no: boolean | null; answer_value: string | null; comment: string | null }>
}

const RESPONSE_FIELDS: { key: string; label: string; money?: boolean }[] = [
  { key: 'best_king_rate', label: 'King rate', money: true },
  { key: 'best_suite_rate', label: 'Suite rate', money: true },
  { key: 'stay2_king_rate', label: 'King rate (Stay 2)', money: true },
  { key: 'stay2_suite_rate', label: 'Suite rate (Stay 2)', money: true },
  { key: 'current_selling_rate', label: 'Selling rate' },
  { key: 'occupancy_tax', label: 'Occupancy tax' },
  { key: 'resort_fee', label: 'Resort fee' },
]

export type BidDiff = {
  hasOriginal: boolean
  changedFields: Set<string> // response field keys that changed (+ 'meeting_space', 'general_comments')
  changedAnswers: Set<string> // concession_item_ids whose answer changed
  summary: string[] // human-readable "King rate $350 → $380", for the Notes column / tooltip
}

const EMPTY: BidDiff = { hasOriginal: false, changedFields: new Set(), changedAnswers: new Set(), summary: [] }

// Compare current hotel bid to its original snapshot. `itemLabel` resolves a
// concession_item_id to its display label for the summary lines.
export function diffBid(h: HotelBidNow, itemLabel: (id: string) => string): BidDiff {
  const orig = h.original_bid
  if (!orig || !orig.response) return EMPTY
  const resp = orig.response
  const changedFields = new Set<string>()
  const changedAnswers = new Set<string>()
  const summary: string[] = []

  for (const f of RESPONSE_FIELDS) {
    if (!(f.key in resp)) continue
    const was = (resp as any)[f.key]
    const now = (h as any)[f.key]
    if (norm(was) !== norm(now)) {
      changedFields.add(f.key)
      const fmt = f.money ? money : plain
      summary.push(`${f.label} ${fmt(was)} → ${fmt(now)}`)
    }
  }

  // Meeting space (type or count) — treated as one field.
  if ('meeting_space_type' in resp || 'meeting_space_count' in resp) {
    const changed =
      norm((resp as any).meeting_space_type) !== norm(h.meeting_space_type) ||
      norm((resp as any).meeting_space_count) !== norm(h.meeting_space_count)
    if (changed) { changedFields.add('meeting_space'); summary.push('Meeting space updated') }
  }

  if ('general_comments' in resp && norm((resp as any).general_comments) !== norm(h.general_comments)) {
    changedFields.add('general_comments')
    summary.push('General comments updated')
  }

  // Concession answers.
  const oAns = orig.answers ?? {}
  for (const [id, o] of Object.entries(oAns)) {
    const cur = h.answers?.[id]
    if (norm(o.answer_yes_no) !== norm(cur?.answer_yes_no) || norm(o.answer_value) !== norm(cur?.answer_value)) {
      changedAnswers.add(id)
      summary.push(`${itemLabel(id)} ${ynOrVal(o)} → ${ynOrVal(cur)}`)
    }
  }

  return { hasOriginal: true, changedFields, changedAnswers, summary }
}
