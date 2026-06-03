import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Trip = {
  id: string
  opponent_label: string | null
  city: string | null
  arrival_date: string | null
  departure_date: string | null
  king_rooms_requested: number | null
  suites_requested: number | null
  clients: { team_name: string } | null
}

type Invitation = {
  id: string
  hotel_name: string
  status: string
}

type Response = {
  id: string
  invitation_id: string
  best_king_rate: number | null
  occupancy_tax: string | null
}

type ConcessionItem = {
  id: string
  section: string
  label: string
  answer_type: string
  sort_order: number
}

type Answer = {
  id: string
  response_id: string
  concession_item_id: string
  answer_yes_no: boolean | null
  answer_value: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d + 'T12:00:00Z')
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProposalPrint() {
  const { id: tripId } = useParams<{ id: string }>()
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
      const [tripRes, invRes, itemsRes] = await Promise.all([
        supabase.from('trips').select('id, opponent_label, city, arrival_date, departure_date, king_rooms_requested, suites_requested, clients(team_name)').eq('id', tripId).single(),
        supabase.from('rfp_invitations').select('id, hotel_name, status').eq('trip_id', tripId).in('status', ['submitted', 'awarded']),
        supabase.from('concession_items').select('id, section, label, answer_type, sort_order').order('sort_order'),
      ])

      if (tripRes.error) { setError(tripRes.error.message); setLoading(false); return }
      setTrip(tripRes.data as unknown as Trip)
      const invs: Invitation[] = (invRes.data as unknown as Invitation[]) ?? []
      setInvitations(invs)
      setConcessionItems((itemsRes.data as unknown as ConcessionItem[]) ?? [])

      if (invs.length > 0) {
        const invIds = invs.map((i) => i.id)
        const respRes = await supabase.from('rfp_responses').select('id, invitation_id, best_king_rate, occupancy_tax').in('invitation_id', invIds)
        const resps: Response[] = (respRes.data as unknown as Response[]) ?? []
        setResponses(resps)

        if (resps.length > 0) {
          const respIds = resps.map((r) => r.id)
          const ansRes = await supabase.from('rfp_answers').select('id, response_id, concession_item_id, answer_yes_no, answer_value').in('response_id', respIds)
          setAnswers((ansRes.data as unknown as Answer[]) ?? [])
        }
      }
      setLoading(false)
    }
    load()
  }, [tripId])

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

  // Build hotel columns
  const hotels = invitations.map((inv) => {
    const resp = responses.find((r) => r.invitation_id === inv.id) ?? null
    const hotelAnswers = resp ? answers.filter((a) => a.response_id === resp.id) : []
    return { inv, resp, answers: hotelAnswers }
  })

  // Find concession items for specific rows
  const compSuitesItem = concessionItems.find((c) => c.label.toLowerCase().includes('complimentary one bedroom'))
  const suiteUpgItem = concessionItems.find((c) => c.label.toLowerCase().includes('suite upgrades at the group'))
  const postseasonItem = concessionItems.find((c) => c.section === 'postseason')
  const meetingSpaceItem = concessionItems.find((c) => c.label.toLowerCase().includes('meeting space') && c.label.toLowerCase().includes('3,000'))

  const getAnswer = (hotelIdx: number, itemId: string | undefined) => {
    if (!itemId) return null
    return hotels[hotelIdx].answers.find((a) => a.concession_item_id === itemId) ?? null
  }

  type TableRow = { label: string; values: (string | null)[] }
  const tableRows: TableRow[] = []

  // Rate / Night
  tableRows.push({
    label: 'Rate / Night',
    values: hotels.map((h) => h.resp?.best_king_rate != null ? `$${h.resp.best_king_rate.toLocaleString()}` : '—'),
  })

  // Taxes & Fees
  tableRows.push({
    label: 'Taxes & Fees',
    values: hotels.map((h) => h.resp?.occupancy_tax || '—'),
  })

  // Comp Suites (FREE)
  tableRows.push({
    label: 'Comp Suites (FREE)',
    values: hotels.map((_, i) => {
      const ans = getAnswer(i, compSuitesItem?.id)
      return ans?.answer_value || '—'
    }),
  })

  // Suite Upgrades at King Rate
  tableRows.push({
    label: 'Suite Upgrades at King Rate',
    values: hotels.map((_, i) => {
      const ans = getAnswer(i, suiteUpgItem?.id)
      return ans?.answer_value || '—'
    }),
  })

  // Playoff / Postseason Clause
  tableRows.push({
    label: 'Playoff / Postseason Clause',
    values: hotels.map((_, i) => {
      const ans = getAnswer(i, postseasonItem?.id)
      if (!ans) return '—'
      return ans.answer_yes_no === true ? 'Yes' : ans.answer_yes_no === false ? 'No' : '—'
    }),
  })

  // Meeting Space Available
  tableRows.push({
    label: 'Meeting Space Available',
    values: hotels.map((_, i) => {
      const ans = getAnswer(i, meetingSpaceItem?.id)
      if (!ans) return '—'
      return ans.answer_yes_no === true ? 'Yes' : ans.answer_yes_no === false ? 'No' : '—'
    }),
  })

  // ── Styles ────────────────────────────────────────────────────────────────
  const primary = '#1C1008'

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 0.75in; }
        }
        * { box-sizing: border-box; }
      `}</style>

      {/* No-print controls */}
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

      {/* Proposal content */}
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' }}>
        {/* Header */}
        <div style={{ background: primary, color: 'white', borderRadius: '12px 12px 0 0', padding: '24px 32px', marginTop: 80 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.02em' }}>KJ SPORTS TRAVEL</div>
          <div style={{ fontSize: 13, marginTop: 4, opacity: 0.7 }}>Hotel Proposal</div>
        </div>

        {/* Trip info bar */}
        <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '20px 32px', background: '#f8fafc' }}>
          <div style={{ marginBottom: 6, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
            {trip.clients?.team_name ?? 'Client'}
          </div>
          <div style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>
            {trip.opponent_label ?? 'Trip'}{trip.city ? ` · ${trip.city}` : ''}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: 8 }}>
            {trip.arrival_date && (
              <span><strong style={{ color: '#334155' }}>Check-in:</strong> {fmtDate(trip.arrival_date)}</span>
            )}
            {trip.departure_date && (
              <span><strong style={{ color: '#334155' }}>Check-out:</strong> {fmtDate(trip.departure_date)}</span>
            )}
            {(trip.king_rooms_requested != null || trip.suites_requested != null) && (
              <span>
                <strong style={{ color: '#334155' }}>Room Block:</strong>{' '}
                {[
                  trip.king_rooms_requested != null ? `${trip.king_rooms_requested} kings` : null,
                  trip.suites_requested != null ? `${trip.suites_requested} suites` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </div>

        {/* Comparison table */}
        {hotels.length > 0 ? (
          <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '24px 32px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: 16 }}>
              HOTEL COMPARISON
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
                      &nbsp;
                    </th>
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
                      <td style={{ padding: '10px 16px', fontWeight: 500, color: '#475569', whiteSpace: 'nowrap' }}>
                        {row.label}
                      </td>
                      {row.values.map((v, ci) => (
                        <td key={ci} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#1e293b' }}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            No submitted bids yet.
          </div>
        )}

        {/* Footer */}
        <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px 32px', background: '#f8fafc', fontSize: 12, color: '#94a3b8' }}>
          * Rates negotiated exclusively by KJ Sports Travel &nbsp;·&nbsp; team@kjsportstravel.com
        </div>
      </div>
    </>
  )
}
