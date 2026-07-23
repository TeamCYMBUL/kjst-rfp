import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  PRIMARY, fmtMoney, normLabel, includeAnsweredItems,
  TripHeader, ProposalFooter, PrintStyles, HotelFull,
  type ProposalTrip as Trip,
  type ProposalInvitation as Invitation,
  type ProposalResponse as Response,
  type ProposalConcessionItem as ConcessionItem,
  type ProposalAnswer as Answer,
} from './proposalRender'

// ── Main component ────────────────────────────────────────────────────────────

export default function ProposalPrint() {
  const { id: tripId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const hotelParam = searchParams.get('hotel')
  const allHotelsMode = hotelParam === 'all'
  const newMode = hotelParam === 'new' // only bids not yet printed (progressive batch)
  const singleInvitationId = hotelParam && !allHotelsMode && !newMode ? hotelParam : null
  const fullDetailMode = Boolean(singleInvitationId) || allHotelsMode || newMode

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

      // Which hotels to include: one requested hotel, every submitted bid ("all"),
      // or only bids not yet printed ("new" — progressive batch).
      let invQuery = supabase.from('rfp_invitations').select('id, hotel_name, hotel_contact_name, hotel_contact_email, status, submitted_at, visit1_declined, visit2_declined').eq('trip_id', tripId)
      if (singleInvitationId) {
        invQuery = invQuery.eq('id', singleInvitationId)
      } else {
        invQuery = invQuery.in('status', ['submitted', 'awarded'])
        if (newMode) invQuery = invQuery.is('printed_at', null)
      }
      const { data: invData } = await invQuery
      const invs: Invitation[] = (invData as unknown as Invitation[]) ?? []
      setInvitations(invs)

      // Printing a full proposal marks those hotels as printed, so the next
      // "print new" run only picks up bids that have arrived since.
      if (fullDetailMode && invs.length > 0) {
        await supabase
          .from('rfp_invitations')
          .update({ printed_at: new Date().toISOString() })
          .in('id', invs.map((i) => i.id))
      }

      // Concession items scoped to THIS trip's client (+ shared master) — an
      // unscoped query would mix in every other client's template now that
      // each client has its own independent RFP.
      const { data: itemsData } = await supabase
        .from('concession_items')
        .select('id, section, label, answer_type, sort_order')
        .or(`client_id.is.null,client_id.eq.${t.client_id}`)
        .eq('archived', false)
        .order('sort_order')
      let items = (itemsData as unknown as ConcessionItem[]) ?? []

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
          const ansRows = (ansData as unknown as Answer[]) ?? []
          setAnswers(ansRows)

          // Include any answered question missing from the scoped list (archived
          // or replaced after this bid was submitted), so the proposal never
          // silently prints a dash where the hotel actually answered.
          items = await includeAnsweredItems(items, ansRows)
        }
      }
      setConcessionItems(items)
      setLoading(false)
    }
    load()
  }, [tripId, hotelParam])

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

  const PrintControls = (
    <div className="no-print" style={{ position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 100 }}>
      <button
        onClick={() => window.print()}
        style={{ background: PRIMARY, color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        Print / Save as PDF
      </button>
      {!fullDetailMode && (
        <Link
          to={`/trips/${tripId}/proposal?hotel=all`}
          style={{ background: 'white', color: PRIMARY, border: `1px solid #e2e8f0`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
        >
          Print All Full Proposals
        </Link>
      )}
      <Link
        to={`/trips/${tripId}`}
        style={{ background: 'white', color: PRIMARY, border: `1px solid #e2e8f0`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
      >
        ← Back to Trip
      </Link>
    </div>
  )

  // ── Full-copy mode: one hotel, or every submitted bid batched together ─────
  if (fullDetailMode) {
    if (singleInvitationId && !invitations[0]) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: '#ef4444' }}>
          Hotel not found on this trip.
        </div>
      )
    }

    return (
      <>
        {PrintStyles}
        {PrintControls}
        <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' }}>
          <TripHeader trip={trip} subtitle="Hotel Proposal — Full Copy" />
          {(allHotelsMode || newMode) && invitations.length === 0 ? (
            <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
              {newMode ? 'No new proposals since your last print.' : 'No submitted bids yet.'}
            </div>
          ) : (
            invitations.map((inv, i) => (
              <HotelFull
                key={inv.id}
                inv={inv}
                resp={responses.find((r) => r.invitation_id === inv.id) ?? null}
                answers={answers}
                concessionItems={concessionItems}
                pageBreak={allHotelsMode && i !== invitations.length - 1}
              />
            ))
          )}
          {ProposalFooter}
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
        <TripHeader trip={trip} subtitle="Hotel Proposal" />

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
                      <th key={i} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 700, color: PRIMARY, whiteSpace: 'nowrap' }}>
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
        {ProposalFooter}
      </div>
    </>
  )
}
