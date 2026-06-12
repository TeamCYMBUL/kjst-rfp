import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Client, Trip } from '../../lib/types'
import { formatDate } from '../../lib/format'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  LinkButton,
  Loading,
  PageHeader,
} from '../../components/ui'

type TripRow = Pick<
  Trip,
  'id' | 'opponent_label' | 'city' | 'arrival_date' | 'departure_date' | 'status'
>

type HistoryRow = {
  invitation_id: string
  hotel_name: string
  staff_notes: string | null
  city: string | null
  opponent_label: string | null
  arrival_date: string | null
  departure_date: string | null
  king_rooms_requested: number | null
  suites_requested: number | null
  best_king_rate: number | null
  best_suite_rate: number | null
  occupancy_tax: string | null
  meeting_space_type: string | null
  meeting_space_count: number | null
}

// One labeled value in the info grid; renders an em dash when empty.
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{value || '—'}</dd>
    </div>
  )
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
  const [trips, setTrips] = useState<TripRow[] | null>(null)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [copiedHistory, setCopiedHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setClient(data as Client)
      })

    supabase
      .from('trips')
      .select('id, opponent_label, city, arrival_date, departure_date, status')
      .eq('client_id', id)
      .order('arrival_date', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTrips(data as TripRow[])
      })

    // Season history — awarded hotel per trip for this client
    supabase
      .from('trips')
      .select('id')
      .eq('client_id', id)
      .then(async ({ data: tripRows }) => {
        if (!tripRows || tripRows.length === 0) { setHistory([]); return }
        const tripIds = tripRows.map((t: any) => t.id)
        const { data } = await supabase
          .from('rfp_invitations')
          .select(`
            id, hotel_name, staff_notes,
            trips!inner(id, opponent_label, city, arrival_date, departure_date, king_rooms_requested, suites_requested),
            rfp_responses(best_king_rate, best_suite_rate, occupancy_tax, meeting_space_type, meeting_space_count)
          `)
          .in('trip_id', tripIds)
          .eq('status', 'awarded')
          .order('created_at', { ascending: false })
        const rows: HistoryRow[] = (data ?? []).map((r: any) => ({
          invitation_id: r.id,
          hotel_name: r.hotel_name,
          staff_notes: r.staff_notes ?? null,
          city: r.trips?.city ?? null,
          opponent_label: r.trips?.opponent_label ?? null,
          arrival_date: r.trips?.arrival_date ?? null,
          departure_date: r.trips?.departure_date ?? null,
          king_rooms_requested: r.trips?.king_rooms_requested ?? null,
          suites_requested: r.trips?.suites_requested ?? null,
          best_king_rate: r.rfp_responses?.best_king_rate ?? null,
          best_suite_rate: r.rfp_responses?.best_suite_rate ?? null,
          occupancy_tax: r.rfp_responses?.occupancy_tax ?? null,
          meeting_space_type: r.rfp_responses?.meeting_space_type ?? null,
          meeting_space_count: r.rfp_responses?.meeting_space_count ?? null,
        }))
        setHistory(rows)
      })
  }, [id])

  const remove = async () => {
    if (!confirm('Delete this client? This cannot be undone.')) return
    setDeleting(true)
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) {
      setError(error.message)
      setDeleting(false)
    } else {
      navigate('/clients')
    }
  }

  if (error) return <ErrorNote message={error} />
  if (!client) return <Loading />

  const t = client.default_terms ?? {}

  return (
    <div>
      <PageHeader
        title={client.team_name}
        subtitle={[client.league, client.season].filter(Boolean).join(' · ') || undefined}
        action={
          <div className="flex gap-2">
            <LinkButton to={`/clients/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <LinkButton to={`/trips/new?client=${id}`}>New Trip</LinkButton>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Trips
            </h2>
            {!trips ? (
              <Loading />
            ) : trips.length === 0 ? (
              <EmptyState title="No trips yet.">
                <LinkButton to={`/trips/new?client=${id}`}>Create the first trip</LinkButton>
              </EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-4 font-medium">Opponent</th>
                    <th className="py-2 pr-4 font-medium">City</th>
                    <th className="py-2 pr-4 font-medium">Dates</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr
                      key={trip.id}
                      className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          to={`/trips/${trip.id}`}
                          className="font-medium text-[#1C1008] hover:underline"
                        >
                          {trip.opponent_label || 'Untitled trip'}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{trip.city || '—'}</td>
                      <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                        {formatDate(trip.arrival_date)} – {formatDate(trip.departure_date)}
                      </td>
                      <td className="py-2">
                        <Badge status={trip.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Season History */}
          {history && history.length > 0 && (
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Season History
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Awarded hotels from past trips — use for pre-season outreach</p>
                </div>
                <button
                  onClick={() => {
                    const lines = history.map((row) => {
                      const dateStr = row.arrival_date && row.departure_date
                        ? `${formatDate(row.arrival_date)} – ${formatDate(row.departure_date)}`
                        : row.arrival_date ? formatDate(row.arrival_date) : ''
                      const rooms = [
                        row.king_rooms_requested != null ? `${row.king_rooms_requested} king rooms` : null,
                        row.suites_requested != null ? `${row.suites_requested} suites` : null,
                      ].filter(Boolean).join(' + ')
                      const rate = row.best_king_rate != null ? `$${row.best_king_rate}/night` : ''
                      const mtg = row.meeting_space_type === 'function_room'
                        ? `${row.meeting_space_count ?? 1} function room${(row.meeting_space_count ?? 1) > 1 ? 's' : ''}`
                        : row.meeting_space_type ? row.meeting_space_type : ''
                      return [
                        `${row.city ?? ''}${row.opponent_label ? ` (vs. ${row.opponent_label})` : ''} — ${dateStr}`,
                        `  Hotel: ${row.hotel_name}`,
                        rate ? `  Rate: ${rate}` : null,
                        rooms ? `  Rooms: ${rooms}` : null,
                        mtg ? `  Meeting space: ${mtg}` : null,
                        row.staff_notes ? `  Notes: ${row.staff_notes}` : null,
                      ].filter(Boolean).join('\n')
                    })
                    navigator.clipboard.writeText(
                      `Last season recap for ${client?.team_name ?? 'your team'}:\n\n` + lines.join('\n\n')
                    )
                    setCopiedHistory(true)
                    setTimeout(() => setCopiedHistory(false), 2000)
                  }}
                  className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {copiedHistory ? '✓ Copied' : '📋 Copy for email'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      <th className="py-2 pr-4 font-medium">City</th>
                      <th className="py-2 pr-4 font-medium">Opponent</th>
                      <th className="py-2 pr-4 font-medium">Dates</th>
                      <th className="py-2 pr-4 font-medium">Hotel</th>
                      <th className="py-2 pr-4 font-medium text-right">King Rate</th>
                      <th className="py-2 pr-4 font-medium text-center">Rooms</th>
                      <th className="py-2 pr-4 font-medium">Mtg Space</th>
                      <th className="py-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.invitation_id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700">
                        <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-200">{row.city || '—'}</td>
                        <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{row.opponent_label || '—'}</td>
                        <td className="py-2 pr-4 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">
                          {row.arrival_date ? formatDate(row.arrival_date) : '—'}
                          {row.departure_date ? ` – ${formatDate(row.departure_date)}` : ''}
                        </td>
                        <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{row.hotel_name}</td>
                        <td className="py-2 pr-4 text-right font-medium text-slate-700 dark:text-slate-300">
                          {row.best_king_rate != null ? `$${row.best_king_rate.toLocaleString()}` : '—'}
                        </td>
                        <td className="py-2 pr-4 text-center text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                          {[
                            row.king_rooms_requested != null ? `${row.king_rooms_requested}K` : null,
                            row.suites_requested != null ? `${row.suites_requested}S` : null,
                          ].filter(Boolean).join(' + ') || '—'}
                        </td>
                        <td className="py-2 pr-4 text-xs text-slate-500 dark:text-slate-400">
                          {row.meeting_space_type === 'function_room'
                            ? `✅ ${row.meeting_space_count ?? 1} room${(row.meeting_space_count ?? 1) > 1 ? 's' : ''}`
                            : row.meeting_space_type === 'restaurant'
                              ? '❌ Restaurant'
                              : row.meeting_space_type === 'none'
                                ? '❌ None'
                                : row.meeting_space_type
                                  ? row.meeting_space_type
                                  : '—'}
                        </td>
                        <td className="py-2 text-xs text-slate-500 dark:text-slate-400 max-w-[160px]">
                          <span className="line-clamp-2">{row.staff_notes || '—'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Season defaults
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Default king rooms"
                value={t.default_king_rooms != null ? String(t.default_king_rooms) : null}
              />
              <Field
                label="Default suites"
                value={t.default_suites != null ? String(t.default_suites) : null}
              />
              <Field
                label="Default total rooms"
                value={t.default_total_rooms != null ? String(t.default_total_rooms) : null}
              />
              <Field label="In-season tournament window" value={t.in_season_tournament_window} />
              <Field label="Postseason window" value={t.postseason_window} />
              <Field label="Postseason rooms" value={t.postseason_rooms_text} />
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Details
            </h2>
            <dl className="space-y-4">
              <Field label="Legal entity" value={client.legal_entity} />
              <Field label="Agreement status" value={t.agreement_status} />
              <Field label="Contact" value={client.primary_contact_name} />
              <Field label="Title" value={client.primary_contact_title} />
              <Field label="Email" value={client.primary_contact_email} />
              <Field label="Phone" value={client.primary_contact_phone} />
              <Field label="Address" value={client.primary_contact_address} />
            </dl>
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Danger zone
            </h2>
            <Button variant="danger" onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete client'}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}
