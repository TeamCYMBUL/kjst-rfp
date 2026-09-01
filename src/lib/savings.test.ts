import { describe, it, expect } from 'vitest'
import { computeSavings, type SavingsInput } from './savings'

const base: SavingsInput = {
  tripId: 't1', clientId: 'c1', clientName: 'Team', city: 'Boston', opponent: 'Nets',
  rooms: 50, nights1: 2, nights2: 1, wonStay1: true, wonStay2: false,
  king1: 300, king2: null, selling1: 400, selling2: null,
}

describe('computeSavings', () => {
  it('savings = (selling − awarded) × rooms × nights, per won stay', () => {
    // (400 − 300) × 50 × 2 = 10,000
    const r = computeSavings([base])
    expect(r.total).toBe(10_000)
    expect(r.benchmarkedTrips).toBe(1)
    expect(r.trips[0].saved).toBe(10_000)
  })

  it('adds stay 2 on a two-visit split award', () => {
    // stay1 (400−300)×50×2 = 10,000 ; stay2 (250−200)×50×1 = 2,500 ; total 12,500
    const r = computeSavings([{ ...base, wonStay2: true, king2: 200, selling2: 250 }])
    expect(r.total).toBe(12_500)
  })

  it('ignores trips with no selling-rate benchmark (conservative by design)', () => {
    const r = computeSavings([{ ...base, selling1: null }])
    expect(r.total).toBe(0)
    expect(r.benchmarkedTrips).toBe(0)
  })

  it('ignores a stay that was not won', () => {
    // stay2 has a benchmark but was not awarded — only stay1 counts
    const r = computeSavings([{ ...base, wonStay2: false, king2: 200, selling2: 500 }])
    expect(r.total).toBe(10_000)
  })

  it('reflects an overpay honestly rather than hiding it', () => {
    // awarded above market => negative contribution, kept for a truthful total
    const r = computeSavings([{ ...base, king1: 450 }]) // (400−450)×50×2 = −5,000
    expect(r.total).toBe(-5_000)
  })

  it('sorts trips by savings, biggest first', () => {
    const small = { ...base, tripId: 't-small', selling1: 320 } // 100k... (320-300)*50*2=2000
    const big = { ...base, tripId: 't-big', selling1: 500 } // (500-300)*50*2=20000
    const r = computeSavings([small, big])
    expect(r.trips.map((t) => t.tripId)).toEqual(['t-big', 't-small'])
  })
})
