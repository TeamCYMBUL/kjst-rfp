import { describe, it, expect } from 'vitest'
import { buildConsolidatedWorkbook, sanitizeDrawingXfrm, type ConsolidatedCity } from './excelExport'
import JSZip from 'jszip'

// Smoke test for the "Hotel Options" grid: a 2-visit city must build a valid,
// non-corrupt xlsx that includes BOTH stays' rates. Guards the exact failure
// modes Catherine/Alina hit (Excel-repair corruption + dropped Stay 2).
const city: ConsolidatedCity = {
  trip: {
    city: 'Boston',
    opponent_label: 'Boston Celtics',
    arrival_date: '2026-12-27',
    departure_date: '2026-12-28',
    game_date: null,
    total_rooms_requested: 75,
    king_rooms_requested: 66,
    suites_requested: 9,
    stay2_arrival_date: '2027-02-25',
    stay2_departure_date: '2027-02-26',
  },
  hotels: [
    {
      hotel_name: 'Four Seasons Hotel Atlanta',
      status: 'submitted',
      staff_notes: null,
      awarded_stay1: false,
      awarded_stay2: false,
      visit1_declined: false,
      visit1_decline_reason: null,
      visit2_declined: false,
      visit2_decline_reason: null,
      best_king_rate: 325,
      best_suite_rate: 950,
      current_selling_rate: '900',
      occupancy_tax: '16.9% + $5 per night',
      resort_fee: null,
      standard_checkin_time: null,
      stay2_king_rate: 399,
      stay2_suite_rate: 950,
      general_comments: null,
      meeting_space_type: null,
      meeting_space_count: null,
      answers: {},
    },
  ],
  items: [],
}

