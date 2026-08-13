import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { TIMELINE_ADMIN_EMAIL } from '../../lib/activity'
import { humanizeDuration } from '../../lib/format'
import { ErrorNote, Loading } from '../../components/ui'

// One row from get_lifecycle_timeline(). Derived events (trip_created,
// invite_sent, bid_received, bid_declined, build_saved) come from base-table
// timestamps; the four logged events come from activity_events.
type TimelineEvent = {
  at: string
  event_type:
    | 'schedule_imported'
    | 'trip_created'
    | 'hotel_added'
    | 'invite_sent'
    | 'bid_received'
    | 'bid_declined'
    | 'build_saved'
    | 'reminder_sent'
    | 'awarded'
    | 'proposal_sent'
    | 'trip_deleted'
    | 'invitation_deleted'
    | 'client_deleted'
  client_id: string | null
  team_name: string | null
  trip_id: string | null
  city: string | null
  hotel_name: string | null
  actor_id: string | null
  actor_name: string | null
  detail: Record<string, unknown> | null
}

const EVENT_META: Record<TimelineEvent['event_type'], { icon: string; label: string; danger?: boolean }> = {
  schedule_imported: { icon: '', label: 'Schedule imported' },
  trip_created: { icon: '', label: 'Trip created' },
  hotel_added: { icon: '', label: 'Hotel added' },
  invite_sent: { icon: '', label: 'Hotel invited' },
  bid_received: { icon: '', label: 'Bid received' },
  bid_declined: { icon: '', label: 'Hotel declined' },
  build_saved: { icon: '', label: 'Build saved' },
  reminder_sent: { icon: '', label: 'Reminder sent' },
  awarded: { icon: '🏆', label: 'Awarded' },
  proposal_sent: { icon: '', label: 'Proposal sent to client' },
  trip_deleted: { icon: '', label: 'Trip deleted', danger: true },
  invitation_deleted: { icon: '', label: 'Hotel invitation deleted', danger: true },
  client_deleted: { icon: '', label: 'Client deleted', danger: true },
}

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const t = (iso: string) => new Date(iso).getTime()

// Per-trip lifecycle timestamps, assembled from the flat event stream.
type TripCycle = {
  trip_id: string
  team_name: string | null
  city: string | null
  start: number | null // schedule import (client) or earliest trip_created
  firstHotelAdded: number | null // first hotel added to the RFP (invitation created)
  firstInvite: number | null
  firstBid: number | null
  lastBid: number | null
  build: number | null // latest build saved
  proposalSent: number | null
  awarded: number | null
}

function buildCycles(events: TimelineEvent[]): TripCycle[] {
  // client-level import time, applied as the start anchor for that client's trips
  const importByClient = new Map<string, number>()
  for (const e of events) {
    if (e.event_type === 'schedule_imported' && e.client_id) {
      const cur = importByClient.get(e.client_id)
      const at = t(e.at)
      if (cur === undefined || at < cur) importByClient.set(e.client_id, at)
    }
  }

  const byTrip = new Map<string, TripCycle>()
  const ensure = (e: TimelineEvent): TripCycle | null => {
    if (!e.trip_id) return null
    let c = byTrip.get(e.trip_id)
    if (!c) {
      c = {
        trip_id: e.trip_id,
        team_name: e.team_name,
        city: e.city,
        start: null,
        firstHotelAdded: null,
        firstInvite: null,
        firstBid: null,
        lastBid: null,
        build: null,
        proposalSent: null,
        awarded: null,
      }
      byTrip.set(e.trip_id, c)
    }
    if (!c.team_name && e.team_name) c.team_name = e.team_name
    if (!c.city && e.city) c.city = e.city
    return c
  }

  for (const e of events) {
    const c = ensure(e)
    if (!c) continue
    const at = t(e.at)
    switch (e.event_type) {
      case 'trip_created':
        // start anchor: schedule import if present for this client, else trip created
        c.start = e.client_id && importByClient.has(e.client_id)
          ? Math.min(importByClient.get(e.client_id)!, at)
          : c.start === null ? at : Math.min(c.start, at)
        break
      case 'hotel_added':
        c.firstHotelAdded = c.firstHotelAdded === null ? at : Math.min(c.firstHotelAdded, at)
        break
      case 'invite_sent':
        c.firstInvite = c.firstInvite === null ? at : Math.min(c.firstInvite, at)
        break
      case 'bid_received':
        c.firstBid = c.firstBid === null ? at : Math.min(c.firstBid, at)
        c.lastBid = c.lastBid === null ? at : Math.max(c.lastBid, at)
        break
      case 'build_saved':
        c.build = c.build === null ? at : Math.max(c.build, at)
        break
      case 'proposal_sent':
        c.proposalSent = c.proposalSent === null ? at : Math.max(c.proposalSent, at)
        break
      case 'awarded':
        c.awarded = c.awarded === null ? at : Math.max(c.awarded, at)
        break
    }
  }
  return [...byTrip.values()]
}

