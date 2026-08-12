import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAllAnswersByResponseIds } from '../../lib/answers'
import {
  PRIMARY, includeAnsweredItems,
  TripHeader, ProposalFooter, PrintStyles, HotelFull,
  type ProposalTrip as Trip,
  type ProposalInvitation as Invitation,
  type ProposalResponse as Response,
  type ProposalConcessionItem as ConcessionItem,
  type ProposalAnswer as Answer,
} from '../trips/proposalRender'
import { buildProposalDoc, downloadDocx, type DocxHotel } from '../../lib/reportDocx'

// Client-wide progressive batch print. Renders every submitted hotel bid across
// ALL of one client's trips, grouped by trip. "all" prints the whole batch;
// "new" prints only bids not yet printed (printed_at is null), so once the first
// 40 are printed, later runs pick up just the ones that arrived since.

type ClientRow = { id: string; team_name: string }

export default function ClientProposalsPrint() {
  const { id: clientId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode')
  const newMode = mode === 'new'
  // "awarded" = only the hotels marked Awarded (the winners we're contracting),
  // so staff can save just the selected hotels' completed RFPs as a checklist.
  const awardedMode = mode === 'awarded'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [client, setClient] = useState<ClientRow | null>(null)
  const [trips, setTrips] = useState<Trip[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [responses, setResponses] = useState<Response[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [concessionItems, setConcessionItems] = useState<ConcessionItem[]>([])

  useEffect(() => {
    if (!clientId) return
    const load = async () => {
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('id, team_name')
        .eq('id', clientId)
        .single()
      if (clientError || !clientData) { setError(clientError?.message ?? 'Client not found'); setLoading(false); return }
      setClient(clientData as unknown as ClientRow)

      // All of this client's trips, alphabetical by city (matches the Trips page).
      const { data: tripData } = await supabase
        .from('trips')
        .select('id, client_id, opponent_label, city, arrival_date, departure_date, king_rooms_requested, double_rooms_requested, suites_requested, total_rooms_requested, clients(team_name)')
        .eq('client_id', clientId)
        .order('city')
      const tps = (tripData as unknown as Trip[]) ?? []
      setTrips(tps)

      if (tps.length === 0) { setLoading(false); return }
      const tripIds = tps.map((t) => t.id)

      // "awarded" = winners only; otherwise every submitted/awarded bid; "new" =
      // not yet printed.
      let invQuery = supabase
        .from('rfp_invitations')
        .select('id, trip_id, hotel_name, hotel_contact_name, hotel_contact_email, status, submitted_at, visit1_declined, visit2_declined')
        .in('trip_id', tripIds)
        .in('status', awardedMode ? ['awarded'] : ['submitted', 'awarded'])
      if (newMode) invQuery = invQuery.is('printed_at', null)
      const { data: invData } = await invQuery
      const invs = (invData as unknown as Invitation[]) ?? []
      setInvitations(invs)

      // Printing marks those bids printed so the next "print new" run only picks
      // up bids that have arrived since. The awarded checklist print is on-demand
      // and must NOT consume the "new" queue, so skip the stamp in awarded mode.
      if (invs.length > 0 && !awardedMode) {
        await supabase
          .from('rfp_invitations')
          .update({ printed_at: new Date().toISOString() })
          .in('id', invs.map((i) => i.id))
      }

      // Concession items scoped to this client (+ shared master).
      const { data: itemsData } = await supabase
        .from('concession_items')
        .select('id, section, label, answer_type, sort_order')
        .or(`client_id.is.null,client_id.eq.${clientId}`)
        .eq('archived', false)
        .order('sort_order')
      let items = (itemsData as unknown as ConcessionItem[]) ?? []

      if (invs.length > 0) {
        const invIds = invs.map((i) => i.id)
        const { data: respData } = await supabase
          .from('rfp_responses')
          .select('id, invitation_id, best_king_rate, best_suite_rate, current_selling_rate, occupancy_tax, resort_fee, stay2_king_rate, stay2_suite_rate, meeting_space_notes, general_comments, distance_to_arena, standard_checkin_time')
          .in('invitation_id', invIds)
        const resps = (respData as unknown as Response[]) ?? []
        setResponses(resps)

        if (resps.length > 0) {
          // Page past Supabase's 1000-row cap (a client with many bids has
          // thousands of answers) so every bid prints its real Yes/No answers.
          const ansRows = (await fetchAllAnswersByResponseIds(resps.map((r) => r.id))) as unknown as Answer[]
          setAnswers(ansRows)

          // Include any question a bid actually answered that isn't in the scoped
          // list — e.g. a question later archived or replaced during a template
          // rework. Without this, an already-submitted bid's PDF would silently
          // print a dash for those rows even though the hotel answered them.
          items = await includeAnsweredItems(items, ansRows)
        }
      }
      setConcessionItems(items)
      setLoading(false)
    }
    load()
  }, [clientId, newMode])

  useEffect(() => {
    if (!loading && client) {
      const t = setTimeout(() => window.print(), 500)
      return () => clearTimeout(t)
    }
  }, [loading, client])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: '#64748b' }}>
        Loading proposals…
      </div>
    )
  }
  if (error || !client) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: '#ef4444' }}>
        {error || 'Client not found.'}
      </div>
    )
  }

  // Only trips that have at least one included bid, in the trips' alphabetical order.
  const tripsWithBids = trips.filter((t) => invitations.some((inv) => inv.trip_id === t.id))
  const totalBids = invitations.length

  const downloadWord = () => {
    const subtitle = `Hotel Proposals — ${awardedMode ? 'Selected (Awarded) Hotels' : newMode ? 'New Since Last Print' : 'Full Copy'}`
    const groups = tripsWithBids.map((trip) => ({
      trip: { ...trip, team_name: trip.clients?.team_name ?? client?.team_name ?? 'Client' },
      hotels: invitations.filter((inv) => inv.trip_id === trip.id).map((inv): DocxHotel => {
        const resp = responses.find((r) => r.invitation_id === inv.id) ?? null
        return { inv, resp, answers: resp ? answers.filter((a) => a.response_id === resp.id) : [], concessionItems }
      }),
    }))
    downloadDocx(buildProposalDoc({ subtitle, groups }), `${client?.team_name ?? 'KJST'} Proposals.docx`)
  }

  const PrintControls = (
    <div className="no-print" style={{ position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 100 }}>
      <button
        onClick={downloadWord}
        style={{ background: PRIMARY, color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        Download Word (.docx)
      </button>
      <button
        onClick={() => window.print()}
        style={{ background: 'white', color: PRIMARY, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
      >
        Print / Save as PDF
      </button>
      <Link
        to={`/clients/${clientId}`}
        style={{ background: 'white', color: PRIMARY, border: `1px solid #e2e8f0`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
      >
        ← Back to Client
      </Link>
    </div>
  )

  return (
    <>
      {PrintStyles}
      {PrintControls}
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' }}>
        {totalBids === 0 ? (
          <div style={{ marginTop: 80, border: '1px solid #e2e8f0', borderRadius: 12, padding: '48px 32px', textAlign: 'center', color: '#94a3b8', fontSize: 15 }}>
            {awardedMode
              ? 'No awarded hotels yet. Mark the winning hotel on each trip as Awarded, then this will collect their completed RFPs.'
              : newMode ? 'No new proposals since your last print.' : 'No submitted bids yet for this client.'}
          </div>
        ) : (
          tripsWithBids.map((trip, ti) => {
            const tripInvs = invitations.filter((inv) => inv.trip_id === trip.id)
            const isLastTrip = ti === tripsWithBids.length - 1
            return (
              <div key={trip.id} style={!isLastTrip ? { pageBreakAfter: 'always' } : undefined}>
                <TripHeader
                  trip={trip}
                  subtitle={`Hotel Proposals — ${awardedMode ? 'Selected (Awarded) Hotels' : newMode ? 'New Since Last Print' : 'Full Copy'}`}
                />
                {tripInvs.map((inv, hi) => (
                  <HotelFull
                    key={inv.id}
                    inv={inv}
                    resp={responses.find((r) => r.invitation_id === inv.id) ?? null}
                    answers={answers}
                    concessionItems={concessionItems}
                    pageBreak={hi !== tripInvs.length - 1}
                  />
                ))}
                {ProposalFooter}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
