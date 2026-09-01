// "What this platform saved you" — for each awarded trip, the gap between the
// hotel's own current selling (market) rate and the rate KJST's client actually
// got, times rooms times nights. Only trips where a selling-rate benchmark was
// captured can be counted (NBA/WNBA RFPs collect it; NHL/MLB don't), so the
// number is conservative by construction: no benchmark, no claimed savings.
import { supabase } from './supabase'
import { saneRate, nightsBetween } from './commissions'

export type SavingsInput = {
  tripId: string
  clientId: string | null
  clientName: string
  city: string | null
  opponent: string | null
  rooms: number
  nights1: number
  nights2: number
  wonStay1: boolean
  wonStay2: boolean
  king1: number | null
  king2: number | null
  selling1: number | null
  selling2: number | null
}

export type SavingsTrip = {
  tripId: string
  clientId: string | null
  clientName: string
  label: string
  rooms: number
  saved: number
}

export type SavingsSummary = {
  total: number
  benchmarkedTrips: number
  trips: SavingsTrip[]
}

/** Pure: sum (selling − awarded) × rooms × nights over every won stay that has a
 *  selling benchmark. A trip counts only if at least one won stay was benchmarked. */
export function computeSavings(bids: SavingsInput[]): SavingsSummary {
  const trips: SavingsTrip[] = []
  for (const b of bids) {
    let saved = 0
    let benchmarked = false
    if (b.wonStay1 && b.king1 != null && b.selling1 != null && b.rooms > 0) {
      saved += (b.selling1 - b.king1) * b.rooms * b.nights1
      benchmarked = true
    }
    if (b.wonStay2 && b.king2 != null && b.selling2 != null && b.rooms > 0) {
      saved += (b.selling2 - b.king2) * b.rooms * b.nights2
      benchmarked = true
    }
    if (!benchmarked) continue
    const label = [b.city, b.opponent].filter(Boolean).join(' vs ') || b.city || 'Trip'
    trips.push({ tripId: b.tripId, clientId: b.clientId, clientName: b.clientName, label, rooms: b.rooms, saved })
  }
  trips.sort((a, b) => b.saved - a.saved)
  return { total: trips.reduce((s, t) => s + t.saved, 0), benchmarkedTrips: trips.length, trips }
}

/** Fetch awarded bids (optionally for one client) and compute season savings. */
export async function fetchSeasonSavings(clientId?: string): Promise<SavingsSummary> {
  let q = supabase
    .from('rfp_invitations')
    .select(`
      id, awarded_stay1, awarded_stay2,
      trips!inner(
        id, city, opponent_label, total_rooms_requested, king_rooms_requested, nights,
        arrival_date, departure_date, stay2_arrival_date, stay2_departure_date,
        client_id, cancelled, clients!inner(id, team_name)
      ),
      rfp_responses(best_king_rate, stay2_king_rate, current_selling_rate, stay2_selling_rate)
    `)
    .eq('status', 'awarded')
  if (clientId) q = q.eq('trips.client_id', clientId)
  const { data: invs, error } = await q
  if (error) throw error

  const bids: SavingsInput[] = []
  for (const i of (invs ?? []) as any[]) {
    const t = Array.isArray(i.trips) ? i.trips[0] : i.trips
    const r = Array.isArray(i.rfp_responses) ? i.rfp_responses[0] : i.rfp_responses
    const client = t?.clients ? (Array.isArray(t.clients) ? t.clients[0] : t.clients) : null
    if (!t || t.cancelled) continue
    const twoVisit = !!t.stay2_arrival_date
    bids.push({
      tripId: t.id,
      clientId: client?.id ?? t.client_id ?? null,
      clientName: client?.team_name ?? 'Unknown',
      city: t.city ?? null,
      opponent: t.opponent_label ?? null,
      rooms: t.king_rooms_requested ?? t.total_rooms_requested ?? 0,
      nights1: t.nights ?? nightsBetween(t.arrival_date, t.departure_date),
      nights2: nightsBetween(t.stay2_arrival_date, t.stay2_departure_date),
      // A single-visit award has no stay flags — the whole award is stay 1.
      wonStay1: twoVisit ? !!i.awarded_stay1 : true,
      wonStay2: twoVisit ? !!i.awarded_stay2 : false,
      king1: saneRate(r?.best_king_rate),
      king2: saneRate(r?.stay2_king_rate),
      selling1: saneRate(r?.current_selling_rate),
      selling2: saneRate(r?.stay2_selling_rate),
    })
  }
  return computeSavings(bids)
}
