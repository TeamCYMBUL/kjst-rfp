import { describe, it, expect } from 'vitest'
import { generateToken } from './format'
import { readSuiteUpgrade } from './excelExport'

// Safety net around the two pieces of RFP-flow logic most worth protecting:
// the token that guards every hotel link, and the concession-answer reader that
// once mis-rendered bids. Both broke (or could break) in ways a hotel would see
// before we would, so they get locked down here.

describe('generateToken — hotel link security', () => {
  it('is 32 url-safe chars with no padding (base64url of 24 CSPRNG bytes = 192 bits)', () => {
    for (let i = 0; i < 50; i++) {
      const t = generateToken()
      expect(t).toHaveLength(32)
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/) // url-safe alphabet only
      expect(t).not.toContain('=') // padding stripped
      expect(t).not.toContain('+') // '+' replaced with '-'
      expect(t).not.toContain('/') // '/' replaced with '_'
    }
  })

  it('is unique across many draws (no sequential / low-entropy generator)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) seen.add(generateToken())
    expect(seen.size).toBe(5000) // zero collisions => real randomness, not a counter
  })
})

describe('readSuiteUpgrade — concession answer shape', () => {
  const item = {} // no requested count => Yes counts as 0, keeps assertions simple

  it('no answer renders blank / zero', () => {
    expect(readSuiteUpgrade(item, null)).toEqual({ display: null, count: 0, note: null })
    expect(readSuiteUpgrade(item, { answer_yes_no: null, answer_value: null })).toEqual({ display: null, count: 0, note: null })
  })

  it('Yes/No answers render Yes/No and surface the note where the real offer lives', () => {
    expect(readSuiteUpgrade(item, { answer_yes_no: true, answer_value: null, comment: 'up to 10 at group rate' }))
      .toEqual({ display: 'Yes', count: 0, note: 'up to 10 at group rate' })
    expect(readSuiteUpgrade(item, { answer_yes_no: false, answer_value: null, comment: null }))
      .toEqual({ display: 'No', count: 0, note: null })
  })

  it('a numeric answer displays and counts as itself', () => {
    expect(readSuiteUpgrade(item, { answer_yes_no: null, answer_value: '5' }))
      .toEqual({ display: 5, count: 5, note: null })
    expect(readSuiteUpgrade(item, { answer_yes_no: null, answer_value: '' }))
      .toEqual({ display: null, count: 0, note: null })
  })

  it('keys off answer_yes_no over answer_value (the original bug: never off answer_type)', () => {
    // A Yes/No item that also happens to carry a stray answer_value must render
    // as Yes, not as the number — this is the exact mix that broke before.
    expect(readSuiteUpgrade(item, { answer_yes_no: true, answer_value: '99', comment: null }))
      .toEqual({ display: 'Yes', count: 0, note: null })
  })
})
