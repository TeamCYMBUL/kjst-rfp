// Delinquent-hotels report — hotels that were invited to bid but blew past the
// RFP response deadline without submitting. Shared by the printable report page
// and the .xlsx export. Used to escalate to a hotel's Global Sales Office (GSO).
//
// "Delinquent" (per KJST): an invited hotel (status sent/opened, no bid) where
//   - the trip has a response deadline AND it's now past, OR
//   - the trip has no deadline set AND it's been 3+ days since the invite went out.
import { supabase } from './supabase'
import { loadLogoForExcel, sanitizeDrawingXfrm } from './excelExport'

const STALE_DAYS = 3

export type DelinquentRow = {
  hotelName: string
  city: string | null
  opponentLabel: string | null
  arrivalDate: string | null
  departureDate: string | null
  responseDeadline: string | null
  status: string // 'sent' | 'opened'
  contactName: string | null
  contactEmail: string | null
  daysOverdue: number | null // days past the deadline (>=1) when a deadline exists
  daysSinceInvite: number | null // days since the invite when no deadline is set
}

export type DelinquentReport = {
  client: { team_name: string; logo_url: string | null; season: string | null }
  rows: DelinquentRow[]
}

// Local-noon parse so a date-only string never shifts a day across timezones.
function dateOnly(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split('T')[0].split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d, 12) : null
}
const DAY = 86_400_000

export async function fetchDelinquentForClient(clientId: string): Promise<DelinquentReport> {
  const { data: client } = await supabase
    .from('clients')
    .select('team_name, logo_url, season')
    .eq('id', clientId)
    .maybeSingle()

  // Active trips only (skip closed/awarded; drafts have no invites anyway).
  const { data: trips } = await supabase
    .from('trips')
    .select('id, city, opponent_label, arrival_date, departure_date, response_deadline, status')
    .eq('client_id', clientId)
    .neq('status', 'closed')

  const rows: DelinquentRow[] = []
  const now = Date.now()
  const todayMid = new Date(new Date().setHours(12, 0, 0, 0)).getTime()

  for (const trip of (trips ?? []) as any[]) {
    const { data: invs } = await supabase
      .from('rfp_invitations')
      .select('hotel_name, status, sent_at, hotel_contact_name, hotel_contact_email')
      .eq('trip_id', trip.id)
      .in('status', ['sent', 'opened'])

    const dl = dateOnly(trip.response_deadline)
    for (const inv of (invs ?? []) as any[]) {
      let delinquent = false
      let daysOverdue: number | null = null
      let daysSinceInvite: number | null = null

      if (dl) {
        const over = todayMid - dl.getTime()
        if (over > 0) { delinquent = true; daysOverdue = Math.round(over / DAY) }
      } else if (inv.sent_at) {
        const waited = Math.floor((now - new Date(inv.sent_at).getTime()) / DAY)
        if (waited >= STALE_DAYS) { delinquent = true; daysSinceInvite = waited }
      }

      if (!delinquent) continue
      rows.push({
        hotelName: inv.hotel_name,
        city: trip.city,
        opponentLabel: trip.opponent_label,
        arrivalDate: trip.arrival_date,
        departureDate: trip.departure_date,
        responseDeadline: trip.response_deadline,
        status: inv.status,
        contactName: inv.hotel_contact_name,
        contactEmail: inv.hotel_contact_email,
        daysOverdue,
        daysSinceInvite,
      })
    }
  }

  // Sort by city, then hotel — reads cleanly and groups a city's misses together.
  rows.sort((a, b) =>
    (a.city ?? '').localeCompare(b.city ?? '', undefined, { sensitivity: 'base' }) ||
    a.hotelName.localeCompare(b.hotelName, undefined, { sensitivity: 'base' }),
  )

  return {
    client: {
      team_name: client?.team_name ?? 'Client',
      logo_url: client?.logo_url ?? null,
      season: client?.season ?? null,
    },
    rows,
  }
}

