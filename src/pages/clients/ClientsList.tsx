import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { Badge, ErrorNote, Loading } from '../../components/ui'
import { useRole } from '../../lib/useRole'
import ScheduleImportModal from '../trips/ScheduleImport'
import { exportAllCitiesForClient } from '../../lib/exportAllCities'

// ── Types ──────────────────────────────────────────────────────────────────────

type ClientTrip = {
  id: string
  opponent_label: string | null
  arrival_date: string | null
  city: string | null
  status: string
}

type Client = {
  id: string
  team_name: string
  league: string | null
  season: string | null
  logo_url: string | null
  primary_contact_name: string | null
  primary_contact_title: string | null
  primary_contact_email: string | null
  primary_contact_phone: string | null
  assigned_to: string | null
  profiles: { full_name: string | null; email: string | null } | null
  trips: ClientTrip[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LEAGUE_COLORS: Record<string, { bg: string; text: string }> = {
  NBA:  { bg: 'bg-blue-100',   text: 'text-blue-700' },
  NFL:  { bg: 'bg-amber-100',  text: 'text-amber-700' },
  MLB:  { bg: 'bg-red-100',    text: 'text-red-700' },
  NHL:  { bg: 'bg-cyan-100',   text: 'text-cyan-700' },
  WNBA: { bg: 'bg-orange-100', text: 'text-orange-700' },
  MLS:  { bg: 'bg-green-100',  text: 'text-green-700' },
}

function TeamAvatar({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string
  logoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const prevUrl = useRef(logoUrl)

  // Reset error state if the URL changes
  if (prevUrl.current !== logoUrl) {
    prevUrl.current = logoUrl
    setImgFailed(false)
  }

  const sizeClass =
    size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm'

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={() => setImgFailed(true)}
        className={`${sizeClass} shrink-0 rounded-lg border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 object-contain p-0.5`}
      />
    )
  }

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
  return (
    <div
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-lg bg-[#1C1008] font-bold text-white`}
    >
      {initials}
    </div>
  )
}

function LeagueBadge({ league }: { league: string | null }) {
  if (!league) return null
  const upper = league.toUpperCase()
  const colors = LEAGUE_COLORS[upper] ?? { bg: 'bg-slate-100', text: 'text-slate-600' }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colors.bg} ${colors.text}`}>
      {league}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const LEAGUES = ['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'MLS']

export default function ClientsList() {
  const [clients, setClients] = useState<Client[] | null>(null)
  const [selected, setSelected] = useState<Client | null>(null)
  const [exportingCities, setExportingCities] = useState(false)
  const [search, setSearch] = useState('')
  const [leagueFilter, setLeagueFilter] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  // Submitted bids across the selected client's trips, and how many are unprinted
  // — drives the progressive batch-print buttons.
  const [proposalCounts, setProposalCounts] = useState<{ total: number; unprinted: number } | null>(null)
  const { role, canEditClient } = useRole()

  const loadClients = (keepSelected?: string) => {
    supabase
      .from('clients')
      .select(
        'id, team_name, league, season, logo_url, primary_contact_name, primary_contact_title, primary_contact_email, primary_contact_phone, assigned_to, profiles(full_name, email), trips(id, opponent_label, arrival_date, city, status)',
      )
      .order('team_name')
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
        } else {
          const rows = (data ?? []).map((r: any) => ({ ...r, profiles: Array.isArray(r.profiles) ? (r.profiles[0] ?? null) : r.profiles })) as Client[]
          setClients(rows)
          if (keepSelected) {
            setSelected(rows.find((r) => r.id === keepSelected) ?? rows[0] ?? null)
          } else if (rows.length > 0) {
            setSelected(rows[0])
          }
        }
      })
  }

  useEffect(() => { loadClients() }, [])

  // Load proposal (bid) counts for the selected client, for the batch-print buttons.
  useEffect(() => {
    if (!selected) { setProposalCounts(null); return }
    const tripIds = selected.trips.map((t) => t.id)
    if (tripIds.length === 0) { setProposalCounts({ total: 0, unprinted: 0 }); return }
    let cancelled = false
    setProposalCounts(null)
    supabase
      .from('rfp_invitations')
      .select('printed_at')
      .in('trip_id', tripIds)
      .in('status', ['submitted', 'awarded'])
      .then(({ data }) => {
        if (cancelled) return
        const bids = data ?? []
        setProposalCounts({
          total: bids.length,
          unprinted: bids.filter((b: any) => b.printed_at == null).length,
        })
      })
    return () => { cancelled = true }
  }, [selected])

  if (error) return <ErrorNote message={error} />
  if (!clients) return <Loading />

  const filtered = clients.filter(
    (c) =>
      (leagueFilter === 'all' || (c.league ?? '').toUpperCase() === leagueFilter) &&
      (c.team_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.league ?? '').toLowerCase().includes(search.toLowerCase())),
  )

  const totalTrips = clients.reduce((n, c) => n + c.trips.length, 0)

  const selTrips = selected?.trips ?? []
  const selActive = selTrips.filter((t) => !['closed', 'draft'].includes(t.status))
  const selClosed = selTrips.filter((t) => t.status === 'closed')

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Clients</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {clients.length} team{clients.length !== 1 ? 's' : ''} · {totalTrips} total trip
            {totalTrips !== 1 ? 's' : ''}
          </p>
        </div>
        {role === 'admin' && (
          <Link
            to="/clients/new"
            className="rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d1e0e]"
          >
            + New client
          </Link>
        )}
      </div>

      {clients.length === 0 ? (
        /* ── Empty state ── */
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-16 text-center">
          <div className="mb-3 text-4xl">🏀</div>
          <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300">No clients yet</h2>
          <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
            Add your first sports team to get started.
          </p>
          {role === 'admin' && (
            <Link
              to="/clients/new"
              className="mt-4 rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d1e0e]"
            >
              Add client
            </Link>
          )}
        </div>
      ) : (
        /* ── Split panel ── */
        <div className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" style={{ minHeight: 520 }}>
          {/* Left — client list */}
          <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700">
            {/* Search */}
            <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-3 space-y-2">
              <input
                type="text"
                placeholder="Search teams..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-[#1C1008]/30 focus:outline-none focus:ring-1 focus:ring-[#1C1008]/20"
              />
              <select
                value={leagueFilter}
                onChange={(e) => setLeagueFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 focus:border-[#1C1008]/30 focus:outline-none focus:ring-1 focus:ring-[#1C1008]/20"
              >
                <option value="all">All leagues</option>
                {LEAGUES.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">
                  No teams match your search.
                </div>
              ) : (
                filtered.map((c) => {
                  const active = c.trips.filter(
                    (t) => !['closed', 'draft'].includes(t.status),
                  ).length
                  const isSelected = selected?.id === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className={`flex w-full items-center gap-3 border-b border-slate-100 dark:border-slate-700 px-4 py-3.5 text-left transition-colors last:border-0 ${
                        isSelected ? 'bg-[#1C1008]/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <TeamAvatar name={c.team_name} logoUrl={c.logo_url} />
                      <div className="min-w-0 flex-1">
                        <span
                          className={`truncate block text-sm font-semibold ${
                            isSelected ? 'text-[#1C1008] dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {c.team_name}
                        </span>
                        <div className="mt-0.5 flex items-center gap-2">
                          <LeagueBadge league={c.league} />
                          {c.season && (
                            <span className="text-xs text-slate-400 dark:text-slate-500">{c.season}</span>
                          )}
                        </div>
                        {c.primary_contact_name && (
                          <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">
                            {c.primary_contact_name}
                            {c.primary_contact_email && ` · ${c.primary_contact_email}`}
                          </p>
                        )}
                        {c.profiles?.full_name && (
                          <p className="mt-0.5 truncate text-xs text-slate-300 dark:text-slate-600">
                            Manager: {c.profiles.full_name}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {active > 0 ? (
                          <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/20 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            {active} active
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">
                            {c.trips.length} trip{c.trips.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Right — selected client detail */}
          {selected ? (
            <div className="flex-1 overflow-y-auto">
              {/* Header */}
              <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <TeamAvatar name={selected.team_name} logoUrl={selected.logo_url} size="lg" />
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{selected.team_name}</h2>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <LeagueBadge league={selected.league} />
                        {selected.season && (
                          <span className="text-sm text-slate-400 dark:text-slate-500">
                            Season {selected.season}
                          </span>
                        )}
                        {selected.profiles?.full_name && (
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            · {selected.profiles.full_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        if (!selected) return
                        setExportingCities(true)
                        try {
                          await exportAllCitiesForClient(selected.id, selected.team_name)
                        } finally {
                          setExportingCities(false)
                        }
                      }}
                      disabled={exportingCities || selTrips.length === 0}
                      className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {exportingCities ? 'Exporting…' : '↓ Export Hotel Options'}
                    </button>
                    {canEditClient(selected.id) && (
                      <>
                        <button
                          onClick={() => setShowImport(true)}
                          className="rounded-lg border border-[#1C1008]/20 bg-[#1C1008]/5 px-3 py-1.5 text-xs font-semibold text-[#1C1008] transition-colors hover:bg-[#1C1008]/10"
                        >
                          ↑ Import Schedule
                        </button>
                        <Link
                          to={`/trips/new?client=${selected.id}`}
                          className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          + New trip
                        </Link>
                        <Link
                          to={`/clients/${selected.id}/edit`}
                          className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          Edit
                        </Link>
                      </>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total trips', value: selTrips.length, highlight: false },
                    {
                      label: 'Active trips',
                      value: selActive.length,
                      highlight: selActive.length > 0,
                    },
                    { label: 'Closed trips', value: selClosed.length, highlight: false },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg bg-slate-50 dark:bg-slate-700 px-4 py-3">
                      <div
                        className={`text-xl font-bold ${
                          s.highlight ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {s.value}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Proposals — progressive batch print */}
              <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Print Proposals
                </h3>
                {proposalCounts === null ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
                ) : proposalCounts.total === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 italic">No submitted bids yet for this team.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/clients/${selected.id}/proposals?mode=all`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d1e0e]"
                    >
                      🖨️ Print all proposals
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{proposalCounts.total}</span>
                    </a>
                    <a
                      href={`/clients/${selected.id}/proposals?mode=new`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                        proposalCounts.unprinted > 0
                          ? 'border-[#1C1008]/30 text-[#1C1008] hover:bg-[#1C1008]/5 dark:border-amber-400/30 dark:text-amber-400'
                          : 'pointer-events-none border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600'
                      }`}
                    >
                      🖨️ Print new proposals
                      <span className={`rounded-full px-2 py-0.5 text-xs ${proposalCounts.unprinted > 0 ? 'bg-[#1C1008]/10 dark:bg-white/10' : 'bg-slate-100 dark:bg-slate-800'}`}>
                        {proposalCounts.unprinted}
                      </span>
                    </a>
                    <p className="mt-1 w-full text-xs text-slate-400 dark:text-slate-500">
                      Full write-ups for every submitted bid, grouped by trip. Printing marks bids as printed; "new" then shows only bids that have come in since your last print.
                    </p>
                  </div>
                )}
              </div>

              {/* Primary contact card */}
              {(selected.primary_contact_name || selected.primary_contact_email) && (
                <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-5">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Primary Contact
                  </h3>
                  <div className="flex items-start gap-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700 px-4 py-4">
                    {/* Avatar */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1C1008] text-sm font-bold text-white">
                      {(selected.primary_contact_name ?? '?')
                        .split(' ')
                        .slice(0, 2)
                        .map((w) => w[0] ?? '')
                        .join('')
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      {selected.primary_contact_name && (
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {selected.primary_contact_name}
                        </p>
                      )}
                      {selected.primary_contact_title && (
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {selected.primary_contact_title}
                        </p>
                      )}
                      <div className="mt-2 flex flex-col gap-1">
                        {selected.primary_contact_email && (
                          <a
                            href={`mailto:${selected.primary_contact_email}`}
                            className="flex items-center gap-1.5 text-xs text-[#1C1008] hover:underline"
                          >
                            <span>✉</span>
                            {selected.primary_contact_email}
                          </a>
                        )}
                        {selected.primary_contact_phone && (
                          <a
                            href={`tel:${selected.primary_contact_phone}`}
                            className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 hover:underline"
                          >
                            <span>📞</span>
                            {selected.primary_contact_phone}
                          </a>
                        )}
                      </div>
                    </div>
                    {canEditClient(selected.id) && (
                      <Link
                        to={`/clients/${selected.id}/edit`}
                        className="shrink-0 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        title="Edit contact info"
                      >
                        ✎
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* Trips list */}
              <div className="px-6 py-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Trips
                </h3>
                {selTrips.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-600 p-8 text-center">
                    <p className="text-sm text-slate-400 dark:text-slate-500">No trips yet for this team.</p>
                    {canEditClient(selected.id) && (
                      <Link
                        to={`/trips/new?client=${selected.id}`}
                        className="mt-3 inline-block rounded-lg bg-[#1C1008] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2d1e0e]"
                      >
                        Create first trip
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...selTrips]
                      .sort((a, b) =>
                        (b.arrival_date ?? '').localeCompare(a.arrival_date ?? ''),
                      )
                      .map((t) => (
                        <Link
                          key={t.id}
                          to={`/trips/${t.id}`}
                          className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 transition-colors hover:border-[#1C1008]/20 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <div>
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                              {t.opponent_label || 'Untitled trip'}
                            </div>
                            {(t.city || t.arrival_date) && (
                              <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                                {t.city && <span>{t.city}</span>}
                                {t.city && t.arrival_date && (
                                  <span className="mx-1">·</span>
                                )}
                                {t.arrival_date && (
                                  <span>{formatDate(t.arrival_date)}</span>
                                )}
                              </div>
                            )}
                          </div>
                          <Badge status={t.status} />
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
              Select a client to view details.
            </div>
          )}
        </div>
      )}

      {selected && (
        <ScheduleImportModal
          isOpen={showImport}
          onClose={() => setShowImport(false)}
          defaultClientId={selected.id}
          onImported={() => {
            setShowImport(false)
            loadClients(selected.id)
          }}
        />
      )}
    </div>
  )
}
