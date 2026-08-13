import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, countVisits } from '../lib/format'
import { Badge, ErrorNote, LinkButton, Loading } from '../components/ui'
import { PageHint } from '../components/PageHint'
import { RevenuePanel } from '../components/RevenuePanel'
import { exportAllCitiesForClient } from '../lib/exportAllCities'
import { useAuth } from '../auth/AuthContext'
import { StageTimeline } from '../components/StageTimeline'
import { TEAM_STAGES, teamAutoDone, resolveDone, currentStage } from '../lib/rfpStages'
import type { StageKey } from '../lib/rfpStages'

const OWNER_EMAIL = 'info@cymbul.co'

type TeamCard = {
  id: string
  team_name: string
  progress_steps: Record<string, boolean>
  hasTrips: boolean
  summary: string
}


type DashTrip = {
  id: string
  opponent_label: string | null
  city: string | null
  status: string
  cancelled?: boolean
  arrival_date: string | null
  stay2_arrival_date: string | null
  response_deadline: string | null
  clients: { id: string; team_name: string } | null
  rfp_invitations: { id: string; status: string; hotel_name: string; sent_at: string | null; submitted_at: string | null }[]
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
  // A cancelled trip is done — never nag "awaiting reply" for its hotels.
  if (trip.cancelled) return 0
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
  // A bid counts once a hotel actually submitted, even if we later awarded
  // elsewhere and it flipped to 'passed'. submitted_at is the reliable signal;
  // a "Passed - Not Available" hotel that never bid has no submitted_at.
  const submitted = trip.rfp_invitations.filter((i) => i.submitted_at != null).length
  const opened = trip.rfp_invitations.filter((i) => i.status === 'opened').length
  const delinquent = delinquentCount(trip)
  const awardedHotel = trip.rfp_invitations.find((i) => i.status === 'awarded')?.hotel_name ?? null
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
            {trip.stay2_arrival_date && (
              <span title="This RFP covers 2 visits to this city (Visit 1 + Visit 2)" className="inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                2 visits
              </span>
            )}
            <Badge status={trip.status} cancelled={trip.cancelled} />
            {trip.status === 'closed' && awardedHotel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-1 text-xs font-semibold leading-5 text-emerald-700 dark:text-emerald-300">
                <span aria-hidden>🏆</span>{awardedHotel}
              </span>
            )}
            <DeadlineChip deadline={trip.response_deadline} />
            {delinquent > 0 && (
              <span
                title={`${delinquent} hotel${delinquent !== 1 ? 's' : ''} invited with no reply yet — consider a reminder`}
                className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                {delinquent} awaiting reply
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
  const [exportingClient, setExportingClient] = useState<string | null>(null)
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

  // The soonest deadline coming due within a week for this client, so the chip
  // can show the actual date instead of a vague "Deadline soon".
  const soonestUrgentDeadline = (g: { trips: DashTrip[] }): string | null => {
    const upcoming = g.trips
      .map((t) => t.response_deadline)
      .filter((d): d is string => {
        const n = daysUntil(d)
        return n !== null && n >= 0 && n <= 7
      })
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    return upcoming[0] ?? null
  }

  // Start collapsed on load for a clean page — the manager opens what they want.
  // Only auto-open when a single group is shown (e.g. filtered to one client),
  // where there is nothing to collapse. Parent remounts with a key on filter
  // change, so this recomputes.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const s = new Set<string>()
    if (sorted.length === 1) sorted.forEach(([k]) => s.add(k))
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
          (n, t) => n + t.rfp_invitations.filter((i) => i.submitted_at != null).length,
          0,
        )
        const urgentDeadline = soonestUrgentDeadline(group)
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
                {urgentDeadline && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    ⏰ Deadline {formatDate(urgentDeadline)}
                  </span>
                )}
                {groupDelinquent > 0 && (
                  <span
                    title={`${groupDelinquent} hotel${groupDelinquent !== 1 ? 's' : ''} across this client with no reply yet`}
                    className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300"
                  >
                    {groupDelinquent} awaiting reply
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span title={`${group.trips.length} trip${group.trips.length !== 1 ? 's' : ''}, counting each 2-visit trip twice`}>
                  <strong className="text-slate-700 dark:text-slate-300">{countVisits(group.trips)}</strong> trip
                  {countVisits(group.trips) !== 1 ? 's' : ''}
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
                {key !== '__none__' && (
                  <div className="flex justify-end">
                    <button
                      onClick={async () => {
                        setExportingClient(key)
                        try { await exportAllCitiesForClient(key, group.name) }
                        finally { setExportingClient(null) }
                      }}
                      disabled={exportingClient === key}
                      title="Download the full Hotel Options grid — every trip and hotel choice for this client, ready to send."
                      className="rounded-lg border border-[#1C1008]/25 dark:border-amber-700/50 bg-[#1C1008]/[0.07] dark:bg-amber-900/20 px-3 py-1.5 text-xs font-semibold text-[#1C1008] dark:text-amber-200 hover:bg-[#1C1008]/[0.13] dark:hover:bg-amber-900/40 disabled:opacity-40 transition-colors"
                    >
                      {exportingClient === key ? 'Exporting…' : '↓ Export hotel options'}
                    </button>
                  </div>
                )}
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

export default function Dashboard() {
  const { user } = useAuth()
  const isOwner = (user?.email ?? '').trim().toLowerCase() === OWNER_EMAIL
  const [trips, setTrips] = useState<DashTrip[]>([])
  const [myTeams, setMyTeams] = useState<TeamCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasClients, setHasClients] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [clientFilter, setClientFilter] = useState<string | null>(null)
  // Dashboard scope: managers default to just the teams they're assigned to,
  // with a My teams / All teams toggle. assignedIds === null → owner (sees all).
  const [assignedIds, setAssignedIds] = useState<string[] | null>(null)
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  // "Log an award" launcher — pick a trip to jump into and log an off-platform award.
  const [awardOpen, setAwardOpen] = useState(false)
  const [awardClient, setAwardClient] = useState('')
  // Collapsible "Your teams · setup" — remembers the choice across visits.
  // Start collapsed on every load for a clean landing; the manager expands it.
  const [teamsOpen, setTeamsOpen] = useState(false)
  const toggleTeams = () => setTeamsOpen((v) => !v)
  useEffect(() => {
    const load = async () => {
      const [tripsRes, clientsRes] = await Promise.all([
        supabase
          .from('trips')
          .select(
            'id, opponent_label, city, status, cancelled, arrival_date, stay2_arrival_date, response_deadline, clients(id, team_name), rfp_invitations(id, status, hotel_name, sent_at, submitted_at)',
          )
          .order('response_deadline', { ascending: true }),
        supabase.from('clients').select('id').limit(1),
      ])

      const tripRows = (tripsRes.data as unknown as DashTrip[]) ?? []
      if (tripsRes.error) setError(tripsRes.error.message)
      else setTrips(tripRows)

      setHasClients((clientsRes.data?.length ?? 0) > 0)

      // "Your teams" setup cards — scoped to the teams assigned to this user
      // (everyone), except info@cymbul.co who sees all teams.
      let teamClientIds: string[] | null = null
      if (!isOwner && user) {
        const { data: asg } = await supabase.from('client_assignments').select('client_id').eq('staff_user_id', user.id)
        teamClientIds = [...new Set((asg ?? []).map((a: any) => a.client_id).filter(Boolean))]
      }
      // Scope the whole dashboard to these teams (managers). Owner → null = all.
      setAssignedIds(teamClientIds)
      if (teamClientIds && teamClientIds.length) setScope('mine')
      let teamQ = supabase.from('clients').select('id, team_name, progress_steps')
      if (teamClientIds) teamQ = teamQ.in('id', teamClientIds.length ? teamClientIds : ['00000000-0000-0000-0000-000000000000'])
      const { data: teamClients } = await teamQ.order('team_name')
      const cards: TeamCard[] = (teamClients ?? []).map((c: any) => {
        const clientTrips = tripRows.filter((t) => t.clients?.id === c.id)
        const collecting = clientTrips.filter((t) => t.status === 'collecting').length
        const awarded = clientTrips.filter((t) => t.status === 'closed').length
        const summary = clientTrips.length === 0
          ? 'No trips yet'
          : [`${clientTrips.length} trip${clientTrips.length !== 1 ? 's' : ''}`, collecting ? `${collecting} collecting` : null, awarded ? `${awarded} awarded` : null].filter(Boolean).join(' · ')
        return { id: c.id, team_name: c.team_name, progress_steps: c.progress_steps ?? {}, hasTrips: clientTrips.length > 0, summary }
      })
      setMyTeams(cards)

      setLoading(false)
    }
    load()
  }, [user, isOwner])

  // Toggle a team-setup check (e.g. Review template) and persist to the client.
  const toggleTeamStep = async (teamId: string, key: StageKey, done: boolean) => {
    setMyTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, progress_steps: { ...t.progress_steps, [key]: done } } : t)))
    const team = myTeams.find((t) => t.id === teamId)
    const next = { ...(team?.progress_steps ?? {}), [key]: done }
    await supabase.from('clients').update({ progress_steps: next }).eq('id', teamId)
  }

  if (loading) return <Loading />
  if (error) return <ErrorNote message={error} />

  // Scope the whole dashboard (list + stat cards) to the user's assigned teams
  // when "My teams" is on. Owner / users with no assignments see everything.
  const scopedTrips = scope === 'mine' && assignedIds && assignedIds.length
    ? trips.filter((t) => t.clients && assignedIds.includes(t.clients.id))
    : trips

  // A cancelled trip stays visible in the main list (so the team can still open
  // it, review the bids that came in, and send declines) — it just isn't counted
  // as active work. So: it shows in openTrips, but activeTrips (which drives the
  // KPI stat cards) excludes it alongside drafts.
  const openTrips = scopedTrips.filter((t) => t.status !== 'closed')
  const activeTrips = openTrips.filter((t) => t.status !== 'draft' && !t.cancelled)
  const totalInvited = activeTrips.reduce((n, t) => n + t.rfp_invitations.length, 0)
  const totalSubmitted = activeTrips.reduce(
    (n, t) => n + t.rfp_invitations.filter((i) => i.submitted_at != null).length,
    0,
  )
  // Outstanding = hotels still to hear from (emailed/opened, no answer yet),
  // not "invited minus bids" — a declined or passed hotel isn't outstanding.
  const totalOutstanding = activeTrips.reduce(
    (n, t) => n + t.rfp_invitations.filter((i) => ['sent', 'opened'].includes(i.status)).length,
    0,
  )
  const closedCount = scopedTrips.filter((t) => t.status === 'closed').length

  // What the list actually shows. "Show closed" flips to ONLY closed trips, so
  // open and closed are never mixed together.
  const closedTrips = scopedTrips.filter((t) => t.status === 'closed')
  const displayedTrips = showClosed ? closedTrips : openTrips

  // Distinct clients present in the (scoped) trips — no separate query needed
  const clientOptions = [...new Map(scopedTrips.filter((t) => t.clients).map((t) => [t.clients!.id, t.clients!.team_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const clientFilteredTrips = clientFilter
    ? displayedTrips.filter((t) => t.clients?.id === clientFilter)
    : displayedTrips

  // First-run onboarding takeover ONLY when the user has no trips at all across
  // everything they can see. If they DO have trips but the current scope ("My
  // teams") happens to be empty, we still render the normal dashboard below so
  // the My teams / All teams toggle stays reachable (a manager whose assigned
  // teams have no trips must still be able to flip to All teams).
  if (trips.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="text-center">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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

      <PageHint id="dashboard-overview">
        Click any trip to open its workspace: invite hotels, compare bids side by side, pick a winner, and export the grid or
        proposal. Start one with <strong>+ New trip</strong> (add the team first with <strong>+ New client</strong>); each card
        shows bids in vs. hotels invited and flags hotels still <strong>awaiting a reply</strong>. Use the <strong>client
        filter</strong> and the <strong>Show closed</strong> toggle to narrow the list, or <strong>Log an award</strong> to record
        a hotel signed outside the RFP flow.
      </PageHint>

      {/* Your teams — per-team setup checklist (scoped to your assignments;
          info@cymbul.co sees all). Each team's one-time setup before its trips. */}
      {myTeams.length > 0 && (
        <div>
          <button
            onClick={toggleTeams}
            className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <span className="text-[10px]">{teamsOpen ? '▾' : '▸'}</span>
            Your teams · setup
            <span className="font-normal normal-case text-slate-400 dark:text-slate-500">({myTeams.length})</span>
          </button>
          {teamsOpen && (
          <div className="space-y-3">
            {myTeams.map((t) => {
              const auto = teamAutoDone(t.hasTrips)
              const done = (k: StageKey) => resolveDone(k, auto[k], t.progress_steps)
              return (
                <div key={t.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <Link to={`/clients/${t.id}`} className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 hover:underline">{t.team_name}</div>
                      <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{t.summary}</div>
                    </Link>
                    <div className="w-full max-w-xs">
                      <StageTimeline
                        stages={TEAM_STAGES}
                        isDone={done}
                        currentKey={currentStage(TEAM_STAGES, done)}
                        tipFor={(k) => TEAM_STAGES.find((s) => s.key === k)?.tip ?? ''}
                        onToggle={(k) => toggleTeamStep(t.id, k, !done(k))}
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Active trips', sublabel: 'in progress · 2-visit trips count twice', value: countVisits(activeTrips), color: 'text-[#1C1008]' },
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

      {/* CYMBUL-only: revenue & commissions from awarded trips (renders only for info@cymbul.co) */}
      <RevenuePanel />

      {/* Trips by client — the single home view. Header row carries the filter
          and show-closed controls; delinquent trips are flagged inline and rolled
          up onto each client header. */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {showClosed ? 'Closed trips (hotel selected)' : 'Active & draft trips'} · by client
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAwardOpen(true)}
              className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3.5 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
            >
              🏆 Log an award
            </button>
            {assignedIds && assignedIds.length > 0 && (
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 p-0.5 text-sm font-medium">
                {(['mine', 'all'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={`rounded-md px-3 py-1.5 transition-colors ${scope === s ? 'bg-[#1C1008] text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                  >
                    {s === 'mine' ? 'My teams' : 'All teams'}
                  </button>
                ))}
              </div>
            )}
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
        {clientFilteredTrips.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {scope === 'mine' && assignedIds && assignedIds.length > 0
              ? 'No trips for your teams yet. Switch to “All teams” above to see everyone’s trips, or create a trip.'
              : showClosed ? 'No closed trips yet.' : 'No active or draft trips right now.'}
          </div>
        ) : (
          <ClientView key={clientFilter ?? 'all'} trips={clientFilteredTrips} />
        )}
      </div>

      {/* Log an award — pick the trip to jump into (then add the hotel, enter its
          terms, award, and send the contract request from the trip workspace). */}
      {awardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAwardOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Log an award</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Pick the trip. On the trip you can add the hotel (if needed), enter its terms on their behalf, mark it awarded, and send the contract request.
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Team</label>
            <select
              value={awardClient}
              onChange={(e) => setAwardClient(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
            >
              <option value="">Select a team…</option>
              {clientOptions.map(([clientId, teamName]) => (
                <option key={clientId} value={clientId}>{teamName}</option>
              ))}
            </select>
            {awardClient && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                {trips
                  .filter((t) => t.clients?.id === awardClient && t.status !== 'closed')
                  .sort((a, b) => (a.city ?? a.opponent_label ?? '').localeCompare(b.city ?? b.opponent_label ?? '', undefined, { sensitivity: 'base' }))
                  .map((t) => (
                    <Link
                      key={t.id}
                      to={`/trips/${t.id}`}
                      className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 px-3 py-2.5 text-sm last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-200">{t.opponent_label || t.city || 'Trip'}</span>
                      <span className="text-xs text-[#1C1008] dark:text-amber-400">Open →</span>
                    </Link>
                  ))}
                {trips.filter((t) => t.clients?.id === awardClient && t.status !== 'closed').length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">No open trips for this team.</p>
                )}
              </div>
            )}
            <div className="mt-5 text-right">
              <button
                onClick={() => setAwardOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
