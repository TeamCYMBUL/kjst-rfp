import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import { Badge, ErrorNote, LinkButton, Loading } from '../components/ui'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'



type DashTrip = {
  id: string
  opponent_label: string | null
  city: string | null
  status: string
  arrival_date: string | null
  response_deadline: string | null
  clients: { id: string; team_name: string } | null
  rfp_invitations: { id: string; status: string; hotel_name: string; sent_at: string | null }[]
}


function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// A trip is "delinquent" when hotels it invited have gone quiet: still awaiting
// (sent/opened), and either the response deadline has passed or it's been 3+
// days since the invite went out with no reply. Deadlines are usually blank in
// practice, so quiet-since-invited is the primary trigger.
const STALE_DAYS = 3
function delinquentCount(trip: DashTrip): number {
  const dl = daysUntil(trip.response_deadline)
  const overdue = dl !== null && dl < 0
  return trip.rfp_invitations.filter((inv) => {
    if (!['sent', 'opened'].includes(inv.status)) return false
    if (overdue) return true
    if (!inv.sent_at) return false
    const daysWaiting = Math.floor((Date.now() - new Date(inv.sent_at).getTime()) / 86400000)
    return daysWaiting >= STALE_DAYS
  }).length
}

function DeadlineChip({ deadline }: { deadline: string | null }) {
  if (!deadline) return null
  const days = daysUntil(deadline)
  if (days === null) return null
  const label =
    days < 0
      ? 'Past deadline'
      : days === 0
        ? 'Due today'
        : days === 1
          ? '1 day left'
          : `${days} days left`
  const color =
    days < 0
      ? 'bg-red-100 text-red-700'
      : days <= 3
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-500'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>
  )
}

