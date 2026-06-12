import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Client, DefaultTerms, Trip, TripStatus } from '../../lib/types'
import { nightsBetween } from '../../lib/format'
import {
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  Select,
  TextField,
} from '../../components/ui'

const blank = {
  client_id: '',
  city: '',
  opponent_label: '',
  arrival_date: '',
  departure_date: '',
  game_date: '',
  game_time: '',
  stay2_arrival_date: '',
  stay2_departure_date: '',
  stay2_game_date: '',
  stay2_game_time: '',
  king_rooms_requested: '',
  suites_requested: '',
  total_rooms_requested: '',
  in_season_tournament_window: '',
  postseason_window: '',
  postseason_rooms_text: '',
  postseason_type: 'regular' as 'regular' | 'playoffs' | 'finals',
  status: 'draft' as TripStatus,
  response_deadline: '',
}

type FormState = typeof blank

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function TripForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const presetClient = search.get('client') ?? ''

  const [clients, setClients] = useState<Pick<Client, 'id' | 'team_name' | 'default_terms'>[]>([])
  const [fields, setFields] = useState<FormState>({ ...blank, client_id: presetClient })
  const [showStay2, setShowStay2] = useState(false)
  const [nightScenarios, setNightScenarios] = useState<number[]>([1])
  const [needsPlayoffClause, setNeedsPlayoffClause] = useState(false)
  const [needsTournamentClause, setNeedsTournamentClause] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the client list (for the selector and for default-term pre-fill).
  useEffect(() => {
    supabase
      .from('clients')
      .select('id, team_name, default_terms')
      .order('team_name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setClients(data as Pick<Client, 'id' | 'team_name' | 'default_terms'>[])
        if (!editing) setLoading(false)
      })
  }, [editing])

  // When editing, load the existing trip.
  useEffect(() => {
    if (!editing) return
    supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
        } else if (data) {
          const t = data as Trip
          if (t.stay2_arrival_date) setShowStay2(true)
          if ((t as any).night_scenarios?.length) setNightScenarios((t as any).night_scenarios)
          if (t.postseason_window || t.postseason_rooms_text) setNeedsPlayoffClause(true)
          if (t.in_season_tournament_window) setNeedsTournamentClause(true)
          setFields({
            client_id: t.client_id,
            city: t.city ?? '',
            opponent_label: t.opponent_label ?? '',
            arrival_date: t.arrival_date ?? '',
            departure_date: t.departure_date ?? '',
            game_date: t.game_date ?? '',
            game_time: t.game_time ?? '',
            stay2_arrival_date: t.stay2_arrival_date ?? '',
            stay2_departure_date: t.stay2_departure_date ?? '',
            stay2_game_date: t.stay2_game_date ?? '',
            stay2_game_time: t.stay2_game_time ?? '',
            king_rooms_requested: t.king_rooms_requested?.toString() ?? '',
            suites_requested: t.suites_requested?.toString() ?? '',
            total_rooms_requested: t.total_rooms_requested?.toString() ?? '',
            in_season_tournament_window: t.in_season_tournament_window ?? '',
            postseason_window: t.postseason_window ?? '',
            postseason_rooms_text: t.postseason_rooms_text ?? '',
            postseason_type: ((t as any).postseason_type ?? 'regular') as 'regular' | 'playoffs' | 'finals',
            status: t.status,
            response_deadline: t.response_deadline ?? '',
          })
        }
        setLoading(false)
      })
  }, [editing, id])

  // Pre-fill room counts / windows from the chosen client's default_terms.
  // Only applies for NEW trips and only fills blanks (never clobbers typing).
  const applyDefaults = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId)
    const terms: DefaultTerms = client?.default_terms ?? {}
    setFields((f) => ({
      ...f,
      client_id: clientId,
      king_rooms_requested:
        f.king_rooms_requested ||
        (terms.default_king_rooms != null ? String(terms.default_king_rooms) : ''),
      suites_requested:
        f.suites_requested || (terms.default_suites != null ? String(terms.default_suites) : ''),
      total_rooms_requested:
        f.total_rooms_requested ||
        (terms.default_total_rooms != null ? String(terms.default_total_rooms) : ''),
      in_season_tournament_window:
        f.in_season_tournament_window || terms.in_season_tournament_window || '',
      postseason_window: f.postseason_window || terms.postseason_window || '',
      postseason_rooms_text: f.postseason_rooms_text || terms.postseason_rooms_text || '',
    }))
    if (terms.postseason_window || terms.postseason_rooms_text) setNeedsPlayoffClause(true)
    if (terms.in_season_tournament_window) setNeedsTournamentClause(true)
  }

  // Apply defaults once the client list arrives, when a client is preset via URL.
  useEffect(() => {
    if (!editing && presetClient && clients.length) applyDefaults(presetClient)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, editing, presetClient])

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }))

  const nights = useMemo(
    () => nightsBetween(fields.arrival_date, fields.departure_date),
    [fields.arrival_date, fields.departure_date],
  )

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fields.client_id) {
      setError('Please choose a client.')
      return
    }
    setSaving(true)
    setError(null)

    const clean = (v: string) => (v.trim() === '' ? null : v.trim())
    const payload = {
      client_id: fields.client_id,
      city: clean(fields.city),
      opponent_label: clean(fields.opponent_label),
      arrival_date: clean(fields.arrival_date),
      departure_date: clean(fields.departure_date),
      nights,
      game_date: clean(fields.game_date),
      game_time: clean(fields.game_time),
      stay2_arrival_date: clean(fields.stay2_arrival_date),
      stay2_departure_date: clean(fields.stay2_departure_date),
      stay2_game_date: clean(fields.stay2_game_date),
      stay2_game_time: clean(fields.stay2_game_time),
      king_rooms_requested: numOrNull(fields.king_rooms_requested),
      suites_requested: numOrNull(fields.suites_requested),
      total_rooms_requested: numOrNull(fields.total_rooms_requested),
      in_season_tournament_window: clean(fields.in_season_tournament_window),
      postseason_window: clean(fields.postseason_window),
      postseason_rooms_text: clean(fields.postseason_rooms_text),
      postseason_type: fields.postseason_type,
      status: fields.status,
      response_deadline: clean(fields.response_deadline),
      night_scenarios: nightScenarios.length > 0 ? nightScenarios : [1],
    }

    if (editing) {
      const { error } = await supabase.from('trips').update(payload).eq('id', id)
      if (error) {
        setError(error.message)
        setSaving(false)
        return
      }
      navigate(`/trips/${id}`)
    } else {
      const { data, error } = await supabase.from('trips').insert(payload).select('id').single()
      if (error) {
        setError(error.message)
        setSaving(false)
        return
      }
      navigate(`/trips/${data!.id}`)
    }
  }

  if (loading) return <Loading />

  return (
    <div>
      <PageHeader
        title={editing ? 'Edit Trip' : 'New Trip'}
        subtitle="A road trip KJST is running a hotel RFP for."
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <form onSubmit={save} className="space-y-6">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Trip
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Client"
              value={fields.client_id}
              onChange={(e) =>
                editing
                  ? setFields((f) => ({ ...f, client_id: e.target.value }))
                  : applyDefaults(e.target.value)
              }
              required
            >
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.team_name}
                </option>
              ))}
            </Select>
            <TextField
              label="Opponent"
              hint="e.g. at Boston Celtics"
              placeholder="e.g. @ Miami Heat"
              value={fields.opponent_label}
              onChange={set('opponent_label')}
            />
            <div>
              <TextField label="City" value={fields.city} onChange={set('city')} />
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Each game city is its own trip. Two away games in NYC = two separate trips.</p>
            </div>
            <Select
              label="Status"
              value={fields.status}
              onChange={(e) =>
                setFields((f) => ({ ...f, status: e.target.value as TripStatus }))
              }
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="collecting">Collecting</option>
              <option value="closed">Closed</option>
            </Select>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {fields.stay2_arrival_date ? 'Visit 1 Dates' : 'Dates'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Arrival date"
              type="date"
              value={fields.arrival_date}
              onChange={set('arrival_date')}
            />
            <TextField
              label="Departure date"
              type="date"
              value={fields.departure_date}
              onChange={set('departure_date')}
              hint={nights != null ? `${nights} night${nights === 1 ? '' : 's'}` : undefined}
            />
            <TextField
              label="Game date"
              type="date"
              value={fields.game_date}
              onChange={set('game_date')}
            />
            <TextField
              label="Game time"
              value={fields.game_time}
              onChange={set('game_time')}
              hint="e.g. 7:30 PM"
            />
            <TextField
              label="Response deadline"
              type="date"
              value={fields.response_deadline}
              onChange={set('response_deadline')}
            />
          </div>
        </Card>

        {/* Night Scenarios */}
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Night Scenarios
          </h2>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            Hotels will quote a separate rate for each option you select. Not sure yet? Check all that apply — you can narrow it down before sending.
          </p>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3].map((n) => {
              const checked = nightScenarios.includes(n)
              return (
                <label
                  key={n}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    checked
                      ? 'border-[#1C1008] bg-[#1C1008]/5 text-[#1C1008] dark:border-amber-400 dark:text-amber-400'
                      : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
                    checked={checked}
                    onChange={(e) => {
                      setNightScenarios((prev) =>
                        e.target.checked
                          ? [...prev, n].sort((a, b) => a - b)
                          : prev.filter((x) => x !== n).length > 0
                            ? prev.filter((x) => x !== n)
                            : prev // never allow empty
                      )
                    }}
                  />
                  {n} night{n > 1 ? 's' : ''}
                </label>
              )
            })}
          </div>
          {nightScenarios.length > 1 && (
            <p className="mt-3 text-xs text-amber-600">
              Hotels will be asked to quote rates and confirm availability for each selected scenario.
            </p>
          )}
        </Card>

        {/* Second Visit */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Second Visit <span className="ml-1 font-normal normal-case text-slate-400 dark:text-slate-500">(optional — same city, different dates)</span>
            </h2>
            {showStay2 ? (
              <button
                type="button"
                className="text-xs text-red-400 hover:text-red-600 hover:underline"
                onClick={() => {
                  setShowStay2(false)
                  setFields((f) => ({
                    ...f,
                    stay2_arrival_date: '',
                    stay2_departure_date: '',
                    stay2_game_date: '',
                    stay2_game_time: '',
                  }))
                }}
              >
                Remove second visit
              </button>
            ) : (
              <button
                type="button"
                className="text-xs font-medium text-[#1C1008] hover:underline"
                onClick={() => setShowStay2(true)}
              >
                + Add second visit
              </button>
            )}
          </div>
          {showStay2 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Arrival date (stay 2)"
                type="date"
                value={fields.stay2_arrival_date}
                onChange={set('stay2_arrival_date')}
              />
              <TextField
                label="Departure date (stay 2)"
                type="date"
                value={fields.stay2_departure_date}
                onChange={set('stay2_departure_date')}
              />
              <TextField
                label="Game date (stay 2)"
                type="date"
                value={fields.stay2_game_date}
                onChange={set('stay2_game_date')}
              />
              <TextField
                label="Game time (stay 2)"
                value={fields.stay2_game_time}
                onChange={set('stay2_game_time')}
                hint="e.g. 7:30 PM"
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Use this when the team plays the same city twice — e.g. Atlanta in November and Atlanta in April. Each visit gets its own set of dates. This is different from night scenarios (which are rate-quote options for the same visit).
            </p>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Rooms requested
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="King rooms"
              type="number"
              value={fields.king_rooms_requested}
              onChange={set('king_rooms_requested')}
            />
            <div>
              <TextField
                label="Suites"
                type="number"
                value={fields.suites_requested}
                onChange={set('suites_requested')}
              />
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Include coaches, staff, and executive suites.</p>
            </div>
            <TextField
              label="Total rooms"
              type="number"
              value={fields.total_rooms_requested}
              onChange={set('total_rooms_requested')}
            />
          </div>
        </Card>

        {/* ── Trip Type ── */}
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Trip Type</h2>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            Selecting Playoffs or Finals auto-fills standard room block counts. You can edit them afterwards.
          </p>
          <div className="flex flex-wrap gap-3">
            {(
              [
                { value: 'regular', label: 'Regular Season' },
                { value: 'playoffs', label: 'Playoffs' },
                { value: 'finals', label: 'NBA Finals / Championship' },
              ] as const
            ).map(({ value, label }) => {
              const checked = fields.postseason_type === value
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    checked
                      ? 'border-[#1C1008] bg-[#1C1008]/5 text-[#1C1008] dark:border-amber-400 dark:text-amber-400'
                      : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="postseason_type"
                    className="h-4 w-4 border-slate-300 accent-[#1C1008]"
                    checked={checked}
                    onChange={() => {
                      setFields((f) => ({
                        ...f,
                        postseason_type: value,
                        king_rooms_requested:
                          value === 'playoffs' ? '75' : value === 'finals' ? '80' : f.king_rooms_requested,
                        suites_requested:
                          value === 'playoffs' ? '0' : value === 'finals' ? '20' : f.suites_requested,
                      }))
                    }}
                  />
                  {label}
                </label>
              )
            })}
          </div>
          {fields.postseason_type === 'playoffs' && (
            <p className="mt-3 text-xs text-amber-600">Auto-filled: 75 rooms (standard playoff block)</p>
          )}
          {fields.postseason_type === 'finals' && (
            <p className="mt-3 text-xs text-amber-600">Auto-filled: 80 kings + 20 suites (standard finals block)</p>
          )}
        </Card>

        {/* ── Playoff clause ── */}
        <Card className="p-6">
          <div className="mb-1 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Playoff Clause</h2>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Adds a hold to the hotel contract for playoff dates. Only needed for teams that prioritize postseason — playoff-focused teams (e.g. Cavs) will choose a more expensive hotel just to get this. Budget-conscious teams typically skip it.
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
                checked={needsPlayoffClause}
                onChange={(e) => {
                  setNeedsPlayoffClause(e.target.checked)
                  if (!e.target.checked) {
                    setFields((f) => ({ ...f, postseason_window: '', postseason_rooms_text: '' }))
                  }
                }}
              />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {needsPlayoffClause ? 'Yes — include playoff clause' : 'No — skip'}
              </span>
            </label>
          </div>

          {needsPlayoffClause && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <TextField
                  label="Postseason window"
                  value={fields.postseason_window}
                  onChange={set('postseason_window')}
                  hint="Date range the playoffs could be held — e.g. Apr 19 – May 31, 2026"
                />
              </div>
              <div>
                <TextField
                  label="Postseason room count"
                  value={fields.postseason_rooms_text}
                  onChange={set('postseason_rooms_text')}
                  hint="Leave blank to use the same room block as the regular stay"
                />
              </div>
            </div>
          )}
        </Card>

        {/* ── In-Season Tournament clause ── */}
        <Card className="p-6">
          <div className="mb-1 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">In-Season Tournament Clause</h2>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                NBA In-Season Tournament runs Nov–Dec. If this city could host a return tournament stay, add a hold for that window. Skip for most regular-season trips.
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
                checked={needsTournamentClause}
                onChange={(e) => {
                  setNeedsTournamentClause(e.target.checked)
                  if (!e.target.checked) {
                    setFields((f) => ({ ...f, in_season_tournament_window: '' }))
                  }
                }}
              />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {needsTournamentClause ? 'Yes — include tournament clause' : 'No — skip'}
              </span>
            </label>
          </div>

          {needsTournamentClause && (
            <div className="mt-4">
              <TextField
                label="Tournament window"
                value={fields.in_season_tournament_window}
                onChange={set('in_season_tournament_window')}
                hint="Date range for the In-Season Tournament — e.g. Nov 12 – Dec 14, 2025"
              />
            </div>
          )}
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create trip'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(editing ? `/trips/${id}` : '/trips')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
