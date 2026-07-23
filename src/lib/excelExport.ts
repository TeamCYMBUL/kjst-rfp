// Produces the KJST comparison .xlsx matching their existing sheet layout.
// Columns: row-label | Hotel 1 | Hotel 2 | …
// Rows: trip header, then rates, then all 48 concession items in order.
//
// Also exports a stripped team-facing grid (no commission, no flex cancel, no internal info).

import * as XLSX from 'xlsx'
import type { ConcessionItem } from './rfpApi'
import { formatMeetingSpaceNotes } from './format'

// ── Revenue helpers ───────────────────────────────────────────────────────────

/**
 * Parse a tax string into a percentage rate plus any flat per-room-per-night fee.
 * Hotels enter free text like "15.5%", "15.5", "16.9% + $5 nightly", "$5 nightly".
 * The old parser read only the leading percentage and silently dropped the "+ $5"
 * flat fee, understating the all-in total. Returns { pct: 0.169, flat: 5 }.
 */
function parseTaxComponents(raw: string | null | undefined): { pct: number; flat: number } {
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
  // Match the on-screen grid exactly: it costs the FULL room block
  // (total_rooms_requested) over trip.nights, not just the king rooms over a
  // date-derived night count. Fall back sensibly when a field is missing.
  const roomBlock = trip.total_rooms_requested ?? trip.king_rooms_requested ?? 0
  const nights = trip.nights ?? calcNights(trip.arrival_date, trip.departure_date)

  // ── Rates ────────────────────────────────────────────────────────────────
  rows.push(['RATES'])
  rows.push(row('RATE (Best King)', hotels.map((h) => h.best_king_rate ?? '—')))
  rows.push(row('KING RATE NOTES', hotels.map((h) => fmt(h.king_rate_notes))))
  rows.push(row('CURRENT SELLING RATE', hotels.map((h) => fmt(h.current_selling_rate))))
  rows.push(row('BEST SUITE RATE', hotels.map((h) => h.best_suite_rate ?? '—')))
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
    fnb_plan?: Record<string, number> | null
    stay2_arrival_date?: string | null
    stay2_departure_date?: string | null
    stay2_game_dates?: string[] | null
    stay2_game_date?: string | null
  }
  hotels: ConsolidatedHotel[]
  items: ConcessionItem[]
}