export function fmtDate(iso: string | null | undefined): string {
  const d = dateOnly(iso)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

export function overdueLabel(r: DelinquentRow): string {
  if (r.daysOverdue != null) return `${r.daysOverdue} day${r.daysOverdue !== 1 ? 's' : ''} past deadline`
  if (r.daysSinceInvite != null) return `No deadline · invited ${r.daysSinceInvite} days ago`
  return '—'
}

// ── .xlsx export ─────────────────────────────────────────────────────────────
export async function exportDelinquentXlsx(report: DelinquentReport): Promise<void> {
  const { client, rows } = report
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const DARK = 'FF1C1008'
  const HEADER_FILL = 'FFEDE9E4'
  const RED = 'FFB91C1C'

  const COLS = [
    { header: 'Hotel', width: 34 },
    { header: 'City', width: 16 },
    { header: 'Trip', width: 22 },
    { header: 'Arrival', width: 12 },
    { header: 'Departure', width: 12 },
    { header: 'Response Deadline', width: 16 },
    { header: 'Status', width: 18 },
    { header: 'Hotel Contact', width: 24 },
    { header: 'Contact Email', width: 30 },
  ]
  const NCOL = COLS.length

  const wb = new ExcelJS.Workbook()
  // pageSetup DPI pinned to avoid ExcelJS's 4294967295 (-1) overflow, which real
  // Excel flags as needing "repair". See excelExport.ts for the full note.
  const ws = wb.addWorksheet('Delinquent Hotels', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { horizontalDpi: 300, verticalDpi: 300 },
  })
  ws.columns = COLS.map((c) => ({ width: c.width }))

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  for (let r = 1; r <= 2; r++) for (let c = 1; c <= NCOL; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
  ws.mergeCells(1, 1, 1, NCOL)
  ws.mergeCells(2, 1, 2, NCOL)
  const title = ws.getCell(1, 1)
  title.value = client.team_name + (client.season ? `  —  ${client.season}` : '')
  title.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  const sub = ws.getCell(2, 1)
  sub.value = `Delinquent Hotels — past RFP deadline, no bid  ·  Prepared by KJ Sports Travel  ·  ${dateStr}`
  sub.font = { name: 'Arial', size: 9, color: { argb: 'FFD6C6B8' } }
  sub.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 46
  ws.getRow(2).height = 18

  // Client logo, top-left of the branding band. Safe now that pageSetup DPI is
  // pinned (above) and the buffer is run through sanitizeDrawingXfrm on download
  // to strip ExcelJS's 0x0 <a:xfrm>. See excelExport.ts for the full note.
  const logo = client.logo_url ? await loadLogoForExcel(client.logo_url) : null
  if (logo) {
    const imgId = wb.addImage({ buffer: logo.buffer, extension: logo.extension })
    ws.addImage(imgId, { tl: { col: 0.12, row: 0.15 }, ext: { width: 50, height: 50 } })
  }

  ws.getRow(3).height = 6
  const headerRow = ws.getRow(4)
  COLS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: DARK } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBBB2A8' } } }
  })
  headerRow.height = 26

  let rowIdx = 4
  for (const r of rows) {
    rowIdx += 1
    const vals = [
      r.hotelName.replace(/\n/g, ' ').trim(),
      r.city ?? '—',
      r.opponentLabel ?? '—',
      fmtDate(r.arrivalDate),
      fmtDate(r.departureDate),
      r.responseDeadline ? fmtDate(r.responseDeadline) : 'None set',
      overdueLabel(r),
      r.contactName ?? '—',
      r.contactEmail ?? '—',
    ]
    vals.forEach((v, i) => {
      const cell = ws.getRow(rowIdx).getCell(i + 1)
      cell.value = v
      // Column 7 (Status/overdue) in red so the miss reads at a glance.
      cell.font = { name: 'Arial', size: 10, color: { argb: i === 6 ? RED : 'FF111827' }, bold: i === 6 }
      cell.alignment = { vertical: 'top', wrapText: i === 0 || i === 6 }
    })
  }

  if (rows.length === 0) {
    rowIdx += 1
    ws.mergeCells(rowIdx, 1, rowIdx, NCOL)
    const cell = ws.getCell(rowIdx, 1)
    cell.value = 'No delinquent hotels — everyone has responded or is still within their deadline.'
    cell.font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF64748B' } }
    cell.alignment = { horizontal: 'center' }
  }

  const clientStr = client.team_name.replace(/\s+/g, '_')
  const fileDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const raw = await wb.xlsx.writeBuffer()
  const buf = await sanitizeDrawingXfrm(raw) // Excel-safe drawing (strip 0x0 xfrm)
  const blob = new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${clientStr}_Delinquent_Hotels_${fileDate}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