// Start of the "Send bids" clock for a trip. Normally that's when the first
// hotel was added. But the schedule went live at a fixed time and bids couldn't
// go out before it, so if the trip's first invite landed at/after go-live we
// time from go-live (ignoring overnight staging). A trip whose first invite
// predates go-live (sent early by permission) is timed from when hotels were
// added, as usual.
function sendAnchor(c: TripCycle, goLive: number | null): number | null {
  if (c.firstHotelAdded === null) return null
  if (goLive !== null && c.firstInvite !== null && c.firstInvite >= goLive) {
    return Math.max(c.firstHotelAdded, goLive)
  }
  return c.firstHotelAdded
}

// Hotel response latency (invite_sent -> bid_received), paired by trip + hotel.
// This is the hotel's clock, not KJST's — reported separately, never against KJST.
function hotelResponseDurations(events: TimelineEvent[]): number[] {
  const invitedAt = new Map<string, number>()
  const out: number[] = []
  const key = (e: TimelineEvent) => `${e.trip_id}::${(e.hotel_name || '').toLowerCase()}`
  for (const e of events) {
    if (e.event_type === 'invite_sent' && e.trip_id && e.hotel_name) {
      const k = key(e)
      const at = t(e.at)
      if (!invitedAt.has(k) || at < invitedAt.get(k)!) invitedAt.set(k, at)
    }
  }
  for (const e of events) {
    if (e.event_type === 'bid_received' && e.trip_id && e.hotel_name) {
      const inv = invitedAt.get(key(e))
      if (inv !== undefined) out.push(t(e.at) - inv)
    }
  }
  return out
}

// Hotels invited but with no bid and no decline yet — the outstanding worklist.
function outstanding(events: TimelineEvent[]): { count: number; oldestDays: number | null } {
  const invited = new Map<string, { at: number; team: string | null; city: string | null }>()
  const resolved = new Set<string>()
  const key = (e: TimelineEvent) => `${e.trip_id}::${(e.hotel_name || '').toLowerCase()}`
  for (const e of events) {
    if (!e.trip_id || !e.hotel_name) continue
    if (e.event_type === 'invite_sent') {
      const k = key(e)
      const at = t(e.at)
      if (!invited.has(k) || at < invited.get(k)!.at) invited.set(k, { at, team: e.team_name, city: e.city })
    } else if (e.event_type === 'bid_received' || e.event_type === 'bid_declined') {
      resolved.add(key(e))
    }
  }
  let count = 0
  let oldest: number | null = null
  for (const [k, v] of invited) {
    if (resolved.has(k)) continue
    count++
    const days = Math.floor((Date.now() - v.at) / 86400000)
    if (oldest === null || days > oldest) oldest = days
  }
  return { count, oldestDays: oldest }
}

function Tile({ value, label, sublabel, tone = 'ink' }: {
  value: string
  label: string
  sublabel?: string
  tone?: 'ink' | 'good' | 'warn' | 'muted'
}) {
  const color =
    tone === 'good' ? 'text-emerald-600'
      : tone === 'warn' ? 'text-amber-600'
        : tone === 'muted' ? 'text-slate-400'
          : 'text-[#1C1008] dark:text-slate-100'
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{label}</div>
      {sublabel && <div className="text-xs text-slate-400 dark:text-slate-500">{sublabel}</div>}
    </div>
  )
}

const ALL_TYPES = Object.keys(EVENT_META) as TimelineEvent['event_type'][]