/** A single trip row/card used in all three views */
function TripCard({ trip, showClient = true }: { trip: DashTrip; showClient?: boolean }) {
  const invited = trip.rfp_invitations.length
  const submitted = trip.rfp_invitations.filter((i) =>
    ['submitted', 'awarded'].includes(i.status),
  ).length
  const opened = trip.rfp_invitations.filter((i) => i.status === 'opened').length
  const delinquent = delinquentCount(trip)
  return (
    <Link
      to={`/trips/${trip.id}`}
      className={`block rounded-xl border bg-white dark:bg-slate-800 px-5 py-4 transition hover:shadow-sm ${
        delinquent > 0
          ? 'border-red-300 dark:border-red-800/70 hover:border-red-400 dark:hover:border-red-700'
          : 'border-slate-200 dark:border-slate-700 hover:border-[#E5D5C8] dark:hover:border-slate-600'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {trip.opponent_label || 'Untitled trip'}
            </span>
            {trip.city && <span className="text-slate-400 dark:text-slate-500">· {trip.city}</span>}
            <Badge status={trip.status} />
            <DeadlineChip deadline={trip.response_deadline} />
            {delinquent > 0 && (
              <span
                title={`${delinquent} hotel${delinquent !== 1 ? 's' : ''} invited with no reply yet — consider a reminder`}
                className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                ⚑ {delinquent} delinquent
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {showClient && trip.clients?.team_name && (
              <span className="font-medium text-slate-600 dark:text-slate-300">{trip.clients.team_name}</span>
            )}
            {trip.arrival_date && <span>{formatDate(trip.arrival_date)}</span>}
            {trip.response_deadline && (
              <span>Due {formatDate(trip.response_deadline)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-right">
          {invited > 0 && (
            <div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-200">
                {submitted}/{invited}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">submitted</div>
            </div>
          )}
          {opened > 0 && (
            <div>
              <div className="text-lg font-bold text-amber-500">{opened}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">opened</div>
            </div>
          )}
          {invited === 0 && (
            <span className="text-xs text-slate-400 dark:text-slate-500">No hotels added yet</span>
          )}
        </div>
      </div>
    </Link>
  )
}

/** By Client — trips grouped under collapsible team sections */
function ClientView({ trips }: { trips: DashTrip[] }) {
  // Group by client id
  const groups = new Map<string, { name: string; trips: DashTrip[] }>()
  for (const trip of trips) {
    const key = trip.clients?.id ?? '__none__'
    const name = trip.clients?.team_name ?? 'No client assigned'
    if (!groups.has(key)) groups.set(key, { name, trips: [] })
    groups.get(key)!.trips.push(trip)
  }
  // Sort groups alphabetically
  const sorted = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  const isUrgent = (g: { trips: DashTrip[] }) =>
    g.trips.some((t) => {
      const d = daysUntil(t.response_deadline)
      return d !== null && d >= 0 && d <= 7
    })

  // Default collapsed so the page stays short with many clients. Auto-open when
  // there's only one group (nothing to collapse) or a client has an urgent deadline.
  // Parent remounts this with a key when the client filter changes, so defaults recompute.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const s = new Set<string>()
    if (sorted.length === 1) {
      sorted.forEach(([k]) => s.add(k))
    } else {
      sorted.forEach(([k, g]) => { if (isUrgent(g)) s.add(k) })
    }
    return s
  })

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const allKeys = sorted.map(([k]) => k)
  const allOpen = allKeys.length > 0 && allKeys.every((k) => openKeys.has(k))

  return (
    <div className="space-y-3">
      {sorted.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={() => setOpenKeys(allOpen ? new Set() : new Set(allKeys))}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      {sorted.map(([key, group]) => {
        const allInvited = group.trips.reduce((n, t) => n + t.rfp_invitations.length, 0)
        const allSubmitted = group.trips.reduce(
          (n, t) =>
            n +
            t.rfp_invitations.filter((i) => ['submitted', 'awarded'].includes(i.status)).length,
          0,
        )
        const hasUrgent = isUrgent(group)
        const groupDelinquent = group.trips.reduce((n, t) => n + delinquentCount(t), 0)
        const isOpen = openKeys.has(key)
        return (
          <div
            key={key}
            className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            {/* Client header — click to expand/collapse */}
            <button
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`text-slate-400 dark:text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  aria-hidden
                >
                  ▸
                </span>
                <span className="text-base font-semibold text-slate-800 dark:text-slate-200">{group.name}</span>
                {hasUrgent && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    ⏰ Deadline soon
                  </span>
                )}
                {groupDelinquent > 0 && (
                  <span
                    title={`${groupDelinquent} hotel${groupDelinquent !== 1 ? 's' : ''} across this client with no reply yet`}
                    className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300"
                  >
                    ⚑ {groupDelinquent} delinquent
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  <strong className="text-slate-700 dark:text-slate-300">{group.trips.length}</strong> trip
                  {group.trips.length !== 1 ? 's' : ''}
                </span>
                {allInvited > 0 && (
                  <span>
                    <strong className="text-emerald-600">{allSubmitted}</strong>
                    <span className="text-slate-400 dark:text-slate-500">/{allInvited}</span> bids in
                  </span>
                )}
              </div>
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-700 p-4">
                {[...group.trips]
                  .sort((a, b) =>
                    (a.city ?? a.opponent_label ?? '').localeCompare(
                      b.city ?? b.opponent_label ?? '',
                      undefined,
                      { sensitivity: 'base' },
                    ),
                  )
                  .map((trip) => (
                    <TripCard key={trip.id} trip={trip} showClient={false} />
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OnboardingBanner() {
  const { steps, completedCount, allDone, loading } = useOnboardingProgress()
  if (loading || allDone) return null
  const total = steps.length
  const pct = Math.round((completedCount / total) * 100)

  return (
    <div className="rounded-xl border border-[#1C1008]/15 bg-[#1C1008]/5 px-6 py-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <p className="text-sm font-semibold text-[#1C1008]">
            🚀 Get Started — {completedCount} of {total} steps complete
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-32 h-2 rounded-full bg-[#1C1008]/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#1C1008] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-medium text-[#1C1008]/60">{pct}%</span>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.n} className="flex items-start gap-2.5">
            {step.done ? (
              <span className="mt-0.5 text-sm font-bold text-emerald-500">✅</span>
            ) : (
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[#1C1008]/20 text-[10px] font-bold text-[#1C1008]/40">
                {step.n}
              </span>
            )}
            <div>
              <span className={`text-sm font-medium ${step.done ? 'text-slate-400 dark:text-slate-600 line-through' : 'text-slate-700 dark:text-slate-300'}`}>
                {step.title}
              </span>
              {!step.done && (
                <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{step.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}

export default function Dashboard() {
  const [trips, setTrips] = useState<DashTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasClients, setHasClients] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [clientFilter, setClientFilter] = useState<string | null>(null)
  useEffect(() => {
    const load = async () => {
      const [tripsRes, clientsRes] = await Promise.all([
        supabase
          .from('trips')
          .select(
            'id, opponent_label, city, status, arrival_date, response_deadline, clients(id, team_name), rfp_invitations(id, status, hotel_name, sent_at)',
          )
          .order('response_deadline', { ascending: true }),
        supabase.from('clients').select('id').limit(1),
      ])

      if (tripsRes.error) setError(tripsRes.error.message)
      else setTrips((tripsRes.data as unknown as DashTrip[]) ?? [])

      setHasClients((clientsRes.data?.length ?? 0) > 0)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Loading />
  if (error) return <ErrorNote message={error} />

  // Stats always exclude closed trips (regardless of showClosed toggle)
  const openTrips = trips.filter((t) => t.status !== 'closed')
  const activeTrips = openTrips.filter((t) => t.status !== 'draft')
  const totalInvited = activeTrips.reduce((n, t) => n + t.rfp_invitations.length, 0)
  const totalSubmitted = activeTrips.reduce(
    (n, t) =>
      n +
      t.rfp_invitations.filter((i) => ['submitted', 'awarded'].includes(i.status)).length,
    0,
  )
  const totalOutstanding = totalInvited - totalSubmitted
  const closedCount = trips.filter((t) => t.status === 'closed').length

  // What the list actually shows
  const displayedTrips = showClosed ? trips : openTrips

  // Distinct clients present in the fetched trips — no separate query needed
  const clientOptions = [...new Map(trips.filter((t) => t.clients).map((t) => [t.clients!.id, t.clients!.team_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const clientFilteredTrips = clientFilter
    ? displayedTrips.filter((t) => t.clients?.id === clientFilter)
    : displayedTrips

  // Empty state: no non-closed trips at all
  if (openTrips.length === 0 && closedCount === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="text-center">
          <div className="mb-2 text-4xl">🏀</div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Welcome to the KJST RFP Platform
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {hasClients
              ? 'You have clients set up — create a trip to start sending RFPs.'
              : 'Replace the manual Word-doc process with one clean, live comparison grid.'}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            {!hasClients && (
              <LinkButton to="/clients/new">Add your first client</LinkButton>
            )}
            {hasClients && <LinkButton to="/trips/new">Create a trip</LinkButton>}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">How this works</h2>
          <div className="grid gap-3 sm:grid-cols-3 text-sm text-slate-500 dark:text-slate-400">
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">1. Set up clients &amp; hotels</p>
              <p>Add each sports team you work with under Clients. Add your hotel contacts under Hotels — they'll auto-fill when you invite hotels to a trip.</p>
            </div>
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">2. Create trips &amp; send RFPs</p>
              <p>Every away game that needs a hotel block is a Trip. Add hotels to the trip and each one gets a unique, secure link to fill out their bid.</p>
            </div>
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">3. Compare &amp; present</p>
              <p>As hotels submit, the comparison grid updates live. When ready, export an internal sheet for your team or a clean proposal PDF for the client.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Dashboard</h1>
        <div className="flex items-center gap-2">
          <LinkButton to="/clients/new" variant="secondary">
            + New client
          </LinkButton>
          <LinkButton to="/trips/new">
            + New trip
          </LinkButton>
        </div>
      </div>

      {/* Onboarding banner */}
      <OnboardingBanner />

      {/* How this works — always-visible explanation */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">How this works</h2>
        <div className="grid gap-3 sm:grid-cols-3 text-sm text-slate-500 dark:text-slate-400">
          <div>
            <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">1. Set up clients &amp; hotels</p>
            <p>Add each sports team you work with under Clients. Add your hotel contacts under Hotels — they'll auto-fill when you invite hotels to a trip.</p>
          </div>
          <div>
            <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">2. Create trips &amp; send RFPs</p>
            <p>Every away game that needs a hotel block is a Trip. Add hotels to the trip and each one gets a unique, secure link to fill out their bid.</p>
          </div>
          <div>
            <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">3. Compare &amp; present</p>
            <p>As hotels submit, the comparison grid updates live. When ready, export an internal sheet for your team or a clean proposal PDF for the client.</p>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Active trips', sublabel: 'in progress', value: activeTrips.length, color: 'text-[#1C1008]' },
          { label: 'Hotels invited', sublabel: 'this cycle', value: totalInvited, color: 'text-slate-800' },
          { label: 'Bids received', sublabel: 'submitted', value: totalSubmitted, color: 'text-emerald-600' },
          {
            label: 'Awaiting response',
            sublabel: 'outstanding',
            value: totalOutstanding,
            color: totalOutstanding > 0 ? 'text-amber-600' : 'text-slate-400',
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4"
          >
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{s.label}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500">{s.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Trips by client — the single home view. Header row carries the filter
          and show-closed controls; delinquent trips are flagged inline and rolled
          up onto each client header. */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {showClosed ? 'All trips' : 'Active & draft trips'} · by client
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {clientOptions.length > 0 && (
              <select
                value={clientFilter ?? ''}
                onChange={(e) => setClientFilter(e.target.value || null)}
                className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
              >
                <option value="">All clients</option>
                {clientOptions.map(([clientId, teamName]) => (
                  <option key={clientId} value={clientId}>{teamName}</option>
                ))}
              </select>
            )}
            {closedCount > 0 && (
              <button
                onClick={() => setShowClosed((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  showClosed
                    ? 'border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {showClosed ? '✓' : '○'} Show closed ({closedCount})
              </button>
            )}
          </div>
        </div>
        <ClientView key={clientFilter ?? 'all'} trips={clientFilteredTrips} />
      </div>

    </div>
  )
}
