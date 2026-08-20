// Produces the KJST comparison .xlsx matching their existing sheet layout.
// Columns: row-label | Hotel 1 | Hotel 2 | …
// Rows: trip header, then rates, then all 48 concession items in order.
//
// Also exports a stripped team-facing grid (no commission, no flex cancel, no internal info).

import * as XLSX from 'xlsx'
import type { ConcessionItem } from './rfpApi'
import { formatMeetingSpaceNotes } from './format'

// ── Concession matching (universal, punctuation-insensitive) ───────────────────
// Every team words the comp-suite and suite-upgrade concessions differently:
// "One Bedroom" vs "One-Bedroom", singular/plural, a leading "(1)", "…for VIPs",
// etc. Matching on the raw label with literal spaces silently misses the
// hyphenated teams (Bulls, Pelicans, Magic), so the Comp Suite column read blank
// for them. Normalize the label (letters only, lowercased) and match on that so
// every team resolves the SAME way, everywhere the value is used.
const normLabel = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
const isCompSuiteItem = (label: unknown): boolean => normLabel(label).includes('complimentaryonebedroomsuite')
const isSuiteUpgradeItem = (label: unknown): boolean => normLabel(label).includes('suiteupgrade')

// ── Revenue helpers ───────────────────────────────────────────────────────────

/**
 * Parse a tax string into a percentage rate plus any flat per-room-per-night fee.
 * Hotels enter free text like "15.5%", "15.5", "16.9% + $5 nightly", "$5 nightly".
 * The old parser read only the leading percentage and silently dropped the "+ $5"
 * flat fee, understating the all-in total. Returns { pct: 0.169, flat: 5 }.
 */
export function parseTaxComponents(raw: string | null | undefined): { pct: number; flat: number } {
  if (raw == null) return { pct: 0, flat: 0 }
  const s = raw.trim()
  // Flat dollar add-on, e.g. "$5", "$3.50" — treated as per room, per night.
  const dollarMatch = s.match(/\$\s*(\d+(?:\.\d+)?)/)
  const flatRaw = dollarMatch ? parseFloat(dollarMatch[1]) : 0
  // Percentage: prefer an explicit "%" figure; otherwise a plain leading number
  // (a bare "16" means 16% tax) — but not if the only number was the dollar fee.
  let pctRaw = 0
  const pctMatch = s.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pctMatch) {
    pctRaw = parseFloat(pctMatch[1]) / 100
  } else if (!dollarMatch) {
    const bare = parseFloat(s)
    if (isFinite(bare)) pctRaw = bare / 100
  }
  return {
    pct: isFinite(pctRaw) && pctRaw >= 0 ? pctRaw : 0,
    flat: isFinite(flatRaw) && flatRaw >= 0 ? flatRaw : 0,
  }
}

/** Number of nights between two ISO date strings. Returns 1 if inputs are missing/invalid. */
export function calcNights(arrival: string | null | undefined, departure: string | null | undefined): number {
  if (!arrival || !departure) return 1
  const ms = new Date(departure).getTime() - new Date(arrival).getTime()
  const nights = Math.round(ms / 86_400_000)
  return nights > 0 ? nights : 1
}

export type GridHotel = {
  hotel_name: string
  status: string
  completed_by_name: string | null
  completed_date: string | null
  best_king_rate: number | null
  king_rate_notes: string | null
  current_selling_rate: string | null
  best_suite_rate: number | null
  // Second-visit rates (2-visit trips); null on single-visit trips.
  stay2_king_rate?: number | null
  stay2_suite_rate?: number | null
  occupancy_tax: string | null
  meeting_space_notes: string | null
  general_comments: string | null
  staff_notes: string | null
  answers: Record<
    string,
    { answer_yes_no: boolean | null; answer_value: string | null; comment: string | null }
  >
}

export type GridTrip = {
  opponent_label: string | null
  city: string | null
  arrival_date: string | null
  departure_date: string | null
  game_date: string | null
  game_dates?: string[] | null
  // Second visit (same city twice); null on single-visit trips.
  stay2_arrival_date?: string | null
  stay2_departure_date?: string | null
  stay2_game_date?: string | null
  stay2_game_dates?: string[] | null
  king_rooms_requested: number | null
  suites_requested: number | null
  total_rooms_requested: number | null
  nights?: number | null
  client_name?: string | null
}

function fmt(v: string | null | undefined) {
  return v ?? '—'
}

// Join a list of game dates into one cell value, falling back to the single date.
function joinGameDates(dates: string[] | null | undefined, single: string | null): string | null {
  const list = dates && dates.length ? dates : single ? [single] : []
  return list.length ? list.join(', ') : null
}

function yesNo(v: boolean | null) {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return '—'
}

function answerText(
  item: ConcessionItem,
  answer: GridHotel['answers'][string] | undefined,
): string {
  if (!answer) return '—'
  if (item.answer_type === 'yes_no') {
    const yn = yesNo(answer.answer_yes_no)
    return answer.comment ? `${yn} (${answer.comment})` : yn
  }
  // Currency/percent answers are stored as bare numbers — re-attach $ / % so the
  // exported sheet reads "$6.00" / "10%", matching the on-screen grid.
  const raw = answer.answer_value
  const val =
    !raw
      ? '—'
      : item.answer_type === 'currency'
        ? `$${raw}`
        : item.answer_type === 'percent'
          ? `${raw}%`
          : raw
  return answer.comment ? `${val} (${answer.comment})` : val
}

