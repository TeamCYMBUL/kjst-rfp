// Produces the KJST comparison .xlsx matching their existing sheet layout.
// Columns: row-label | Hotel 1 | Hotel 2 | …
// Rows: trip header, then rates, then all 48 concession items in order.
//
// Also exports a stripped team-facing grid (no commission, no flex cancel, no internal info).

import * as XLSX from 'xlsx'
import type { ConcessionItem } from './rfpApi'
import { formatMeetingSpaceNotes } from './format'

// ── Revenue helpers ───────────────────────────────────────────────────────────

/** Parse a tax string like "15.5%", "15.5", or null → decimal rate (0.155). */
function parseTaxRate(raw: string | null | undefined): number {
  if (raw == null) return 0
  const stripped = raw.trim().replace('%', '')
  const n = parseFloat(stripped)
  if (!isFinite(n) || n < 0) return 0
  // Values stored as a percent (e.g. 15.5) → divide by 100
  return n / 100
}

/** Number of nights between two ISO date strings. Returns 1 if inputs are missing/invalid. */
function calcNights(arrival: string | null | undefined, departure: string | null | undefined): number {
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
  king_rooms_requested: number | null
  suites_requested: number | null
  total_rooms_requested: number | null
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
  rows.push(row('GAME DATE', hotels.map(() => fmt(joinGameDates(trip.game_dates, trip.game_date)))))
  rows.push([]) // blank spacer

  // ── Hotel meta ───────────────────────────────────────────────────────────
  rows.push(row('HOTEL NAME', hotels.map((h) => h.hotel_name)))
  rows.push(row('STATUS', hotels.map((h) => h.status.toUpperCase())))
  rows.push(row('COMPLETED BY', hotels.map((h) => fmt(h.completed_by_name))))
  rows.push(row('DATE', hotels.map((h) => fmt(h.completed_date))))
  rows.push([])

  // ── Pre-compute revenue inputs ────────────────────────────────────────────
  const kingRooms = trip.king_rooms_requested ?? 0
  const nights = calcNights(trip.arrival_date, trip.departure_date)

  // ── Rates ────────────────────────────────────────────────────────────────
  rows.push(['RATES'])
  rows.push(row('RATE (Best King)', hotels.map((h) => h.best_king_rate ?? '—')))
  rows.push(row('KING RATE NOTES', hotels.map((h) => fmt(h.king_rate_notes))))
  rows.push(row('CURRENT SELLING RATE', hotels.map((h) => fmt(h.current_selling_rate))))
  rows.push(row('BEST SUITE RATE', hotels.map((h) => h.best_suite_rate ?? '—')))
  rows.push(row('TAXES & FEES', hotels.map((h) => fmt(h.occupancy_tax))))

  // Revenue per hotel (numeric where calculable, '—' otherwise)
  const revenueInclTax = hotels.map((h) => {
    if (h.best_king_rate == null || kingRooms === 0) return '—' as const
    const taxRate = parseTaxRate(h.occupancy_tax)
    return h.best_king_rate * kingRooms * nights * (1 + taxRate)
  })
  const revenueExclTax = hotels.map((h) => {
    if (h.best_king_rate == null || kingRooms === 0) return '—' as const
    return h.best_king_rate * kingRooms * nights
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
    if (h.best_king_rate == null || kingRooms === 0) return '—' as const
    const taxRate = parseTaxRate(h.occupancy_tax)
    return h.best_king_rate * kingRooms * nights * (1 + taxRate)
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
  const compSuitesItem = concessionItems.find((c: any) =>
    c.label.toLowerCase().includes('complimentary one bedroom suites'),
  )
  const suiteUpgItem = concessionItems.find((c: any) =>
    c.label.toLowerCase().includes('suite upgrades at the group'),
  )
  const playoffItem = concessionItems.find((c: any) => c.section === 'postseason')

  const getAns = (invId: string, itemId: string | undefined) => {
    if (!itemId) return null
    return answers.get(invId)?.find((a: any) => a.concession_item_id === itemId) ?? null
  }

  const eligible = invitations.filter((i) => ['submitted', 'awarded'].includes(i.status))

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
  best_king_rate: number | null
  current_selling_rate: string | null
  occupancy_tax: string | null
  resort_fee: string | null
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
  }
  hotels: ConsolidatedHotel[]
  items: ConcessionItem[]
}

const MTG_LABELS: Record<string, string> = {
  function_room: 'Function Room',
  ballroom: 'Ballroom',
  restaurant: 'Restaurant ⚠️',
  suite_converted: 'Suite (converted) ⚠️',
  none: 'None',
}

export function exportMultiCityConsolidatedXlsx(
  cities: ConsolidatedCity[],
  clientName: string,
  filename?: string,
): void {
  const COLS = [
    'HOTEL',
    'KING RATE / NIGHT',
    'VS. CURRENT RATE',
    'TAXES & FEES',
    'RESORT FEE',
    'COMP SUITES (FREE)',
    'SUITE UPGRADES AT KING RATE',
    'COMP TVs',
    'COMP WHITEBOARDS',
    'PORTERAGE ($/BAG)',
    'PLAYOFF CLAUSE',
    'MEETING SPACE',
    'NOTES',
  ]

  const rows: (string | number | null)[][] = []

  for (const { trip, hotels, items } of cities) {
    const eligible = hotels.filter((h) => ['submitted', 'awarded'].includes(h.status))
    if (eligible.length === 0) continue

    // Find relevant concession items by label
    const compSuitesItem = items.find((i) => i.label.toLowerCase().includes('complimentary one bedroom suite'))
    const suiteUpgItem = items.find((i) => i.label.toLowerCase().includes('suite upgrades at the group'))
    const tvItem = items.find((i) => i.label.toLowerCase().includes('tv') || i.label.toLowerCase().includes('television'))
    const wbItem = items.find((i) => i.label.toLowerCase().includes('white board') || i.label.toLowerCase().includes('whiteboard'))
    const portItem = items.find((i) => i.label.toLowerCase().includes('baggage') || i.label.toLowerCase().includes('porterage'))
    const playoffItem = items.find((i) => i.section === 'postseason')

    // City section header
    const arrival = trip.arrival_date ? fmtDate(trip.arrival_date) : '—'
    const departure = trip.departure_date ? fmtDate(trip.departure_date) : '—'
    const cityHeader = [
      `${(trip.city ?? 'City').toUpperCase()}  ·  ${trip.opponent_label ?? ''}  ·  ${arrival} – ${departure}`,
      ...Array(COLS.length - 1).fill(''),
    ]
    rows.push(cityHeader)
    rows.push(COLS)

    for (const h of eligible) {
      const compAns = compSuitesItem ? h.answers[compSuitesItem.id] : undefined
      const upgAns = suiteUpgItem ? h.answers[suiteUpgItem.id] : undefined
      const tvAns = tvItem ? h.answers[tvItem.id] : undefined
      const wbAns = wbItem ? h.answers[wbItem.id] : undefined
      const portAns = portItem ? h.answers[portItem.id] : undefined
      const playoffAns = playoffItem ? h.answers[playoffItem.id] : undefined

      const mtgLabel = h.meeting_space_type
        ? (MTG_LABELS[h.meeting_space_type] ?? h.meeting_space_type)
        : '—'
      const mtgDisplay =
        h.meeting_space_type && h.meeting_space_count != null && h.meeting_space_count > 1
          ? `${mtgLabel} ×${h.meeting_space_count}`
          : mtgLabel

      const noteFrags: string[] = []
      if (h.meeting_space_type === 'restaurant' || h.meeting_space_type === 'suite_converted') {
        noteFrags.push('Meeting space not traditional — confirm eligibility')
      }
      if (h.status === 'awarded') noteFrags.push('AWARDED')

      rows.push([
        h.hotel_name,
        h.best_king_rate ?? '—',
        h.current_selling_rate ?? '—',
        h.occupancy_tax ?? '—',
        h.resort_fee ?? '—',
        compAns ? (compAns.answer_value ?? (compAns.answer_yes_no === false ? 'None' : '—')) : '—',
        upgAns?.answer_value ?? '—',
        tvAns ? (tvAns.answer_yes_no === true ? 'Yes' : tvAns.answer_yes_no === false ? 'No' : (tvAns.answer_value ?? '—')) : '—',
        wbAns ? (wbAns.answer_yes_no === true ? 'Yes' : wbAns.answer_yes_no === false ? 'No' : (wbAns.answer_value ?? '—')) : '—',
        portAns?.answer_value ?? (portAns?.answer_yes_no === false ? 'No' : '—'),
        playoffAns?.answer_yes_no === true ? 'Yes' : playoffAns?.answer_yes_no === false ? 'No' : '—',
        mtgDisplay,
        noteFrags.join('; '),
      ])
    }

    rows.push([]) // blank spacer between cities
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)

  ws['!cols'] = [
    { wch: 32 }, // Hotel
    { wch: 16 }, // King Rate
    { wch: 16 }, // VS Current
    { wch: 16 }, // Taxes
    { wch: 12 }, // Resort Fee
    { wch: 20 }, // Comp Suites
    { wch: 28 }, // Suite Upgrades
    { wch: 12 }, // Comp TVs
    { wch: 18 }, // Comp Whiteboards
    { wch: 16 }, // Porterage
    { wch: 14 }, // Playoff
    { wch: 24 }, // Mtg Space
    { wch: 44 }, // Notes
  ]

  const clientStr = clientName.replace(/\s+/g, '_')
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const outputFile = filename ?? `${clientStr}_All_Cities_Grid_${dateStr}.xlsx`

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'All Cities')
  XLSX.writeFile(wb, outputFile)
}

// ─────────────────────────────────────────────────────────────────────────────
// exportSingleHotelXlsx — one hotel's full bid in a vertical label/value layout
// ─────────────────────────────────────────────────────────────────────────────

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
