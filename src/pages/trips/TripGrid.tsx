import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activity'
import { formatDate, formatMeetingSpaceNotes } from '../../lib/format'
import { exportComparisonXlsx } from '../../lib/excelExport'
import type { ConcessionItem } from '../../lib/rfpApi'
import type { Trip, Client } from '../../lib/types'
import { Badge, ErrorNote, Loading } from '../../components/ui'

// ── Data types ────────────────────────────────────────────────────────────────

type Answer = {
  id: string
  concession_item_id: string
  answer_yes_no: boolean | null
  answer_value: string | null
  comment: string | null
}

type Response = {
  id: string
  completed_by_name: string | null
  completed_date: string | null
  best_king_rate: number | null
  king_rate_notes: string | null
  current_selling_rate: string | null
  stay2_king_rate: number | null
  stay2_suite_rate: number | null
  stay2_selling_rate: string | null
  best_suite_rate: number | null
  occupancy_tax: string | null
  meeting_space_notes: string | null
  meeting_space_type: string | null
  meeting_space_count: number | null
  scenario_rates: Record<string, { rate: number | null; available: boolean }> | null
  scenario_availability: Record<string, boolean> | null
  resort_fee: string | null
  general_comments: string | null
  concession_answers: Answer[]
}

type Invitation = {
  id: string
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  status: string
  submitted_at: string | null
  staff_notes: string | null
  visit1_declined: boolean
  visit2_declined: boolean
  // PostgREST returns a single object (not array) because invitation_id has a UNIQUE constraint.
  rfp_responses: Response | null
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

function YesNoCell({ value, comment }: { value: boolean | null; comment?: string | null }) {
  const [expanded, setExpanded] = useState(false)
  if (value === null) return <span className="text-slate-300">—</span>
  return (
    <div>
      <div className="flex items-center gap-1">
        {value ? (
          <span className="font-semibold text-emerald-600">✓ Yes</span>
        ) : (
          <span className="font-semibold text-red-500">✗ No</span>
        )}
        {comment && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="ml-1 text-xs text-[#1C1008]/40 hover:text-[#1C1008]"
            title="View counteroffer"
          >
            {expanded ? '▲' : '▼ note'}
          </button>
        )}
      </div>
      {expanded && comment && (
        <p className="mt-1 text-xs italic text-slate-500">{comment}</p>
      )}
    </div>
  )
}

function ValueCell({
  item,
  answer,
}: {
  item: ConcessionItem
  answer: Answer | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  if (!answer) return <span className="text-slate-300">—</span>

  if (item.answer_type === 'yes_no') {
    return <YesNoCell value={answer.answer_yes_no} comment={answer.comment} />
  }

  const val = answer.answer_value
  const display =
    item.answer_type === 'currency' && val
      ? `$${val}`
      : item.answer_type === 'percent' && val
        ? `${val}%`
        : (val ?? '—')

  return (
    <div>
      <div className="flex items-center gap-1">
        <span className={val ? 'text-slate-800' : 'text-slate-300'}>{display || '—'}</span>
        {answer.comment && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="ml-1 text-xs text-[#1C1008]/40 hover:text-[#1C1008]"
          >
            {expanded ? '▲' : '▼ note'}
          </button>
        )}
      </div>
      {expanded && answer.comment && (
        <p className="mt-1 text-xs italic text-slate-500">{answer.comment}</p>
      )}
    </div>
  )
}

// ── Dealbreaker badge ────────────────────────────────────────────────────────

type DealBreakerLevel = 'red' | 'yellow'
type DealBreaker = { label: string; level: DealBreakerLevel }

function getDealbreakerBadges(
  inv: Invitation,
  items: ConcessionItem[],
  answerMap: Record<string, Answer>,
): DealBreaker[] {
  const badges: DealBreaker[] = []
  const resp = inv.rfp_responses
  if (!resp) return badges

  // 1. No flex cancel
  const flexItem = items.find((i) => i.label.toLowerCase().includes('flexible cancellation'))
  if (flexItem) {
    const ans = answerMap[flexItem.id]
    if (ans?.answer_yes_no === false) badges.push({ label: 'No Flex Cancel', level: 'red' })
  }

  // 2. No commission
  const commItem = items.find(
    (i) => i.answer_type === 'percent' && (i.label.toLowerCase().includes('commissionable') || i.label.toLowerCase().includes('commission')),
  )
  if (commItem) {
    const ans = answerMap[commItem.id]
    const val = ans?.answer_value?.trim() ?? ''
    if (val === '0' || val === '0%' || val === '') badges.push({ label: 'No Commission', level: 'red' })
  }

  // 3. No eligible meeting space
  if (resp.meeting_space_type === 'restaurant' || resp.meeting_space_type === 'suite_converted' || resp.meeting_space_type === 'none') {
    badges.push({ label: 'No Mtg Space', level: 'yellow' })
  }

  // 4. Night scenario unavailable
  if (resp.scenario_rates) {
    const unavailable = Object.entries(resp.scenario_rates)
      .filter(([, v]) => v.available === false)
      .map(([k]) => `${k}n N/A`)
    for (const u of unavailable) badges.push({ label: u, level: 'yellow' })
  }

  // 5. Date scenario unavailable
  if (resp.scenario_availability) {
    for (const [label, avail] of Object.entries(resp.scenario_availability)) {
      if (!avail) badges.push({ label: `Scenario ${label} N/A`, level: 'yellow' })
    }
  }

  return badges
}

