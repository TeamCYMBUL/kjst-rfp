import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import { Badge, ErrorNote, LinkButton, Loading } from '../components/ui'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'

const BANNER_KEY = 'kjst_banner_dismissed'

type DashTrip = {
  id: string
  opponent_label: string | null
  city: string | null
  status: string
  arrival_date: string | null
  response_deadline: string | null
  clients: { id: string; team_name: string } | null
  rfp_invitations: { id: string; status: string; hotel_name: string }[]
}

type ViewMode = 'deadline' | 'client' | 'status'

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
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
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="block rounded-xl border border-slate-200 bg-white px-5 py-4 transition hover:border-[#E5D5C8] hover:shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">
              {trip.opponent_label || 'Untitled trip'}
            </span>
            {trip.city && <span className="text-slate-400">· {trip.city}</span>}
            <Badge status={trip.status} />
            <DeadlineChip deadline={trip.response_deadline} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {showClient && trip.clients?.team_name && (
              <span className="font-medium text-slate-600">{trip.clients.team_name}</span>
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
              <div className="text-lg font-bold text-slate-800">
                {submitted}/{invited}
              </div>
              <div className="text-xs text-slate-400">submitted</div>
            </div>
          )}
          {opened > 0 && (
            <div>
              <div className="text-lg font-bold text-amber-500">{opened}</div>
              <div className="text-xs text-slate-400">opened</div>
            </div>
          )}
          {invited === 0 && (
            <span className="text-xs text-slate-400">No hotels invited yet</span>
          )}
        </div>
      </div>
    </Link>
  )
}

/** By Deadline — flat sorted list (current behavior) */
function DeadlineView({ trips }: { trips: DashTrip[] }) {
  return (
    <div className="space-y-3">
      {trips.map((trip) => (
        <TripCard key={trip.id} trip={trip} showClient />
      ))}
    </div>
  )
}