// Fetch a client logo and return an ExcelJS-embeddable buffer + extension.
// Returns null on any failure (missing/SVG/unsupported/CORS) so the export
// falls back to a text-only branded header instead of breaking.
async function loadLogoForExcel(
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
export async function exportMultiCityConsolidatedXlsx(
  cities: ConsolidatedCity[],
  clientName: string,
  opts: { logoUrl?: string | null; season?: string | null; filename?: string } = {},
): Promise<void> {
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod

  const DARK = 'FF1C1008'
  const HEADER_FILL = 'FFEDE9E4'
  const RED = 'FFFF0000'

  const COLS: { header: string; width: number }[] = [
    { header: '#', width: 4 },
    { header: 'Stay', width: 7 },
    { header: 'City', width: 15 },
    { header: 'Game Date', width: 11 },
    { header: 'C/I', width: 10 },
    { header: 'C/O', width: 10 },
    { header: 'Nts', width: 5 },
    { header: 'Hotel Choices', width: 30 },
    { header: 'Rate', width: 9 },
    { header: 'Comp Suite', width: 9 },
    { header: 'Suite UG', width: 9 },
    { header: 'Postseason Guaranteed', width: 14 },
    { header: 'Notes', width: 55 },
  ]
  // F&B forecast columns appear only for teams whose trips carry an F&B plan
  // (per-person meal prices × person-meals). Appended after Notes so existing
  // column indices are untouched.
  const fnbActive = cities.some(
    (c) => c.trip.fnb_plan && Object.values(c.trip.fnb_plan).some((v) => Number(v) > 0),
  )
  const FNB_COL_FORECAST = COLS.length // 0-based index of first appended col
  if (fnbActive) {
    COLS.push({ header: 'Forecasted F&B', width: 13 }, { header: 'Rooms + F&B', width: 14 })
  }
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
    ws.addImage(imgId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 108, height: 52 } })
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
  ws.getCell(4, 12).note = 'YES / NO from hotel responses. Change to LIMITED manually if applicable.'

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
  const CENTER_COLS = new Set([0, 1, 3, 4, 5, 6, 8, 9, 10, 11])
  if (fnbActive) { CENTER_COLS.add(FNB_COL_FORECAST); CENTER_COLS.add(FNB_COL_FORECAST + 1) }

  let rowIdx = 4
  let counter = 0

  for (const { trip, hotels, items } of cities) {
    const compSuitesItem = items.find((i) => i.label.toLowerCase().includes('complimentary one bedroom suite'))
    const suiteUpgItem = items.find((i) => i.label.toLowerCase().includes('suite upgrade'))
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
        const noteFrags: string[] = []
        if (h.status === 'awarded') noteFrags.push('AWARDED')
        if (struck) noteFrags.push(reason ? REASON_LABELS[reason] ?? 'Not available' : 'Not available')
        if (h.staff_notes) noteFrags.push(h.staff_notes)
        if (h.general_comments) noteFrags.push(h.general_comments)

        const vals: (string | number | Date | null)[] = [
          counter,
          first ? stayLabel : '',
          first ? cityName : '',
          gameCell,
          toDate(visit.arr),
          toDate(visit.dep),
          nights,
          h.hotel_name.replace(/\n/g, ' ').trim(),
          bid ? kingRate ?? null : null,
          bid && Number.isFinite(compSuites) && compSuites > 0 ? compSuites : null,
          bid && suiteUg != null && Number.isFinite(suiteUg) ? suiteUg : null,
          bid ? postGte : '',
          noteFrags.join('\n'),
        ]

        // F&B forecast (Stay 1 only; per-person price × person-meals per meal item)
        if (fnbActive) {
          const plan = trip.fnb_plan ?? {}
          const planEntries = Object.entries(plan).filter(([, pm]) => Number(pm) > 0)
          let fnb: number | null = null
          if (bid && visit.index === 1 && planEntries.length > 0) {
            let sum = 0, any = false
            for (const [itemId, pm] of planEntries) {
              const raw = h.answers[itemId]?.answer_value
              const price = raw ? parseFloat(String(raw).replace(/[^0-9.]/g, '')) : NaN
              if (Number.isFinite(price)) { sum += price * Number(pm); any = true }
            }
            fnb = any ? sum : null
          }
          const roomCost = (bid && visit.index === 1 && kingRate != null && trip.total_rooms_requested != null)
            ? kingRate * trip.total_rooms_requested * nights : null
          const roomsPlusFnb = (fnb != null || roomCost != null) ? (fnb ?? 0) + (roomCost ?? 0) : null
          vals.push(fnb, roomsPlusFnb)
        }
        first = false

        vals.forEach((v, i) => {
          const cell = row.getCell(i + 1)
          cell.value = v as any
          cell.font = struck
            ? { name: 'Arial', size: 10, color: { argb: RED }, strike: true }
            : { name: 'Arial', size: 10 }
          cell.alignment = { vertical: 'top', wrapText: i === 12, horizontal: CENTER_COLS.has(i) ? 'center' : 'left' }
        })
        row.getCell(4).numFmt = 'm/d/yy'
        row.getCell(5).numFmt = 'm/d/yy'
        row.getCell(6).numFmt = 'm/d/yy'
        row.getCell(9).numFmt = '$#,##0'
        if (fnbActive) {
          row.getCell(FNB_COL_FORECAST + 1).numFmt = '$#,##0'
          row.getCell(FNB_COL_FORECAST + 2).numFmt = '$#,##0'
        }
      }
    }
  }

  const clientStr = clientName.replace(/\s+/g, '_')
  const fileDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const outputFile = opts.filename ?? `${clientStr}_Hotel_Options_${fileDate}.xlsx`

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
