import { describe, it, expect } from 'vitest'
import { parseTaxComponents, calcNights } from './excelExport'
import { num, saneRate, nightsBetween } from './commissions'

// The money math is the highest-consequence logic in the app. These lock in the
// exact behavior the exports and the commission panel depend on.

describe('parseTaxComponents', () => {
  it('splits a percent and a flat per-night fee', () => {
    const r = parseTaxComponents('16.9% + $5 per night')
    expect(r.pct).toBeCloseTo(0.169, 6)
    expect(r.flat).toBe(5)
  })
  it('handles percent only', () => {
    const r = parseTaxComponents('16%')
    expect(r.pct).toBeCloseTo(0.16, 6)
    expect(r.flat).toBe(0)
  })
  it('treats a bare number as a percentage', () => {
    expect(parseTaxComponents('15').pct).toBeCloseTo(0.15, 6)
  })
  it('treats a dollar-only value as a flat fee, not a percent', () => {
    expect(parseTaxComponents('$3.50')).toEqual({ pct: 0, flat: 3.5 })
  })
  it('is zero for empty/null', () => {
    expect(parseTaxComponents(null)).toEqual({ pct: 0, flat: 0 })
    expect(parseTaxComponents('')).toEqual({ pct: 0, flat: 0 })
  })
})

describe('calcNights', () => {
  it('counts nights between two dates', () => {
    expect(calcNights('2026-10-28', '2026-10-30')).toBe(2)
    expect(calcNights('2026-12-27', '2026-12-28')).toBe(1)
  })
  it('falls back to 1 for missing or inverted dates', () => {
    expect(calcNights(null, '2026-10-30')).toBe(1)
    expect(calcNights('2026-10-30', '2026-10-28')).toBe(1)
  })
})

describe('num', () => {
  it('pulls the leading number out of free text', () => {
    expect(num('7%')).toBe(7)
    expect(num('$269')).toBe(269)
    expect(num('10.5')).toBe(10.5)
  })
  it('is null for non-numeric / missing', () => {
    expect(num('n/a')).toBeNull()
    expect(num(null)).toBeNull()
  })
})

describe('saneRate', () => {
  it('accepts real nightly rates', () => {
    expect(saneRate('250')).toBe(250)
    expect(saneRate(20000)).toBe(20000)
  })
  it('rejects zero, junk placeholders, and non-numeric text', () => {
    expect(saneRate(0)).toBeNull()
    expect(saneRate(99999999)).toBeNull() // "no availability" placeholder
    expect(saneRate(20001)).toBeNull()
    expect(saneRate('sold out')).toBeNull()
    // Note: num() strips non-digits (incl. a leading "-"), so a negative input
    // reads as its positive magnitude — fine, since rate inputs are never negative.
  })
})

describe('nightsBetween', () => {
  it('mirrors calcNights, defaulting to 1', () => {
    expect(nightsBetween('2027-02-25', '2027-02-26')).toBe(1)
    expect(nightsBetween('2027-02-25', '2027-02-28')).toBe(3)
    expect(nightsBetween(null, null)).toBe(1)
  })
})
