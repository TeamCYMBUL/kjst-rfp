// Word (.docx) generators for every KJST printable report.
//
// The team asked for Word across the board (Save-as-PDF mangled fonts when they
// re-converted to Word). These mirror the on-screen/PDF layout: a dark KJST
// letterhead band, a trip/summary header, rate tables, concession sections with
// "No" in red and counteroffers in blue, and a footer.
//
// This module is intentionally PURE (only depends on `docx` + the pure
// formatMeetingSpaceNotes helper) so it runs in the browser AND in a Node
// self-test harness with no React/Supabase in the graph.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, AlignmentType, PageBreak, VerticalAlign,
} from 'docx'
import { formatMeetingSpaceNotes } from './format'

// ── Brand + layout constants ─────────────────────────────────────────────────
const DARK = '1C1008'
const INK = '1E293B'
const MUTED = '64748B'
const RED = 'DC2626'
const BLUE = '1D4ED8'
const LINE = 'E2E8F0'
const PANEL = 'F8FAFC'
const HEAD = 'Cambria'
const BODY = 'Calibri'
// US Letter, 0.75" margins → content width 10080 dxa.
const CONTENT_W = 10080

// ── Shared data types (what the callers assemble) ────────────────────────────
export type DocxTrip = {
  team_name: string
  opponent_label: string | null
  city: string | null
  arrival_date: string | null
  departure_date: string | null
  king_rooms_requested: number | null
  double_rooms_requested: number | null
  suites_requested: number | null
  total_rooms_requested: number | null
}
export type DocxResp = {
  best_king_rate: number | null
  best_suite_rate: number | null
  current_selling_rate: string | null
  occupancy_tax: string | null
  resort_fee: string | null
  stay2_king_rate: number | null
  stay2_suite_rate: number | null
  meeting_space_notes: string | null
  general_comments: string | null
  distance_to_arena: string | null
  standard_checkin_time: string | null
} | null
export type DocxInv = {
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  submitted_at: string | null
  visit1_declined: boolean
  visit2_declined: boolean
}
export type DocxItem = { id: string; section: string; label: string; answer_type: string; sort_order: number }
export type DocxAnswer = { concession_item_id: string; answer_yes_no: boolean | null; answer_value: string | null; comment: string | null }
export type DocxHotel = { inv: DocxInv; resp: DocxResp; answers: DocxAnswer[]; concessionItems: DocxItem[] }

// ── Pure formatting helpers (mirror proposalRender) ──────────────────────────
function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00Z')
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
function fmtMoney(n: number | null): string { return n != null ? `$${n.toLocaleString()}` : '—' }
const SECTION_LABELS: Record<string, string> = {
  concessions: 'Concessions', facilities: 'Facilities',
  in_season_tournament: 'In-Season Tournament Guarantee', postseason: 'Postseason Guarantee',
}
const SECTION_ORDER = ['concessions', 'facilities', 'in_season_tournament', 'postseason']
function answerText(ans: DocxAnswer | undefined, answerType?: string): string {
  if (!ans || (ans.answer_yes_no == null && !ans.answer_value)) return '—'
  if (ans.answer_yes_no != null) return ans.answer_yes_no === true ? 'Yes' : 'No'
  const val = ans.answer_value
  if (!val) return '—'
  if (answerType === 'currency') return `$${val}`
  if (answerType === 'percent') return `${val}%`
  return val
}

// ── Low-level doc pieces ─────────────────────────────────────────────────────
const noBorder = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }
const rowLine = { style: BorderStyle.SINGLE, size: 2, color: LINE }

function bandTable(title: string, subtitle: string): Table {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    borders: noBorder,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { fill: DARK, type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 220, bottom: 220, left: 240, right: 240 },
            children: [
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: title, bold: true, font: HEAD, size: 30, color: 'FFFFFF' })] }),
              new Paragraph({ children: [new TextRun({ text: subtitle, font: BODY, size: 18, color: 'D6C3B0' })] }),
            ],
          }),
        ],
      }),
    ],
  })
}

