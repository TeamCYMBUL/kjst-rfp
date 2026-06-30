import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Client, Trip } from '../../lib/types'
import { formatDate } from '../../lib/format'
import { exportMultiCityConsolidatedXlsx } from '../../lib/excelExport'
import type { ConsolidatedCity } from '../../lib/excelExport'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  LinkButton,
  Loading,
  PageHeader,
  TextField,
} from '../../components/ui'
import { useRole } from '../../lib/useRole'
import ScheduleImportModal from '../trips/ScheduleImport'

type ClientConcessionItem = {
  id: string
  sort_order: number
  section: string
  label: string
  answer_type: string
  requested_value: string | null
  allow_comment: boolean
}

const SECTION_OPTIONS = [
  { value: 'concessions', label: 'Concessions & Facilities' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'in_season_tournament', label: 'In-Season Tournament' },
  { value: 'postseason', label: 'Postseason' },
]

const ANSWER_TYPE_OPTIONS = [
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'percent', label: 'Percent %' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'currency', label: 'Currency $' },
  { value: 'text', label: 'Text' },
]

const selectCls = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1C1008]'

type TripRow = Pick<
  Trip,
  'id' | 'opponent_label' | 'city' | 'arrival_date' | 'departure_date' | 'game_date' | 'status'
  | 'total_rooms_requested' | 'stay2_arrival_date' | 'stay2_departure_date' | 'stay2_game_date'
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
  const { canEditClient } = useRole()
  const [client, setClient] = useState<Client | null>(null)
  const [trips, setTrips] = useState<TripRow[] | null>(null)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [copiedHistory, setCopiedHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Custom concession items
  const [customItems, setCustomItems] = useState<ClientConcessionItem[] | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [newItem, setNewItem] = useState({
    section: 'concessions',
    label: '',
    answer_type: 'yes_no',
    requested_value: '',
    allow_comment: true,
  })
  const [savingItem, setSavingItem] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)
  const [exportingAllCities, setExportingAllCities] = useState(false)
  const [activeTab, setActiveTab] = useState<'trips' | 'import' | 'details'>('trips')

  const loadTrips = () => {
    supabase
      .from('trips')
      .select('id, opponent_label, city, arrival_date, departure_date, game_date, game_dates, total_rooms_requested, stay2_arrival_date, stay2_departure_date, stay2_game_date, stay2_game_dates, status')
      .eq('client_id', id)
      .order('arrival_date', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTrips(data as TripRow[])
      })
  }

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

    loadTrips()

    supabase
      .from('concession_items')
      .select('id, sort_order, section, label, answer_type, requested_value, allow_comment')
      .eq('client_id', id)
      .eq('archived', false)
      .order('sort_order')
      .then(({ data }) => setCustomItems((data as ClientConcessionItem[]) ?? []))

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

  const saveCustomItem = async () => {
    if (!newItem.label.trim()) { setItemError('Label is required.'); return }
    setSavingItem(true)
    setItemError(null)
    const maxSort = customItems && customItems.length > 0
      ? Math.max(...customItems.map((i) => i.sort_order)) + 10
      : 10
    const { data, error: err } = await supabase
      .from('concession_items')
      .insert({
        organization_id: client!.organization_id,
        client_id: id,
        sort_order: maxSort,
        section: newItem.section,
        label: newItem.label.trim(),
        answer_type: newItem.answer_type,
        requested_value: newItem.requested_value.trim() || null,
        allow_comment: newItem.allow_comment,
      })
      .select('id, sort_order, section, label, answer_type, requested_value, allow_comment')
      .single()
    setSavingItem(false)
    if (err) { setItemError(err.message); return }
    setCustomItems((prev) => [...(prev ?? []), data as ClientConcessionItem])
    setNewItem({ section: 'concessions', label: '', answer_type: 'yes_no', requested_value: '', allow_comment: true })
    setAddingItem(false)
  }

  const deleteCustomItem = async (itemId: string) => {
    await supabase.from('concession_items').update({ archived: true }).eq('id', itemId)
    setCustomItems((prev) => (prev ?? []).filter((i) => i.id !== itemId))
  }

  const handleExportAllCities = async () => {
    if (!client || !trips || trips.length === 0) return
    setExportingAllCities(true)
    try {
      // Fetch master + client-specific items in one query
      const { data: allItemsData } = await supabase
        .from('concession_items')
        .select('id, label, section, answer_type, requested_value, allow_comment, sort_order')
        .or(`client_id.is.null,client_id.eq.${id}`)
        .eq('archived', false)
        .order('sort_order')

      const allItems = allItemsData ?? []

      // For each trip, fetch invitations + responses + answers
      const cityData: ConsolidatedCity[] = []
      for (const trip of trips) {
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
          // rfp_responses embeds as an array (one row) or object depending on PostgREST
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
            game_dates: (trip as any).game_dates ?? null,
            total_rooms_requested: trip.total_rooms_requested,
            stay2_arrival_date: trip.stay2_arrival_date,
            stay2_departure_date: trip.stay2_departure_date,
            stay2_game_dates: (trip as any).stay2_game_dates ?? null,
            stay2_game_date: trip.stay2_game_date,
          },
          hotels,
          items: allItems as any,
        })
      }

      exportMultiCityConsolidatedXlsx(cityData, client.team_name)
    } finally {
      setExportingAllCities(false)
    }
  }

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
            {canEditClient(id!) && (
              <LinkButton to={`/clients/${id}/edit`} variant="secondary">
                Edit
              </LinkButton>
            )}
            <Button
              variant="secondary"
              onClick={handleExportAllCities}
              disabled={exportingAllCities || !trips || trips.length === 0}
            >
              {exportingAllCities ? 'Exporting…' : '↓ Export All Cities'}
            </Button>
            {canEditClient(id!) && (
              <LinkButton to={`/trips/new?client=${id}`}>New Trip</LinkButton>
            )}
          </div>
        }
      />

      {/* Tab strip */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 mb-6 -mt-2">
        {(['trips', 'import', 'details'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-[#1C1008] text-[#1C1008] dark:border-slate-100 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tab === 'trips' ? 'Trips' : tab === 'import' ? 'Import Schedule' : 'Details'}
          </button>
        ))}
      </div>

      {/* Trips tab */}
      {activeTab === 'trips' && (
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

        </div>

        {/* Right sidebar — season defaults */}
        <div className="space-y-6">
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
      </div>
      )}

      {/* Import Schedule tab */}
      {activeTab === 'import' && canEditClient(id!) && (
        <div className="max-w-2xl">
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Upload a schedule file — Excel, PDF, Word, or CSV — to create draft trips at once.
          </p>
          <ScheduleImportModal
            inline
            isOpen={activeTab === 'import'}
            onClose={() => setActiveTab('trips')}
            defaultClientId={id}
            onImported={() => {
              loadTrips()
              setActiveTab('trips')
            }}
          />
        </div>
      )}

      {/* Details tab */}
      {activeTab === 'details' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Custom Concession Items */}
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Custom Concession Items
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                    Items added here appear at the end of every RFP sent for this client.
                  </p>
                </div>
                {!addingItem && (
                  <button
                    onClick={() => setAddingItem(true)}
                    className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    + Add item
                  </button>
                )}
              </div>

              {customItems === null ? (
                <Loading />
              ) : customItems.length === 0 && !addingItem ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 italic">No custom items yet.</p>
              ) : (
                <div className="space-y-2 mb-4">
                  {customItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{item.label}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          {SECTION_OPTIONS.find((s) => s.value === item.section)?.label ?? item.section}
                          {' · '}
                          {ANSWER_TYPE_OPTIONS.find((a) => a.value === item.answer_type)?.label ?? item.answer_type}
                          {item.requested_value ? ` · Requested: ${item.requested_value}` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteCustomItem(item.id)}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-500 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {addingItem && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Section</label>
                      <select
                        className={selectCls}
                        value={newItem.section}
                        onChange={(e) => setNewItem((n) => ({ ...n, section: e.target.value }))}
                      >
                        {SECTION_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Answer type</label>
                      <select
                        className={selectCls}
                        value={newItem.answer_type}
                        onChange={(e) => setNewItem((n) => ({ ...n, answer_type: e.target.value }))}
                      >
                        {ANSWER_TYPE_OPTIONS.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <TextField
                    label="Label"
                    value={newItem.label}
                    onChange={(e) => setNewItem((n) => ({ ...n, label: e.target.value }))}
                    placeholder="e.g. Complimentary breakfast for staff"
                  />
                  <TextField
                    label="Requested value (optional)"
                    value={newItem.requested_value ?? ''}
                    onChange={(e) => setNewItem((n) => ({ ...n, requested_value: e.target.value }))}
                    placeholder="e.g. Yes or 10%"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
                      checked={newItem.allow_comment}
                      onChange={(e) => setNewItem((n) => ({ ...n, allow_comment: e.target.checked }))}
                    />
                    Allow hotel to add a comment or counteroffer
                  </label>
                  {itemError && <p className="text-xs text-red-500">{itemError}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button onClick={saveCustomItem} disabled={savingItem}>
                      {savingItem ? 'Saving…' : 'Save item'}
                    </Button>
                    <Button variant="secondary" onClick={() => { setAddingItem(false); setItemError(null) }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
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
      )}
    </div>
  )
}
