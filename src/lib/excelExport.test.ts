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

  it('embeds a client logo as a single image with no cell comments (no Excel-repair)', async () => {
    // A tiny valid 1x1 PNG.
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ])
    const orig = globalThis.fetch
    ;(globalThis as any).fetch = async () => ({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    })
    try {
      const { wb } = await buildConsolidatedWorkbook([city], 'Orlando Magic', {
        logoUrl: 'https://example.com/logo.png',
      })
      const ws = wb.worksheets[0]
      // Exactly one embedded image (the logo).
      expect(ws.getImages().length).toBe(1)
      // No cell comments anywhere — a comment + image is what made ExcelJS emit a
      // legacy VML drawing alongside the image drawing, which Excel then "repaired".
      let hasComment = false
      ws.eachRow((row: any) => row.eachCell((c: any) => { if (c.note) hasComment = true }))
      expect(hasComment).toBe(false)
      // Round-trips to a valid ZIP.
      const buf = await wb.xlsx.writeBuffer()
      const bytes = new Uint8Array(buf as ArrayBuffer)
      expect(bytes[0]).toBe(0x50)
      expect(bytes[1]).toBe(0x4b)
    } finally {
      globalThis.fetch = orig
    }
  })
})
