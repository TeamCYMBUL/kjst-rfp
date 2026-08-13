// CYMBUL-only revenue & commission engine.
//
// For every AWARDED trip, figures the room revenue KJST booked and the
// commission earned from it. Commission % comes straight from the winning
// hotel's own bid (the per-client "Commissionable to KJ Sports Travel"
// percent field), so each trip carries its own rate.
//
// Revenue uses the SAME math as the Excel export (king rate x room block x
// nights, excl. tax) so the numbers reconcile. Same-city 2-visit trips are
// scored per stay: a hotel is only credited for the stay(s) it actually won,
// using that stay's rate and night count.
import { supabase } from './supabase'

export type CommissionRow = {
  invitationId: string
  clientId: string | null
  clientName: string
  city: string
  opponent: string | null
  hotelName: string
  wonStay1: boolean
  wonStay2: boolean
  twoVisit: boolean
  rooms: number
  nights1: number
  nights2: number
  king1: number | null
  king2: number | null
  revenue: number // excl. tax, summed across the stay(s) this hotel won
  commissionPct: number // e.g. 7 (percent, not a fraction)
  commission: number
  flags: string[] // data-quality notes, e.g. "No commission %"
  pending?: boolean // true for a not-yet-awarded trip (revenue is an opportunity estimate)
  bidCount?: number // how many bids were compared to pick the highest (pending only)
}

export type CommissionSummary = {
  rows: CommissionRow[]
  totalRevenue: number
  totalCommission: number
  bookings: number
  avgPct: number
  // Not-yet-awarded trips, valued at their HIGHEST bid (revenue opportunity).
  pendingRows: CommissionRow[]
  pendingRevenue: number
  pendingCommission: number
  pendingCount: number
}

/** Pull the leading numeric value out of free text ("7%", "$269", "10.5") → number | null. */
function num(v: unknown): number | null {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isFinite(n) ? n : null
}

// A nightly king rate above this is a data-entry error or a placeholder like
// "99999999" (a property flagging no availability), not a real price. Excluding
// it keeps one junk bid from blowing up revenue and the opportunity average.
const MAX_SANE_RATE = 20000
function saneRate(v: unknown): number | null {
  const n = num(v)
  return n != null && n > 0 && n <= MAX_SANE_RATE ? n : null
}

/** Nights between two ISO dates; 1 when missing/invalid (mirrors excelExport.calcNights). */
function nightsBetween(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 1
  const n = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
  return n > 0 ? n : 1
}

