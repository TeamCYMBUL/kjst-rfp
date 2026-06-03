// Produces the KJST comparison .xlsx matching their existing sheet layout.
// Columns: row-label | Hotel 1 | Hotel 2 | …
// Rows: trip header, then rates, then all 48 concession items in order.
//
// Also exports a stripped team-facing grid (no commission, no flex cancel, no internal info).

import * as XLSX from 'xlsx'
import type { ConcessionItem } from './rfpApi'

export type GridHotel = {
  hotel_name: string
  status: string
  completed_by_name: string | null
  completed_date: string | null
  best_king_rate: number | null
  king_rate_notes: string | null
  current_selling_rate: string | null
  best_suite_rate: number | null
  occupancy_tax: string | null
  meeting_space_notes: string | null
  general_comments: string | null
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
  king_rooms_requested: number | null
  suites_requested: number | null
  total_rooms_requested: number | null
  client_name?: string | null
}

function fmt(v: string | null | undefined) {
  return v ?? '—'
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
  const val = answer.answer_value ?? '—'
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

  // ── Trip header ──────────────────────────────────────────────────────────
  rows.push(['', ...hotelNames])
  rows.push(row('OPPONENT', hotels.map(() => fmt(trip.opponent_label))))
  rows.push(row('ARR DATE', hotels.map(() => fmt(trip.arrival_date))))
  rows.push(row('DEP DATE', hotels.map(() => fmt(trip.departure_date))))
  rows.push(row('GAME DATE', hotels.map(() => fmt(trip.game_date))))
  rows.push([]) // blank spacer

  // ── Hotel meta ───────────────────────────────────────────────────────────
  rows.push(row('HOTEL NAME', hotels.map((h) => h.hotel_name)))
  rows.push(row('STATUS', hotels.map((h) => h.status.toUpperCase())))
  rows.push(row('COMPLETED BY', hotels.map((h) => fmt(h.completed_by_name))))
  rows.push(row('DATE', hotels.map((h) => fmt(h.completed_date))))
  rows.push([])

  // ── Rates ────────────────────────────────────────────────────────────────
  rows.push(['RATES'])
  rows.push(row('RATE (Best King)', hotels.map((h) => h.best_king_rate ?? '—')))
  rows.push(row('KING RATE NOTES', hotels.map((h) => fmt(h.king_rate_notes))))
  rows.push(row('CURRENT SELLING RATE', hotels.map((h) => fmt(h.current_selling_rate))))
  rows.push(row('BEST SUITE RATE', hotels.map((h) => h.best_suite_rate ?? '—')))
  rows.push(row('TAXES & FEES', hotels.map((h) => fmt(h.occupancy_tax))))
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
  rows.push(row('MEETING SPACE NOTES', hotels.map((h) => fmt(h.meeting_space_notes))))
  rows.push(row('GENERAL COMMENTS', hotels.map((h) => fmt(h.general_comments))))

  // ── Build workbook ───────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Column widths: label col wide, hotel cols medium
  ws['!cols'] = [
    { wch: 55 },
    ...hotels.map(() => ({ wch: 28 })),
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'RFP Comparison')
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
