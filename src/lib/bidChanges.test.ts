import { describe, it, expect } from 'vitest'
import { diffBid } from './bidChanges'

const label = (id: string) => ({ itm_bfast: 'Breakfast', itm_upg: 'Suite Upgrade' }[id] ?? id)

describe('diffBid', () => {
  it('reports no changes when there is no original snapshot', () => {
    const d = diffBid({ best_king_rate: 380, answers: {} }, label)
    expect(d.hasOriginal).toBe(false)
    expect(d.summary).toEqual([])
  })

  it('flags a changed rate with old → new (money formatted)', () => {
    const d = diffBid({
      best_king_rate: 380,
      original_bid: { response: { best_king_rate: 350 }, answers: {} },
      answers: {},
    }, label)
    expect(d.changedFields.has('best_king_rate')).toBe(true)
    expect(d.summary).toContain('King rate $350 → $380')
  })

  it('does not flag a rate that is unchanged despite string/number difference', () => {
    const d = diffBid({
      best_king_rate: 350,
      original_bid: { response: { best_king_rate: '350' }, answers: {} },
      answers: {},
    }, label)
    expect(d.changedFields.has('best_king_rate')).toBe(false)
    expect(d.summary).toEqual([])
  })

  it('flags a changed concession answer (Yes → No) by item label', () => {
    const d = diffBid({
      original_bid: { response: {}, answers: { itm_bfast: { answer_yes_no: true, answer_value: null, comment: null } } },
      answers: { itm_bfast: { answer_yes_no: false, answer_value: null, comment: null } },
    }, label)
    expect(d.changedAnswers.has('itm_bfast')).toBe(true)
    expect(d.summary).toContain('Breakfast Yes → No')
  })

  it('flags a changed quantity answer and leaves unchanged ones alone', () => {
    const d = diffBid({
      original_bid: {
        response: {},
        answers: {
          itm_upg: { answer_yes_no: null, answer_value: '2', comment: null },
          itm_bfast: { answer_yes_no: true, answer_value: null, comment: null },
        },
      },
      answers: {
        itm_upg: { answer_yes_no: null, answer_value: '4', comment: null },
        itm_bfast: { answer_yes_no: true, answer_value: null, comment: null },
      },
    }, label)
    expect(d.changedAnswers.has('itm_upg')).toBe(true)
    expect(d.changedAnswers.has('itm_bfast')).toBe(false)
    expect(d.summary).toContain('Suite Upgrade 2 → 4')
  })
})