export function exportComparisonXlsx(
  trip: GridTrip,
  hotels: GridHotel[],
  items: ConcessionItem[],
  filename = 'KJST_RFP_Comparison.xlsx',
) {
  const hotelNames = hotels.map((h) => h.hotel_name)

  // Helper: build one spreadsheet row
  const row = (label: string, values: (string | number | null)[]) =>
    [label, ...values.map((v) => (v == null ? '—' : v))]

  const rows: (string | number | null)[][] = []

  // On a 2-visit trip (same city twice), label the first-visit rows "— STAY 1"
  // and add a matching "— STAY 2" set so both stays land on the grid.
  const twoVisit = Boolean(trip.stay2_arrival_date)
  const s1 = twoVisit ? ' — STAY 1' : ''

  // ── Trip header ──────────────────────────────────────────────────────────
  rows.push(['', ...hotelNames])
  rows.push(row('OPPONENT', hotels.map(() => fmt(trip.opponent_label))))
  rows.push(row(`ARR DATE${s1}`, hotels.map(() => fmt(trip.arrival_date))))
  rows.push(row(`DEP DATE${s1}`, hotels.map(() => fmt(trip.departure_date))))
  rows.push(row(`GAME DATE${s1}`, hotels.map(() => fmt(joinGameDates(trip.game_dates, trip.game_date)))))
  if (twoVisit) {
    rows.push(row('ARR DATE — STAY 2', hotels.map(() => fmt(trip.stay2_arrival_date))))
    rows.push(row('DEP DATE — STAY 2', hotels.map(() => fmt(trip.stay2_departure_date))))
    rows.push(row('GAME DATE — STAY 2', hotels.map(() => fmt(joinGameDates(trip.stay2_game_dates, trip.stay2_game_date ?? null)))))
  }
  rows.push([]) // blank spacer

  // ── Hotel meta ───────────────────────────────────────────────────────────
  rows.push(row('HOTEL NAME', hotels.map((h) => h.hotel_name)))
  rows.push(row('STATUS', hotels.map((h) => h.status.toUpperCase())))
  rows.push(row('COMPLETED BY', hotels.map((h) => fmt(h.completed_by_name))))
  rows.push(row('DATE', hotels.map((h) => fmt(h.completed_date))))
  rows.push([])

  // ── Pre-compute revenue inputs ────────────────────────────────────────────
  // Match the on-screen grid exactly: it costs the FULL room block
  // (total_rooms_requested) over trip.nights, not just the king rooms over a
  // date-derived night count. Fall back sensibly when a field is missing.
  const roomBlock = trip.total_rooms_requested ?? trip.king_rooms_requested ?? 0
  const nights = trip.nights ?? calcNights(trip.arrival_date, trip.departure_date)

  // ── Rates ────────────────────────────────────────────────────────────────
  rows.push(['RATES'])
  rows.push(row(`RATE (Best King)${s1}`, hotels.map((h) => h.best_king_rate ?? '—')))
  rows.push(row('KING RATE NOTES', hotels.map((h) => fmt(h.king_rate_notes))))
  rows.push(row('CURRENT SELLING RATE', hotels.map((h) => fmt(h.current_selling_rate))))
  rows.push(row(`BEST SUITE RATE${s1}`, hotels.map((h) => h.best_suite_rate ?? '—')))
  if (twoVisit) {
    rows.push(row('RATE (Best King) — STAY 2', hotels.map((h) => h.stay2_king_rate ?? '—')))
    rows.push(row('BEST SUITE RATE — STAY 2', hotels.map((h) => h.stay2_suite_rate ?? '—')))
  }
  rows.push(row('TAXES & FEES', hotels.map((h) => fmt(h.occupancy_tax))))

  // Revenue per hotel (numeric where calculable, '—' otherwise). Incl-tax applies
  // the percentage AND any flat per-room-per-night fee the hotel quoted.
  const revenueInclTax = hotels.map((h) => {
    if (h.best_king_rate == null || roomBlock === 0) return '—' as const
    const { pct, flat } = parseTaxComponents(h.occupancy_tax)
    return h.best_king_rate * roomBlock * nights * (1 + pct) + flat * roomBlock * nights
  })
  const revenueExclTax = hotels.map((h) => {
    if (h.best_king_rate == null || roomBlock === 0) return '—' as const
    return h.best_king_rate * roomBlock * nights
  })
  const adr = hotels.map((h) => h.best_king_rate ?? ('—' as const))

  const revenueInclTaxRowIdx = rows.length
  rows.push(row('ROOM REVENUE (INCL. TAX)', revenueInclTax))
  const revenueExclTaxRowIdx = rows.length
  rows.push(row('ROOM REVENUE (EXCL. TAX)', revenueExclTax))
  const adrRowIdx = rows.length
  rows.push(row('ADR (EXCL. TAX)', adr))
  rows.push([])

  // ── Concession items by section ───────────────────────────────────────────
  const sections: Array<{ key: string; label: string }> = [
    { key: 'concessions', label: 'CONCESSIONS & FACILITIES' },
    { key: 'facilities', label: 'FACILITIES' },
    { key: 'in_season_tournament', label: 'IN-SEASON TOURNAMENT GUARANTEE' },
    { key: 'postseason', label: 'POSTSEASON / PLAYOFF GUARANTEE' },
  ]

  for (const { key, label } of sections) {
    const sectionItems = items.filter((i) => i.section === key)
    if (sectionItems.length === 0) continue
    rows.push([label])
    for (const item of sectionItems) {
      rows.push(
        row(
          item.label.length > 80 ? item.label.slice(0, 77) + '…' : item.label,
          hotels.map((h) => answerText(item, h.answers[item.id])),
        ),
      )
    }
    rows.push([])
  }

  // ── Additional info ───────────────────────────────────────────────────────
  rows.push(['ADDITIONAL INFORMATION'])
  rows.push(row('MEETING SPACE NOTES', hotels.map((h) => fmt(formatMeetingSpaceNotes(h.meeting_space_notes) || null))))
  rows.push(row('GENERAL COMMENTS', hotels.map((h) => fmt(h.general_comments))))
  rows.push(row('STAFF NOTES (Team Export)', hotels.map((h) => fmt(h.staff_notes))))
  rows.push([])

  // ── Grand Total row ───────────────────────────────────────────────────────
  const grandTotalValues = hotels.map((h) => {
    if (h.best_king_rate == null || roomBlock === 0) return '—' as const
    const { pct, flat } = parseTaxComponents(h.occupancy_tax)
    return h.best_king_rate * roomBlock * nights * (1 + pct) + flat * roomBlock * nights
  })
  const grandTotalRowIdx = rows.length
  const grandTotalRow = ['GRAND TOTAL', ...grandTotalValues.map((v) => (v === '—' ? '—' : v))]
  rows.push(grandTotalRow)

  // ── Build workbook ───────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Column widths: label col wide, hotel cols medium
  ws['!cols'] = [
    { wch: 55 },
    ...hotels.map(() => ({ wch: 28 })),
  ]

  // ── Cell formatting ───────────────────────────────────────────────────────
  const currencyFmt = '$#,##0.00'

  // Helper: apply format to all hotel value cells in a given row index
  const applyRowFmt = (rowIdx: number, numFmt: string) => {
    for (let c = 1; c <= hotels.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: rowIdx, c })
      if (ws[addr] && typeof ws[addr].v === 'number') {
        ws[addr].t = 'n'
        ws[addr].z = numFmt
      }
    }
  }

  applyRowFmt(revenueInclTaxRowIdx, currencyFmt)
  applyRowFmt(revenueExclTaxRowIdx, currencyFmt)
  applyRowFmt(adrRowIdx, currencyFmt)

  // Grand total row: currency format + bold + thick top border
  for (let c = 0; c <= hotels.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: grandTotalRowIdx, c })
    if (!ws[addr]) ws[addr] = { t: 's', v: '' }
    ws[addr].s = {
      font: { bold: true },
      border: {
        top: { style: 'medium', color: { rgb: '000000' } },
      },
    }
    if (c > 0 && typeof ws[addr].v === 'number') {
      ws[addr].t = 'n'
      ws[addr].z = currencyFmt
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'RFP Comparison')
  XLSX.writeFile(wb, filename)
}

// ─────────────────────────────────────────────────────────────────────────────
// exportTeamGrid — raw-data version of the team export.
// Takes invitations, responses Map, answers Map, and concessionItems directly.
// NEVER includes: commission %, flex cancel details, internal scores.
// Only exports hotels with status 'submitted' or 'awarded'.
// ─────────────────────────────────────────────────────────────────────────────

