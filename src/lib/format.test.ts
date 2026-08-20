import { describe, it, expect } from 'vitest'
import { parseMeetingSpaces, formatMeetingSpaceNotes } from './format'

// The meeting-space parser drives the proposal's "Meeting Space" section on the
// web, Word, and (indirectly) the grid. It caused two reopened tickets, so it's
// the first thing under test.
describe('parseMeetingSpaces', () => {
  const detailsRaw = JSON.stringify({
    __details: {
      item1: { name: 'Ballroom II & III', space_type: 'function_room', dimensions: '3,800' },
      item2: { name: 'Ballroom I', space_type: 'function_room', dimensions: '1,200' },
    },
  })

  it('labels each space by the requested purpose from the item label', () => {
    const labels = {
      item1: 'Complimentary Meeting space (3,000 sq. ft. requested) for meals/meetings, for duration of stay',
      item2: 'Complimentary Meeting space (800 sq. ft. requested) for Coaches Meeting Room, for duration of stay',
    }
    const out = parseMeetingSpaces(detailsRaw, labels)
    expect(out).toEqual([
      { purpose: 'meals/meetings', detail: 'Ballroom II & III · Function Room / Ballroom · Size: 3,800' },
      { purpose: 'Coaches Meeting Room', detail: 'Ballroom I · Function Room / Ballroom · Size: 1,200' },
    ])
  })

  it('leaves purpose null when no item labels are provided', () => {
    const out = parseMeetingSpaces(detailsRaw)
    expect(out.map((e) => e.purpose)).toEqual([null, null])
    expect(out[0].detail).toBe('Ballroom II & III · Function Room / Ballroom · Size: 3,800')
  })

  it('uses the spaceLabel on named sub-spaces', () => {
    const raw = JSON.stringify({ __named: { i: { meal_room: { name: 'Salon A', dimensions: '500', spaceLabel: 'Meal Room' } } } })
    expect(parseMeetingSpaces(raw)).toEqual([{ purpose: 'Meal Room', detail: 'Salon A · Size: 500' }])
  })

  it('treats a plain-text note as one entry, and empty input as none', () => {
    expect(parseMeetingSpaces('Ballroom, 2000 sq ft')).toEqual([{ purpose: null, detail: 'Ballroom, 2000 sq ft' }])
    expect(parseMeetingSpaces('')).toEqual([])
    expect(parseMeetingSpaces(null)).toEqual([])
  })
})

describe('formatMeetingSpaceNotes', () => {
  it('joins each space on its own line (purpose: detail when known)', () => {
    const raw = JSON.stringify({ __named: { i: { meal_room: { name: 'Salon A', dimensions: '500', spaceLabel: 'Meal Room' } } } })
    expect(formatMeetingSpaceNotes(raw)).toBe('Meal Room: Salon A · Size: 500')
  })
  it('returns empty string for empty input', () => {
    expect(formatMeetingSpaceNotes('')).toBe('')
  })
})
