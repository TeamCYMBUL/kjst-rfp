import { describe, it, expect } from 'vitest'
import { Packer } from 'docx'
import { buildProposalDoc, type DocxTrip, type DocxHotel } from './reportDocx'

// Smoke test: a 2-visit trip with a meeting-space bid must build a valid .docx
// (non-empty, real ZIP) without throwing. Exercises the stay-2 date/rate rows
// and the meeting-space table — the areas that caused reopened tickets.
const trip: DocxTrip = {
  team_name: 'Cleveland Cavaliers',
  opponent_label: 'Boston Celtics',
  city: 'Boston',
  arrival_date: '2026-12-27',
  departure_date: '2026-12-28',
  stay2_arrival_date: '2027-02-25',
  stay2_departure_date: '2027-02-26',
  king_rooms_requested: 66,
  double_rooms_requested: 0,
  suites_requested: 9,
  total_rooms_requested: 75,
}

const hotel: DocxHotel = {
  inv: {
    hotel_name: 'Four Seasons Hotel Atlanta',
    hotel_contact_name: 'Ali DeBerry',
    hotel_contact_email: 'ali.deberry@fourseasons.com',
    submitted_at: '2026-08-18T12:00:00Z',
    visit1_declined: false,
    visit2_declined: false,
  },
  resp: {
    best_king_rate: 325,
    best_suite_rate: 950,
    current_selling_rate: '900',
    occupancy_tax: '16.9% + $5 per night',
    resort_fee: null,
    stay2_king_rate: 399,
    stay2_suite_rate: 950,
    meeting_space_notes: JSON.stringify({
      __details: { item1: { name: 'Ballroom II & III', space_type: 'function_room', dimensions: '3,800' } },
    }),
    general_comments: null,
    distance_to_arena: null,
    standard_checkin_time: null,
  },
  answers: [],
  concessionItems: [
    { id: 'item1', section: 'concessions', label: 'Complimentary Meeting space (3,000 sq. ft. requested) for meals/meetings, for duration of stay', answer_type: 'yes_no', sort_order: 210 },
  ],
}

describe('buildProposalDoc', () => {
  it('builds a valid .docx for a 2-visit trip with meeting space', async () => {
    const doc = buildProposalDoc({ subtitle: 'Hotel Proposals — Full Copy', groups: [{ trip, hotels: [hotel] }] })
    const buf = await Packer.toBuffer(doc)
    expect(buf.length).toBeGreaterThan(1000)
    // .docx is a ZIP — first two bytes are "PK". A corrupt/empty build fails here.
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('builds when a trip has no bids yet', async () => {
    const doc = buildProposalDoc({ subtitle: 'Full Copy', groups: [{ trip, hotels: [] }] })
    const buf = await Packer.toBuffer(doc)
    expect(buf.length).toBeGreaterThan(500)
    expect(buf[0]).toBe(0x50)
  })
})