function tripHeaderTable(trip: DocxTrip): Table {
  const roomBlock = [
    trip.king_rooms_requested != null ? `${trip.king_rooms_requested} kings` : null,
    trip.double_rooms_requested != null ? `${trip.double_rooms_requested} doubles` : null,
    trip.suites_requested != null ? `${trip.suites_requested} suites` : null,
    trip.total_rooms_requested != null ? `${trip.total_rooms_requested} total` : null,
  ].filter(Boolean).join(' · ')
  const meta: Paragraph[] = []
  if (trip.arrival_date) meta.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: 'Check-in: ', bold: true, font: BODY, size: 18, color: '334155' }), new TextRun({ text: fmtDate(trip.arrival_date), font: BODY, size: 18, color: MUTED })] }))
  if (trip.departure_date) meta.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: 'Check-out: ', bold: true, font: BODY, size: 18, color: '334155' }), new TextRun({ text: fmtDate(trip.departure_date), font: BODY, size: 18, color: MUTED })] }))
  if (roomBlock) meta.push(new Paragraph({ children: [new TextRun({ text: 'Room Block: ', bold: true, font: BODY, size: 18, color: '334155' }), new TextRun({ text: roomBlock, font: BODY, size: 18, color: MUTED })] }))
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    borders: { top: { style: BorderStyle.NONE }, bottom: rowLine, left: rowLine, right: rowLine, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { fill: PANEL, type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 160, bottom: 160, left: 240, right: 240 },
            children: [
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: trip.team_name, bold: true, font: HEAD, size: 24, color: '0F172A' })] }),
              new Paragraph({ spacing: { after: meta.length ? 100 : 0 }, children: [new TextRun({ text: `${trip.opponent_label ?? 'Trip'}${trip.city ? ` · ${trip.city}` : ''}`, font: BODY, size: 20, color: '475569' })] }),
              ...meta,
            ],
          }),
        ],
      }),
    ],
  })
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: text.toUpperCase(), bold: true, font: BODY, size: 16, color: '94A3B8', characterSpacing: 20 })] })
}

// A 2-column label/value table (rates, or concession answers with colored value).
function kvTable(rows: { label: string; value: string; isNo?: boolean; comment?: string | null }[]): Table {
  const L = Math.round(CONTENT_W * 0.72)
  const R = CONTENT_W - L
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [L, R],
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: rowLine, insideVertical: { style: BorderStyle.NONE } },
    rows: rows.map((r) => {
      // Honor line breaks inside a label (e.g. the multi-paragraph Postseason
      // clause) — a raw \n is not a Word break, so emit explicit run breaks.
      const labelRuns = r.label.split('\n').flatMap((seg, i) =>
        i === 0
          ? [new TextRun({ text: seg, font: BODY, size: 20, color: '374151' })]
          : [new TextRun({ text: seg, break: 1, font: BODY, size: 20, color: '374151' })],
      )
      const left: Paragraph[] = [new Paragraph({ children: labelRuns })]
      if (r.comment) left.push(new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: r.comment, italics: true, bold: true, font: BODY, size: 18, color: BLUE })] }))
      return new TableRow({
        children: [
          new TableCell({ width: { size: L, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, verticalAlign: VerticalAlign.TOP, children: left }),
          new TableCell({ width: { size: R, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, verticalAlign: VerticalAlign.TOP, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: r.value, bold: true, font: BODY, size: 20, color: r.isNo ? RED : '111827' })] })] }),
        ],
      })
    }),
  })
}

function rateRowsFor(inv: DocxInv, resp: DocxResp): { label: string; value: string }[] {
  const hasStay2 = inv.visit2_declined || resp?.stay2_king_rate != null || resp?.stay2_suite_rate != null
  const s1 = hasStay2 ? ' — Stay 1' : ''
  const rows: { label: string; value: string }[] = inv.visit1_declined
    ? [
      { label: `King/Suite/Selling Rate${s1}`, value: 'Visit 1 declined' },
      { label: 'Occupancy Tax', value: resp?.occupancy_tax || '—' },
      { label: 'Resort Fee', value: resp?.resort_fee || '—' },
    ]
    : [
      { label: `King Rate${s1}`, value: fmtMoney(resp?.best_king_rate ?? null) },
      { label: `Suite Rate${s1}`, value: fmtMoney(resp?.best_suite_rate ?? null) },
      { label: 'Selling Rate', value: resp?.current_selling_rate || '—' },
      { label: 'Occupancy Tax', value: resp?.occupancy_tax || '—' },
      { label: 'Resort Fee', value: resp?.resort_fee || '—' },
    ]
  if (inv.visit2_declined) rows.push({ label: 'King/Suite Rate — Stay 2', value: 'Visit 2 declined' })
  else if (resp?.stay2_king_rate != null) rows.push({ label: 'King Rate — Stay 2', value: fmtMoney(resp.stay2_king_rate) })
  if (!inv.visit2_declined && resp?.stay2_suite_rate != null) rows.push({ label: 'Suite Rate — Stay 2', value: fmtMoney(resp.stay2_suite_rate) })
  if (resp?.distance_to_arena) rows.push({ label: 'Distance to arena', value: resp.distance_to_arena })
  if (resp?.standard_checkin_time) rows.push({ label: 'Standard check-in', value: resp.standard_checkin_time })
  return rows
}

