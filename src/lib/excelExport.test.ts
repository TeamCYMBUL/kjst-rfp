import { describe, it, expect } from 'vitest'
import { buildConsolidatedWorkbook, type ConsolidatedCity } from './excelExport'

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
        answers: { 'itm-upg': { answer_yes_no: true, answer_value: null } },
      }],
      items: [suiteItem],
    } as any
    const { wb } = await buildConsolidatedWorkbook([yesNoCity], 'Orlando Magic', { logoUrl: null })
    const ws = wb.worksheets[0]
    // A Yes to a "(4) suite upgrades" question shows the number 4 (was blank
    // before the fix), matching how quantity-storing teams display the column.
    let found4 = false
    ws.eachRow((row: any) => row.eachCell((c: any) => { if (c.value === 4) found4 = true }))
    expect(found4).toBe(true)
  })
})