export default function TimelinePage() {
  const { user, loading: authLoading } = useAuth()
  const allowed = user?.email === TIMELINE_ADMIN_EMAIL
  const [clients, setClients] = useState<{ id: string; team_name: string }[]>([])
  const [clientId, setClientId] = useState<string>('') // '' = all clients (global feed)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<Set<TimelineEvent['event_type']>>(new Set(ALL_TYPES))

  useEffect(() => {
    supabase.from('clients').select('id, team_name').order('team_name').then(({ data }) => {
      setClients((data ?? []) as { id: string; team_name: string }[])
    })
  }, [])

  // Schedule go-live time. Bids couldn't be sent before this, so the "Send bids"
  // stage is timed from go-live (not from when hotels were staged the night
  // before). A team allowed to send early (e.g. the Wizards) is timed normally
  // from when its hotels were added, since its first invite predates go-live.
  const [goLive, setGoLive] = useState<number | null>(null)
  useEffect(() => {
    supabase.from('app_config').select('value').eq('key', 'schedule_go_live').maybeSingle()
      .then(({ data }) => {
        const v = data?.value ? new Date(data.value).getTime() : NaN
        setGoLive(Number.isFinite(v) ? v : null)
      })
  }, [])

  useEffect(() => {
    if (!allowed) return
    setLoading(true); setError(null)
    supabase
      .rpc('get_lifecycle_timeline', { p_client_id: clientId || null })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setEvents((data ?? []) as TimelineEvent[])
        setLoading(false)
      })
  }, [allowed, clientId])

  // Show the full activity log (past the default cap) when the operator asks.
  const [showAll, setShowAll] = useState(false)

  const cycles = useMemo(() => buildCycles(events), [events])

  const metrics = useMemo(() => {
    const span = (a: number | null, b: number | null) => (a !== null && b !== null && b >= a ? b - a : null)
    const setup: number[] = []      // trip created/imported → first hotel added
    const send: number[] = []       // first hotel added → first invite emailed
    const award: number[] = []      // last bid received → hotel awarded
    const lifecycle: number[] = []  // start → proposal sent (full lifecycle)
    for (const c of cycles) {
      const su = span(c.start, c.firstHotelAdded)
      const sd = span(sendAnchor(c, goLive), c.firstInvite)
      const aw = span(c.lastBid, c.awarded)
      if (su !== null) setup.push(su)
      if (sd !== null) send.push(sd)
      if (aw !== null) award.push(aw)
      const lc = span(c.start, c.proposalSent)
      if (lc !== null) lifecycle.push(lc)
    }
    return {
      setup: median(setup),
      send: median(send),
      award: median(award),
      lifecycle: median(lifecycle),
      hotelResponse: median(hotelResponseDurations(events)),
    }
  }, [cycles, events, goLive])

  const out = useMemo(() => outstanding(events), [events])

  const feed = useMemo(
    () => events.filter((e) => typeFilter.has(e.event_type)),
    [events, typeFilter],
  )

  const dur = (ms: number | null) => (ms === null ? '—' : humanizeDuration(ms))

  // ── Gating ────────────────────────────────────────────────────────────────
  if (authLoading) return <Loading />
  if (!allowed) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-12 text-center">
        <div className="text-3xl mb-2"></div>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Restricted</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          The lifecycle timeline is limited to the KJST operations account.
        </p>
      </div>
    )
  }

  const toggleType = (ty: TimelineEvent['event_type']) => {
    setTypeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(ty)) next.delete(ty)
      else next.add(ty)
      return next
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Timeline</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Lifecycle from schedule import to proposals out, with cycle-time metrics. Admin only.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">View</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value="">All clients (global feed)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.team_name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      {loading ? (
        <Loading />
      ) : (
        <>
          {/* KJST-owned cycle time */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              KJST cycle time <span className="font-normal text-slate-400">(median, what KJST controls)</span>
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Tile value={dur(metrics.setup)} label="Set up hotels" sublabel="trip created → first hotel added" />
              <Tile value={dur(metrics.send)} label="Send bids" sublabel="first hotel added → first invite" />
              <Tile value={dur(metrics.award)} label="Award" sublabel="last bid → hotel awarded" />
            </div>
          </div>

          {/* Hotel-owned latency (never counted against KJST) */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              Hotel response <span className="font-normal text-slate-400">(hotel&apos;s clock, once the invite is out)</span>
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Tile value={dur(metrics.hotelResponse)} label="Median hotel response" sublabel="invite → bid received" tone="muted" />
              <Tile
                value={String(out.count)}
                label="Outstanding"
                sublabel={out.oldestDays !== null ? `oldest ${out.oldestDays}d waiting` : 'invited, no bid yet'}
                tone={out.count > 0 ? 'warn' : 'muted'}
              />
              <Tile value={dur(metrics.lifecycle)} label="Total lifecycle" sublabel="import → proposal (incl. hotel wait)" tone="muted" />
            </div>
          </div>

          {/* Per-client program view: per-trip stage breakdown */}
          {clientId && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Per-trip breakdown</h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Trip</th>
                      <th className="px-4 py-2">Set up hotels</th>
                      <th className="px-4 py-2">Send bids</th>
                      <th className="px-4 py-2">Hotel wait</th>
                      <th className="px-4 py-2">Award</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {cycles.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No trips yet for this client.</td></tr>
                    )}
                    {cycles
                      .sort((a, b) => (b.start ?? 0) - (a.start ?? 0))
                      .map((c) => {
                        const span = (x: number | null, y: number | null) => (x !== null && y !== null && y >= x ? y - x : null)
                        const status = c.awarded ? 'Awarded' : c.proposalSent ? 'Proposal sent' : c.build ? 'Building' : c.firstBid ? 'Collecting bids' : c.firstInvite ? 'Invited' : c.firstHotelAdded ? 'Hotels added' : 'Draft'
                        return (
                          <tr key={c.trip_id} className="text-slate-700 dark:text-slate-200">
                            <td className="px-4 py-2 font-medium">{c.city || 'Trip'}</td>
                            <td className="px-4 py-2 tabular-nums">{dur(span(c.start, c.firstHotelAdded))}</td>
                            <td className="px-4 py-2 tabular-nums">{dur(span(sendAnchor(c, goLive), c.firstInvite))}</td>
                            <td className="px-4 py-2 tabular-nums text-slate-400">{dur(span(c.firstInvite, c.firstBid))}</td>
                            <td className="px-4 py-2 tabular-nums">{dur(span(c.lastBid, c.awarded))}</td>
                            <td className="px-4 py-2 text-xs">{status}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Activity feed */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {clientId ? 'Activity' : 'Global activity feed'}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {ALL_TYPES.map((ty) => {
                  const on = typeFilter.has(ty)
                  return (
                    <button
                      key={ty}
                      onClick={() => toggleType(ty)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        on
                          ? 'border-[#1C1008] bg-[#1C1008] text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                          : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
                      }`}
                      title={EVENT_META[ty].label}
                    >
                      {EVENT_META[ty].icon} {EVENT_META[ty].label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700">
              {feed.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-slate-400">No activity to show.</div>
              )}
              {(showAll ? feed : feed.slice(0, 300)).map((e, i) => {
                const meta = EVENT_META[e.event_type]
                const det = (e.detail ?? {}) as Record<string, any>
                // Deletion rows carry their subject in `detail` (the deleted row is
                // gone), so team/name come from there rather than the joined tables.
                const teamName = e.team_name || det.team_name || null
                const parts: string[] = []
                if (meta.danger) {
                  const name = e.hotel_name || det.hotel_name || det.opponent_label || det.team_name
                  if (name && name !== teamName) parts.push(String(name))
                } else if (e.hotel_name) {
                  parts.push(e.hotel_name)
                }
                if (e.event_type === 'schedule_imported' && e.detail?.count) parts.push(`${e.detail.count} trips`)
                if (e.event_type === 'reminder_sent' && e.detail?.count) parts.push(`${e.detail.count} hotels`)
                if (e.event_type === 'build_saved' && e.detail?.label) parts.push(String(e.detail.label))
                if (e.detail?.reason) parts.push(String(e.detail.reason))
                return (
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="mt-0.5 text-base leading-none" aria-hidden>{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-700 dark:text-slate-200">
                        <span className={`font-medium ${meta.danger ? 'text-red-600 dark:text-red-400' : ''}`}>{meta.label}</span>
                        {parts.length > 0 && <span className="text-slate-500 dark:text-slate-400"> · {parts.join(' · ')}</span>}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">
                        {[teamName, e.city].filter(Boolean).join(' · ')}
                        {e.actor_name ? ` · by ${e.actor_name}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-slate-400 dark:text-slate-500 tabular-nums" title={new Date(e.at).toLocaleString()}>
                      {relativeTime(e.at)}
                    </div>
                  </div>
                )
              })}
            </div>
            {feed.length > 300 && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 text-xs font-medium text-[#1C1008] dark:text-slate-200 hover:underline"
              >
                {showAll ? `Show less (most recent 300)` : `Show all ${feed.length} events`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