function DealBreakerBadge({ label, level }: { label: string; level: DealBreakerLevel }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        level === 'red'
          ? 'bg-red-100 text-red-700'
          : 'bg-amber-100 text-amber-700'
      }`}
    >
      {label}
    </span>
  )
}

// ── Section row (spanning header inside the table) ────────────────────────────

function SectionRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr className="bg-slate-100">
      <td colSpan={colSpan} className="sticky left-0 bg-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        {label}
      </td>
    </tr>
  )
}

// ── Rate row helper ───────────────────────────────────────────────────────────

function RateRow({
  label,
  invitations,
  getValue,
  highlight,
  lowestRateId,
  declinedWhen,
}: {
  label: string
  invitations: Invitation[]
  getValue: (r: Response | null) => string | null
  highlight?: boolean
  lowestRateId?: string | null
  declinedWhen?: (inv: Invitation) => boolean
}) {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="sticky left-0 w-64 bg-white px-4 py-2.5 text-xs font-medium text-slate-500">
        {label}
      </td>
      {invitations.map((inv) => {
        const resp = inv.rfp_responses ?? null
        const val = getValue(resp)
        const isPassed = inv.status === 'passed'
        const isUnavailable = inv.status === 'unavailable'
        const isAwarded = inv.status === 'awarded'
        const isDimmed = isPassed || isUnavailable
        const isDeclinedVisit = declinedWhen?.(inv) ?? false
        const noResponse = !resp && !isDimmed && !isDeclinedVisit
        return (
          <td
            key={inv.id}
            className={`min-w-[200px] whitespace-pre-line px-4 py-2.5 text-sm ${
              isDimmed
                ? 'opacity-40 bg-slate-50'
                : isAwarded
                  ? 'bg-amber-50'
                  : inv.id === lowestRateId
                    ? 'bg-emerald-50'
                    : ''
            } ${highlight && val && !isDimmed ? 'font-medium text-slate-800' : 'text-slate-600'}`}
          >
            {isUnavailable
              ? <span className="text-xs italic text-slate-400">Not available</span>
              : isDeclinedVisit
                ? <span className="text-xs italic text-red-500">Declined</span>
                : noResponse
                  ? <span className="text-xs italic text-slate-300">Awaiting response</span>
                  : val || <span className="text-slate-300">—</span>
            }
          </td>
        )
      })}
    </tr>
  )
}

// ── Meeting space type label ─────────────────────────────────────────────────

function meetingSpaceLabel(type: string | null | undefined, count: number | null | undefined): string {
  if (!type) return '—'
  const labels: Record<string, string> = {
    function_room: 'Function Room',
    ballroom: 'Ballroom',
    restaurant: '⚠️ Restaurant',
    suite_converted: '⚠️ Suite (converted)',
    none: 'None',
  }
  const base = labels[type] ?? type
  return count != null && count > 1 ? `${base} ×${count}` : base
}

// ── Main component ────────────────────────────────────────────────────────────

const SECTION_ORDER = ['concessions', 'facilities', 'in_season_tournament', 'postseason'] as const
const SECTION_LABELS: Record<string, string> = {
  concessions: 'Concessions & Facilities',
  facilities: 'Facilities',
  in_season_tournament: 'In-Season Tournament Guarantee',
  postseason: 'Postseason / Playoff Guarantee',
}

export default function TripGrid() {
  const { id } = useParams<{ id: string }>()
  const [trip, setTrip] = useState<(Trip & { clients: Pick<Client, 'id' | 'team_name' | 'organization_id'> }) | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [items, setItems] = useState<ConcessionItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Per-hotel staff notes (persisted to rfp_invitations.staff_notes on blur)
  const [staffNotes, setStaffNotes] = useState<Record<string, string>>({})
  const [noteSaving, setNoteSaving] = useState<Record<string, boolean>>({})
  const [versionSaving, setVersionSaving] = useState(false)

  const saveGridVersion = async (label: string, currentInvitations?: typeof invitations) => {
    if (!id) return
    const snapshotInvitations = currentInvitations ?? invitations
    const snapshot = {
      saved_at: new Date().toISOString(),
      trip: { city: trip?.city, opponent_label: trip?.opponent_label, arrival_date: trip?.arrival_date, departure_date: trip?.departure_date },
      invitations: snapshotInvitations.map((inv) => ({
        id: inv.id,
        hotel_name: inv.hotel_name,
        status: inv.status,
        response: inv.rfp_responses ?? null,
        answers: answerMaps[inv.id] ?? {},
      })),
    }
    await supabase.from('grid_versions').insert({ trip_id: id, version_label: label, snapshot })
  }

  const loadData = async () => {
    if (!id) return

    const { data: tripData, error: tripErr } = await supabase
      .from('trips')
      .select('*, clients(id, team_name, organization_id)')
      .eq('id', id)
      .single()

    if (tripErr || !tripData) {
      setError(tripErr?.message ?? 'Trip not found')
      setLoading(false)
      return
    }
    setTrip(tripData as Trip & { clients: Pick<Client, 'id' | 'team_name' | 'organization_id'> })

    const orgId = (tripData as any).clients.organization_id

    const [{ data: invData, error: invErr }, { data: snapData }] =
      await Promise.all([
        supabase
          .from('rfp_invitations')
          .select(`
            id, hotel_name, hotel_contact_name, hotel_contact_email, status, submitted_at, staff_notes,
            visit1_declined, visit2_declined,
            rfp_responses (
              id, completed_by_name, completed_date, best_king_rate, king_rate_notes,
              current_selling_rate, stay2_king_rate, stay2_suite_rate, stay2_selling_rate,
              best_suite_rate, occupancy_tax, resort_fee, meeting_space_notes, meeting_space_type,
              meeting_space_count, scenario_rates, scenario_availability, general_comments,
              concession_answers (
                id, concession_item_id, answer_yes_no, answer_value, comment
              )
            )
          `)
          .eq('trip_id', id)
          .order('hotel_name'),
        supabase
          .from('trip_concession_items')
          .select('source_item_id, sort_order, section, label, answer_type, requested_value, allow_comment')
          .eq('trip_id', id)
          .order('sort_order'),
      ])

    if (invErr) setError(invErr.message)
    const parsedInvitations = (invData as unknown as Invitation[]) ?? []
    setInvitations(parsedInvitations)
    // Seed staffNotes state from DB (won't overwrite unsaved local edits — only on initial load)
    setStaffNotes((prev) => {
      const next = { ...prev }
      for (const inv of parsedInvitations) {
        if (!(inv.id in next)) next[inv.id] = inv.staff_notes ?? ''
      }
      return next
    })

    // Use trip snapshot when available; fall back to live org items for legacy trips
    if (snapData && snapData.length > 0) {
      setItems(
        snapData.map((s: any) => ({
          id: s.source_item_id,
          sort_order: s.sort_order,
          section: s.section as ConcessionItem['section'],
          label: s.label,
          answer_type: s.answer_type as ConcessionItem['answer_type'],
          requested_value: s.requested_value,
          allow_comment: s.allow_comment ?? true,
        })),
      )
    } else {
      const { data: liveItems, error: itemErr } = await supabase
        .from('concession_items')
        .select('id, sort_order, section, label, answer_type, requested_value, allow_comment')
        .eq('organization_id', orgId)
        .order('sort_order')
      if (itemErr) setError(itemErr.message)
      setItems((liveItems as ConcessionItem[]) ?? [])
    }
    setLoading(false)
  }

  // Initial load
  useEffect(() => { loadData() }, [id])

  // Realtime — refetch when any invitation or response changes for this trip
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`trip-grid-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rfp_invitations', filter: `trip_id=eq.${id}` },
        () => loadData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rfp_responses' },
        () => loadData(),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Summary stats
  const stats = useMemo(() => {
    const invited = invitations.length
    const responded = invitations.filter((i) => ['submitted', 'awarded'].includes(i.status)).length
    const opened = invitations.filter((i) => i.status === 'opened').length
    const awarded = invitations.filter((i) => i.status === 'awarded').length
    const passed = invitations.filter((i) => i.status === 'passed').length
    const unavailable = invitations.filter((i) => i.status === 'unavailable').length
    const pending = invited - responded - passed - unavailable
    return { invited, responded, opened, pending, awarded, passed, unavailable }
  }, [invitations])

  // Find lowest king rate — only consider submitted/awarded hotels, ignore passed/unavailable
  const lowestRateId = useMemo(() => {
    let min: number | null = null
    let minId: string | null = null
    for (const inv of invitations) {
      if (['passed', 'unavailable'].includes(inv.status)) continue
      const rate = inv.rfp_responses?.best_king_rate
      if (rate != null && (min === null || rate < min)) {
        min = rate
        minId = inv.id
      }
    }
    return minId
  }, [invitations])

  // Build answer lookup map per invitation
  const answerMaps = useMemo(() => {
    const maps: Record<string, Record<string, Answer>> = {}
    for (const inv of invitations) {
      const resp = inv.rfp_responses
      maps[inv.id] = {}
      if (resp) {
        for (const a of resp.concession_answers ?? []) {
          maps[inv.id][a.concession_item_id] = a
        }
      }
    }
    return maps
  }, [invitations])

  // ── Award / Pass ────────────────────────────────────────────────────────────
  const handleAward = async (invitationId: string, hotelName: string) => {
    if (
      !confirm(
        `Award "${hotelName}"?\n\nThis will:\n• Mark this hotel as Awarded\n• Mark all other bids as Passed\n• Close the trip\n\nYou can undo this at any time.`,
      )
    )
      return
    setSaving(true)
    try {
      await supabase
        .from('rfp_invitations')
        .update({ status: 'awarded' })
        .eq('id', invitationId)
      await supabase
        .from('rfp_invitations')
        .update({ status: 'passed' })
        .eq('trip_id', id!)
        .neq('id', invitationId)
        .neq('status', 'awarded')
      await supabase.from('trips').update({ status: 'closed' }).eq('id', id!)
      // Snapshot with updated statuses before re-render
      const awardedInvitations = invitations.map((inv) => ({
        ...inv,
        status: inv.id === invitationId ? 'awarded' : inv.status === 'submitted' ? 'passed' : inv.status,
      }))
      await saveGridVersion(`Awarded: ${hotelName}`, awardedInvitations)
      // Timeline: record the award (no base-table timestamp exists for this).
      void logActivity({
        event_type: 'awarded',
        client_id: trip?.client_id ?? null,
        trip_id: id ?? null,
        detail: { hotel_name: hotelName },
      })
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleUndoAward = async (invitationId: string, hotelName: string) => {
    if (
      !confirm(
        `Undo award for "${hotelName}"?\n\nThis will:\n• Reset this hotel back to Submitted\n• Reopen the trip for further review\n\nOther hotels marked as Passed will stay passed — you can manually change them from the trip detail page.`,
      )
    )
      return
    setSaving(true)
    try {
      await supabase
        .from('rfp_invitations')
        .update({ status: 'submitted' })
        .eq('id', invitationId)
      await supabase.from('trips').update({ status: 'collecting' }).eq('id', id!)
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const handlePass = async (invitationId: string) => {
    setSaving(true)
    try {
      await supabase
        .from('rfp_invitations')
        .update({ status: 'passed' })
        .eq('id', invitationId)
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleMarkUnavailable = async (invitationId: string) => {
    setSaving(true)
    try {
      await supabase
        .from('rfp_invitations')
        .update({ status: 'unavailable' })
        .eq('id', invitationId)
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSnapshot = async () => {
    setVersionSaving(true)
    try {
      const d = new Date()
      const label = `Snapshot – ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      await saveGridVersion(label)
    } finally {
      setVersionSaving(false)
    }
  }

  // For Excel export
  const handleExport = () => {
    if (!trip) return
    const hotels = invitations.map((inv) => {
      const resp = inv.rfp_responses ?? null
      return {
        hotel_name: inv.hotel_name,
        status: inv.status,
        completed_by_name: resp?.completed_by_name ?? null,
        completed_date: resp?.completed_date ?? null,
        best_king_rate: resp?.best_king_rate ?? null,
        king_rate_notes: resp?.king_rate_notes ?? null,
        current_selling_rate: resp?.current_selling_rate ?? null,
        best_suite_rate: resp?.best_suite_rate ?? null,
        occupancy_tax: resp?.occupancy_tax ?? null,
        meeting_space_notes: resp?.meeting_space_notes ?? null,
        general_comments: resp?.general_comments ?? null,
        staff_notes: staffNotes[inv.id] || inv.staff_notes || null,
        answers: answerMaps[inv.id] ?? {},
      }
    })
    const tripClient = trip as any
    exportComparisonXlsx(
      {
        opponent_label: trip.opponent_label,
        city: trip.city,
        arrival_date: trip.arrival_date,
        departure_date: trip.departure_date,
        game_date: trip.game_date,
        game_dates: (trip as any).game_dates,
        king_rooms_requested: trip.king_rooms_requested,
        suites_requested: trip.suites_requested,
        total_rooms_requested: trip.total_rooms_requested,
      },
      hotels,
      items,
      `KJST_${(tripClient.clients?.team_name ?? 'RFP').replace(/\s+/g, '_')}_${trip.opponent_label?.replace(/\s+/g, '_') ?? 'Trip'}.xlsx`,
    )
  }

  if (error) return <ErrorNote message={error} />
  if (loading) return <Loading />

  const colSpan = invitations.length + 1

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link to={`/trips/${id}`} className="mb-1 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            ← Back to trip
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">
            {trip?.opponent_label || 'Comparison Grid'}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {(trip as any)?.clients?.team_name}
            {trip?.city ? ` · ${trip.city}` : ''}
            {trip?.arrival_date ? ` · ${formatDate(trip.arrival_date)} – ${formatDate(trip.departure_date)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveSnapshot}
            disabled={versionSaving || invitations.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            title="Save a snapshot of the current grid state"
          >
            {versionSaving ? 'Saving…' : '💾 Save Version'}
          </button>
          <button
            onClick={handleExport}
            disabled={invitations.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            ↓ Export (.xlsx)
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="mb-6 flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white px-6 py-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-800">{stats.invited}</div>
          <div className="text-xs text-slate-400">Invited</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-600">{stats.responded}</div>
          <div className="text-xs text-slate-400">Submitted</div>
        </div>
        {stats.awarded > 0 && (
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.awarded}</div>
            <div className="text-xs text-slate-400">Awarded</div>
          </div>
        )}
        <div className="text-center">
          <div className="text-2xl font-bold text-amber-500">{stats.opened}</div>
          <div className="text-xs text-slate-400">Opened</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-400">{stats.pending}</div>
          <div className="text-xs text-slate-400">Outstanding</div>
        </div>
        {stats.unavailable > 0 && (
          <div className="text-center">
            <div className="text-2xl font-bold text-slate-300">{stats.unavailable}</div>
            <div className="text-xs text-slate-400">Not available</div>
          </div>
        )}
        {trip?.response_deadline && (
          <div className="ml-auto text-center">
            <div className="text-sm font-semibold text-red-600">{formatDate(trip.response_deadline)}</div>
            <div className="text-xs text-slate-400">Deadline</div>
          </div>
        )}
      </div>

      {invitations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">No hotels have been invited yet.</p>
          <Link to={`/trips/${id}`} className="mt-2 block text-sm font-medium text-[#1C1008] hover:underline">
            Go invite hotels →
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="border-b-2 border-slate-200">
                <th className="sticky left-0 w-64 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Hotel
                </th>
                {invitations.map((inv) => {
                  const isLowest = inv.id === lowestRateId
                  const isAwarded = inv.status === 'awarded'
                  const isPassed = inv.status === 'passed'
                  const isUnavailable = inv.status === 'unavailable'
                  const isDimmed = isPassed || isUnavailable
                  const canAward = ['submitted', 'opened'].includes(inv.status)
                  const canUndoAward = isAwarded
                  const canPass = !isPassed && !isAwarded && !isUnavailable && trip?.status !== 'closed'
                  const canMarkUnavailable = ['sent', 'opened'].includes(inv.status) && trip?.status !== 'closed'
                  return (
                    <th
                      key={inv.id}
                      className={`min-w-[200px] px-4 py-3 text-left align-top ${
                        isAwarded
                          ? 'border-t-4 border-t-amber-400 bg-amber-50'
                          : isUnavailable
                            ? 'border-t-4 border-t-slate-300 bg-slate-50'
                            : isLowest
                              ? 'bg-emerald-50'
                              : ''
                      } ${isDimmed ? 'opacity-50' : ''}`}
                    >
                      <div className={`font-semibold ${isDimmed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                        {inv.hotel_name}
                      </div>
                      {inv.hotel_contact_name && (
                        <div className="mt-0.5 text-xs font-normal text-slate-400">
                          {inv.hotel_contact_name}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge status={inv.status} />
                        {isLowest && !isAwarded && !isDimmed && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Best rate
                          </span>
                        )}
                      </div>
                      {/* Dealbreaker badges */}
                      {!isDimmed && inv.rfp_responses && (() => {
                        const badges = getDealbreakerBadges(inv, items, answerMaps[inv.id] ?? {})
                        if (badges.length === 0) return null
                        return (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {badges.map((b) => (
                              <DealBreakerBadge key={b.label} label={b.label} level={b.level} />
                            ))}
                          </div>
                        )
                      })()}
                      {/* Award / Undo Award / Pass / Unavailable actions */}
                      {(canAward || canUndoAward || canPass || canMarkUnavailable) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {canAward && (
                            <button
                              onClick={() => handleAward(inv.id, inv.hotel_name)}
                              disabled={saving}
                              title="Use this when the team picks this hotel, even if you've also confirmed by phone or email. It marks the winner, passes the rest, and closes the trip."
                              className="rounded px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-40 transition-colors"
                            >
                              🏆 Award
                            </button>
                          )}
                          {canUndoAward && (
                            <button
                              onClick={() => handleUndoAward(inv.id, inv.hotel_name)}
                              disabled={saving}
                              className="rounded px-2 py-1 text-xs font-medium bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors"
                            >
                              ↩ Undo award
                            </button>
                          )}
                          {canPass && (
                            <button
                              onClick={() => handlePass(inv.id)}
                              disabled={saving}
                              className="rounded px-2 py-1 text-xs font-medium bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40 transition-colors"
                            >
                              Pass
                            </button>
                          )}
                          {canMarkUnavailable && (
                            <button
                              onClick={() => handleMarkUnavailable(inv.id)}
                              disabled={saving}
                              title="Hotel cannot accommodate these dates"
                              className="rounded px-2 py-1 text-xs font-medium bg-slate-100 text-slate-400 hover:bg-slate-200 disabled:opacity-40 transition-colors"
                            >
                              Not available
                            </button>
                          )}
                        </div>
                      )}
                      {/* Staff notes — KJST-only, shown on team export */}
                      {!isDimmed && (
                        <div className="mt-2">
                          <textarea
                            placeholder="Staff notes (team export)…"
                            value={staffNotes[inv.id] ?? ''}
                            onChange={(e) =>
                              setStaffNotes((n) => ({ ...n, [inv.id]: e.target.value }))
                            }
                            onBlur={async () => {
                              const val = staffNotes[inv.id] ?? ''
                              setNoteSaving((s) => ({ ...s, [inv.id]: true }))
                              await supabase
                                .from('rfp_invitations')
                                .update({ staff_notes: val.trim() || null })
                                .eq('id', inv.id)
                              setNoteSaving((s) => ({ ...s, [inv.id]: false }))
                            }}
                            className="w-full resize-none rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-600 placeholder-slate-300 focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
                            rows={2}
                          />
                          {noteSaving[inv.id] && (
                            <p className="mt-0.5 text-[10px] text-slate-400">Saving…</p>
                          )}
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {/* ── Rates section ── */}
              <SectionRow label="Rates" colSpan={colSpan} />

              {/* Stay label if multi-stay trip */}
              {trip?.stay2_arrival_date && (
                <tr className="border-b border-slate-50">
                  <td className="sticky left-0 bg-white px-4 py-1 text-xs font-semibold text-slate-400">Stay 1 · {formatDate(trip.arrival_date)} – {formatDate(trip.departure_date)}</td>
                  {invitations.map((inv) => <td key={inv.id} className="min-w-[200px] bg-white px-4 py-1" />)}
                </tr>
              )}

              <RateRow
                label={trip?.stay2_arrival_date ? 'King Rate — Stay 1' : 'Best King Rate'}
                invitations={invitations}
                getValue={(r) => (r?.best_king_rate != null ? `$${r.best_king_rate}` : null)}
                highlight
                lowestRateId={lowestRateId}
                declinedWhen={(inv) => inv.visit1_declined}
              />
              <RateRow
                label={trip?.stay2_arrival_date ? 'Selling Rate — Stay 1' : 'Current Selling Rate'}
                invitations={invitations}
                getValue={(r) => r?.current_selling_rate ?? null}
                lowestRateId={lowestRateId}
                declinedWhen={(inv) => inv.visit1_declined}
              />
              <RateRow
                label={trip?.stay2_arrival_date ? 'Suite Rate — Stay 1' : 'Best Suite Rate'}
                invitations={invitations}
                getValue={(r) => (r?.best_suite_rate != null ? `$${r.best_suite_rate}` : null)}
                lowestRateId={lowestRateId}
                declinedWhen={(inv) => inv.visit1_declined}
              />

              {/* Estimated cost — Stay 1 */}
              {trip?.total_rooms_requested != null && trip?.nights != null && (
                <RateRow
                  label={`Est. Room Cost${trip.stay2_arrival_date ? ' — Stay 1' : ''} (${trip.total_rooms_requested}rm × ${trip.nights}nt)`}
                  invitations={invitations}
                  getValue={(r) => {
                    if (r?.best_king_rate == null) return null
                    const cost = r.best_king_rate * trip.total_rooms_requested! * trip.nights!
                    return `$${cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  }}
                  lowestRateId={lowestRateId}
                />
              )}

              {/* ── Food & Beverage forecast (auto-computed from the trip's F&B plan) ── */}
              {(() => {
                const plan = ((trip as any)?.fnb_plan ?? {}) as Record<string, number>
                const entries = Object.entries(plan).filter(([, pm]) => Number(pm) > 0)
                if (entries.length === 0) return null
                const totalPersonMeals = entries.reduce((n, [, pm]) => n + Number(pm), 0)
                const parsePrice = (v: unknown) => (v == null || v === '') ? NaN : parseFloat(String(v).replace(/[^0-9.]/g, ''))
                const fnbFor = (invId: string): number | null => {
                  let total = 0, any = false
                  for (const [itemId, pm] of entries) {
                    const price = parsePrice(answerMaps[invId]?.[itemId]?.answer_value)
                    if (Number.isFinite(price)) { total += price * Number(pm); any = true }
                  }
                  return any ? total : null
                }
                const roomFor = (inv: typeof invitations[number]): number | null => {
                  const r = inv.rfp_responses
                  if (r?.best_king_rate == null || trip?.total_rooms_requested == null || trip?.nights == null) return null
                  return r.best_king_rate * trip.total_rooms_requested * trip.nights
                }
                const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                const cell = (content: string, inv: typeof invitations[number], strong = false) => {
                  const isDimmed = inv.status === 'passed' || inv.status === 'unavailable'
                  return (
                    <td key={inv.id} className={`min-w-[200px] px-4 py-2 text-right text-sm ${isDimmed ? 'opacity-40 bg-slate-50' : ''} ${strong ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                      {content}
                    </td>
                  )
                }
                return (
                  <>
                    <SectionRow label="Food & Beverage (forecast)" colSpan={colSpan} />
                    <tr className="border-b border-slate-100">
                      <td className="sticky left-0 w-64 bg-white px-4 py-2 align-top text-xs font-medium text-slate-500">
                        Forecasted F&amp;B Total
                        <span className="text-slate-400"> ({totalPersonMeals} person-meals)</span>
                      </td>
                      {invitations.map((inv) => cell(money(fnbFor(inv.id)), inv, true))}
                    </tr>
                    <tr className="border-b border-slate-100 bg-amber-50/30">
                      <td className="sticky left-0 w-64 bg-white px-4 py-2 text-xs font-semibold text-slate-700">
                        Rooms + F&amp;B (est.)
                      </td>
                      {invitations.map((inv) => {
                        const room = roomFor(inv), fnb = fnbFor(inv.id)
                        const tot = (room == null && fnb == null) ? null : (room ?? 0) + (fnb ?? 0)
                        return cell(money(tot), inv, true)
                      })}
                    </tr>
                  </>
                )
              })()}

              {/* Stay 2 rows — only shown when trip has a second stay */}
              {trip?.stay2_arrival_date && (() => {
                const stay2Nights = trip.stay2_arrival_date && trip.stay2_departure_date
                  ? Math.max(1, Math.ceil((new Date(trip.stay2_departure_date).getTime() - new Date(trip.stay2_arrival_date).getTime()) / 86400000))
                  : null
                return (
                  <>
                    <tr className="border-b border-slate-50">
                      <td className="sticky left-0 bg-white px-4 py-1 text-xs font-semibold text-slate-400">
                        Stay 2 · {formatDate(trip.stay2_arrival_date)} – {formatDate(trip.stay2_departure_date)}
                      </td>
                      {invitations.map((inv) => <td key={inv.id} className="min-w-[200px] bg-white px-4 py-1" />)}
                    </tr>
                    <RateRow
                      label="King Rate — Stay 2"
                      invitations={invitations}
                      getValue={(r) => (r?.stay2_king_rate != null ? `$${r.stay2_king_rate}` : null)}
                      highlight
                      lowestRateId={lowestRateId}
                      declinedWhen={(inv) => inv.visit2_declined}
                    />
                    <RateRow
                      label="Selling Rate — Stay 2"
                      invitations={invitations}
                      getValue={(r) => r?.stay2_selling_rate ?? null}
                      lowestRateId={lowestRateId}
                      declinedWhen={(inv) => inv.visit2_declined}
                    />
                    <RateRow
                      label="Suite Rate — Stay 2"
                      invitations={invitations}
                      getValue={(r) => (r?.stay2_suite_rate != null ? `$${r.stay2_suite_rate}` : null)}
                      lowestRateId={lowestRateId}
                      declinedWhen={(inv) => inv.visit2_declined}
                    />
                    {trip.total_rooms_requested != null && stay2Nights != null && (
                      <RateRow
                        label={`Est. Room Cost — Stay 2 (${trip.total_rooms_requested}rm × ${stay2Nights}nt)`}
                        invitations={invitations}
                        getValue={(r) => {
                          if (r?.stay2_king_rate == null) return null
                          const cost = r.stay2_king_rate * trip.total_rooms_requested! * stay2Nights
                          return `$${cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                        }}
                        lowestRateId={lowestRateId}
                      />
                    )}
                  </>
                )
              })()}

              {/* Multi-scenario rates — shown when trip has night_scenarios with 2+ values */}
              {(() => {
                const scenarios: number[] = (trip as any)?.night_scenarios ?? []
                if (scenarios.length < 2) return null
                return scenarios.map((n) => (
                  <tr key={`scenario-${n}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="sticky left-0 w-64 bg-white px-4 py-2.5 text-xs font-medium text-slate-500">
                      {n}-Night Rate
                    </td>
                    {invitations.map((inv) => {
                      const resp = inv.rfp_responses ?? null
                      const sr = resp?.scenario_rates?.[String(n)]
                      const isPassed = inv.status === 'passed'
                      const isUnavailable = inv.status === 'unavailable'
                      const isAwarded = inv.status === 'awarded'
                      const isDimmed = isPassed || isUnavailable
                      const noResponse = !resp && !isDimmed
                      let content: ReactNode
                      if (isUnavailable) {
                        content = <span className="text-xs italic text-slate-400">Not available</span>
                      } else if (noResponse) {
                        content = <span className="text-xs italic text-slate-300">Awaiting response</span>
                      } else if (!sr) {
                        // Fall back to best_king_rate for the first scenario
                        const fallback = n === scenarios[0] && resp?.best_king_rate != null
                          ? `$${resp.best_king_rate}`
                          : null
                        content = fallback ? (
                          <span className="text-slate-600">{fallback}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )
                      } else if (sr.available === false) {
                        content = <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">N/A</span>
                      } else {
                        content = <span className="font-medium text-slate-800">{sr.rate != null ? `$${sr.rate}` : '—'}</span>
                      }
                      return (
                        <td
                          key={inv.id}
                          className={`min-w-[200px] px-4 py-2.5 text-sm ${
                            isDimmed
                              ? 'opacity-40 bg-slate-50'
                              : isAwarded
                                ? 'bg-amber-50'
                                : inv.id === lowestRateId
                                  ? 'bg-emerald-50'
                                  : ''
                          }`}
                        >
                          {content}
                        </td>
                      )
                    })}
                  </tr>
                ))
              })()}

              <RateRow
                label="Occupancy Tax"
                invitations={invitations}
                getValue={(r) => r?.occupancy_tax ?? null}
                lowestRateId={lowestRateId}
              />
              <RateRow
                label="Resort Fee"
                invitations={invitations}
                getValue={(r) => r?.resort_fee ?? null}
                lowestRateId={lowestRateId}
              />
              {/* Date scenario availability */}
              {(trip?.date_scenarios?.length ?? 0) > 0 && (
                <tr className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="sticky left-0 w-64 bg-white px-4 py-2.5 align-top">
                    <p className="text-xs font-medium text-slate-600">Date Scenarios</p>
                  </td>
                  {invitations.map((inv) => {
                    const r = inv.rfp_responses
                    const avail: Record<string, boolean> | null = r?.scenario_availability ?? null
                    const scenarios = trip?.date_scenarios ?? []
                    return (
                      <td key={inv.id} className="px-4 py-2.5 align-top text-xs">
                        {avail ? (
                          <div className="flex flex-wrap gap-1">
                            {scenarios.map((s) => {
                              const ok = avail[s.label] ?? true
                              return (
                                <span
                                  key={s.label}
                                  className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
                                >
                                  {ok ? '✓' : '✗'} {s.label}
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )}
              {/* King rate notes only shown for single-stay trips */}
              {!trip?.stay2_arrival_date && (
                <RateRow
                  label="Rate Notes"
                  invitations={invitations}
                  getValue={(r) => r?.king_rate_notes ?? null}
                  lowestRateId={lowestRateId}
                />
              )}

              {/* ── Concession items by section ── */}
              {SECTION_ORDER.map((section) => {
                const sectionItems = items.filter((i) => i.section === section)
                if (sectionItems.length === 0) return null
                return [
                  <SectionRow
                    key={`section-${section}`}
                    label={SECTION_LABELS[section]}
                    colSpan={colSpan}
                  />,
                  ...sectionItems.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="sticky left-0 w-64 bg-white px-4 py-2.5 align-top">
                        <p className="text-xs leading-relaxed text-slate-600">{item.label}</p>
                        {item.requested_value && item.requested_value !== '—' && (
                          <p className="mt-0.5 text-xs text-slate-400">
                            Req: {item.requested_value}
                          </p>
                        )}
                      </td>
                      {invitations.map((inv) => {
                        const answer = answerMaps[inv.id]?.[item.id]
                        const isNo = item.answer_type === 'yes_no' && answer?.answer_yes_no === false
                        const isPassed = inv.status === 'passed'
                        const isUnavailable = inv.status === 'unavailable'
                        const isAwarded = inv.status === 'awarded'
                        const isDimmed = isPassed || isUnavailable
                        const noResponse = !inv.rfp_responses && !isDimmed
                        return (
                          <td
                            key={inv.id}
                            className={`min-w-[200px] px-4 py-2.5 align-top text-sm ${
                              isDimmed
                                ? 'opacity-40 bg-slate-50'
                                : isAwarded
                                  ? 'bg-amber-50'
                                  : isNo
                                    ? 'bg-red-50'
                                    : inv.id === lowestRateId
                                      ? 'bg-emerald-50'
                                      : ''
                            }`}
                          >
                            {isUnavailable
                              ? <span className="text-xs italic text-slate-400">Not available</span>
                              : noResponse
                                ? <span className="text-xs italic text-slate-300">Awaiting response</span>
                                : <ValueCell item={item} answer={answer} />
                            }
                          </td>
                        )
                      })}
                    </tr>
                  )),
                ]
              })}

              {/* ── Additional info ── */}
              <SectionRow label="Additional Information" colSpan={colSpan} />
              <RateRow
                label="Meeting Space Type"
                invitations={invitations}
                getValue={(r) => meetingSpaceLabel(r?.meeting_space_type, r?.meeting_space_count)}
                lowestRateId={lowestRateId}
              />
              <RateRow
                label="Meeting Space Notes"
                invitations={invitations}
                getValue={(r) => formatMeetingSpaceNotes(r?.meeting_space_notes) || null}
                lowestRateId={lowestRateId}
              />
              <RateRow
                label="General Comments"
                invitations={invitations}
                getValue={(r) => r?.general_comments ?? null}
                lowestRateId={lowestRateId}
              />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