describe('buildConsolidatedWorkbook', () => {
  it('builds a valid xlsx with both stays for a 2-visit trip', async () => {
    const { wb, outputFile } = await buildConsolidatedWorkbook([city], 'Cleveland Cavaliers', { logoUrl: null })
    expect(outputFile).toMatch(/\.xlsx$/)

    const buf = await wb.xlsx.writeBuffer()
    const bytes = new Uint8Array(buf as ArrayBuffer)
    expect(bytes.length).toBeGreaterThan(1000)
    // .xlsx is a ZIP — "PK" header. Corrupt/empty output fails here.
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)

    // Both stays must have rendered: Stay 1 rate (325) and Stay 2 rate (399).
    const ws = wb.worksheets[0]
    let found325 = false
    let found399 = false
    ws.eachRow((row: any) => row.eachCell((c: any) => {
      if (c.value === 325) found325 = true
      if (c.value === 399) found399 = true
    }))
    expect(found325).toBe(true)
    expect(found399).toBe(true)
  })

  it('awardedOnly renders ONLY the won stay rows (2-visit split between hotels)', async () => {
    // Brooklyn-style split: Four Seasons won Stay 1, 1 Hotel won Stay 2. The
    // awarded-only export must show each hotel ONLY on the stay it actually won,
    // never the losing stay (the bug: both hotels' both stays showed up).
    const splitCity: ConsolidatedCity = {
      trip: {
        city: 'New York', opponent_label: 'Brooklyn Nets',
        arrival_date: '2026-12-12', departure_date: '2026-12-13', game_date: null,
        total_rooms_requested: 65, king_rooms_requested: 65, suites_requested: 2,
        stay2_arrival_date: '2027-03-22', stay2_departure_date: '2027-03-23',
      },
      hotels: [
        { hotel_name: 'Four Seasons New York', status: 'awarded', staff_notes: null,
          awarded_stay1: true, awarded_stay2: false,
          visit1_declined: false, visit1_decline_reason: null, visit2_declined: false, visit2_decline_reason: null,
          best_king_rate: 1625, best_suite_rate: null, current_selling_rate: null, occupancy_tax: null, resort_fee: null,
          standard_checkin_time: null, stay2_king_rate: 1000, stay2_suite_rate: null, general_comments: null,
          meeting_space_type: null, meeting_space_count: null, answers: {} },
        { hotel_name: '1 Hotel Brooklyn Bridge', status: 'awarded', staff_notes: null,
          awarded_stay1: false, awarded_stay2: true,
          visit1_declined: false, visit1_decline_reason: null, visit2_declined: false, visit2_decline_reason: null,
          best_king_rate: 999, best_suite_rate: null, current_selling_rate: null, occupancy_tax: null, resort_fee: null,
          standard_checkin_time: null, stay2_king_rate: 499, stay2_suite_rate: null, general_comments: null,
          meeting_space_type: null, meeting_space_count: null, answers: {} },
      ],
      items: [],
    }
    const { wb } = await buildConsolidatedWorkbook([splitCity], 'Brooklyn Nets', { logoUrl: null, awardedOnly: true })
    const ws = wb.worksheets[0]
    const nums = new Set<number>()
    ws.eachRow((row: any) => row.eachCell((c: any) => { if (typeof c.value === 'number') nums.add(c.value) }))
    expect(nums.has(1625)).toBe(true)   // Four Seasons Stay 1 rate — won
    expect(nums.has(499)).toBe(true)    // 1 Hotel Stay 2 rate — won
    expect(nums.has(1000)).toBe(false)  // Four Seasons Stay 2 — NOT won, must be absent
    expect(nums.has(999)).toBe(false)   // 1 Hotel Stay 1 — NOT won, must be absent
  })

  it('stays drawing-free and comment-free even when a logoUrl is given (no Excel "repair")', async () => {
    // Real Excel repairs any grid carrying an image drawing part ("Drawing shape")
    // or a cell comment (legacy VML drawing). The grid must therefore contain
    // NO images and NO comments regardless of logoUrl, so Excel opens it clean.
    const { wb } = await buildConsolidatedWorkbook([city], 'Orlando Magic', {
      logoUrl: 'https://example.com/logo.png',
    })
    const ws = wb.worksheets[0]
    expect(ws.getImages().length).toBe(0)
    let hasComment = false
    ws.eachRow((row: any) => row.eachCell((c: any) => { if (c.note) hasComment = true }))
    expect(hasComment).toBe(false)
  })

  it('pins a valid pageSetup DPI (no 4294967295 overflow that Excel repairs)', async () => {
    const { wb } = await buildConsolidatedWorkbook([city], 'Indiana Pacers', { logoUrl: null })
    const ws: any = wb.worksheets[0]
    // ExcelJS writes -1 as unsignedInt 4294967295 in the XML unless a real DPI
    // is set. Pinning it to 300 is what removes the overflow Excel repairs.
    expect(ws.pageSetup.horizontalDpi).toBe(300)
    expect(ws.pageSetup.verticalDpi).toBe(300)
  })

  it('flags what the hotel changed since its original bid in the Notes column', async () => {
    const changedCity: ConsolidatedCity = {
      trip: { city: 'Denver', opponent_label: 'Colorado Rockies', arrival_date: '2026-09-01',
        departure_date: '2026-09-02', game_date: '2026-09-01', total_rooms_requested: 40 },
      hotels: [{
        hotel_name: 'Changed Hotel', status: 'submitted', staff_notes: null,
        awarded_stay1: false, awarded_stay2: false, visit1_declined: false, visit1_decline_reason: null,
        visit2_declined: false, visit2_decline_reason: null, best_king_rate: 380, best_suite_rate: 900,
        current_selling_rate: null, occupancy_tax: null, resort_fee: null, standard_checkin_time: null,
        general_comments: null, meeting_space_type: null, meeting_space_count: null,
        original_bid: { response: { best_king_rate: 350 }, answers: {} },
        answers: {},
      }],
      items: [],
    } as any
    const { wb } = await buildConsolidatedWorkbook([changedCity], 'Colorado Rockies', { logoUrl: null })
    const ws = wb.worksheets[0]
    let flagged = false
    ws.eachRow((row: any) => row.eachCell((c: any) => {
      if (typeof c.value === 'string' && c.value.includes('Updated by hotel') && c.value.includes('King rate $350 → $380')) flagged = true
    }))
    expect(flagged).toBe(true)
  })

  it('shows Suite Upgrade for teams that store it as Yes/No (Magic, Sharks)', async () => {
    const suiteItem = {
      id: 'itm-upg',
      label: '(4) One-Bedroom Suite Upgrades at group/King rate — must for this team',
      answer_type: 'yes_no',
      requested_value: '4 (Team Hot Button)',
      section: null,
    }
    const yesNoCity: ConsolidatedCity = {
      trip: { city: 'Orlando', opponent_label: 'Orlando Magic', arrival_date: '2026-11-10',
        departure_date: '2026-11-12', game_date: '2026-11-11', total_rooms_requested: 40 },
      hotels: [{
        hotel_name: 'Test Hotel', status: 'submitted', staff_notes: null,
        awarded_stay1: false, awarded_stay2: false, visit1_declined: false, visit1_decline_reason: null,
        visit2_declined: false, visit2_decline_reason: null, best_king_rate: 300, best_suite_rate: 800,
        current_selling_rate: null, occupancy_tax: null, resort_fee: null, standard_checkin_time: null,
        general_comments: null, meeting_space_type: null, meeting_space_count: null,
        answers: { 'itm-upg': { answer_yes_no: true, answer_value: null, comment: 'up to ten (10) upgrades at group rate' } },
      }],
      items: [suiteItem],
    } as any
    const { wb } = await buildConsolidatedWorkbook([yesNoCity], 'Orlando Magic', { logoUrl: null })
    const ws = wb.worksheets[0]
    // Yes/No teams show "Yes" in the Suite UG column (was blank before the fix)
    // and the hotel's note is carried into the Notes column verbatim.
    let foundYes = false
    let foundNote = false
    ws.eachRow((row: any) => row.eachCell((c: any) => {
      if (c.value === 'Yes') foundYes = true
      if (typeof c.value === 'string' && c.value.includes('up to ten (10) upgrades')) foundNote = true
    }))
    expect(foundYes).toBe(true)
    expect(foundNote).toBe(true)
  })
})

