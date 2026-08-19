// Shared "export trips to Excel" used by the Dashboard header (all teams) and by
// each team card (one team). Fetches the full date fields directly (the dashboard
// cards only carry a subset) and is scoped by RLS to what the user can see.
import { supabase } from './supabase'
import { formatDate } from './format'
import { exportTripsListXlsx, type TripListRow } from './excelExport'

export async function exportTripsXlsx(clientId: string | null, teamName: string | null): Promise<void> {
  let query = supabase
    .from('trips')
    .select('opponent_label, city, arrival_date, departure_date, nights, game_date, game_dates, stay2_arrival_date, stay2_departure_date, stay2_game_date, stay2_game_dates, total_rooms_requested, response_deadline, status, cancelled, clients(team_name)')
  if (clientId) query = query.eq('client_id', clientId)
  const { data, error } = await query
  if (error) throw error

  const gd = (single: string | null, list: string[] | null): string =>
    (list && list.length ? list : single ? [single] : []).filter(Boolean).map((d) => formatDate(d)).join(', ')

  const rows: TripListRow[] = (data ?? [])
    .map((t: any) => {
      const c = Array.isArray(t.clients) ? t.clients[0] : t.clients
      return {
        team: c?.team_name ?? '—',
        opponent: t.opponent_label ?? '',
        city: t.city ?? '',
        stay1_in: t.arrival_date ? formatDate(t.arrival_date) : '',
        stay1_out: t.departure_date ? formatDate(t.departure_date) : '',
        stay2_in: t.stay2_arrival_date ? formatDate(t.stay2_arrival_date) : '',
        stay2_out: t.stay2_departure_date ? formatDate(t.stay2_departure_date) : '',
        nights: t.nights ?? '',
        game_dates: [gd(t.game_date, t.game_dates), gd(t.stay2_game_date, t.stay2_game_dates)].filter(Boolean).join('  |  '),
        deadline: t.response_deadline ? formatDate(t.response_deadline) : '',
        status: t.cancelled ? 'cancelled' : (t.status ?? ''),
        total_rooms: t.total_rooms_requested ?? '',
        _team: c?.team_name ?? '~',
        _date: t.arrival_date ?? '9999',
      } as TripListRow & { _team: string; _date: string }
    })
    .sort((a: any, b: any) => a._team.localeCompare(b._team) || String(a._date).localeCompare(String(b._date)))
    .map(({ _team, _date, ...r }: any) => r)

  const fname = clientId && teamName
    ? `KJST_${teamName.replace(/[^\w]+/g, '_')}_Trips.xlsx`
    : 'KJST_All_Trips.xlsx'
  exportTripsListXlsx(rows, fname)
}