function hotelBlock(h: DocxHotel): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  out.push(new Paragraph({ spacing: { before: 240, after: 20 }, children: [new TextRun({ text: h.inv.hotel_name, bold: true, font: HEAD, size: 26, color: DARK })] }))
  const contact = [h.inv.hotel_contact_name, h.inv.hotel_contact_email].filter(Boolean).join(' · ') || 'No contact on file'
  out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: contact + (h.inv.submitted_at ? ` · Submitted ${fmtDate(h.inv.submitted_at)}` : ''), font: BODY, size: 18, color: MUTED })] }))
  if (!h.resp) {
    out.push(new Paragraph({ children: [new TextRun({ text: 'No response submitted yet.', italics: true, font: BODY, size: 20, color: '94A3B8' })] }))
    return out
  }
  out.push(sectionHeading('Rates'))
  out.push(kvTable(rateRowsFor(h.inv, h.resp)))
  if (h.resp.meeting_space_notes) {
    const note = formatMeetingSpaceNotes(h.resp.meeting_space_notes)
    if (note) out.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: 'Meeting space: ', bold: true, font: BODY, size: 20, color: '374151' }), new TextRun({ text: note, font: BODY, size: 20, color: '374151' })] }))
  }
  const ansById = new Map(h.answers.map((a) => [a.concession_item_id, a]))
  for (const sectionKey of SECTION_ORDER) {
    const items = h.concessionItems.filter((c) => c.section === sectionKey).sort((a, b) => a.sort_order - b.sort_order)
    if (items.length === 0) continue
    out.push(sectionHeading(SECTION_LABELS[sectionKey] ?? sectionKey))
    out.push(kvTable(items.map((item) => {
      const ans = ansById.get(item.id)
      return { label: item.label, value: answerText(ans, item.answer_type), isNo: ans?.answer_yes_no === false, comment: ans?.comment ?? null }
    })))
  }
  if (h.resp.general_comments) {
    out.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: 'General comments: ', bold: true, font: BODY, size: 20, color: '374151' }), new TextRun({ text: h.resp.general_comments, font: BODY, size: 20, color: '374151' })] }))
  }
  return out
}

const footerPara = () => new Paragraph({ spacing: { before: 240 }, border: { top: rowLine }, children: [new TextRun({ text: 'Rates negotiated exclusively by KJ Sports Travel', font: BODY, size: 16, color: '94A3B8' })] })

function pageBreakPara() { return new Paragraph({ children: [new PageBreak()] }) }

function docShell(children: (Paragraph | Table)[]): Document {
  return new Document({
    creator: 'KJ Sports Travel',
    styles: { default: { document: { run: { font: BODY, size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children,
    }],
  })
}

// ── Public generators ────────────────────────────────────────────────────────

/** Full-copy proposal doc: trip groups, each with a header + every hotel's write-up. */
export function buildProposalDoc(input: { subtitle: string; groups: { trip: DocxTrip; hotels: DocxHotel[] }[] }): Document {
  const children: (Paragraph | Table)[] = []
  input.groups.forEach((g, gi) => {
    if (gi > 0) children.push(pageBreakPara())
    children.push(bandTable('KJ SPORTS TRAVEL', input.subtitle))
    children.push(tripHeaderTable(g.trip))
    if (g.hotels.length === 0) {
      children.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: 'No submitted bids yet.', italics: true, font: BODY, size: 20, color: '94A3B8' })] }))
    } else {
      g.hotels.forEach((h, hi) => {
        if (hi > 0) children.push(pageBreakPara())
        hotelBlock(h).forEach((c) => children.push(c))
      })
    }
    children.push(footerPara())
  })
  return docShell(children)
}

