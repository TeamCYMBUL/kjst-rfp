// Shared proposal print/render pieces, used by both the per-trip ProposalPrint
// and the client-wide ClientProposalsPrint so the two always look identical.
import { formatMeetingSpaceNotes } from '../../lib/format'
import { supabase } from '../../lib/supabase'

export const PRIMARY = '#1C1008'

// ── Types ─────────────────────────────────────────────────────────────────────
export type ProposalTrip = {
  id: string
  client_id: string
  opponent_label: string | null
  city: string | null
  arrival_date: string | null
  departure_date: string | null
  king_rooms_requested: number | null
  double_rooms_requested: number | null
  suites_requested: number | null
  total_rooms_requested: number | null
  clients: { team_name: string } | null
}

export type ProposalInvitation = {
  id: string
  trip_id?: string
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  status: string
  submitted_at: string | null
  visit1_declined: boolean
  visit2_declined: boolean
}

export type ProposalResponse = {
  id: string
  invitation_id: string
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
}

export type ProposalConcessionItem = {
  id: string
  section: string
  label: string
  answer_type: string
  sort_order: number
}

export type ProposalAnswer = {
  response_id: string
  concession_item_id: string
  answer_yes_no: boolean | null
  answer_value: string | null
  comment: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function fmtDate(d: string | null): string {
  if (!d) return '—'
  // Trip dates are date-only ('YYYY-MM-DD'); submitted_at is a full timestamp.
  // Pin the former to noon UTC to avoid a timezone day-shift; parse the latter as-is.
  const dt = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00Z')
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
export function fmtMoney(n: number | null): string {
  return n != null ? `$${n.toLocaleString()}` : '—'
}
export function normLabel(label: string): string {
  return label.toLowerCase().replace(/-/g, ' ')
}
export const SECTION_LABELS: Record<string, string> = {
  concessions: 'Concessions',
  facilities: 'Facilities',
  in_season_tournament: 'In-Season Tournament Guarantee',
  postseason: 'Postseason Guarantee',
}
export const SECTION_ORDER = ['concessions', 'facilities', 'in_season_tournament', 'postseason']

// Ensure every question a bid actually answered is present in the item list the
// proposal renders — even questions later archived or replaced during a template
// rework, which the scoped (archived = false) query would otherwise drop. Without
// this, an already-submitted bid's printed proposal silently shows a dash for
// those rows instead of the Yes/No the hotel gave. Returns the list merged and
// re-sorted; a no-op when nothing is missing.
export async function includeAnsweredItems(
  items: ProposalConcessionItem[],
  answers: ProposalAnswer[],
): Promise<ProposalConcessionItem[]> {
  const have = new Set(items.map((i) => i.id))
  const missingIds = [...new Set(answers.map((a) => a.concession_item_id))].filter((id) => !have.has(id))
  if (missingIds.length === 0) return items
  const { data: extra } = await supabase
    .from('concession_items')
    .select('id, section, label, answer_type, sort_order')
    .in('id', missingIds)
  const extraItems = (extra as unknown as ProposalConcessionItem[]) ?? []
  if (extraItems.length === 0) return items
  return [...items, ...extraItems].sort((a, b) => a.sort_order - b.sort_order)
}

export function answerText(ans: ProposalAnswer | undefined, answerType?: string): string {
  if (!ans || (ans.answer_yes_no == null && !ans.answer_value)) return '—'
  // Show the actual answer: a Yes/No if the hotel gave one (covers items later
  // switched to quantity), otherwise the entered value with its unit. Currency
  // and percent values are stored as bare numbers, so re-attach $ / % to match
  // the on-screen comparison grid (otherwise a "$6.00 per person" reads as "6").
  if (ans.answer_yes_no != null) return ans.answer_yes_no === true ? 'Yes' : 'No'
  const val = ans.answer_value
  if (!val) return '—'
  if (answerType === 'currency') return `$${val}`
  if (answerType === 'percent') return `${val}%`
  return val
}

// ── Reusable print chrome ───────────────────────────────────────────────────
export const PrintStyles = (
  <style>{`
    @media print {
      .no-print { display: none !important; }
      @page { margin: 0.75in; }
    }
    * { box-sizing: border-box; }
  `}</style>
)

export function TripHeader({ trip, subtitle }: { trip: ProposalTrip; subtitle: string }) {
  const roomBlock = [
    trip.king_rooms_requested != null ? `${trip.king_rooms_requested} kings` : null,
    trip.double_rooms_requested != null ? `${trip.double_rooms_requested} doubles` : null,
    trip.suites_requested != null ? `${trip.suites_requested} suites` : null,
    trip.total_rooms_requested != null ? `${trip.total_rooms_requested} total` : null,
  ].filter(Boolean).join(' · ')
  return (
    <>
      <div style={{ background: PRIMARY, color: 'white', borderRadius: '12px 12px 0 0', padding: '24px 32px', marginTop: 80 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.02em' }}>KJ SPORTS TRAVEL</div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.7 }}>{subtitle}</div>
      </div>
      <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '20px 32px', background: '#f8fafc' }}>
        <div style={{ marginBottom: 6, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{trip.clients?.team_name ?? 'Client'}</div>
        <div style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>
          {trip.opponent_label ?? 'Trip'}{trip.city ? ` · ${trip.city}` : ''}
        </div>
        <div style={{ fontSize: 13, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: 8 }}>
          {trip.arrival_date && <span><strong style={{ color: '#334155' }}>Check-in:</strong> {fmtDate(trip.arrival_date)}</span>}
          {trip.departure_date && <span><strong style={{ color: '#334155' }}>Check-out:</strong> {fmtDate(trip.departure_date)}</span>}
          {roomBlock && <span><strong style={{ color: '#334155' }}>Room Block:</strong> {roomBlock}</span>}
        </div>
      </div>
    </>
  )
}

export const ProposalFooter = (
  <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px 32px', background: '#f8fafc', fontSize: 12, color: '#94a3b8' }}>
    * Rates negotiated exclusively by KJ Sports Travel &nbsp;·&nbsp; team@kjsportstravel.com
  </div>
)

// ── One hotel's full write-up ────────────────────────────────────────────────
export function HotelFull({
  inv, resp, answers, concessionItems, pageBreak,
}: {
  inv: ProposalInvitation
  resp: ProposalResponse | null
  answers: ProposalAnswer[]
  concessionItems: ProposalConcessionItem[]
  pageBreak: boolean
}) {
  const hotelAnswers = resp ? answers.filter((a) => a.response_id === resp.id) : []
  const ansByItemId = new Map(hotelAnswers.map((a) => [a.concession_item_id, a]))

  // When the bid also carries a second visit (same city twice), label the
  // first-visit rates "— Stay 1" so they read clearly against the "— Stay 2"
  // rows below. Single-visit trips keep the plain "King Rate" / "Suite Rate".
  const hasStay2Rows = inv.visit2_declined || resp?.stay2_king_rate != null || resp?.stay2_suite_rate != null
  const s1 = hasStay2Rows ? ' — Stay 1' : ''
  const rateRows: [string, string][] = inv.visit1_declined
    ? [
      [`King/Suite/Selling Rate${s1}`, 'Visit 1 declined'],
      ['Occupancy Tax', resp?.occupancy_tax || '—'],
      ['Resort Fee', resp?.resort_fee || '—'],
    ]
    : [
      [`King Rate${s1}`, fmtMoney(resp?.best_king_rate ?? null)],
      [`Suite Rate${s1}`, fmtMoney(resp?.best_suite_rate ?? null)],
      ['Selling Rate', resp?.current_selling_rate || '—'],
      ['Occupancy Tax', resp?.occupancy_tax || '—'],
      ['Resort Fee', resp?.resort_fee || '—'],
    ]
  if (inv.visit2_declined) rateRows.push(['King/Suite Rate — Stay 2', 'Visit 2 declined'])
  else if (resp?.stay2_king_rate != null) rateRows.push(['King Rate — Stay 2', fmtMoney(resp.stay2_king_rate)])
  if (!inv.visit2_declined && resp?.stay2_suite_rate != null) rateRows.push(['Suite Rate — Stay 2', fmtMoney(resp.stay2_suite_rate)])
  if (resp?.distance_to_arena) rateRows.push(['Distance to arena', resp.distance_to_arena])
  if (resp?.standard_checkin_time) rateRows.push(['Standard check-in', resp.standard_checkin_time])

  return (
    <div style={pageBreak ? { pageBreakAfter: 'always' } : undefined}>
      <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '24px 32px' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: PRIMARY, marginBottom: 4 }}>{inv.hotel_name}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          {[inv.hotel_contact_name, inv.hotel_contact_email].filter(Boolean).join(' · ') || 'No contact on file'}
          {inv.submitted_at ? ` · Submitted ${fmtDate(inv.submitted_at)}` : ''}
        </div>
        {resp ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: 8 }}>Rates</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 20 }}>
              <tbody>
                {rateRows.map(([label, value], i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 12px', color: '#64748b' }}>{label}</td>
                    <td style={{ padding: '6px 12px', fontWeight: 600, color: '#111827', textAlign: 'right' }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {resp.meeting_space_notes && (
              <div style={{ fontSize: 13, color: '#374151', marginBottom: 16, whiteSpace: 'pre-line' }}>
                <strong>Meeting space:</strong> {formatMeetingSpaceNotes(resp.meeting_space_notes)}
              </div>
            )}
            {SECTION_ORDER.map((sectionKey) => {
              const items = concessionItems.filter((c) => c.section === sectionKey).sort((a, b) => a.sort_order - b.sort_order)
              if (items.length === 0) return null
              return (
                <div key={sectionKey} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: 8 }}>
                    {SECTION_LABELS[sectionKey] ?? sectionKey}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      {items.map((item) => {
                        const ans = ansByItemId.get(item.id)
                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 12px', color: '#374151', verticalAlign: 'top' }}>
                              {item.label}
                              {ans?.comment && (
                                <div style={{ marginTop: 2, fontSize: 12, color: '#92400e', background: '#fffbeb', borderRadius: 4, padding: '3px 8px', display: 'inline-block' }}>
                                  {ans.comment}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '6px 12px', fontWeight: 600, color: '#111827', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                              {answerText(ans, item.answer_type)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
            {resp.general_comments && (
              <div style={{ fontSize: 13, color: '#374151' }}>
                <strong>General comments:</strong> {resp.general_comments}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>No response submitted yet.</div>
        )}
      </div>
    </div>
  )
}