describe('non-finite cell guard (the real "we found a problem" cause)', () => {
  it('never writes NaN/Infinity when free-text tax/fee has a comma before digits', async () => {
    // "charge now, which ... 1.5%" — the lone comma used to match firstNum's
    // [\d,]+ regex, strip to "", and produce parseFloat("")=NaN, poisoning the
    // Taxes & Fees / Total / Est. Cost columns with NaN (which Excel repairs).
    const taxCity: ConsolidatedCity = {
      trip: { city: 'Chicago', opponent_label: 'Chicago Bulls', arrival_date: '2026-12-01',
        departure_date: '2026-12-03', game_date: '2026-12-02', total_rooms_requested: 50,
        king_rooms_requested: 45, suites_requested: 5 },
      hotels: [{
        hotel_name: 'Peninsula', status: 'submitted', staff_notes: null,
        awarded_stay1: false, awarded_stay2: false, visit1_declined: false, visit1_decline_reason: null,
        visit2_declined: false, visit2_decline_reason: null, best_king_rate: 380, best_suite_rate: 900,
        current_selling_rate: null, occupancy_tax: '17.4%',
        resort_fee: 'We have a Chicago Fee we have to charge now, which is called Tourism Improvement Fee- 1.5%',
        standard_checkin_time: null, general_comments: null, meeting_space_type: null, meeting_space_count: null,
        answers: {},
      }],
      items: [],
    } as any
    const gridColumns = [
      { type: 'system', key: 'taxes_fees', label: 'Taxes & Fees', width: 12 },
      { type: 'system', key: 'total_per_night', label: 'Total / Night', width: 12 },
      { type: 'system', key: 'est_total_cost', label: 'Est. Total Cost', width: 12 },
    ] as any
    const { wb } = await buildConsolidatedWorkbook([taxCity], 'Chicago Bulls', { logoUrl: null, gridColumns })
    let nonFinite = 0
    wb.worksheets[0].eachRow((row: any) => row.eachCell((c: any) => {
      if (typeof c.value === 'number' && !Number.isFinite(c.value)) nonFinite++
    }))
    expect(nonFinite).toBe(0)
  })
})

describe('sanitizeDrawingXfrm (Excel-safe logo drawing)', () => {
  const PNG = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])

  it('embeds the logo and strips the 0x0 xfrm Excel repairs, keeping the image', async () => {
    const orig = globalThis.fetch
    ;(globalThis as any).fetch = async () => ({
      ok: true, headers: { get: () => 'image/png' },
      arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    })
    try {
      const { wb } = await buildConsolidatedWorkbook([city], 'Orlando Magic', { logoUrl: 'https://x/logo.png' })
      expect(wb.worksheets[0].getImages().length).toBe(1) // logo embedded
      const raw = await wb.xlsx.writeBuffer()
      const clean = await sanitizeDrawingXfrm(raw)
      const zip = await JSZip.loadAsync(clean)
      const drawing = await zip.file('xl/drawings/drawing1.xml')!.async('string')
      expect(drawing).not.toContain('<a:ext cx="0" cy="0"/>') // the repair trigger, removed
      expect(zip.file('xl/media/image1.png')).not.toBeNull()   // image still present
      const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
      expect(sheet).not.toContain('4294967295')                // dpi overflow gone
    } finally {
      globalThis.fetch = orig
    }
  })
})