export type DelinquentDocRow = { hotelName: string; city: string | null; arrivalDate: string | null; departureDate: string | null; responseDeadline: string | null; statusLabel: string; contactName: string | null; contactEmail: string | null }
export function buildDelinquentDoc(input: { teamName: string; season: string | null; dateStr: string; rows: DelinquentDocRow[] }): Document {
  const children: (Paragraph | Table)[] = []
  children.push(bandTable('KJ SPORTS TRAVEL', `${input.teamName}${input.season ? ` · ${input.season}` : ''} — Delinquent Hotels`))
  children.push(new Paragraph({ spacing: { before: 120, after: 160 }, children: [new TextRun({ text: `Hotels invited to bid that are past the RFP response deadline without submitting — as of ${input.dateStr}.`, font: BODY, size: 18, color: MUTED })] }))
  if (input.rows.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'No delinquent hotels — everyone has responded or is still within their deadline.', italics: true, font: BODY, size: 20, color: '94A3B8' })] }))
    return docShell(children)
  }
  const headers = ['Hotel', 'City', 'Trip dates', 'Deadline', 'Status', 'Hotel contact']
  const widths = [0.22, 0.13, 0.19, 0.15, 0.12, 0.19].map((f) => Math.round(CONTENT_W * f))
  const headerRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, shading: { fill: PANEL, type: ShadingType.CLEAR, color: 'auto' }, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: h.toUpperCase(), bold: true, font: BODY, size: 15, color: MUTED })] })] })) })
  const bodyRows = input.rows.map((r) => new TableRow({ children: [
    new TableCell({ width: { size: widths[0], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: r.hotelName, bold: true, font: BODY, size: 18, color: INK })] })] }),
    new TableCell({ width: { size: widths[1], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: r.city ?? '—', font: BODY, size: 18, color: INK })] })] }),
    new TableCell({ width: { size: widths[2], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: `${fmtDate(r.arrivalDate)} – ${fmtDate(r.departureDate)}`, font: BODY, size: 18, color: INK })] })] }),
    new TableCell({ width: { size: widths[3], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: r.responseDeadline ? fmtDate(r.responseDeadline) : 'None set', font: BODY, size: 18, color: INK })] })] }),
    new TableCell({ width: { size: widths[4], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: r.statusLabel, bold: true, font: BODY, size: 18, color: 'B91C1C' })] })] }),
    new TableCell({ width: { size: widths[5], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: r.contactName || '—', font: BODY, size: 18, color: INK })] }), ...(r.contactEmail ? [new Paragraph({ children: [new TextRun({ text: r.contactEmail, font: BODY, size: 16, color: MUTED })] })] : [])] }),
  ] }))
  children.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, borders: { top: rowLine, bottom: rowLine, left: rowLine, right: rowLine, insideHorizontal: rowLine, insideVertical: { style: BorderStyle.NONE } }, rows: [headerRow, ...bodyRows] }))
  children.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `${input.rows.length} hotel${input.rows.length !== 1 ? 's' : ''} past deadline · KJ Sports Travel`, font: BODY, size: 16, color: '94A3B8' })] }))
  return docShell(children)
}

export type ContractsDocRow = { hotelName: string; city: string | null; statusLabel: string; uploaded: string | null; signed: string | null }
export function buildContractsDoc(input: { dateStr: string; groups: { name: string; rows: ContractsDocRow[] }[] }): Document {
  const children: (Paragraph | Table)[] = []
  children.push(bandTable('KJ SPORTS TRAVEL', 'Contracts Summary — Room agreements for awarded hotels'))
  children.push(new Paragraph({ spacing: { before: 120, after: 160 }, children: [new TextRun({ text: input.dateStr, font: BODY, size: 18, color: MUTED })] }))
  if (input.groups.length === 0) children.push(new Paragraph({ children: [new TextRun({ text: 'No awarded hotels yet.', italics: true, font: BODY, size: 20, color: '94A3B8' })] }))
  const widths = [0.34, 0.2, 0.16, 0.15, 0.15].map((f) => Math.round(CONTENT_W * f))
  input.groups.forEach((g) => {
    children.push(new Paragraph({ spacing: { before: 220, after: 60 }, children: [new TextRun({ text: g.name, bold: true, font: HEAD, size: 22, color: DARK })] }))
    const headers = ['Hotel', 'City', 'Status', 'Uploaded', 'Signed']
    const headerRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, shading: { fill: PANEL, type: ShadingType.CLEAR, color: 'auto' }, margins: { top: 70, bottom: 70, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, font: BODY, size: 16, color: MUTED })] })] })) })
    const bodyRows = g.rows.map((r) => new TableRow({ children: [r.hotelName, r.city ?? '—', r.statusLabel, r.uploaded ?? '—', r.signed ?? '—'].map((v, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: v, bold: i === 0, font: BODY, size: 18, color: i === 0 ? INK : '475569' })] })] })) }) )
    children.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, borders: { top: rowLine, bottom: rowLine, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: rowLine, insideVertical: { style: BorderStyle.NONE } }, rows: [headerRow, ...bodyRows] }))
  })
  return docShell(children)
}

// ── Browser download helper ──────────────────────────────────────────────────
export async function downloadDocx(doc: Document, filename: string): Promise<void> {
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
