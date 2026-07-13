// Shared "Export All Cities" routine — fetches a client's trips, hotel bids, and
// concession answers, then writes the horizontal hotel-options grid.
// Used by both the client detail page and the clients list slide-out panel.
import { supabase } from './supabase'
import { exportMultiCityConsolidatedXlsx } from './excelExport'
import type { ConsolidatedCity } from './excelExport'

export async function exportAllCitiesForClient(
  clientId: string,
  clientName: string,
): Promise<{ count: number }> {
  // Master + client-specific concession items (for the count/guarantee columns)
  const { data: allItemsData } = await supabase
    .from('concession_items')
    .select('id, label, section, answer_type, requested_value, allow_comment, sort_order')
    .or(`client_id.is.null,client_id.eq.${clientId}`)
    .eq('archived', false)
    .order('sort_order')
  const allItems = allItemsData ?? []

  const { data: trips } = await supabase
    .from('trips')
    .select(
      'id, opponent_label, city, arrival_date, departure_date, game_date, game_dates, total_rooms_requested, stay2_arrival_date, stay2_departure_date, stay2_game_date, stay2_game_dates, status',
    )
    .eq('client_id', clientId)
    .order('city', { ascending: true, nullsFirst: false })

  if (!trips || trips.length === 0) return { count: 0 }

  const cityData: ConsolidatedCity[] = []
  for (const trip of trips as any[]) {
    const { data: invs } = await supabase
      .from('rfp_invitations')
      .select(`
        id, hotel_name, status,
        rfp_responses(
          best_king_rate, best_suite_rate, current_selling_rate, occupancy_tax, resort_fee,
          stay2_king_rate, stay2_suite_rate, general_comments,
          meeting_space_type, meeting_space_count,
          concession_answers(concession_item_id, answer_yes_no, answer_value, comment)
        )
      `)
      .eq('trip_id', trip.id)

    if (!invs || invs.length === 0) continue

    const hotels = invs.map((inv: any) => {
      const r = Array.isArray(inv.rfp_responses) ? inv.rfp_responses[0] : inv.rfp_responses
      const answerMap: ConsolidatedCity['hotels'][0]['answers'] = {}
      for (const a of (r?.concession_answers ?? [])) {
        answerMap[a.concession_item_id] = {
          answer_yes_no: a.answer_yes_no,
          answer_value: a.answer_value,
          comment: a.comment,
        }
      }
      return {
        hotel_name: inv.hotel_name,
        status: inv.status,
        best_king_rate: r?.best_king_rate ?? null,
        best_suite_rate: r?.best_suite_rate ?? null,
        current_selling_rate: r?.current_selling_rate ?? null,
        occupancy_tax: r?.occupancy_tax ?? null,
        resort_fee: r?.resort_fee ?? null,
        stay2_king_rate: r?.stay2_king_rate ?? null,
        stay2_suite_rate: r?.stay2_suite_rate ?? null,
        general_comments: r?.general_comments ?? null,
        meeting_space_type: r?.meeting_space_type ?? null,
        meeting_space_count: r?.meeting_space_count ?? null,
        answers: answerMap,
      }
    })

    cityData.push({
      trip: {
        city: trip.city,
        opponent_label: trip.opponent_label,
        arrival_date: trip.arrival_date,
        departure_date: trip.departure_date,
        game_date: trip.game_date,
        game_dates: trip.game_dates ?? null,
        total_rooms_requested: trip.total_rooms_requested,
        stay2_arrival_date: trip.stay2_arrival_date,
        stay2_departure_date: trip.stay2_departure_date,
        stay2_game_dates: trip.stay2_game_dates ?? null,
        stay2_game_date: trip.stay2_game_date,
      },
      hotels,
      items: allItems as any,
    })
  }

  exportMultiCityConsolidatedXlsx(cityData, clientName)
  return { count: cityData.length }
}
