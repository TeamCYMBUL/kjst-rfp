import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatMeetingSpaceNotes } from '../../lib/format'

// ── Types ─────────────────────────────────────────────────────────────────────

type Trip = {
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

type Invitation = {
  id: string
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  status: string
  submitted_at: string | null
}

type Response = {
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

type ConcessionItem = {
  id: string
  section: string
  label: string
  answer_type: string
  sort_order: number
}

type Answer = {
  response_id: string
  concession_item_id: string
  answer_yes_no: boolean | null
  answer_value: string | null
  comment: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d + 'T12:00:00Z')
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n: number | null): string {
  return n != null ? `$${n.toLocaleString()}` : '—'
}

function normLabel(label: string): string {
  return label.toLowerCase().replace(/-/g, ' ')
}

const SECTION_LABELS: Record<string, string> = {
  concessions: 'Concessions',
  facilities: 'Facilities',
  in_season_tournament: 'In-Season Tournament Guarantee',
  postseason: 'Postseason Guarantee',
}
const SECTION_ORDER = ['concessions', 'facilities', 'in_season_tournament', 'postseason']

function answerText(item: ConcessionItem, ans: Answer | undefined): string {
  if (!ans || (ans.answer_yes_no == null && !ans.answer_value)) return '—'
  if (item.answer_type === 'yes_no') return ans.answer_yes_no === true ? 'Yes' : ans.answer_yes_no === false ? 'No' : '—'
  return ans.answer_value || '—'
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProposalPrint() {
  const { id: tripId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const singleInvitationId = searchParams.get('hotel')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [trip, setTrip] = useState<Trip | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [responses, setResponses] = useState<Response[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [concessionItems, setConcessionItems] = useState<ConcessionItem[]>([])

  useEffect(() => {
    if (!tripId) return
    const load = async () => {
      const { data: tripData, error: tripError } = await supabase
        .from('trips')
        .select('id, client_id, opponent_label, city, arrival_date, departure_date, king_rooms_requested, double_rooms_requested, suites_requested, total_rooms_requested, clients(team_name)')
        .eq('id', tripId)
        .single()

      if (tripError || !tripData) { setError(tripError?.message ?? 'Trip not found'); setLoading(false); return }
      const t = tripData as unknown as Trip
      setTrip(t)

      // Which hotels to include: just the one requested, or every submitted bid
      let invQuery = supabase.from('rfp_invitations').select('id, hotel_name, hotel_contact_name, hotel_contact_email, status, submitted_at').eq('trip_id', tripId)
      invQuery = singleInvitationId ? invQuery.eq('id', singleInvitationId) : invQuery.in('status', ['submitted', 'awarded'])
      const { data: invData } = await invQuery
      const invs: Invitation[] = (invData as unknown as Invitation[]) ?? []
      setInvitations(invs)

      // Concession items scoped to THIS trip's client (+ shared master) — an
      // unscoped query would mix in every other client's template now that
      // each client has its own independent RFP.
      const { data: itemsData } = await supabase
        .from('concession_items')
        .select('id, section, label, answer_type, sort_order')
        .or(`client_id.is.null,client_id.eq.${t.client_id}`)
        .eq('archived', false)
        .order('sort_order')
      setConcessionItems((itemsData as unknown as ConcessionItem[]) ?? [])

      if (invs.length > 0) {
        const invIds = invs.map((i) => i.id)
        const { data: respData } = await supabase
          .from('rfp_responses')
          .select('id, invitation_id, best_king_rate, best_suite_rate, current_selling_rate, occupancy_tax, resort_fee, stay2_king_rate, stay2_suite_rate, meeting_space_notes, general_comments, distance_to_arena, standard_checkin_time')
          .in('invitation_id', invIds)
        const resps: Response[] = (respData as unknown as Response[]) ?? []
        setResponses(resps)

        if (resps.length > 0) {
          const respIds = resps.map((r) => r.id)
          const { data: ansData } = await supabase
            .from('concession_answers')
            .select('response_id, concession_item_id, answer_yes_no, answer_value, comment')
            .in('response_id', respIds)
          setAnswers((ansData as unknown as Answer[]) ?? [])
        }
      }
      setLoading(false)
    }
    load()
  }, [tripId, singleInvitationId])

  // Auto-print after data loads
  useEffect(() => {
    if (!loading && trip) {
      const t = setTimeout(() => window.print(), 400)
      return () => clearTimeout(t)
    }
  }, [loading, trip])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: '#64748b' }}>
        Loading proposal…
      </div>
    )
  }

  if (error || !trip) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: '#ef4444' }}>
        {error || 'Trip not found.'}
      </div>
    )
  }

  const primary = '#1C1008'
  const roomBlock = [
    trip.king_rooms_requested != null ? `${trip.king_rooms_requested} kings` : null,
    trip.double_rooms_requested != null ? `${trip.double_rooms_requested} doubles` : null,
    trip.suites_requested != null ? `${trip.suites_requested} suites` : null,
    trip.total_rooms_requested != null ? `${trip.total_rooms_requested} total` : null,
  ].filter(Boolean).join(' · ')

  const TripHeader = (
    <>
      <div style={{ background: primary, color: 'white', borderRadius: '12px 12px 0 0', padding: '24px 32px', marginTop: 80 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.02em' }}>KJ SPORTS TRAVEL</div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.7 }}>{singleInvitationId ? 'Hotel Proposal — Full Copy' : 'Hotel Proposal'}</div>
      </div>
      <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '20px 32px', background: '#f8fafc' }}>
        <div style={{ marginBottom: 6, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
          {trip.clients?.team_name ?? 'Client'}
        </div>
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

  const Footer = (
    <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px 32px', background: '#f8fafc', fontSize: 12, color: '#94a3b8' }}>
      * Rates negotiated exclusively by KJ Sports Travel &nbsp;·&nbsp; team@kjsportstravel.com
    </div>
  )

  const PrintControls = (
    <div className="no-print" style={{ position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 100 }}>
      <button
        onClick={() => window.print()}
        style={{ background: primary, color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        🖨️ Print / Save as PDF
      </button>
      <Link
        to={`/trips/${tripId}`}
        style={{ background: 'white', color: primary, border: `1px solid #e2e8f0`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
      >
        ← Back to Trip
      </Link>
    </div>
  )

  const PrintStyles = (
    <style>{`
      @media print {
        .no-print { display: none !important; }
        @page { margin: 0.75in; }
      }
      * { box-sizing: border-box; }
    `}</style>
  )

  // ── Single-hotel mode: complete copy of everything this hotel submitted ────
  if (singleInvitationId) {
    const inv = invitations[0]
    if (!inv) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: '#ef4444' }}>
          Hotel not found on this trip.
        </div>
      )
    }
    const resp = responses.find((r) => r.invitation_id === inv.id) ?? null
    const hotelAnswers = resp ? answers.filter((a) => a.response_id === resp.id) : []
    const ansByItemId = new Map(hotelAnswers.map((a) => [a.concession_item_id, a]))

    const rateRows: [string, string][] = [
      ['King Rate', fmtMoney(resp?.best_king_rate ?? null)],
      ['Suite Rate', fmtMoney(resp?.best_suite_rate ?? null)],
      ['Selling Rate', resp?.current_selling_rate || '—'],
      ['Occupancy Tax', resp?.occupancy_tax || '—'],
      ['Resort Fee', resp?.resort_fee || '—'],
    ]
    if (resp?.stay2_king_rate != null) rateRows.push(['King Rate — Stay 2', fmtMoney(resp.stay2_king_rate)])
    if (resp?.stay2_suite_rate != null) rateRows.push(['Suite Rate — Stay 2', fmtMoney(resp.stay2_suite_rate)])
    if (resp?.distance_to_arena) rateRows.push(['Distance to arena', resp.distance_to_arena])
    if (resp?.standard_checkin_time) rateRows.push(['Standard check-in', resp.standard_checkin_time])

    return (
      <>
        {PrintStyles}
        {PrintControls}
        <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' }}>
          {TripHeader}

          <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '24px 32px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: primary, marginBottom: 4 }}>{inv.hotel_name}</div>
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
                                  {answerText(item, ans)}
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
          {Footer}
        </div>
      </>
    )
  }

  // ── Multi-hotel mode: side-by-side comparison summary ──────────────────────
  const hotels = invitations.map((inv) => {
    const resp = responses.find((r) => r.invitation_id === inv.id) ?? null
    const hotelAnswers = resp ? answers.filter((a) => a.response_id === resp.id) : []
    return { inv, resp, answers: hotelAnswers }
  })

  const compSuitesItem = concessionItems.find((c) => normLabel(c.label).includes('complimentary one bedroom suite'))
  const suiteUpgItem = concessionItems.find((c) => normLabel(c.label).includes('suite upgrade'))
  const postseasonItem = concessionItems.find((c) => c.section === 'postseason')
  const meetingSpaceItems = concessionItems.filter((c) => c.answer_type === 'yes_no' && (normLabel(c.label).includes('meeting space') || normLabel(c.label).includes('function space')))

  const getAnswer = (hotelIdx: number, itemId: string | undefined) => {
    if (!itemId) return null
    return hotels[hotelIdx].answers.find((a) => a.concession_item_id === itemId) ?? null
  }

  type TableRow = { label: string; values: (string | null)[] }
  const tableRows: TableRow[] = [
    { label: 'Rate / Night', values: hotels.map((h) => fmtMoney(h.resp?.best_king_rate ?? null)) },
    { label: 'Taxes & Fees', values: hotels.map((h) => h.resp?.occupancy_tax || '—') },
    { label: 'Resort Fee', values: hotels.map((h) => h.resp?.resort_fee || '—') },
    { label: 'Comp Suites (FREE)', values: hotels.map((_, i) => getAnswer(i, compSuitesItem?.id)?.answer_value || '—') },
    { label: 'Suite Upgrades at King Rate', values: hotels.map((_, i) => getAnswer(i, suiteUpgItem?.id)?.answer_value || '—') },
    {
      label: 'Playoff / Postseason Clause',
      values: hotels.map((_, i) => {
        const ans = getAnswer(i, postseasonItem?.id)
        return ans ? (ans.answer_yes_no === true ? 'Yes' : ans.answer_yes_no === false ? 'No' : '—') : '—'
      }),
    },
    {
      label: 'Meeting Space (Yes / Total)',
      values: hotels.map((_, i) => {
        if (meetingSpaceItems.length === 0) return '—'
        const yesCount = meetingSpaceItems.filter((item) => getAnswer(i, item.id)?.answer_yes_no === true).length
        return `${yesCount}/${meetingSpaceItems.length}`
      }),
    },
  ]

  return (
    <>
      {PrintStyles}
      {PrintControls}
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' }}>
        {TripHeader}

        {hotels.length > 0 ? (
          <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '24px 32px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: 16 }}>
              HOTEL COMPARISON
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>&nbsp;</th>
                    {hotels.map((h, i) => (
                      <th key={i} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 700, color: primary, whiteSpace: 'nowrap' }}>
                        {h.inv.hotel_name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? 'white' : '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 500, color: '#475569', whiteSpace: 'nowrap' }}>{row.label}</td>
                      {row.values.map((v, ci) => (
                        <td key={ci} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#1e293b' }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
              This is a side-by-side summary. For a complete copy of one hotel's full submission, open that hotel from the trip page and choose "Print full proposal."
            </p>
          </div>
        ) : (
          <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            No submitted bids yet.
          </div>
        )}
        {Footer}
      </div>
    </>
  )
}