export function exportTeamGrid(
  trip: {
    city: string | null
    arrival_date: string | null
    departure_date: string | null
    opponent_label: string | null
    clients: { team_name: string } | null
  },
  invitations: Array<{ id: string; hotel_name: string; status: string; staff_notes?: string | null }>,
  responses: Map<string, any>,
  answers: Map<string, any[]>,
  concessionItems: any[],
): void {
  // Find relevant concession item IDs (team-safe ones only)
  const compSuitesItem = concessionItems.find((c: any) => isCompSuiteItem(c.label))
  const suiteUpgItem = concessionItems.find((c: any) => isSuiteUpgradeItem(c.label))
  const playoffItem = concessionItems.find((c: any) => c.section === 'postseason')

  const getAns = (invId: string, itemId: string | undefined) => {
    if (!itemId) return null
    return answers.get(invId)?.find((a: any) => a.concession_item_id === itemId) ?? null
  }

  // Include live bids plus any hotel that actually submitted one before leaving
  // the running (e.g. an award loser now marked 'passed'): their rates still
  // belong in the side-by-side. A response row only exists for a real bid, so
  // decline/pass-without-bid hotels are naturally left out.
  const eligible = invitations.filter(
    (i) => ['submitted', 'awarded'].includes(i.status) || responses.has(i.id),
  )

  const header = [
    'Hotel',
    'King Rate / Night',
    'Resort Fee',
    'Occupancy Tax',
    'Comp Suites (FREE)',
    'Suite Upgrades at King Rate',
    'Playoff / Postseason Clause',
    'Meeting Space',
    'Notes',
  ]

  const rows = eligible.map((inv) => {
    const resp = responses.get(inv.id)
    const compAns = getAns(inv.id, compSuitesItem?.id)
    const upgAns = getAns(inv.id, suiteUpgItem?.id)
    const playoffAns = getAns(inv.id, playoffItem?.id)

    // Meeting space — team-friendly label
    const mtgType = resp?.meeting_space_type as string | null | undefined
    const mtgCount = resp?.meeting_space_count as number | null | undefined
    const mtgLabels: Record<string, string> = {
      function_room: 'Function Room',
      ballroom: 'Ballroom',
      restaurant: 'Restaurant',
      suite_converted: 'Suite (converted)',
      none: 'None',
    }
    const mtgLabel = mtgType ? (mtgLabels[mtgType] ?? mtgType) : (resp ? 'Yes' : '—')
    const mtgDisplay = mtgType && mtgCount != null && mtgCount > 1 ? `${mtgLabel} ×${mtgCount}` : mtgLabel

    // Auto-generate notes (no internal flags)
    const noteFragments: string[] = []
    if (inv.staff_notes?.trim()) noteFragments.push(inv.staff_notes.trim())
    if (mtgType === 'restaurant' || mtgType === 'suite_converted') {
      noteFragments.push('Meeting space is restaurant/F&B — may not qualify')
    }
    // Check for unavailable scenarios
    const scenarioRates = resp?.scenario_rates as Record<string, { rate: number | null; available: boolean }> | null | undefined
    if (scenarioRates) {
      for (const [nights, val] of Object.entries(scenarioRates)) {
        if (val.available === false) noteFragments.push(`Not available for ${nights}-night stay`)
      }
    }

    return [
      inv.hotel_name,
      resp?.best_king_rate != null ? resp.best_king_rate : '—',
      resp?.resort_fee ?? '—',
      resp?.occupancy_tax ?? '—',
      compAns?.answer_value ?? '—',
      upgAns?.answer_value ?? '—',
      playoffAns?.answer_yes_no === true ? 'Yes' : playoffAns?.answer_yes_no === false ? 'No' : '—',
      mtgDisplay,
      noteFragments.join('; '),
    ]
  })

  const teamName = (trip.clients?.team_name ?? 'Team').replace(/\s+/g, '_')
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const filename = `${teamName} ${trip.city ?? 'City'} Proposals ${dateStr}.xlsx`

  const sheetData = [header, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(sheetData)

  ws['!cols'] = [
    { wch: 32 }, // Hotel
    { wch: 16 }, // King Rate
    { wch: 14 }, // Resort Fee
    { wch: 16 }, // Occupancy Tax
    { wch: 20 }, // Comp Suites
    { wch: 28 }, // Suite Upgrades
    { wch: 24 }, // Playoff Clause
    { wch: 24 }, // Meeting Space
    { wch: 44 }, // Notes
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Team Grid')
  XLSX.writeFile(wb, filename)
}

// ─────────────────────────────────────────────────────────────────────────────
// Team-facing stripped export
// Columns: City | Check-in | Check-out | King Rate | Tax | Comp Suites (FREE) |
//          Suite Upgrades at King Rate | Playoff Clause | Notes
// NEVER includes: commission, flex cancel, full concession list, internal scores
// ─────────────────────────────────────────────────────────────────────────────

export type TeamGridHotel = {
  hotel_name: string
  status: string
  best_king_rate: number | null
  occupancy_tax: string | null
  // Suite concession values (pre-extracted from answers)
  comp_suites: string | null        // free suites quantity
  suite_upgrades: string | null     // suite upgrades at king rate quantity
  playoff_clause: boolean | null    // postseason clause answer
  notes: string | null              // only exceptions (entered manually or auto-detected)
}

export type TeamGridTrip = {
  city: string | null
  arrival_date: string | null
  departure_date: string | null
  client_name: string | null
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${m}/${day}/${y}`
}

export function exportTeamGridXlsx(
  trip: TeamGridTrip,
  hotels: TeamGridHotel[],
  filename?: string,
) {
  const clientStr = (trip.client_name ?? 'Team').replace(/\s+/g, '_')
  const cityStr = (trip.city ?? 'City').replace(/\s+/g, '_')
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const outputFile = filename ?? `${clientStr}_${cityStr}_Grid_Updated_${dateStr}.xlsx`

  // Only include hotels that have submitted (no pending/declined)
  const eligible = hotels.filter((h) => ['submitted', 'awarded'].includes(h.status))

  const header = [
    'Hotel',
    'Check-in',
    'Check-out',
    'King Rate',
    'Taxes & Fees',
    'Comp Suites (FREE)',
    'Suite Upgrades at King Rate',
    'Playoff Clause',
    'Notes',
  ]

  const rows = eligible.map((h) => [
    h.hotel_name,
    fmtDate(trip.arrival_date),
    fmtDate(trip.departure_date),
    h.best_king_rate != null ? h.best_king_rate : '—',
    fmt(h.occupancy_tax),
    h.comp_suites ?? '—',
    h.suite_upgrades ?? '—',
    h.playoff_clause === true ? 'Yes' : h.playoff_clause === false ? 'No' : '—',
    h.notes ?? '',
  ])

  const sheetData = [header, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(sheetData)

  // Column widths
  ws['!cols'] = [
    { wch: 30 }, // Hotel
    { wch: 12 }, // Check-in
    { wch: 12 }, // Check-out
    { wch: 12 }, // King Rate
    { wch: 16 }, // Taxes
    { wch: 20 }, // Comp Suites
    { wch: 28 }, // Suite Upgrades
    { wch: 14 }, // Playoff
    { wch: 40 }, // Notes
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Team Grid')
  XLSX.writeFile(wb, outputFile)
}

// ─────────────────────────────────────────────────────────────────────────────
// exportMultiCityConsolidatedXlsx
// One sheet: all cities stacked vertically, hotels as rows, attributes as columns.
// This is the final grid KJST sends to the client — no commission, no flex cancel.
// ─────────────────────────────────────────────────────────────────────────────

export type ConsolidatedHotel = {
  hotel_name: string
  status: string
  staff_notes: string | null
  // Per-stay award flags — a two-visit trip can award a different hotel per stay.
  awarded_stay1?: boolean
  awarded_stay2?: boolean
  // Per-visit availability — a hotel can be sold out for one visit but not the other
  visit1_declined: boolean
  visit1_decline_reason: string | null
  visit2_declined: boolean
  visit2_decline_reason: string | null
  best_king_rate: number | null
  best_suite_rate: number | null
  current_selling_rate: string | null
  occupancy_tax: string | null
  resort_fee: string | null
  standard_checkin_time: string | null
  // Second-visit rates (when the trip covers two stays)
  stay2_king_rate: number | null
  stay2_suite_rate: number | null
  general_comments: string | null
  meeting_space_type: string | null
  meeting_space_count: number | null
  answers: Record<string, { answer_yes_no: boolean | null; answer_value: string | null; comment: string | null }>
}

export type ConsolidatedCity = {
  trip: {
    city: string | null
    opponent_label: string | null
    arrival_date: string | null
    departure_date: string | null
    game_date: string | null
    game_dates?: string[] | null
    total_rooms_requested?: number | null
    king_rooms_requested?: number | null
    suites_requested?: number | null
    fnb_plan?: Record<string, number> | null
    stay2_arrival_date?: string | null
    stay2_departure_date?: string | null
    stay2_game_dates?: string[] | null
    stay2_game_date?: string | null
  }
  hotels: ConsolidatedHotel[]
  items: ConcessionItem[]
}

// ── Per-team grid columns ──────────────────────────────────────────────────
// A client can define extra client-facing grid columns, each EXPLICITLY bound
// to a data source (never guessed by label). Two kinds:
//   • system  — a named structured field/computed value (rate, taxes, counts…)
//   • item    — a specific concession item, referenced by its id
// Stored on clients.grid_columns (jsonb) and rendered in order after the base
// columns. This is what makes the grid non-fuzzy: the binding is an id/key.
export type GridSystemKey =
  | 'taxes_fees'
  | 'tax_pct'
  | 'total_per_night'
  | 'revenue_per_night'
  | 'revenue_all_nights'
  | 'est_total_cost'
  | 'avg_rate'
  | 'suite_rate'
  | 'kings_suites'
  | 'total_rooms'
  | 'in_season'
  | 'postseason'
  | 'check_in_time'
  | 'forecasted_room_total'
  | 'forecasted_fnb'
  | 'total_est_rooms_fnb'
// Base (built-in) columns can be placed anywhere in a full custom layout.
export type GridBaseKey =
  | 'num' | 'stay' | 'city' | 'game_date' | 'ci' | 'co' | 'nts'
  | 'hotel' | 'rate' | 'comp_suite' | 'suite_ug' | 'postseason' | 'notes'
export type GridColumnSpec =
  | { type: 'base'; key: GridBaseKey; label: string; width?: number }
  | { type: 'system'; key: GridSystemKey; label: string; width?: number }
  | { type: 'item'; item_id: string; label: string; format?: 'yesno' | 'value' | 'currency' | 'party'; width?: number }

// Fetch a client logo and return an ExcelJS-embeddable buffer + extension.
// Returns null on any failure (missing/SVG/unsupported/CORS) so the export
// falls back to a text-only branded header instead of breaking.
export async function loadLogoForExcel(
  url: string,
): Promise<{ buffer: Uint8Array; extension: 'png' | 'jpeg' | 'gif' } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    const urlExt = url.split('.').pop()?.toLowerCase() ?? ''
    let extension: 'png' | 'jpeg' | 'gif' | null = null
    if (ct.includes('png') || urlExt === 'png') extension = 'png'
    else if (ct.includes('jpeg') || ct.includes('jpg') || urlExt === 'jpg' || urlExt === 'jpeg') extension = 'jpeg'
    else if (ct.includes('gif') || urlExt === 'gif') extension = 'gif'
    if (!extension) return null // svg/webp/unknown → text-only fallback
    const buf = await res.arrayBuffer()
    return { buffer: new Uint8Array(buf), extension }
  } catch {
    return null
  }
}

// Client-facing "Hotel Options" grid — a branded, editable .xlsx matching KJST's
// season grid: alpha by city, one row per hotel offer, Stay 1/Stay 2 blocks,
// sold-out hotels kept but red-struck. Uses ExcelJS (dynamic import) for cell
// styling + an embedded client logo, which the community `xlsx` build cannot do.
export type ConsolidatedOpts = {
  logoUrl?: string | null
  season?: string | null
  filename?: string
  gridColumns?: GridColumnSpec[]
  gridLayout?: GridColumnSpec[] // full column order (base + custom); overrides the default layout
  fnbHeadcount?: number | null
}

// Builds the workbook (no download) so it can be exercised in tests. The public
// exportMultiCityConsolidatedXlsx wraps this and triggers the browser download.
export async function buildConsolidatedWorkbook(
  cities: ConsolidatedCity[],
  clientName: string,
  opts: ConsolidatedOpts = {},
): Promise<{ wb: any; outputFile: string }> {
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod

  const DARK = 'FF1C1008'
  const HEADER_FILL = 'FFEDE9E4'
  const RED = 'FFFF0000'

  const gridCols = opts.gridColumns ?? []
  const fnbHeadcount = Number(opts.fnbHeadcount) || 0 // client-level F&B headcount

  // Built-in (base) column defaults.
  const BASE_DEF: Record<GridBaseKey, { label: string; width: number }> = {
    num: { label: '#', width: 4 },
    stay: { label: 'Stay', width: 7 },
    city: { label: 'City', width: 15 },
    game_date: { label: 'Game Date', width: 11 },
    ci: { label: 'C/I', width: 10 },
    co: { label: 'C/O', width: 10 },
    nts: { label: 'Nts', width: 5 },
    hotel: { label: 'Hotel Choices', width: 30 },
    rate: { label: 'Rate', width: 9 },
    comp_suite: { label: 'Comp Suite', width: 9 },
    suite_ug: { label: 'Suite UG', width: 9 },
    postseason: { label: 'Postseason Guaranteed', width: 14 },
    notes: { label: 'Notes', width: 55 },
  }
  const baseSpec = (key: GridBaseKey): GridColumnSpec => ({ type: 'base', key, label: BASE_DEF[key].label, width: BASE_DEF[key].width })

  // Full ordered column list. A client can supply an explicit `gridLayout`
  // (base + custom columns in any order); otherwise the default is base columns
  // → the per-team custom columns → Notes last.
  const layoutSpecs: GridColumnSpec[] = opts.gridLayout?.length
    ? opts.gridLayout
    : [
        baseSpec('num'), baseSpec('stay'), baseSpec('city'), baseSpec('game_date'),
        baseSpec('ci'), baseSpec('co'), baseSpec('nts'), baseSpec('hotel'),
        baseSpec('rate'), baseSpec('comp_suite'), baseSpec('suite_ug'), baseSpec('postseason'),
        ...gridCols,
        baseSpec('notes'),
      ]

  // Per-column presentation derived from the spec.
  const specIsCurrency = (s: GridColumnSpec): boolean =>
    s.type === 'item' ? (s.format === 'currency' || s.format === 'party')
      : s.type === 'system' ? ['taxes_fees', 'total_per_night', 'revenue_per_night', 'revenue_all_nights',
          'est_total_cost', 'avg_rate', 'suite_rate',
          'forecasted_room_total', 'forecasted_fnb', 'total_est_rooms_fnb'].includes(s.key)
      : s.type === 'base' && s.key === 'rate'
  const specNumFmt = (s: GridColumnSpec): string | undefined =>
    s.type === 'base' && (s.key === 'game_date' || s.key === 'ci' || s.key === 'co') ? 'm/d/yy'
      : s.type === 'system' && s.key === 'tax_pct' ? '0.#"%"'
      : specIsCurrency(s) ? '$#,##0' : undefined
  const specCenter = (s: GridColumnSpec): boolean =>
    s.type === 'base' ? !(s.key === 'city' || s.key === 'hotel' || s.key === 'notes') : true
  const specWrap = (s: GridColumnSpec): boolean => s.type === 'base' && s.key === 'notes'

  const COLS = layoutSpecs.map((s) => ({
    header: s.label,
    width: (s as any).width ?? (s.type === 'base' ? BASE_DEF[s.key].width : 12),
  }))
  const NCOL = COLS.length

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Hotel Options', {
    views: [{ state: 'frozen', ySplit: 4 }], // keep branding + header on screen
  })
  ws.columns = COLS.map((c) => ({ width: c.width }))

  // ── Branding band (rows 1-2) ──
  const seasonLabel = opts.season ? String(opts.season) : ''
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= NCOL; c++) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
    }
  }
  ws.mergeCells(1, 1, 1, NCOL)
  ws.mergeCells(2, 1, 2, NCOL)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = clientName + (seasonLabel ? `  —  ${seasonLabel}` : '')
  titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  const subCell = ws.getCell(2, 1)
  subCell.value = `Hotel Options  ·  Prepared by KJ Sports Travel  ·  ${dateStr}`
  subCell.font = { name: 'Arial', size: 9, color: { argb: 'FFD6C6B8' } }
  subCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 46
  ws.getRow(2).height = 18

  // Embed client logo (best-effort; text-only fallback on any failure)
  const logo = opts.logoUrl ? await loadLogoForExcel(opts.logoUrl) : null
  if (logo) {
    const imgId = wb.addImage({ buffer: logo.buffer, extension: logo.extension })
    // Square box so team crests (usually 1:1) aren't stretched into a wide oval.
    ws.addImage(imgId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 52, height: 52 } })
  }

  // ── Column header row (row 4; row 3 is a thin spacer) ──
  ws.getRow(3).height = 6
  const headerRow = ws.getRow(4)
  COLS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: DARK } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBBB2A8' } } }
  })
  headerRow.height = 30
  // NOTE: we deliberately do NOT attach an ExcelJS cell comment (.note) here.
  // A cell comment plus the embedded logo image in the same sheet makes ExcelJS
  // emit conflicting drawing parts, which Excel then flags as corrupt and
  // "repairs" (dropping cell content, incl. check-in). Any column guidance stays
  // in the on-screen UI, not as a spreadsheet comment.

  const REASON_LABELS: Record<string, string> = {
    sold_out: 'Sold out / no availability',
    insufficient_rooms: 'Insufficient rooms available',
    rate_conflict: 'Rate restrictions in effect',
    no_suites: 'Unable to accommodate suites',
    not_competing: 'Chose not to compete',
    other: 'Not available',
  }
  const toDate = (iso: string | null | undefined): Date | null => {
    if (!iso) return null
    const [y, m, d] = iso.split('-').map(Number)
    // Local noon so the serialized date never shifts a day across timezones.
    return y && m && d ? new Date(y, m - 1, d, 12) : null
  }
  // ── Custom grid column plumbing ──
  const firstNum = (s: any): number | null => {
    const m = String(s ?? '').match(/[\d,]+(\.\d+)?/)
    return m ? parseFloat(m[0].replace(/,/g, '')) : null
  }
  // Best-effort parse of the free-text tax/fee fields into a % and a $/night fee.
  // Rules chosen to be MORE accurate without ever guessing wildly high:
  //  • Tax %: sum the %-tagged numbers only when joined by "+" (clear additive
  //    intent, e.g. "15.7% + 2.3%"); otherwise take the first % (so "18% (15.7%
  //    & 2.3%)" stays 18, not 36). Bare number with no % or $ = a percent.
  //  • Fees: pull any "$N" embedded in the tax field, plus the resort fee —
  //    but a resort fee that says waived / n/a / none / optional counts as $0
  //    (fixes phantom fees like "Waived (normally $45)").
  const parseTaxFee = (occText: any, feeText: any): { pct: number; fee: number } => {
    const occ = String(occText ?? '')
    const pcts = [...occ.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]))
    let pct = 0
    if (pcts.length) pct = occ.includes('+') ? pcts.reduce((a, b) => a + b, 0) : pcts[0]
    else if (!occ.includes('$')) pct = firstNum(occ) ?? 0 // bare number = percent
    const embeddedFee = [...occ.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)]
      .map((m) => parseFloat(m[1])).reduce((a, b) => a + b, 0)
    const feeStr = String(feeText ?? '')
    const waived = /waiv|n\/?a|none|no\s*(resort|fee)|opt.?out|optional/i.test(feeStr)
    const resortFee = waived ? 0 : firstNum(feeStr) ?? 0
    return { pct, fee: embeddedFee + resortFee }
  }
  // Estimated room-block cost for a stay, incl. taxes/fees, tiered by room type:
  //   • comped suites            → free (removed)
  //   • suite upgrades + kings   → King rate
  //   • any remaining suites     → Additional Suite rate
  // Falls back to the simple all-at-King estimate when the trip's room counts
  // don't reconcile (kings + suites ≠ total) or a needed suite rate is missing,
  // so a bad room-count entry never produces a confidently-wrong total.
  const roomBlockTotal = (p: {
    kingRate: number | null; suiteRate: number | null; tax: number | null; fee: number | null
    nights: number; totalRooms: number | null; kingsReq: number | null; suitesReq: number | null
    comp: number; upgrades: number
  }): number | null => {
    if (p.kingRate == null) return null
    const withTax = (rate: number) => rate * (1 + (p.tax ?? 0) / 100) + (p.fee ?? 0)
    const kingNight = withTax(p.kingRate)
    const suiteNight = p.suiteRate != null ? withTax(p.suiteRate) : null
    const comp = Number.isFinite(p.comp) ? Math.max(0, p.comp) : 0
    const reconciles =
      p.kingsReq != null && p.suitesReq != null && p.totalRooms != null &&
      p.kingsReq + p.suitesReq === p.totalRooms
    if (reconciles) {
      const availSuites = Math.max(0, p.suitesReq! - comp) // suites left after comps
      const upg = Math.min(Math.max(0, p.upgrades), availSuites) // upgrades ⊆ paid suites
      const overflow = availSuites - upg // suites billed at the suite rate
      if (overflow > 0 && suiteNight == null) {
        // No suite rate to price overflow suites → safe fallback (all at King).
        const paid = Math.max(0, p.totalRooms! - comp)
        return Math.round(kingNight * paid * p.nights)
      }
      const kingUnits = p.kingsReq! + upg // kings + suite-upgrades, both at King rate
      return Math.round((kingUnits * kingNight + overflow * (suiteNight ?? 0)) * p.nights)
    }
    // Fallback: counts don't reconcile → all paid rooms at the King rate.
    if (p.totalRooms == null) return null
    const paid = Math.max(0, p.totalRooms - comp)
    return Math.round(kingNight * paid * p.nights)
  }
  const asYesNo = (a?: { answer_yes_no: boolean | null }) =>
    a?.answer_yes_no === true ? 'Yes' : a?.answer_yes_no === false ? 'No' : ''
  // Resolve one custom column's value for a given hotel row. Every branch is an
  // explicit binding — a named field/computation or a specific concession item.
  const gridColValue = (
    gc: GridColumnSpec,
    h: ConsolidatedHotel,
    visitIndex: 1 | 2,
    kingRate: number | null,
    nights: number,
    trip: ConsolidatedCity['trip'],
    items: ConcessionItem[],
    headcount: number,
  ): string | number | null => {
    if (gc.type === 'item') {
      const a = h.answers[gc.item_id]
      if (!a) return ''
      if (gc.format === 'currency') return firstNum(a.answer_value)
      // Party cost = headcount × the hotel's per-person price (one serving for
      // the whole travelling party). Manager multiplies by # of meals at the end.
      if (gc.format === 'party') {
        const p = firstNum(a.answer_value)
        return p != null && headcount > 0 ? Math.round(p * headcount) : null
      }
      if (gc.format === 'value') return a.answer_value ?? asYesNo(a)
      return asYesNo(a)
    }
    const { pct: tax, fee } = parseTaxFee(h.occupancy_tax, h.resort_fee)
    const suite = visitIndex === 1 ? h.best_suite_rate : h.stay2_suite_rate
    // Taxes & fees as a per-room DOLLAR amount (KJST-standard grid: rate × tax% + fee)
    const taxesFeesAmt = kingRate != null ? kingRate * (tax ?? 0) / 100 + (fee ?? 0) : null
    const perNight = kingRate != null ? kingRate + (taxesFeesAmt ?? 0) : null
    // Paid rooms exclude complimentary suites (they carry no room revenue).
    const compItem = items.find((i) => isCompSuiteItem(i.label))
    const compAns = compItem ? h.answers[compItem.id] : undefined
    const compSuites = compAns?.answer_value ? Number(compAns.answer_value) : compAns?.answer_yes_no === true ? 1 : 0
    const upgItem = items.find((i) => isSuiteUpgradeItem(i.label))
    const upgAns = upgItem ? h.answers[upgItem.id] : undefined
    const suiteUpgrades = upgAns?.answer_value ? Number(upgAns.answer_value) : 0
    const totalRooms = trip.total_rooms_requested ?? null
    // ONE room-cost formula (roomBlockTotal) governs every team so the math is
    // identical across the board: comped suites free, suite upgrades + kings at
    // the King rate, any remaining suites at the Additional Suite rate, incl
    // taxes/fees. Est. Total Cost, Forecasted Room Total, and the per-night /
    // all-nights revenue columns ALL resolve through it — no team diverges.
    const blockParams = {
      kingRate, suiteRate: suite, tax, fee, totalRooms,
      kingsReq: trip.king_rooms_requested ?? null, suitesReq: trip.suites_requested ?? null,
      comp: compSuites, upgrades: suiteUpgrades,
    }
    const roomTotal = roomBlockTotal({ ...blockParams, nights })
    const roomPerNight = roomBlockTotal({ ...blockParams, nights: 1 })
    // Forecasted F&B = headcount × Σ (hotel's per-person price for each meal-price
    // column this client shows). One round for the whole party — no meal counts;
    // the travel manager multiplies by the number of meals at the end.
    let fnbTotal: number | null = null
    if (headcount > 0) {
      let sum = 0, any = false
      for (const g of gridCols) {
        if (g.type === 'item' && /breakfast|lunch|brunch|dinner/i.test(g.label)) {
          const price = firstNum(h.answers[g.item_id]?.answer_value)
          if (price != null) { sum += price; any = true }
        }
      }
      fnbTotal = any ? sum * headcount : null
    }
    switch (gc.key) {
      case 'taxes_fees':
        return taxesFeesAmt != null ? Math.round(taxesFeesAmt) : null
      case 'tax_pct':
        // The occupancy-tax percentage the hotel quoted (fees are shown separately).
        return tax != null && tax > 0 ? tax : null
      case 'total_per_night':
        return perNight != null ? Math.round(perNight) : null
      case 'revenue_per_night':
        // Block room revenue for ONE night — same tiered comp/upgrade formula as
        // Est. Total Cost, so every team's math is identical.
        return roomPerNight
      case 'revenue_all_nights':
        // Same block revenue across all nights (=== Est. Total Cost numerically).
        return roomTotal
      case 'forecasted_room_total':
      case 'est_total_cost':
        // Tiered block estimate (see roomBlockTotal): comped suites free,
        // upgrades + kings at King rate, overflow suites at the Suite rate.
        // F&B is handled separately (party-cost columns), not folded in here.
        return roomTotal
      case 'forecasted_fnb':
        return fnbTotal != null ? Math.round(fnbTotal) : null
      case 'total_est_rooms_fnb':
        return roomTotal != null || fnbTotal != null ? Math.round((roomTotal ?? 0) + (fnbTotal ?? 0)) : null
      case 'avg_rate': {
        // Blended effective rate per room (KJST house formula): comped suites are
        // free, so King rate × paid rooms ÷ total rooms. Falls back to King rate.
        if (kingRate == null) return null
        if (totalRooms && totalRooms > 0) {
          const paid = Math.max(0, totalRooms - (Number.isFinite(compSuites) ? compSuites : 0))
          return Math.round((kingRate * paid) / totalRooms)
        }
        return Math.round(kingRate)
      }
      case 'suite_rate':
        return suite != null ? suite : null
      case 'check_in_time': {
        // Prefer the dedicated system field, but fall back to a "standard
        // check-in time" concession item's answer — most templates capture
        // check-in as a text item rather than the system field, so without this
        // the column reads blank even though hotels answered it.
        if (h.standard_checkin_time) return h.standard_checkin_time
        const ciItem = items.find((it) => {
          const l = it.label.toLowerCase()
          return l.includes('check-in time') || l.includes('check in time')
        })
        const ans = ciItem ? h.answers[ciItem.id] : undefined
        return ans?.answer_value ?? ''
      }
      case 'kings_suites':
        return `${trip.king_rooms_requested ?? '-'} / ${trip.suites_requested ?? '-'}`
      case 'total_rooms':
        return trip.total_rooms_requested ?? null
      case 'in_season': {
        const it = items.find(
          (i) => i.section === 'in_season_tournament' ||
            i.label.toLowerCase().includes('in-season') || i.label.toLowerCase().includes('in season'),
        )
        return it ? asYesNo(h.answers[it.id]) : ''
      }
      case 'postseason': {
        const it = items.find(
          (i) => i.section === 'postseason' ||
            (i.label.toLowerCase().includes('post') && i.label.toLowerCase().includes('season')),
        )
        return it ? asYesNo(h.answers[it.id]) : ''
      }
    }
    return ''
  }

  let rowIdx = 4
  let counter = 0
  // Each trip is boxed as its own little table: an outline around the block, no
  // interior gridlines. Awarded hotels are shaded green.
  const OUTLINE = { style: 'medium' as const, color: { argb: 'FF9C8F80' } }
  const AWARD_FILL = 'FFD8F3E3'
  const AWARD_TEXT = 'FF166534'
  let firstTrip = true

  for (const { trip, hotels, items } of cities) {
    // Thin spacer row between trips so each reads as a distinct table.
    if (!firstTrip) { rowIdx += 1; ws.getRow(rowIdx).height = 6 }
    firstTrip = false
    const tripStartRow = rowIdx + 1

    const compSuitesItem = items.find((i) => isCompSuiteItem(i.label))
    const suiteUpgItem = items.find((i) => isSuiteUpgradeItem(i.label))
    const playoffItem = items.find(
      (i) => i.section === 'postseason' || (i.label.toLowerCase().includes('post') && i.label.toLowerCase().includes('season')),
    )
    const cityName = (trip.city ?? trip.opponent_label ?? 'City').toUpperCase()

    type Visit = { index: 1 | 2; arr: string | null; dep: string | null; games: string[]; kingKey: keyof ConsolidatedHotel }
    const visits: Visit[] = [
      {
        index: 1, arr: trip.arrival_date, dep: trip.departure_date,
        games: trip.game_dates?.length ? trip.game_dates : trip.game_date ? [trip.game_date] : [],
        kingKey: 'best_king_rate',
      },
    ]
    if (trip.stay2_arrival_date) {
      visits.push({
        index: 2, arr: trip.stay2_arrival_date, dep: trip.stay2_departure_date ?? null,
        games: trip.stay2_game_dates?.length ? trip.stay2_game_dates : trip.stay2_game_date ? [trip.stay2_game_date] : [],
        kingKey: 'stay2_king_rate',
      })
    }

    for (const visit of visits) {
      const nights = calcNights(visit.arr, visit.dep)
      const gameDates = visit.games.map((g) => toDate(g)).filter(Boolean) as Date[]
      const gameCell: string | Date | null =
        gameDates.length > 1 ? gameDates.map((g) => `${g.getMonth() + 1}/${g.getDate()}`).join(', ') : gameDates[0] ?? null
      const stayLabel = visits.length > 1 ? `Stay ${visit.index}` : 'Stay 1'

      const soldOut = (h: ConsolidatedHotel): boolean =>
        ['declined', 'unavailable', 'passed'].includes(h.status) || (visit.index === 1 ? h.visit1_declined : h.visit2_declined)
      const isBid = (h: ConsolidatedHotel) => ['submitted', 'awarded'].includes(h.status)
      const rank = (h: ConsolidatedHotel) => (soldOut(h) ? 2 : isBid(h) ? 0 : 1)
      const ordered = [...hotels].sort((a, b) => rank(a) - rank(b))

      let first = true
      for (const h of ordered) {
        counter += 1
        rowIdx += 1
        const struck = soldOut(h)
        const bid = isBid(h) && !struck
        const row = ws.getRow(rowIdx)

        const kingRate = (h as any)[visit.kingKey] as number | null
        const compAns = compSuitesItem ? h.answers[compSuitesItem.id] : undefined
        const upgAns = suiteUpgItem ? h.answers[suiteUpgItem.id] : undefined
        const playoffAns = playoffItem ? h.answers[playoffItem.id] : undefined
        const compSuites = compAns?.answer_value ? Number(compAns.answer_value) : compAns?.answer_yes_no === true ? 1 : 0
        const suiteUg = upgAns?.answer_value ? Number(upgAns.answer_value) : null
        const postGte = playoffAns?.answer_yes_no === true ? 'YES' : playoffAns?.answer_yes_no === false ? 'NO' : ''

        const reason = visit.index === 1 ? h.visit1_decline_reason : h.visit2_decline_reason
        // Awarded per stay: mark AWARDED only on the visit this hotel actually won.
        const wonThisVisit = visit.index === 1 ? !!h.awarded_stay1 : !!h.awarded_stay2
        const noteFrags: string[] = []
        if (wonThisVisit) noteFrags.push('AWARDED')
        if (struck) noteFrags.push(reason ? REASON_LABELS[reason] ?? 'Not available' : 'Not available')
        if (h.staff_notes) noteFrags.push(h.staff_notes)
        if (h.general_comments) noteFrags.push(h.general_comments)

        // One value per column, in the configured layout order.
        const baseCellValue = (key: GridBaseKey): string | number | Date | null => {
          switch (key) {
            case 'num': return counter
            case 'stay': return first ? stayLabel : ''
            case 'city': return first ? cityName : ''
            case 'game_date': return gameCell
            case 'ci': return toDate(visit.arr)
            case 'co': return toDate(visit.dep)
            case 'nts': return nights
            case 'hotel': return h.hotel_name.replace(/\n/g, ' ').trim()
            case 'rate': return bid ? kingRate ?? null : null
            case 'comp_suite': return bid && Number.isFinite(compSuites) && compSuites > 0 ? compSuites : null
            case 'suite_ug': return bid && suiteUg != null && Number.isFinite(suiteUg) ? suiteUg : null
            case 'postseason': return bid ? postGte : ''
            case 'notes': return noteFrags.join('\n')
          }
        }
        const vals = layoutSpecs.map((s) =>
          s.type === 'base'
            ? baseCellValue(s.key)
            : bid ? gridColValue(s, h, visit.index, kingRate, nights, trip, items, fnbHeadcount) : null,
        )
        first = false

        const awardedRow = wonThisVisit && !struck
        vals.forEach((v, i) => {
          const spec = layoutSpecs[i]
          const cell = row.getCell(i + 1)
          cell.value = v as any
          cell.font = struck
            ? { name: 'Arial', size: 10, color: { argb: RED }, strike: true }
            : awardedRow
              ? { name: 'Arial', size: 10, bold: true, color: { argb: AWARD_TEXT } }
              : { name: 'Arial', size: 10 }
          if (awardedRow) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AWARD_FILL } }
          }
          cell.alignment = { vertical: 'top', wrapText: specWrap(spec), horizontal: specCenter(spec) ? 'center' : 'left' }
          const nf = specNumFmt(spec)
          if (nf) cell.numFmt = nf
        })
      }
    }

    // Box this trip: outline only (top/bottom on the block ends, left/right on
    // the outer columns), leaving interior gridlines off.
    const tripEndRow = rowIdx
    for (let r = tripStartRow; r <= tripEndRow; r++) {
      for (let c = 1; c <= NCOL; c++) {
        const edge: any = {}
        if (r === tripStartRow) edge.top = OUTLINE
        if (r === tripEndRow) edge.bottom = OUTLINE
        if (c === 1) edge.left = OUTLINE
        if (c === NCOL) edge.right = OUTLINE
        if (edge.top || edge.bottom || edge.left || edge.right) ws.getCell(r, c).border = edge
      }
    }
  }

  const clientStr = clientName.replace(/\s+/g, '_')
  const fileDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const outputFile = opts.filename ?? `${clientStr}_Hotel_Options_${fileDate}.xlsx`
  return { wb, outputFile }
}

// Public entry: build the workbook, then download it in the browser.
export async function exportMultiCityConsolidatedXlsx(
  cities: ConsolidatedCity[],
  clientName: string,
  opts: ConsolidatedOpts = {},
): Promise<void> {
  const { wb, outputFile } = await buildConsolidatedWorkbook(cities, clientName, opts)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = outputFile
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────────────────────────
// exportSingleHotelXlsx — one hotel's full bid in a vertical label/value layout
// ─────────────────────────────────────────────────────────────────────────────

// ── All-trips list export ──────────────────────────────────────────────────────
// A flat, one-row-per-trip spreadsheet of every trip's in/out dates so staff can
// confirm the portal has the latest schedule without opening each trip. Pure:
// the caller fetches and shapes the rows.
export type TripListRow = {
  team: string
  opponent: string
  city: string
  stay1_in: string
  stay1_out: string
  stay2_in: string
  stay2_out: string
  nights: string | number
  game_dates: string
  deadline: string
  status: string
  total_rooms: string | number
}

export function exportTripsListXlsx(rows: TripListRow[], filename = 'KJST_All_Trips.xlsx'): void {
  const header = [
    'Team', 'Opponent', 'City',
    'Stay 1 In', 'Stay 1 Out', 'Stay 2 In', 'Stay 2 Out',
    'Nights', 'Game Date(s)', 'Response Deadline', 'Status', 'Total Rooms',
  ]
  const aoa: (string | number)[][] = [header]
  for (const r of rows) {
    aoa.push([
      r.team, r.opponent, r.city,
      r.stay1_in, r.stay1_out, r.stay2_in, r.stay2_out,
      r.nights, r.game_dates, r.deadline, r.status, r.total_rooms,
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 22 }, { wch: 22 }, { wch: 18 },
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
    { wch: 8 }, { wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
  ]
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'All Trips')
  XLSX.writeFile(wb, filename)
}

export function exportSingleHotelXlsx(
  hotel: GridHotel,
  trip: GridTrip,
  items: ConcessionItem[],
): void {
  const row2 = (label: string, value: string | number | null) =>
    [label, value == null ? '—' : value]

  const rows: (string | number | null)[][] = []

  // Trip header
  rows.push(['TRIP'])
  rows.push(row2('Client', trip.client_name ?? '—'))
  rows.push(row2('Opponent', trip.opponent_label))
  rows.push(row2('City', trip.city))
  rows.push(row2('Arrival', trip.arrival_date))
  rows.push(row2('Departure', trip.departure_date))
  rows.push(row2('Game date', joinGameDates(trip.game_dates, trip.game_date)))
  rows.push(row2('Kings requested', trip.king_rooms_requested))
  rows.push(row2('Suites requested', trip.suites_requested))
  rows.push(row2('Total rooms', trip.total_rooms_requested))
  rows.push([])

  // Hotel info
  rows.push(['HOTEL'])
  rows.push(row2('Hotel name', hotel.hotel_name))
  rows.push(row2('Status', hotel.status.toUpperCase()))
  rows.push(row2('Completed by', hotel.completed_by_name))
  rows.push(row2('Completed date', hotel.completed_date))
  rows.push([])

  // Rates
  rows.push(['RATES'])
  rows.push(row2('Best king rate', hotel.best_king_rate))
  rows.push(row2('King rate notes', hotel.king_rate_notes))
  rows.push(row2('Current selling rate', hotel.current_selling_rate))
  rows.push(row2('Best suite rate', hotel.best_suite_rate))
  rows.push(row2('Occupancy tax', hotel.occupancy_tax))
  rows.push([])

  // Concession items by section
  const sections: Array<{ key: string; label: string }> = [
    { key: 'concessions', label: 'CONCESSIONS & FACILITIES' },
    { key: 'facilities', label: 'FACILITIES' },
    { key: 'in_season_tournament', label: 'IN-SEASON TOURNAMENT GUARANTEE' },
    { key: 'postseason', label: 'POSTSEASON / PLAYOFF GUARANTEE' },
  ]

  for (const { key, label } of sections) {
    const sectionItems = items.filter((i) => i.section === key)
    if (sectionItems.length === 0) continue
    rows.push([label])
    for (const item of sectionItems) {
      rows.push(row2(
        item.label.length > 80 ? item.label.slice(0, 77) + '…' : item.label,
        answerText(item, hotel.answers[item.id]),
      ))
    }
    rows.push([])
  }

  // Notes
  rows.push(['ADDITIONAL NOTES'])
  rows.push(row2('Meeting space', formatMeetingSpaceNotes(hotel.meeting_space_notes) || null))
  rows.push(row2('General comments', hotel.general_comments))
  rows.push(row2('Staff notes', hotel.staff_notes))

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 45 }, { wch: 55 }]

  const hotelSlug = hotel.hotel_name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30)
  const citySlug = (trip.city ?? 'City').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '')
  const filename = `${hotelSlug}_${citySlug}_Bid.xlsx`

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hotel Bid')
  XLSX.writeFile(wb, filename)
}