export async function fetchCommissions(): Promise<CommissionSummary> {
  // 1. Every awarded invitation, with its winning bid + trip + client.
  const { data: invs, error } = await supabase
    .from('rfp_invitations')
    .select(`
      id, hotel_name, awarded_stay1, awarded_stay2,
      trips!inner(
        id, city, opponent_label, total_rooms_requested, king_rooms_requested,
        nights, arrival_date, departure_date, stay2_arrival_date, stay2_departure_date,
        client_id, clients(id, team_name)
      ),
      rfp_responses(id, best_king_rate, stay2_king_rate)
    `)
    .eq('status', 'awarded')
  if (error) throw error

  const awardedTripIds = new Set(
    (invs ?? []).map((i: any) => (Array.isArray(i.trips) ? i.trips[0]?.id : i.trips?.id)).filter(Boolean),
  )

  // 1b. Every SUBMITTED bid on a trip that hasn't been awarded yet — the pool we
  // pick the highest total from to value the trip's revenue opportunity.
  const { data: subInvs } = await supabase
    .from('rfp_invitations')
    .select(`
      id, hotel_name, status,
      trips!inner(
        id, city, opponent_label, total_rooms_requested, king_rooms_requested,
        nights, arrival_date, departure_date, stay2_arrival_date, stay2_departure_date,
        cancelled, client_id, clients(id, team_name)
      ),
      rfp_responses(id, best_king_rate, stay2_king_rate)
    `)
    .eq('status', 'submitted')

  // 2. The per-client commission % concession item (there is one per client).
  const { data: commItems } = await supabase
    .from('concession_items')
    .select('id')
    .ilike('label', '%commission%')
    .eq('answer_type', 'percent')
  const commItemIds = (commItems ?? []).map((c) => c.id)

  // 3. The commission-% answers for every bid we'll value (awarded + submitted).
  const responseIds = [...(invs ?? []), ...(subInvs ?? [])]
    .map((i: any) => (Array.isArray(i.rfp_responses) ? i.rfp_responses[0]?.id : i.rfp_responses?.id))
    .filter(Boolean)
  const pctByResponse = new Map<string, number>()
  if (responseIds.length && commItemIds.length) {
    const { data: ans } = await supabase
      .from('concession_answers')
      .select('response_id, answer_value')
      .in('response_id', responseIds)
      .in('concession_item_id', commItemIds)
    for (const a of ans ?? []) {
      const p = num(a.answer_value)
      if (p != null) pctByResponse.set(a.response_id, p)
    }
  }

  const rows: CommissionRow[] = (invs ?? []).map((i: any) => {
    const t = Array.isArray(i.trips) ? i.trips[0] : i.trips
    const r = Array.isArray(i.rfp_responses) ? i.rfp_responses[0] : i.rfp_responses
    const client = t?.clients ? (Array.isArray(t.clients) ? t.clients[0] : t.clients) : null

    const rooms = t?.total_rooms_requested ?? t?.king_rooms_requested ?? 0
    const nights1 = t?.nights ?? nightsBetween(t?.arrival_date, t?.departure_date)
    const nights2 = nightsBetween(t?.stay2_arrival_date, t?.stay2_departure_date)
    const king1 = saneRate(r?.best_king_rate)
    const king2 = saneRate(r?.stay2_king_rate)
    const twoVisit = !!t?.stay2_arrival_date
    const wonStay1 = !!i.awarded_stay1
    const wonStay2 = !!i.awarded_stay2

    const rev1 = wonStay1 && king1 ? king1 * rooms * nights1 : 0
    const rev2 = wonStay2 && king2 ? king2 * rooms * nights2 : 0
    const revenue = rev1 + rev2
    const commissionPct = pctByResponse.get(r?.id) ?? 0
    const commission = (revenue * commissionPct) / 100

    const flags: string[] = []
    if (rooms === 0) flags.push('No room count')
    if (wonStay1 && !king1) flags.push('No Stay 1 rate')
    if (wonStay2 && !king2) flags.push('No Stay 2 rate')
    if (!commissionPct) flags.push('No commission %')

    return {
      invitationId: i.id,
      clientId: client?.id ?? t?.client_id ?? null,
      clientName: client?.team_name ?? 'Unknown client',
      city: t?.city ?? '',
      opponent: t?.opponent_label ?? null,
      hotelName: i.hotel_name,
      wonStay1,
      wonStay2,
      twoVisit,
      rooms,
      nights1,
      nights2,
      king1,
      king2,
      revenue,
      commissionPct,
      commission,
      flags,
    }
  })

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0)
  const withPct = rows.filter((r) => r.commissionPct > 0)
  const avgPct = withPct.length ? withPct.reduce((s, r) => s + r.commissionPct, 0) / withPct.length : 0

  // Revenue opportunity: for every trip with bids in but no winner yet, value it
  // at the AVERAGE of the bids received (room revenue = king rate x rooms x
  // nights per bid), with projected commission averaged the same way.
  const pendingByTrip = new Map<string, any[]>()
  for (const i of subInvs ?? []) {
    const t = Array.isArray((i as any).trips) ? (i as any).trips[0] : (i as any).trips
    if (!t?.id || t.cancelled || awardedTripIds.has(t.id)) continue
    if (!pendingByTrip.has(t.id)) pendingByTrip.set(t.id, [])
    pendingByTrip.get(t.id)!.push(i)
  }

  const pendingRows: CommissionRow[] = []
  for (const [tripId, bids] of pendingByTrip) {
    const t = Array.isArray((bids[0] as any).trips) ? (bids[0] as any).trips[0] : (bids[0] as any).trips
    const client = t?.clients ? (Array.isArray(t.clients) ? t.clients[0] : t.clients) : null
    const rooms = t?.total_rooms_requested ?? t?.king_rooms_requested ?? 0
    const nights1 = t?.nights ?? nightsBetween(t?.arrival_date, t?.departure_date)
    const nights2 = nightsBetween(t?.stay2_arrival_date, t?.stay2_departure_date)
    const twoVisit = !!t?.stay2_arrival_date

    // Per-bid room revenue + projected commission; average across bids that
    // actually carry a rate (a bid with no rate shouldn't drag the average to 0).
    const perBid: Array<{ rev: number; comm: number; pct: number }> = []
    for (const b of bids) {
      const r = Array.isArray((b as any).rfp_responses) ? (b as any).rfp_responses[0] : (b as any).rfp_responses
      const king1 = saneRate(r?.best_king_rate)
      const king2 = saneRate(r?.stay2_king_rate)
      const rev = (king1 ? king1 * rooms * nights1 : 0) + (twoVisit && king2 ? king2 * rooms * nights2 : 0)
      if (rev <= 0) continue
      const pct = pctByResponse.get(r?.id) ?? 0
      perBid.push({ rev, comm: (rev * pct) / 100, pct })
    }
    if (perBid.length === 0) continue

    const avgRevenue = perBid.reduce((s, x) => s + x.rev, 0) / perBid.length
    const avgCommission = perBid.reduce((s, x) => s + x.comm, 0) / perBid.length
    const effPct = avgRevenue > 0 ? (avgCommission / avgRevenue) * 100 : 0

    const flags: string[] = []
    if (rooms === 0) flags.push('No room count')
    if (!perBid.some((x) => x.pct > 0)) flags.push('No commission %')

    pendingRows.push({
      invitationId: `pending:${tripId}`,
      clientId: client?.id ?? t?.client_id ?? null,
      clientName: client?.team_name ?? 'Unknown client',
      city: t?.city ?? '',
      opponent: t?.opponent_label ?? null,
      hotelName: `Average of ${perBid.length} bid${perBid.length === 1 ? '' : 's'}`,
      wonStay1: false,
      wonStay2: false,
      twoVisit,
      rooms,
      nights1,
      nights2,
      king1: null,
      king2: null,
      revenue: avgRevenue,
      commissionPct: Math.round(effPct * 10) / 10,
      commission: avgCommission,
      flags,
      pending: true,
      bidCount: perBid.length,
    })
  }

  const pendingRevenue = pendingRows.reduce((s, r) => s + r.revenue, 0)
  const pendingCommission = pendingRows.reduce((s, r) => s + r.commission, 0)

  return {
    rows,
    totalRevenue,
    totalCommission,
    bookings: rows.length,
    avgPct,
    pendingRows,
    pendingRevenue,
    pendingCommission,
    pendingCount: pendingRows.length,
  }
}