/** By Client — trips grouped under team headers */
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

  return (
    <div className="space-y-8">
      {sorted.map(([key, group]) => {
        const allInvited = group.trips.reduce((n, t) => n + t.rfp_invitations.length, 0)
        const allSubmitted = group.trips.reduce(
          (n, t) =>
            n +
            t.rfp_invitations.filter((i) => ['submitted', 'awarded'].includes(i.status)).length,
          0,
        )
        const hasUrgent = group.trips.some((t) => {
          const d = daysUntil(t.response_deadline)
          return d !== null && d >= 0 && d <= 7
        })
        return (
          <div key={key}>
            {/* Client header */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-slate-800">{group.name}</span>
                {hasUrgent && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    ⏰ Deadline soon
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>
                  <strong className="text-slate-700">{group.trips.length}</strong> trip
                  {group.trips.length !== 1 ? 's' : ''}
                </span>
                {allInvited > 0 && (
                  <span>
                    <strong className="text-emerald-600">{allSubmitted}</strong>
                    <span className="text-slate-400">/{allInvited}</span> bids in
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {group.trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} showClient={false} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** By Status — trips grouped by their workflow stage */
function StatusView({ trips }: { trips: DashTrip[] }) {
  const statusGroups: { key: string; label: string; emoji: string; color: string; filter: (t: DashTrip) => boolean }[] = [
    {
      key: 'needs_attention',
      label: 'Needs attention',
      emoji: '🔴',
      color: 'text-red-700',
      filter: (t) => {
        const d = daysUntil(t.response_deadline)
        const hasOutstanding = t.rfp_invitations.some(
          (i) => !['submitted', 'awarded', 'passed', 'declined'].includes(i.status),
        )
        return hasOutstanding && d !== null && d >= 0 && d <= 3
      },
    },
    {
      key: 'collecting',
      label: 'Collecting bids',
      emoji: '📬',
      color: 'text-blue-700',
      filter: (t) =>
        t.status === 'collecting' ||
        (t.rfp_invitations.length > 0 && t.status === 'sent'),
    },
    {
      key: 'draft',
      label: 'Draft — not yet sent',
      emoji: '✏️',
      color: 'text-slate-600',
      filter: (t) => t.status === 'draft',
    },
  ]

  // Each trip appears in the first group it matches
  const assigned = new Set<string>()
  const grouped = statusGroups.map((g) => {
    const groupTrips = trips.filter((t) => !assigned.has(t.id) && g.filter(t))
    groupTrips.forEach((t) => assigned.add(t.id))
    return { ...g, trips: groupTrips }
  })

  // Catch-all: anything not yet assigned
  const remaining = trips.filter((t) => !assigned.has(t.id))

  return (
    <div className="space-y-8">
      {grouped
        .filter((g) => g.trips.length > 0)
        .map((g) => (
          <div key={g.key}>
            <div className="mb-3 border-b border-slate-200 pb-2">
              <span className={`text-sm font-semibold ${g.color}`}>
                {g.emoji} {g.label}
              </span>
              <span className="ml-2 text-xs text-slate-400">{g.trips.length} trip{g.trips.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-3">
              {g.trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} showClient />
              ))}
            </div>
          </div>
        ))}
      {remaining.length > 0 && (
        <div>
          <div className="mb-3 border-b border-slate-200 pb-2">
            <span className="text-sm font-semibold text-slate-500">📋 Other active trips</span>
            <span className="ml-2 text-xs text-slate-400">{remaining.length} trip{remaining.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-3">
            {remaining.map((trip) => (
              <TripCard key={trip.id} trip={trip} showClient />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const STEPS = [
  {
    n: 1,
    title: 'Create a client',
    body: 'Add a sports team with their default room-block terms. These pre-fill every new trip automatically.',
    href: '/clients/new',
    cta: 'Add client',
  },
  {
    n: 2,
    title: 'Create a trip',
    body: 'Set city, opponent, game dates, and the room block requested. Set a deadline for hotel responses.',
    href: '/trips/new',
    cta: 'Add trip',
  },
  {
    n: 3,
    title: 'Invite hotels',
    body: "From the trip page, add each hotel's name and contact. A unique, secure link is generated for each property.",
    href: '/trips',
    cta: 'Go to trips',
  },
  {
    n: 4,
    title: 'Watch bids arrive',
    body: 'The comparison grid updates live as hotels submit. Every counteroffer stays attached to its line item.',
    href: '/trips',
    cta: 'View trips',
  },
  {
    n: 5,
    title: 'Export to Excel',
    body: "One click produces KJST's standard comparison sheet — ready to send to the team.",
    href: '/trips',
    cta: 'View trips',
  },
]

function HowItWorks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? '' : 'rounded-xl border border-slate-200 bg-white p-8'}>
      {!compact && (
        <h2 className="mb-6 text-lg font-semibold text-slate-800">How it works</h2>
      )}
      <ol className={`${compact ? 'space-y-4' : 'space-y-6'}`}>
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-4">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1C1008]/10 text-xs font-bold text-[#1C1008]">
              {s.n}
            </div>
            <div className="flex-1 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">{s.body}</p>
              </div>
              {s.href && (
                <Link
                  to={s.href}
                  className="shrink-0 rounded-lg border border-[#1C1008]/20 bg-[#1C1008]/5 px-3 py-1.5 text-xs font-medium text-[#1C1008] hover:bg-[#1C1008]/10 transition-colors"
                >
                  {s.cta} →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

const VIEW_OPTIONS: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'deadline', label: 'By Deadline', icon: '📅' },
  { key: 'client', label: 'By Client', icon: '🏀' },
  { key: 'status', label: 'By Status', icon: '📊' },
]

export default function Dashboard() {
  const [trips, setTrips] = useState<DashTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasClients, setHasClients] = useState(false)
  const [view, setView] = useState<ViewMode>('deadline')
  const [showClosed, setShowClosed] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(BANNER_KEY) === 'true',
  )
  const { completedCount, allDone } = useOnboardingProgress()

  const dismissBanner = () => {
    localStorage.setItem(BANNER_KEY, 'true')
    setBannerDismissed(true)
  }

  const showBanner = !bannerDismissed && !allDone

  useEffect(() => {
    const load = async () => {
      const [tripsRes, clientsRes] = await Promise.all([
        supabase
          .from('trips')
          .select(
            'id, opponent_label, city, status, arrival_date, response_deadline, clients(id, team_name), rfp_invitations(id, status, hotel_name)',
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
  const upcomingSoon = activeTrips.filter((t) => {
    const d = daysUntil(t.response_deadline)
    return d !== null && d >= 0 && d <= 7
  }).length
  const closedCount = trips.filter((t) => t.status === 'closed').length

  // Overdue invitations — specific hotels that haven't responded past deadline (cross-trip)
  const overdueInvitations = trips.flatMap((trip) => {
    if (!trip.response_deadline) return []
    const deadline = new Date(trip.response_deadline)
    if (deadline > new Date()) return []
    return trip.rfp_invitations
      .filter((inv) => !['submitted', 'awarded', 'passed', 'declined'].includes(inv.status))
      .map((inv) => ({
        hotelName: inv.hotel_name,
        tripName: trip.opponent_label || 'Untitled trip',
        tripId: trip.id,
        daysOverdue: Math.max(1, Math.floor((Date.now() - deadline.getTime()) / (1000 * 60 * 60 * 24))),
      }))
  })

  // What the list actually shows
  const displayedTrips = showClosed ? trips : openTrips

  // Empty state: no non-closed trips at all
  if (openTrips.length === 0 && closedCount === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="text-center">
          <div className="mb-2 text-4xl">🏀</div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome to the KJST RFP Platform
          </h1>
          <p className="mt-2 text-sm text-slate-500">
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
        <HowItWorks />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          <LinkButton to="/clients/new" variant="secondary">
            + New client
          </LinkButton>
          <LinkButton to="/trips/new">
            + New trip
          </LinkButton>
        </div>
      </div>

      {/* Getting Started banner */}
      {showBanner && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[#1C1008]/20 bg-[#1C1008]/5 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-lg">🏁</span>
            <div>
              <p className="text-sm font-semibold text-[#1C1008]">
                New to KJST RFP?{' '}
                <span className="font-normal text-slate-600">
                  Follow the Getting Started guide to run your first RFP.
                </span>
              </p>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 w-24 rounded-full bg-[#1C1008]/15">
                  <div
                    className="h-1 rounded-full bg-[#1C1008] transition-all"
                    style={{ width: `${(completedCount / 5) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500">{completedCount}/5 steps done</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/getting-started"
              className="shrink-0 rounded-lg bg-[#1C1008] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#2d1e0e] transition-colors"
            >
              View guide →
            </Link>
            <button
              onClick={dismissBanner}
              className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
              title="Never show again"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>
      )}

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
            className="rounded-xl border border-slate-200 bg-white px-5 py-4"
          >
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="mt-1 text-sm font-medium text-slate-600">{s.label}</div>
            <div className="text-xs text-slate-400">{s.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Upcoming deadlines alert */}
      {upcomingSoon > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⏰{' '}
          <strong>
            {upcomingSoon} trip{upcomingSoon > 1 ? 's' : ''}
          </strong>{' '}
          with deadlines in the next 7 days — consider sending reminders.
        </div>
      )}

      {/* Overdue invitations — cross-trip panel (feature from old Invitations page) */}
      {overdueInvitations.length > 0 && (
        <details className="rounded-xl border border-red-200 bg-red-50 open:pb-0" open>
          <summary className="flex cursor-pointer select-none list-none items-center gap-3 px-5 py-3.5">
            <span className="text-base">🚨</span>
            <div className="flex-1">
              <span className="text-sm font-semibold text-red-800">
                {overdueInvitations.length} overdue invitation{overdueInvitations.length !== 1 ? 's' : ''}
              </span>
              <span className="ml-2 text-xs text-red-600">
                — hotels past deadline with no response
              </span>
            </div>
            <span className="text-xs text-red-400">click to expand ▾</span>
          </summary>
          <div className="border-t border-red-200 px-5 pb-4 pt-3">
            <div className="space-y-2">
              {overdueInvitations.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-red-200 bg-white px-4 py-2.5"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-800">{item.hotelName}</span>
                    <span className="mx-2 text-slate-300">·</span>
                    <span className="text-sm text-slate-500">{item.tripName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-red-600">
                      {item.daysOverdue} day{item.daysOverdue !== 1 ? 's' : ''} overdue
                    </span>
                    <Link
                      to={`/trips/${item.tripId}`}
                      className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 transition-colors"
                    >
                      View trip →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}

      {/* View toggle + closed toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setView(opt.key)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                view === opt.key
                  ? 'bg-[#1C1008] text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
        {closedCount > 0 && (
          <button
            onClick={() => setShowClosed((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
              showClosed
                ? 'border-slate-400 bg-slate-100 text-slate-700'
                : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {showClosed ? '✓' : '○'} Show closed ({closedCount})
          </button>
        )}
      </div>

      {/* Trip list — renders based on active view */}
      <div>
        {view === 'deadline' && (
          <>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              {showClosed ? 'All trips' : 'Active & draft trips'} · soonest deadline first
            </h2>
            <DeadlineView trips={displayedTrips} />
          </>
        )}
        {view === 'client' && (
          <>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              {showClosed ? 'All trips' : 'Active & draft trips'} · grouped by client
            </h2>
            <ClientView trips={displayedTrips} />
          </>
        )}
        {view === 'status' && (
          <>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              {showClosed ? 'All trips' : 'Active & draft trips'} · grouped by status
            </h2>
            <StatusView trips={displayedTrips} />
          </>
        )}
      </div>

      {/* How it works (compact, collapsible) */}
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer select-none px-6 py-4 text-sm font-medium text-slate-600 hover:text-slate-900">
          How it works — quick guide
        </summary>
        <div className="border-t border-slate-100 px-6 pb-6 pt-4">
          <HowItWorks compact />
        </div>
      </details>
    </div>
  )
}
