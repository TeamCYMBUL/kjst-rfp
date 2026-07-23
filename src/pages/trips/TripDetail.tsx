import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activity'
import type { Client, DateScenario, Invitation, Trip } from '../../lib/types'
import { formatDate, generateToken, formatMeetingSpaceNotes, passedLabel } from '../../lib/format'
import { PUBLIC_APP_URL } from '../../lib/config'
import { sendInvitationEmail, sendReminderEmails, sendSingleReminderEmail, reopenRfp } from '../../lib/emailApi'
import { Badge, ErrorNote, LinkButton, Loading } from '../../components/ui'
import { PageHint } from '../../components/PageHint'
import { exportTeamGrid, exportSingleHotelXlsx } from '../../lib/excelExport'
import { useRole } from '../../lib/useRole'

// ── Types ─────────────────────────────────────────────────────────────────────

type HotelResponse = {
  id: string
  best_king_rate: number | null
  best_suite_rate: number | null
  current_selling_rate: string | null
  occupancy_tax: string | null
  resort_fee: string | null
  king_rate_notes: string | null
  meeting_space_notes: string | null
  general_comments: string | null
  stay2_king_rate: number | null
  stay2_suite_rate: number | null
  stay2_selling_rate: string | null
  scenario_availability: Record<string, boolean> | null
  completed_by_name: string | null
  completed_date: string | null
  menu_attachments: { path: string; name: string; size?: number; type?: string }[] | null
}

type ConcessionItem = {
  id: string
  sort_order: number
  section: string
  label: string
  answer_type: string
  requested_value: string | null
}

type Answer = {
  concession_item_id: string
  answer_yes_no: boolean | null
  answer_value: string | null
  comment: string | null
}

// ── Concession item matchers ─────────────────────────────────────────────────
// Every client now has its own RFP template with its own wording (a hotel item
// might say "One-Bedroom" or "One Bedroom", "3,000 sq ft" or "800 sq ft", etc.).
// These matchers key off phrases that are consistent across all templates —
// never off a specific number or room name — so scoring works the same
// regardless of which client's template a trip uses. Shared by calcScores,
// BidSummaryTable, and the hotel detail panel so all three stay in sync.

// Open a hotel-uploaded menu from the private rfp-menus bucket. Staff are
// authenticated, so a short-lived signed URL is generated on demand.
async function openMenuAttachment(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from('rfp-menus').createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) {
    alert('Could not open the file: ' + (error?.message ?? 'unknown error'))
    return
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
}

// Hyphens vary ("One-Bedroom" vs "One Bedroom") across templates — normalize before matching.
function normLabel(label: string): string {
  return label.toLowerCase().replace(/-/g, ' ')
}
function findFlexCancelItem(items: ConcessionItem[]) {
  return items.find((c) => normLabel(c.label).includes('flexible cancellation'))
}
function findCommissionItem(items: ConcessionItem[]) {
  return items.find((c) => normLabel(c.label).includes('commissionable') || (normLabel(c.label).includes('commission') && c.answer_type === 'percent'))
}
function findCompSuitesItem(items: ConcessionItem[]) {
  return items.find((c) => normLabel(c.label).includes('complimentary one bedroom suite'))
}
function findSuiteUpgItem(items: ConcessionItem[]) {
  return items.find((c) => normLabel(c.label).includes('suite upgrade'))
}
function findPostseasonItem(items: ConcessionItem[]) {
  return items.find((c) => c.section === 'postseason')
}
// Meeting-space concessions vary in count, room names, and square footage per
// client — score by the fraction answered Yes instead of matching a specific
// room (e.g. "massage room") or size (e.g. "3,000 sq ft") that won't exist in
// every template.
function findMeetingSpaceItems(items: ConcessionItem[]) {
  return items.filter((c) => c.answer_type === 'yes_no' && (normLabel(c.label).includes('meeting space') || normLabel(c.label).includes('function space')))
}

// Free-suite / suite-upgrade concessions are a number ('quantity') in some
// templates (e.g. Mets) and Yes/No in others (e.g. Sharks). Read whichever the
// answer used so the value shows and scores correctly either way.
function suiteAnswerView(
  ans: { answer_yes_no?: boolean | null; answer_value?: string | null } | null | undefined,
): { display: string; positive: boolean } {
  if (!ans) return { display: '—', positive: false }
  if (ans.answer_yes_no != null) return { display: ans.answer_yes_no ? 'Yes' : 'No', positive: ans.answer_yes_no === true }
  const n = Number(ans.answer_value)
  return {
    display: ans.answer_value != null && ans.answer_value !== '' ? String(ans.answer_value) : '—',
    positive: Number.isFinite(n) && n > 0,
  }
}

// A hotel is emailable only while its RFP is still in play. Once it's submitted,
// awarded, passed, declined, or marked unavailable, the proposal process is
// complete for that hotel and there's nothing to (re)send or remind.
const EMAIL_DONE_STATUSES = ['submitted', 'awarded', 'passed', 'declined', 'unavailable']
const canEmailStatus = (status: string) => !EMAIL_DONE_STATUSES.includes(status)

// ── Score calculation ─────────────────────────────────────────────────────────

type ScoreResult = {
  score: number
  noFlexCancel: boolean  // flex cancellation answered No → KJST dealbreaker
  noCommission: boolean  // commission = 0% → KJST dealbreaker
}

function calcScores(
  submittedInvites: { id: string }[],
  responses: Map<string, HotelResponse>,
  answers: Map<string, Answer[]>,
  concessionItems: ConcessionItem[],
  tripHasStay2: boolean,
): Map<string, ScoreResult> {
  const scores = new Map<string, ScoreResult>()
  if (submittedInvites.length === 0) return scores

  // Find key item IDs by label
  const flexCancelItem = findFlexCancelItem(concessionItems)
  const commissionItem  = findCommissionItem(concessionItems)
  const compSuitesItem  = findCompSuitesItem(concessionItems)
  const suiteUpgItem    = findSuiteUpgItem(concessionItems)
  const meetingSpaceItems = findMeetingSpaceItems(concessionItems)
  const postseasonItem  = findPostseasonItem(concessionItems)

  // Rate score (25 pts) — lowest rate = 25 pts, others proportional.
  // Trips with a second stay are scored on BOTH stays independently (each stay's
  // cheapest submitted rate earns full points), then averaged — so a hotel can't
  // win purely on a strong Stay 1 rate while quoting a weak Stay 2 rate.
  // Rates can arrive as numeric strings; 0 / blank means "not provided" (e.g. a
  // hotel with no second stay), NOT a real $0 quote. Normalize to a positive
  // number or null so 0 never enters the min or a 0/0 division.
  const toRate = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : v != null ? Number(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const stay1Rates = submittedInvites
    .map((inv) => toRate(responses.get(inv.id)?.best_king_rate))
    .filter((r): r is number => r != null)
  const minStay1Rate = stay1Rates.length > 0 ? Math.min(...stay1Rates) : null

  const stay2Rates = submittedInvites
    .map((inv) => toRate(responses.get(inv.id)?.stay2_king_rate))
    .filter((r): r is number => r != null)
  const minStay2Rate = stay2Rates.length > 0 ? Math.min(...stay2Rates) : null

  for (const inv of submittedInvites) {
    const resp = responses.get(inv.id)
    const ans  = answers.get(inv.id) ?? []
    const ansMap = new Map(ans.map((a) => [a.concession_item_id, a]))

    const getYesNo = (item: ConcessionItem | undefined) =>
      item ? (ansMap.get(item.id)?.answer_yes_no ?? null) : null
    const getValue = (item: ConcessionItem | undefined) =>
      item ? (ansMap.get(item.id)?.answer_value ?? null) : null

    // Dealbreaker flags (separate from score)
    const flexAns = getYesNo(flexCancelItem)
    const noFlexCancel = flexAns === false
    const commValue = getValue(commissionItem)
    const noCommission = commValue != null && (commValue.trim() === '0' || commValue.trim() === '0%')

    // 1. Flex cancel — 20 pts
    const flexScore = flexAns === true ? 20 : 0

    // 2. Commission — tiered (15 pts). Books almost always come in at 0 / 7 / 10,
    //    so reward the tier rather than giving full marks for any commission at all:
    //    0% → 0 pts · 1–9% → 7.5 pts · 10%+ → 15 pts.
    const commNum = commValue != null ? parseFloat(commValue.replace(/[^0-9.]/g, '')) : NaN
    const commScore = !Number.isFinite(commNum) || commNum <= 0
      ? 0
      : commNum >= 10
        ? 15
        : 7.5

    // 3. Rate competitiveness — 25 pts (averaged across both stays when the trip has two)
    const scoreForStay = (minRate: number | null, rate: number | null | undefined) => {
      const r = toRate(rate)
      if (r == null) return null
      return minRate != null ? (minRate / r) * 25 : 25
    }
    const stay1Score = scoreForStay(minStay1Rate, resp?.best_king_rate)
    const v1 = stay1Score != null && Number.isFinite(stay1Score) ? stay1Score : 0
    let rateScore = 0
    if (tripHasStay2) {
      // Strict: on a two-stay trip, a missing/blank stay scores 0 for that stay,
      // so a hotel that only bids one stay can't win on a single strong rate.
      const stay2Score = scoreForStay(minStay2Rate, resp?.stay2_king_rate)
      const v2 = stay2Score != null && Number.isFinite(stay2Score) ? stay2Score : 0
      rateScore = Math.round((v1 + v2) / 2)
    } else {
      rateScore = Math.round(v1)
    }

    // 4. Playoff / postseason clause — 10 pts
    const playoffScore = getYesNo(postseasonItem) === true ? 10 : 0

    // 5. Meeting space — up to 10 pts, scaled by the fraction of meeting-space
    // items this hotel answered Yes to (item count varies per client template)
    const meetingYesCount = meetingSpaceItems.filter((item) => ansMap.get(item.id)?.answer_yes_no === true).length
    const meetingScore = meetingSpaceItems.length > 0 ? Math.round((meetingYesCount / meetingSpaceItems.length) * 10) : 0

    // 6. Suite concessions — up to 20 pts. Works whether the template uses a
    // quantity (a number > 0) or Yes/No (Yes counts) for these items.
    const compPositive = suiteAnswerView(compSuitesItem ? ansMap.get(compSuitesItem.id) : null).positive
    const upgPositive  = suiteAnswerView(suiteUpgItem ? ansMap.get(suiteUpgItem.id) : null).positive
    const suiteScore = (compPositive ? 10 : 0) + (upgPositive ? 10 : 0)

    const rawTotal = flexScore + commScore + rateScore + playoffScore + meetingScore + suiteScore
    const total = Math.min(100, Number.isFinite(rawTotal) ? rawTotal : 0)
    scores.set(inv.id, { score: total, noFlexCancel, noCommission })
  }
  return scores
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' :
    score >= 60 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' :
                  'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>
      {score}
    </span>
  )
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status, sentAt }: { status: string; sentAt?: string | null }) {
  // An invitation reads as 'sent' in the DB the moment it's added — sentAt is
  // the only reliable signal an email actually went out. Show a hollow dot
  // for a draft that was never emailed instead of the same filled dot as a
  // real "sent, awaiting response" invitation.
  if (sentAt === null && (status === 'sent' || status === 'opened')) {
    return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-slate-300 dark:border-slate-600" />
  }
  const color =
    status === 'submitted' || status === 'awarded'
      ? 'bg-emerald-500'
      : status === 'opened'
        ? 'bg-amber-400'
        : status === 'passed'
          ? 'bg-red-500'
          : status === 'unavailable'
            ? 'bg-red-400'
            : 'bg-slate-300'
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ResponseProgress({ invites }: { invites: Invitation[] }) {
  const total = invites.length
  if (total === 0) return null
  const submitted = invites.filter((i) => ['submitted', 'awarded'].includes(i.status)).length
  const opened = invites.filter((i) => i.status === 'opened').length
  const pct = Math.round((submitted / total) * 100)
  return (
    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span><strong className="text-slate-700 dark:text-slate-300">{submitted}/{total}</strong> responded</span>
        <span>{pct}%</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="bg-emerald-500 transition-all" style={{ width: `${(submitted / total) * 100}%` }} />
        <div className="bg-amber-400 transition-all" style={{ width: `${(opened / total) * 100}%` }} />
      </div>
    </div>
  )
}

// ── Invite form (slide-in panel) ──────────────────────────────────────────────

const LEAGUE_TABS = ['All', 'MLB', 'NBA', 'NHL', 'WNBA'] as const
type LeagueTab = typeof LEAGUE_TABS[number]

type HotelSuggestion = {
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  league: string | null
  fromDatabase?: boolean
}

function InviteForm({
  tripId,
  defaultLeague,
  onDone,
  onCancel,
}: {
  tripId: string
  defaultLeague?: string | null
  onDone: () => void
  onCancel: () => void
}) {
  const [hotelName, setHotelName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allFetched, setAllFetched] = useState<HotelSuggestion[]>([])
  const [suggestions, setSuggestions] = useState<HotelSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const initialLeagueTab = (LEAGUE_TABS as readonly string[]).includes((defaultLeague ?? '').toUpperCase())
    ? ((defaultLeague ?? '').toUpperCase() as LeagueTab)
    : 'All'
  const [leagueTab, setLeagueTab] = useState<LeagueTab>(initialLeagueTab)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Re-filter client-side when league tab changes
  useEffect(() => {
    if (allFetched.length === 0) return
    const filtered = applyLeagueFilter(allFetched, leagueTab)
    setSuggestions(filtered)
    setShowSuggestions(filtered.length > 0)
  }, [leagueTab, allFetched])

  const applyLeagueFilter = (list: HotelSuggestion[], tab: LeagueTab) => {
    if (tab === 'All') return list.slice(0, 8)
    return list.filter((s) => (s.league ?? '').toUpperCase() === tab).slice(0, 8)
  }

  const search = async (q: string) => {
    if (q.length < 2) { setAllFetched([]); setSuggestions([]); setShowSuggestions(false); return }
    const [dbRes, histRes] = await Promise.all([
      supabase.from('hotels').select('name, contact_name, contact_email, league').ilike('name', `%${q}%`).limit(20),
      supabase.from('rfp_invitations').select('hotel_name, hotel_contact_name, hotel_contact_email').ilike('hotel_name', `%${q}%`).order('hotel_name').limit(8),
    ])
    const dbSuggestions: HotelSuggestion[] = (dbRes.data ?? []).map((h: any) => ({
      hotel_name: h.name as string,
      hotel_contact_name: h.contact_name as string | null,
      hotel_contact_email: h.contact_email as string | null,
      league: (h.league as string | null) ?? null,
      fromDatabase: true as const,
    }))
    const seen = new Set<string>(dbSuggestions.map((s) => s.hotel_name.toLowerCase()))
    const histUnique: HotelSuggestion[] = (histRes.data ?? []).filter((r: any) => {
      const k = r.hotel_name.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).map((r: any) => ({
      hotel_name: r.hotel_name as string,
      hotel_contact_name: r.hotel_contact_name as string | null,
      hotel_contact_email: r.hotel_contact_email as string | null,
      league: null as string | null,
      fromDatabase: false as const,
    }))
    const merged = [...dbSuggestions, ...histUnique]
    setAllFetched(merged)
    const filtered = applyLeagueFilter(merged, leagueTab)
    setSuggestions(filtered)
    setShowSuggestions(filtered.length > 0)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hotelName.trim()) { setError('Hotel name is required.'); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('rfp_invitations').insert({
      trip_id: tripId, hotel_name: hotelName.trim(),
      hotel_contact_name: contactName.trim() || null,
      hotel_contact_email: contactEmail.trim() || null,
      token: generateToken(), status: 'sent',
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onDone()
  }

  return (
    <div className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 p-4">
      <p className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Add hotel to RFP</p>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Hotels receive a secure link and can't see each other's bids.</p>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* League filter tabs */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LEAGUE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setLeagueTab(tab)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              leagueTab === tab
                ? 'bg-[#1C1008] text-white'
                : 'border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-[#1C1008] hover:text-[#1C1008]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div ref={ref} className="relative">
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Hotel name *</label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
            value={hotelName} required autoComplete="off"
            placeholder="Start typing to search history…"
            onChange={(e) => { setHotelName(e.target.value); search(e.target.value) }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
              {suggestions.map((s, i) => (
                <button key={i} type="button"
                  onMouseDown={() => { setHotelName(s.hotel_name); setContactName(s.hotel_contact_name ?? ''); setContactEmail(s.hotel_contact_email ?? ''); setShowSuggestions(false) }}
                  className="flex w-full flex-col border-b border-slate-100 dark:border-slate-700 px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 last:border-0"
                >
                  <span className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                    {s.hotel_name}
                    {s.fromDatabase && (
                      <span className="rounded px-1 py-0.5 text-[10px] bg-blue-50 text-blue-500 font-semibold">📋 DB</span>
                    )}
                    {s.league && (
                      <span className="rounded px-1 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-semibold">{s.league}</span>
                    )}
                  </span>
                  {(s.hotel_contact_name || s.hotel_contact_email) && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">{[s.hotel_contact_name, s.hotel_contact_email].filter(Boolean).join(' · ')}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Contact name</label>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Contact email</label>
          <input type="email" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="rounded-lg bg-[#1C1008] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50">
            {saving ? 'Adding…' : 'Add hotel'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Score info modal ──────────────────────────────────────────────────────────

function ScoreInfoModal({ onClose }: { onClose: () => void }) {
  const items = [
    { pts: 25, label: 'Rate competitiveness', note: 'Lowest bid = 25 pts. Other hotels are scored proportionally (e.g. a rate 10% higher than the lowest = ~22.5 pts).' },
    { pts: 20, label: 'Flexible cancellation', note: 'Full 20 pts if the hotel answers Yes. Zero if No — this also triggers a red dealbreaker flag.' },
    { pts: 20, label: 'Suite concessions', note: 'Split equally: comp suites (up to 10 pts) + suite upgrades at king rate (up to 10 pts). Each is scaled vs the best offer across all hotels.' },
    { pts: 15, label: 'Commission', note: 'Tiered by rate: 10%+ = 15 pts · 1–9% = 7.5 pts · 0% = 0 pts (0% also triggers an orange dealbreaker flag).' },
    { pts: 10, label: 'Playoff / postseason clause', note: 'Full 10 pts if the hotel answers Yes. Zero if No.' },
    { pts: 10, label: 'Meeting space available', note: 'Full 10 pts if the hotel confirms meeting space. Zero if No.' },
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">Score breakdown</h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Each hotel is scored out of 100 pts across 6 categories. Scores are for KJST internal use only — never shared with clients or hotels.</p>
        <div className="space-y-3">
          {items.map(({ pts, label, note }) => (
            <div key={label} className="flex gap-4">
              <span className="shrink-0 w-8 pt-0.5 text-right text-sm font-bold text-emerald-600 dark:text-emerald-400">{pts}</span>
              <div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500 leading-snug mt-0.5">{note}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
          <span className="text-xs text-slate-400 dark:text-slate-500">Total: 100 pts</span>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 dark:bg-slate-700 px-4 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bid summary table ─────────────────────────────────────────────────────────

function BidSummaryTable({
  invites,
  responses,
  answers,
  concessionItems,
  scores,
  selectedId,
  onSelect,
  onPass,
  onResetStatus,
  onReopen,
  reopeningId,
  onRemove,
  passingId,
  isViewer,
}: {
  invites: Invitation[]
  responses: Map<string, HotelResponse>
  answers: Map<string, Answer[]>
  concessionItems: ConcessionItem[]
  scores: Map<string, ScoreResult>
  selectedId: string | null
  onSelect: (id: string) => void
  onPass: (inv: Invitation) => void
  onResetStatus: (inv: Invitation) => void
  onReopen: (inv: Invitation) => void
  reopeningId: string | null
  onRemove: (inv: Invitation) => void
  passingId: string | null
  isViewer?: boolean
}) {
  const [showScoreInfo, setShowScoreInfo] = useState(false)

  // Include 'passed' hotels so staff can undo them; sort: awarded first, then submitted, then passed
  const submitted = invites
    .filter((i) => ['submitted', 'awarded', 'passed'].includes(i.status))
    .sort((a, b) => {
      const rank = (s: string) => s === 'awarded' ? 0 : s === 'submitted' ? 1 : 2
      return rank(a.status) - rank(b.status)
    })
  if (submitted.length === 0) return null

  // Find concession item IDs for key columns
  const commissionItem  = findCommissionItem(concessionItems)
  const compSuitesItem  = findCompSuitesItem(concessionItems)
  const suiteUpgItem    = findSuiteUpgItem(concessionItems)

  const getAnswer = (invId: string, itemId: string | undefined) => {
    if (!itemId) return null
    return answers.get(invId)?.find((a) => a.concession_item_id === itemId) ?? null
  }

  // Trips with a second stay show both stays' rates side by side, not just Stay 1.
  const hasStay2 = submitted.some((inv) => responses.get(inv.id)?.stay2_king_rate != null)

  // no cascade — each hotel is passed individually

  return (
    <>
    {showScoreInfo && <ScoreInfoModal onClose={() => setShowScoreInfo(false)} />}
    <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Submitted RFPs — {submitted.length} hotel{submitted.length !== 1 ? 's' : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs font-semibold text-slate-400 dark:text-slate-500">
              <th className="pb-2 pr-6">Hotel</th>
              <th className="pb-2 pr-6 text-right whitespace-nowrap">{hasStay2 ? 'King Rate — Stay 1' : 'King Rate'}</th>
              {hasStay2 && <th className="pb-2 pr-6 text-right whitespace-nowrap">King Rate — Stay 2</th>}
              <th className="pb-2 pr-6 text-right whitespace-nowrap">Resort Fee</th>
              <th className="pb-2 pr-6 text-center whitespace-nowrap">Free Suites</th>
              <th className="pb-2 pr-6 text-center whitespace-nowrap">Suite Upgrades</th>
              <th className="pb-2 pr-6 text-right whitespace-nowrap">Commission</th>
              <th className="pb-2 pr-6 text-center whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Score
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowScoreInfo(true) }}
                    className="rounded-full w-4 h-4 text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-600 dark:hover:text-slate-300 transition-colors leading-none"
                    title="How scores are calculated"
                  >
                    i
                  </button>
                </span>
              </th>
              <th className="pb-2 text-right whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
            {submitted.map((inv) => {
                const resp       = responses.get(inv.id)
                const result     = scores.get(inv.id)
                const commAns    = getAnswer(inv.id, commissionItem?.id)
                const compSuites = getAnswer(inv.id, compSuitesItem?.id)
                const suiteUpg   = getAnswer(inv.id, suiteUpgItem?.id)
                const isSelected = inv.id === selectedId
                const isAwarded  = inv.status === 'awarded'
                const isPassed   = inv.status === 'passed'
                return (
                  <tr
                    key={inv.id}
                    onClick={() => onSelect(inv.id)}
                    className={`cursor-pointer transition-colors ${isPassed ? 'opacity-50' : ''} ${isSelected ? 'bg-[#1C1008]/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                  >
                    {/* Hotel name + issue flags */}
                    <td className="py-2.5 pr-6">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium ${isSelected ? 'text-[#1C1008] dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>
                          {isAwarded && '🏆 '}{isPassed && '✗ '}{inv.hotel_name}
                        </span>
                        {result?.noFlexCancel && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400">No flex cancel</span>
                        )}
                        {result?.noCommission && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-100 text-orange-600">No commission</span>
                        )}
                      </div>
                    </td>
                    {/* King rate — Stay 1 */}
                    <td className="py-2.5 pr-6 text-right font-medium text-slate-700 dark:text-slate-300">
                      {resp?.best_king_rate != null ? `$${resp.best_king_rate.toLocaleString()}` : '—'}
                    </td>
                    {/* King rate — Stay 2 */}
                    {hasStay2 && (
                      <td className="py-2.5 pr-6 text-right font-medium text-slate-700 dark:text-slate-300">
                        {resp?.stay2_king_rate != null ? `$${resp.stay2_king_rate.toLocaleString()}` : '—'}
                      </td>
                    )}
                    {/* Resort fee */}
                    <td className="py-2.5 pr-6 text-right text-slate-600 dark:text-slate-400">
                      {resp?.resort_fee || '—'}
                    </td>
                    {/* Free (comp) suites — quantity or Yes/No depending on template */}
                    <td className="py-2.5 pr-6 text-center">
                      {(() => { const v = suiteAnswerView(compSuites); return (
                        <span className={`font-semibold ${v.positive ? 'text-emerald-600' : 'text-slate-400 dark:text-slate-500'}`}>{v.display}</span>
                      )})()}
                    </td>
                    {/* Suite upgrades at king rate — quantity or Yes/No depending on template */}
                    <td className="py-2.5 pr-6 text-center">
                      {(() => { const v = suiteAnswerView(suiteUpg); return (
                        <span className={`font-semibold ${v.positive ? 'text-emerald-600' : 'text-slate-400 dark:text-slate-500'}`}>{v.display}</span>
                      )})()}
                    </td>
                    {/* Commission */}
                    <td className={`py-2.5 pr-6 text-right font-medium ${result?.noCommission ? 'text-orange-500' : 'text-slate-700 dark:text-slate-300'}`}>
                      {commAns?.answer_value || '—'}
                    </td>
                    {/* Score */}
                    <td className="py-2.5 pr-6 text-center">
                      {result ? <ScoreBadge score={result.score} /> : <span className="text-slate-300 dark:text-slate-600">—</span>}
                    </td>
                    {/* Pass / Undo + Remove — hidden for viewers */}
                    <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {!isViewer && (
                        <div className="flex items-center justify-end gap-2">
                          {isAwarded ? (
                            <>
                              <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">Awarded</span>
                              <button
                                onClick={() => onResetStatus(inv)}
                                className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 transition-colors"
                              >
                                ↩ Undo
                              </button>
                            </>
                          ) : isPassed ? (
                            <button
                              onClick={() => onResetStatus(inv)}
                              className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 transition-colors"
                            >
                              ↩ Undo
                            </button>
                          ) : (
                            <button
                              onClick={() => onPass(inv)}
                              disabled={passingId === inv.id}
                              title="Turn this hotel down. Their bid is kept and shows as 'Not available' on the exported grid. Use Undo to reverse."
                              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-40 transition-colors"
                            >
                              {passingId === inv.id ? '…' : 'Pass'}
                            </button>
                          )}
                          {/* Reopen for edits — lets the hotel revise a locked
                              submission (e.g. after a date change). Preserves answers. */}
                          {(inv.status === 'submitted' || inv.status === 'awarded') && (
                            <button
                              onClick={() => onReopen(inv)}
                              disabled={reopeningId === inv.id}
                              title="Reopen so the hotel can revise their proposal (their answers are kept)"
                              className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-400 disabled:opacity-40 transition-colors"
                            >
                              {reopeningId === inv.id ? '…' : '↺ Reopen'}
                            </button>
                          )}
                          {/* Remove hotel from RFP entirely */}
                          <button
                            onClick={() => onRemove(inv)}
                            className="rounded p-1 text-slate-300 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            title="Remove from RFP"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      )}
                      {isViewer && isAwarded && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">Awarded</span>
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
}

// ── Hotel bid panel ───────────────────────────────────────────────────────────

function HotelPanel({
  inv,
  trip,
  concessionItems,
  preloadedAnswers,
  score,
  onSendEmail,
  onSendReminder,
  onPass,
  onResetStatus,
  onReopen,
  reopeningId,
  onCopyLink,
  onContactUpdated,
  sendingEmail,
  sendingReminder,
  reminderFlash,
  emailFlash,
  copied,
}: {
  inv: Invitation
  trip: Trip
  concessionItems: ConcessionItem[]
  preloadedAnswers: Answer[] | undefined
  score: number | undefined
  onSendEmail: (inv: Invitation) => void
  onSendReminder: (inv: Invitation) => void
  onPass: (inv: Invitation) => void
  onResetStatus: (inv: Invitation) => void
  onReopen: (inv: Invitation) => void
  reopeningId: string | null
  onCopyLink: (token: string) => void
  onContactUpdated: (id: string, name: string | null, email: string | null) => void
  sendingEmail: string | null
  sendingReminder: string | null
  reminderFlash: string | null
  emailFlash: string | null
  copied: string | null
}) {
  const [response, setResponse] = useState<HotelResponse | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [loadingBid, setLoadingBid] = useState(false)

  // Inline contact editing
  const [editingContact, setEditingContact] = useState(false)
  const [editName, setEditName] = useState(inv.hotel_contact_name ?? '')
  const [editEmail, setEditEmail] = useState(inv.hotel_contact_email ?? '')
  const [savingContact, setSavingContact] = useState(false)

  useEffect(() => {
    setEditName(inv.hotel_contact_name ?? '')
    setEditEmail(inv.hotel_contact_email ?? '')
    setEditingContact(false)
  }, [inv.id, inv.hotel_contact_name, inv.hotel_contact_email])

  const saveContact = async () => {
    setSavingContact(true)
    const newName = editName.trim() || null
    const newEmail = editEmail.trim() || null
    await supabase.from('rfp_invitations').update({
      hotel_contact_name: newName,
      hotel_contact_email: newEmail,
    }).eq('id', inv.id)
    setSavingContact(false)
    setEditingContact(false)
    // Update parent state in-place — no page reload needed
    onContactUpdated(inv.id, newName, newEmail)
  }

  useEffect(() => {
    if (!['submitted', 'awarded'].includes(inv.status)) { setResponse(null); setAnswers([]); return }
    setLoadingBid(true)
    supabase.from('rfp_responses').select('*').eq('invitation_id', inv.id).single()
      .then(async ({ data: respData }) => {
        setResponse(respData as HotelResponse ?? null)
        if (respData?.id) {
          const { data: ansData } = await supabase
            .from('concession_answers')
            .select('concession_item_id, answer_yes_no, answer_value, comment')
            .eq('response_id', respData.id)
          setAnswers((ansData as Answer[]) ?? [])
        } else {
          setAnswers([])
        }
        setLoadingBid(false)
      })
  }, [inv.id, inv.status])

  const hasStay2 = Boolean(trip.stay2_arrival_date)
  const isSubmitted = ['submitted', 'awarded'].includes(inv.status)
  const isPassed = inv.status === 'passed'
  const isUnavailable = inv.status === 'unavailable'

  const answerMap = new Map(answers.map((a) => [a.concession_item_id, a]))

  // Group concessions by section
  const sections = ['concessions', 'facilities', 'in_season_tournament', 'postseason']
  const sectionLabels: Record<string, string> = {
    concessions: 'Concessions',
    facilities: 'Facilities',
    in_season_tournament: 'In-Season Tournament',
    postseason: 'Postseason',
  }

  const fmt = (d: string | null) => d ? formatDate(d) : '—'
  const fmtRate = (n: number | null) => n != null ? `$${n.toLocaleString()}` : '—'

  return (
    <div className="flex flex-col">
      {/* Hotel header */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{inv.hotel_name}</h2>
            {editingContact ? (
              <div className="mt-1.5 flex flex-col gap-1.5">
                <input
                  className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
                  placeholder="Contact name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <input
                  type="email"
                  className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
                  placeholder="Contact email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
                <div className="flex gap-2">
                  <button onClick={saveContact} disabled={savingContact}
                    className="rounded bg-[#1C1008] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50">
                    {savingContact ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingContact(false)}
                    className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-0.5 flex items-center gap-2">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {[inv.hotel_contact_name, inv.hotel_contact_email].filter(Boolean).join(' · ') || <span className="italic text-slate-400 dark:text-slate-500">No contact info</span>}
                </p>
                <button onClick={() => setEditingContact(true)}
                  className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 transition-colors"
                  title="Edit contact">
                  ✎
                </button>
              </div>
            )}
            {inv.sent_at && (
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Emailed {formatDate(inv.sent_at)}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!inv.sent_at && (inv.status === 'sent' || inv.status === 'opened') ? (
              <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                Draft — not sent
              </span>
            ) : (
              <Badge status={inv.status} label={inv.status === 'passed' ? passedLabel(inv.submitted_at) : undefined} />
            )}
            {/* Reopened-for-revision indicator. The bid keeps its submitted status
                (so it stays on the grid); it's "awaiting a revised bid" while
                reopened_at is newer than the last submitted_at. */}
            {inv.reopened_at && (!inv.submitted_at || new Date(inv.reopened_at).getTime() > new Date(inv.submitted_at).getTime()) && (
              <span className="inline-flex rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                ↺ Reopened — awaiting revised bid
              </span>
            )}
            {/* Reopen a submitted/awarded proposal so the hotel can revise it */}
            {(inv.status === 'submitted' || inv.status === 'awarded') && (
              <button
                onClick={() => onReopen(inv)}
                disabled={reopeningId === inv.id}
                title="Reopen so the hotel can revise their proposal (their answers are kept)"
                className="rounded-lg border border-amber-200 dark:border-amber-700 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40 transition-colors"
              >
                {reopeningId === inv.id ? 'Reopening…' : '↺ Reopen for edits'}
              </button>
            )}
            {/* Undo awarded / passed / unavailable */}
            {(inv.status === 'awarded' || inv.status === 'passed' || inv.status === 'unavailable') && (
              <button
                onClick={() => onResetStatus(inv)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title={`Reset to Submitted`}
              >
                ↩ Undo {inv.status === 'awarded' ? 'award' : inv.status === 'passed' ? 'pass' : 'unavailable'}
              </button>
            )}
            <button
              onClick={() => onCopyLink(inv.token)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              {copied === inv.token ? '✓ Copied' : 'Copy link'}
            </button>
            {canEmailStatus(inv.status) && (
              <button
                onClick={() => onSendEmail(inv)}
                disabled={!inv.hotel_contact_email || sendingEmail === inv.id}
                title={!inv.hotel_contact_email ? 'No email address on file' : undefined}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {sendingEmail === inv.id ? 'Sending…' : emailFlash === inv.id ? '✓ Sent!' : inv.sent_at ? 'Resend email' : 'Send email'}
              </button>
            )}
            {inv.sent_at && (inv.status === 'sent' || inv.status === 'opened') && (
              <button
                onClick={() => onSendReminder(inv)}
                disabled={!inv.hotel_contact_email || sendingReminder === inv.id}
                title={!inv.hotel_contact_email ? 'No email address on file' : 'Send a short follow-up nudge (not the full proposal)'}
                className="rounded-lg border border-amber-200 dark:border-amber-700 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40 transition-colors"
              >
                {sendingReminder === inv.id ? 'Sending…' : reminderFlash === inv.id ? '✓ Reminder sent!' : 'Send reminder'}
              </button>
            )}
            {/* Pass — turn a hotel down even before they've submitted (e.g. they
                emailed that the dates don't work, no RFP needed). Same red action
                as on submitted bids; shows as "Not available" on the exported grid. */}
            {['sent', 'opened'].includes(inv.status) && (
              <button
                onClick={() => onPass(inv)}
                title="Turn this hotel down — e.g. they replied the dates don't work, no bid needed. Shows as 'Not available' on the exported grid. Use Undo to reverse."
                className="rounded-lg border border-red-200 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Pass
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1">
        {isUnavailable && (
          <div className="m-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            This hotel marked as unavailable for these dates.
          </div>
        )}

        {isPassed && (
          <div className="m-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {inv.submitted_at
              ? 'Passed on this hotel.'
              : 'Passed - Not Available. This hotel did not submit a bid (unavailable for the proposed dates).'}
          </div>
        )}

        {!isSubmitted && !isPassed && !isUnavailable && (
          inv.sent_at ? (
            <div className="m-6 rounded-xl border border-amber-100 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 text-center">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Awaiting response</p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Invited {formatDate(inv.sent_at)}</p>
            </div>
          ) : (
            <div className="m-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 p-6 text-center">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Not sent yet</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Email not sent yet</p>
            </div>
          )
        )}

        {isSubmitted && loadingBid && (
          <div className="flex items-center justify-center p-12"><Loading /></div>
        )}

        {isSubmitted && !loadingBid && response && (
          <div className="space-y-0 divide-y divide-slate-100 dark:divide-slate-700">
            {/* Quick stats — top 5 items that matter most */}
            {(() => {
              const ansMap = new Map((preloadedAnswers ?? answers).map((a) => [a.concession_item_id, a]))
              const flexItem    = findFlexCancelItem(concessionItems)
              const commItem    = findCommissionItem(concessionItems)
              const compSuiteI  = findCompSuitesItem(concessionItems)
              const suiteUpgI   = findSuiteUpgItem(concessionItems)
              const postItem    = findPostseasonItem(concessionItems)

              const flexAns    = flexItem   ? ansMap.get(flexItem.id)   : null
              const commAns    = commItem   ? ansMap.get(commItem.id)   : null
              const compAns    = compSuiteI ? ansMap.get(compSuiteI.id) : null
              const upgAns     = suiteUpgI  ? ansMap.get(suiteUpgI.id)  : null
              const postAns    = postItem   ? ansMap.get(postItem.id)   : null

              const noFlex = flexAns?.answer_yes_no === false
              const noComm = commAns?.answer_value != null && (commAns.answer_value.trim() === '0' || commAns.answer_value.trim() === '0%')

              type Chip = { label: string; value: string; ok?: boolean | null; warn?: boolean }
              const chips: Chip[] = []
              if (flexAns)  chips.push({ label: 'Flex cancel',      value: flexAns.answer_yes_no  === true ? '✓ Yes' : '✗ No',  ok: flexAns.answer_yes_no,  warn: noFlex })
              if (commAns)  chips.push({ label: 'Commission',        value: commAns.answer_value ?? '—',                          warn: noComm })
              if (compAns)  { const v = suiteAnswerView(compAns); chips.push({ label: 'Free suites',    value: v.display, ok: v.positive }) }
              if (upgAns)   { const v = suiteAnswerView(upgAns);  chips.push({ label: 'Suite upgrades', value: v.display, ok: v.positive }) }
              if (postAns)  chips.push({ label: 'Playoff clause',    value: postAns.answer_yes_no === true ? '✓ Yes' : '✗ No',  ok: postAns.answer_yes_no })
              if (score != null) chips.push({ label: 'Score', value: String(score) })

              if (chips.length === 0) return null
              return (
                <div className="flex flex-wrap gap-2 px-6 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                  {chips.map((chip) => (
                    <span key={chip.label} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      chip.label === 'Score'
                        ? (score! >= 80 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : score! >= 60 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400')
                        : chip.warn
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                          : chip.ok === true  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                          : chip.ok === false ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                      <span className="opacity-60">{chip.label}:</span> {chip.value}
                    </span>
                  ))}
                </div>
              )
            })()}

            {/* Rates */}
            <div className="px-6 py-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {hasStay2 ? 'Stay 1 Rates' : 'Rates'}
                {hasStay2 && trip.arrival_date && (
                  <span className="ml-2 font-normal normal-case text-slate-300 dark:text-slate-600">
                    {fmt(trip.arrival_date)} – {fmt(trip.departure_date)}
                  </span>
                )}
                {inv.visit1_declined && (
                  <span className="ml-2 rounded-full bg-red-50 dark:bg-red-900/20 px-2 py-0.5 text-[10px] font-semibold normal-case text-red-600 dark:text-red-400">
                    Declined
                  </span>
                )}
              </h3>
              {inv.visit1_declined ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {inv.visit1_decline_reason ? `Declined: ${inv.visit1_decline_reason.replace(/_/g, ' ')}` : 'Declined by hotel'}
                  {inv.visit1_decline_notes && ` — ${inv.visit1_decline_notes}`}
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    <RateField label="King rate" value={fmtRate(response.best_king_rate)} />
                    <RateField label="Suite rate" value={fmtRate(response.best_suite_rate)} />
                    <RateField label="Selling rate" value={response.current_selling_rate || '—'} />
                    <RateField label="Occupancy tax" value={response.occupancy_tax || '—'} />
                    {trip.king_rooms_requested && response.best_king_rate && trip.nights && (
                      <RateField
                        label="Est. total cost"
                        value={`$${(response.best_king_rate * trip.total_rooms_requested! * trip.nights).toLocaleString()}`}
                        highlight
                      />
                    )}
                  </dl>
                  {response.king_rate_notes && (
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400"><span className="font-medium">Rate notes:</span> {response.king_rate_notes}</p>
                  )}
                </>
              )}
            </div>

            {/* Stay 2 rates — always shown on a two-stay trip so a missing stay
                is visible (and flagged) rather than silently absent. */}
            {hasStay2 && (() => {
              const stay2Num = Number(response.stay2_king_rate)
              const stay2Provided = Number.isFinite(stay2Num) && stay2Num > 0
              return (
                <div className="px-6 py-5">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Stay 2 Rates
                    {trip.stay2_arrival_date && (
                      <span className="ml-2 font-normal normal-case text-slate-300 dark:text-slate-600">
                        {fmt(trip.stay2_arrival_date)} – {fmt(trip.stay2_departure_date)}
                      </span>
                    )}
                    {inv.visit2_declined ? (
                      <span className="ml-2 rounded-full bg-red-50 dark:bg-red-900/20 px-2 py-0.5 text-[10px] font-semibold normal-case text-red-600 dark:text-red-400">
                        Declined
                      </span>
                    ) : !stay2Provided && (
                      <span className="ml-2 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-[10px] font-semibold normal-case text-amber-600 dark:text-amber-400">
                        Not provided
                      </span>
                    )}
                  </h3>
                  {inv.visit2_declined ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {inv.visit2_decline_reason ? `Declined: ${inv.visit2_decline_reason.replace(/_/g, ' ')}` : 'Declined by hotel'}
                      {inv.visit2_decline_notes && ` — ${inv.visit2_decline_notes}`}
                    </p>
                  ) : !stay2Provided ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      This hotel did not provide a Stay 2 rate, so it scores 0 for Stay 2.
                    </p>
                  ) : (
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                      <RateField label="King rate" value={fmtRate(response.stay2_king_rate)} />
                      <RateField label="Suite rate" value={fmtRate(response.stay2_suite_rate)} />
                      <RateField label="Selling rate" value={response.stay2_selling_rate || '—'} />
                    </dl>
                  )}
                </div>
              )
            })()}

            {/* Date scenario availability */}
            {trip.date_scenarios?.length > 0 && response.scenario_availability && (
              <div className="px-6 py-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Date Scenario Availability
                </h3>
                <div className="flex flex-wrap gap-2">
                  {trip.date_scenarios.map((s) => {
                    const avail = response.scenario_availability![s.label] ?? true
                    return (
                      <span
                        key={s.label}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                          avail
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        <span>{avail ? '✓' : '✗'}</span>
                        <span>Scenario {s.label}</span>
                        <span className="text-[10px] opacity-70">
                          {fmt(s.arrival_date)} – {fmt(s.departure_date)}
                        </span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Meeting space & comments */}
            {(response.meeting_space_notes || response.general_comments) && (
              <div className="px-6 py-5 space-y-3">
                {response.meeting_space_notes && (
                  <p className="whitespace-pre-line text-xs text-slate-500 dark:text-slate-400"><span className="font-medium text-slate-600 dark:text-slate-300">Meeting space:</span> {formatMeetingSpaceNotes(response.meeting_space_notes)}</p>
                )}
                {response.general_comments && (
                  <p className="text-xs text-slate-500 dark:text-slate-400"><span className="font-medium text-slate-600 dark:text-slate-300">General comments:</span> {response.general_comments}</p>
                )}
              </div>
            )}

            {/* Menu / F&B pricing attachments uploaded by the hotel */}
            {Array.isArray(response.menu_attachments) && response.menu_attachments.length > 0 && (
              <div className="px-6 py-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Menus &amp; F&amp;B Pricing</h3>
                <div className="space-y-2">
                  {response.menu_attachments.map((m) => (
                    <button
                      key={m.path}
                      onClick={() => openMenuAttachment(m.path)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <span className="shrink-0">📎</span>
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="shrink-0 text-xs text-[#1C1008] dark:text-amber-400">Open ↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Download single-hotel bid */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700">
              <button
                onClick={() => {
                  const answerRecord: Record<string, { answer_yes_no: boolean | null; answer_value: string | null; comment: string | null }> = {}
                  for (const a of [...answers]) {
                    answerRecord[a.concession_item_id] = { answer_yes_no: a.answer_yes_no, answer_value: a.answer_value, comment: a.comment }
                  }
                  exportSingleHotelXlsx(
                    {
                      hotel_name: inv.hotel_name,
                      status: inv.status,
                      completed_by_name: response.completed_by_name ?? null,
                      completed_date: response.completed_date ?? null,
                      best_king_rate: response.best_king_rate,
                      king_rate_notes: response.king_rate_notes,
                      current_selling_rate: response.current_selling_rate,
                      best_suite_rate: response.best_suite_rate,
                      occupancy_tax: response.occupancy_tax,
                      meeting_space_notes: response.meeting_space_notes,
                      general_comments: response.general_comments,
                      staff_notes: inv.staff_notes ?? null,
                      answers: answerRecord,
                    },
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
                    concessionItems as any,
                  )
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-center"
              >
                ↓ Download bid (.xlsx)
              </button>
              <a
                href={`/trips/${trip.id}/proposal?hotel=${inv.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block w-full rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-center"
              >
                🖨️ Print full proposal (PDF)
              </a>
            </div>

            {/* Concessions */}
            {sections.map((section) => {
              const items = concessionItems.filter((c) => c.section === section)
              if (items.length === 0) return null
              const answeredItems = items.filter((c) => answerMap.has(c.id))
              if (answeredItems.length === 0) return null
              return (
                <div key={section} className="px-6 py-5">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{sectionLabels[section]}</h3>
                  <div className="space-y-2">
                    {answeredItems.map((item) => {
                      const ans = answerMap.get(item.id)!
                      const isYes = ans.answer_yes_no === true
                      return (
                        <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                          <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
                          <div className="text-right shrink-0">
                            {/* Show what the hotel actually answered: a Yes/No if they gave one
                                (covers legacy answers on items later switched to quantity), else
                                the entered number. Keeps this panel in sync with the summary. */}
                            {ans.answer_yes_no != null ? (
                              <span className={`font-medium ${isYes ? 'text-emerald-600' : 'text-red-500'}`}>
                                {isYes ? '✓ Yes' : '✗ No'}
                              </span>
                            ) : (
                              <span className="font-medium text-slate-700 dark:text-slate-300">{ans.answer_value || '—'}</span>
                            )}
                            {ans.comment && (
                              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 italic">"{ans.comment}"</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function RateField({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${highlight ? 'text-[#1C1008] dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</dd>
    </div>
  )
}

// ── Trip info panel (right panel when no hotel selected) ──────────────────────

function TripInfoPanel({ trip }: { trip: Trip & { clients: Pick<Client, 'id' | 'team_name' | 'league'> | null } }) {
  const fmt = (d: string | null) => formatDate(d) || '—'
  // Format a list of game dates, falling back to the single game_date column.
  const fmtGames = (dates: string[] | null | undefined, single: string | null) => {
    const list = dates && dates.length ? dates : single ? [single] : []
    return list.length ? list.map((d) => formatDate(d)).join(', ') : '—'
  }
  const hasStay2 = Boolean(trip.stay2_arrival_date)
  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Trip details</h3>
        <dl className="space-y-3">
          <InfoRow label="Client" value={trip.clients?.team_name} />
          <InfoRow label="City" value={trip.city} />
          <InfoRow label={hasStay2 ? 'Stay 1 arrival' : 'Arrival'} value={fmt(trip.arrival_date)} />
          <InfoRow label={hasStay2 ? 'Stay 1 departure' : 'Departure'} value={fmt(trip.departure_date)} />
          {trip.nights != null && <InfoRow label="Nights" value={String(trip.nights)} />}
          <InfoRow label="Game date(s)" value={fmtGames((trip as any).game_dates, trip.game_date)} />
          {trip.game_time && <InfoRow label="Game time" value={trip.game_time} />}
          <InfoRow label="Response deadline" value={fmt(trip.response_deadline)} />
        </dl>
      </div>
      {hasStay2 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Stay 2</h3>
          <dl className="space-y-3">
            <InfoRow label="Arrival" value={fmt(trip.stay2_arrival_date)} />
            <InfoRow label="Departure" value={fmt(trip.stay2_departure_date)} />
            {(((trip as any).stay2_game_dates as string[] | null)?.length || trip.stay2_game_date) && (
              <InfoRow label="Game date(s)" value={fmtGames((trip as any).stay2_game_dates, trip.stay2_game_date)} />
            )}
            {trip.stay2_game_time && <InfoRow label="Game time" value={trip.stay2_game_time} />}
          </dl>
        </div>
      )}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Rooms requested</h3>
        <dl className="space-y-3">
          <InfoRow label="King rooms" value={trip.king_rooms_requested != null ? String(trip.king_rooms_requested) : null} />
          <InfoRow label="Double rooms" value={(trip as any).double_rooms_requested != null ? String((trip as any).double_rooms_requested) : null} />
          <InfoRow label="Suites" value={trip.suites_requested != null ? String(trip.suites_requested) : null} />
          <InfoRow label="Total rooms" value={trip.total_rooms_requested != null ? String(trip.total_rooms_requested) : null} />
        </dl>
      </div>
      {(trip.in_season_tournament_window || trip.postseason_window) && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Special windows</h3>
          <dl className="space-y-3">
            {trip.in_season_tournament_window && <InfoRow label="In-season tournament" value={trip.in_season_tournament_window} />}
            {trip.postseason_window && <InfoRow label="Postseason" value={trip.postseason_window} />}
          </dl>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{label}</dt>
      <dd className="text-sm text-slate-700 dark:text-slate-300 text-right">{value || '—'}</dd>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { role, canEditClient } = useRole()
  const isViewer = role === 'viewer'
  const [trip, setTrip] = useState<(Trip & { clients: Pick<Client, 'id' | 'team_name' | 'league'> | null }) | null>(null)
  // Sibling trips for this client (for the Next/Prev city shortcut), alpha by city.
  const [siblings, setSiblings] = useState<{ id: string; city: string | null }[]>([])
  const [invites, setInvites] = useState<Invitation[] | null>(null)
  const [concessionItems, setConcessionItems] = useState<ConcessionItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [showTripInfo, setShowTripInfo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)
  const [sendingReminder, setSendingReminder] = useState<string | null>(null)
  const [reminderFlash, setReminderFlash] = useState<string | null>(null)
  const [emailFlash, setEmailFlash] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [sendingReminders, setSendingReminders] = useState(false)
  const [reminderResult, setReminderResult] = useState<{ sent: number; skipped: number } | null>(null)
  // Bulk-select + bulk-send hotels
  const [selectedInviteIds, setSelectedInviteIds] = useState<Set<string>>(new Set())
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkSendResult, setBulkSendResult] = useState<{ hotelName: string; email: string | null; ok: boolean; error?: string }[] | null>(null)
  // Bulk responses + answers for the summary table and scoring
  const [allResponses, setAllResponses] = useState<Map<string, HotelResponse>>(new Map())
  const [allAnswers, setAllAnswers] = useState<Map<string, Answer[]>>(new Map())
  const [scores, setScores] = useState<Map<string, ScoreResult>>(new Map())
  const [awardingId, setAwardingId] = useState<string | null>(null)
  const [versions, setVersions] = useState<{id: string; version_label: string; created_at: string}[]>([])
  const [viewingVersion, setViewingVersion] = useState<{label: string; snapshot: any} | null>(null)
  const [savingVersion, setSavingVersion] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [proposalSentMarked, setProposalSentMarked] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [sendingDeclines, setSendingDeclines] = useState(false)
  const [declineToast, setDeclineToast] = useState<string | null>(null)
  const [confirmingScenario, setConfirmingScenario] = useState(false)
  const [confirmingScenarioSaving, setConfirmingScenarioSaving] = useState(false)
  // F&B forecast plan for this trip: { concession_item_id: person_meals }
  const [fnbPlan, setFnbPlan] = useState<Record<string, number>>({})
  const [fnbOpen, setFnbOpen] = useState(false)
  const [fnbSaving, setFnbSaving] = useState(false)

  const loadInvites = () => {
    supabase.from('rfp_invitations').select('*').eq('trip_id', id).order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setInvites(data as Invitation[])
      })
  }

  // Save the F&B plan (person-meals per meal-price item) to the trip. Zero/blank
  // entries are dropped so only real meal inputs drive the forecast.
  const saveFnbPlan = async (next: Record<string, number>) => {
    setFnbPlan(next)
    setFnbSaving(true)
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(next)) if (Number(v) > 0) clean[k] = Number(v)
    await supabase.from('trips').update({ fnb_plan: clean }).eq('id', id!)
    setFnbSaving(false)
  }

  useEffect(() => {
    supabase.from('trips').select('*, clients(id, team_name, league)').eq('id', id!).single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else {
          setTrip(data as Trip & { clients: Pick<Client, 'id' | 'team_name' | 'league'> | null })
          const plan = (data as any)?.fnb_plan
          if (plan && typeof plan === 'object') setFnbPlan(plan as Record<string, number>)
        }
      })
    loadInvites()
    supabase.from('grid_versions').select('id, version_label, created_at').eq('trip_id', id).order('created_at', { ascending: false })
      .then(({ data }) => { setVersions((data as any[]) ?? []) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Load concession items scoped to this trip's client (+ shared master items).
  // Each client now has its own template — an unscoped query would mix in every
  // other client's items and break label-based lookups (score, summary columns).
  useEffect(() => {
    if (!trip) return
    supabase
      .from('concession_items')
      .select('id, sort_order, section, label, answer_type, requested_value')
      .or(`client_id.is.null,client_id.eq.${trip.client_id}`)
      .eq('archived', false)
      .order('sort_order')
      .then(({ data }) => { if (data) setConcessionItems(data as ConcessionItem[]) })
  }, [trip?.client_id])

  // Sibling trips for the Next/Prev city shortcut — same client, alpha by city
  // (matches the trips list ordering) so a user can move city to city without
  // going back to the clients overview.
  useEffect(() => {
    if (!trip?.client_id) return
    supabase
      .from('trips')
      .select('id, city')
      .eq('client_id', trip.client_id)
      .order('city', { ascending: true, nullsFirst: false })
      .then(({ data }) => setSiblings((data ?? []) as { id: string; city: string | null }[]))
  }, [trip?.client_id])

  // Auto-select first submitted hotel when invites load
  useEffect(() => {
    if (!invites || selectedId) return
    const first = invites.find((i) => ['submitted', 'awarded'].includes(i.status)) ?? invites[0]
    if (first) setSelectedId(first.id)
  }, [invites, selectedId])

  // Bulk-fetch responses + answers for all submitted hotels (for summary table + scoring)
  useEffect(() => {
    if (!invites || concessionItems.length === 0) return
    const submitted = invites.filter((i) => ['submitted', 'awarded'].includes(i.status))
    if (submitted.length === 0) return
    const invIds = submitted.map((i) => i.id)

    supabase.from('rfp_responses').select('*').in('invitation_id', invIds)
      .then(async ({ data: respData }) => {
        const respMap = new Map<string, HotelResponse>()
        ;(respData ?? []).forEach((r: any) => respMap.set(r.invitation_id, r))

        // concession_answers links via response_id, not invitation_id — build the mapping
        const responseIds = (respData ?? []).map((r: any) => r.id as string)
        const respIdToInvId = new Map<string, string>(
          (respData ?? []).map((r: any) => [r.id as string, r.invitation_id as string])
        )

        const ansMap = new Map<string, Answer[]>()
        if (responseIds.length > 0) {
          const { data: ansData } = await supabase
            .from('concession_answers')
            .select('response_id, concession_item_id, answer_yes_no, answer_value, comment')
            .in('response_id', responseIds)
          ;(ansData ?? []).forEach((a: any) => {
            const invId = respIdToInvId.get(a.response_id)
            if (!invId) return
            if (!ansMap.has(invId)) ansMap.set(invId, [])
            ansMap.get(invId)!.push(a)
          })
        }

        setAllResponses(respMap)
        setAllAnswers(ansMap)
        setScores(calcScores(submitted, respMap, ansMap, concessionItems, Boolean(trip?.stay2_arrival_date)))
      })
  }, [invites, concessionItems, trip?.stay2_arrival_date])

  const selectedInvite = invites?.find((i) => i.id === selectedId) ?? null

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${PUBLIC_APP_URL}/rfp/${token}`)
      setCopied(token)
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500)
    } catch { setError('Could not copy link.') }
  }

  const sendEmail = async (inv: Invitation) => {
    if (!inv.hotel_contact_email) return
    setSendingEmail(inv.id); setError(null)
    const result = await sendInvitationEmail(inv.id)
    setSendingEmail(null)
    if ('error' in result) { setError(result.error) }
    else { setEmailFlash(inv.id); setTimeout(() => setEmailFlash((f) => (f === inv.id ? null : f)), 2000); loadInvites() }
  }

  const toggleInviteSelected = (inviteId: string) => {
    const inv = invites?.find((i) => i.id === inviteId)
    if (inv && !canEmailStatus(inv.status)) return // completed proposals aren't emailable
    setSelectedInviteIds((prev) => {
      const next = new Set(prev)
      if (next.has(inviteId)) next.delete(inviteId)
      else next.add(inviteId)
      return next
    })
  }

  const selectAllNotSent = () => {
    if (!invites) return
    const ids = invites.filter((i) => !i.sent_at && i.hotel_contact_email).map((i) => i.id)
    setSelectedInviteIds(new Set(ids))
  }

  const sendBulkInvites = async () => {
    if (!invites || selectedInviteIds.size === 0) return
    // Never email a hotel whose proposal is already complete, even if it somehow got selected.
    const targets = invites.filter((i) => selectedInviteIds.has(i.id) && canEmailStatus(i.status))
    setBulkSending(true); setError(null)

    const results = await Promise.all(
      targets.map(async (inv) => {
        if (!inv.hotel_contact_email) {
          return { hotelName: inv.hotel_name, email: null, ok: false, error: 'No email address on file' }
        }
        const result = await sendInvitationEmail(inv.id)
        if ('error' in result) {
          return { hotelName: inv.hotel_name, email: inv.hotel_contact_email, ok: false, error: result.error }
        }
        return { hotelName: inv.hotel_name, email: inv.hotel_contact_email, ok: true }
      }),
    )

    setBulkSending(false)
    setBulkSendResult(results)
    setSelectedInviteIds(new Set())
    loadInvites()
  }

  const sendReminder = async (inv: Invitation) => {
    if (!inv.hotel_contact_email) return
    setSendingReminder(inv.id); setError(null)
    const result = await sendSingleReminderEmail(inv.id)
    setSendingReminder(null)
    if ('error' in result) { setError(result.error) }
    else {
      setReminderFlash(inv.id); setTimeout(() => setReminderFlash((f) => (f === inv.id ? null : f)), 2500)
      void logActivity({ event_type: 'reminder_sent', client_id: trip?.client_id ?? null, trip_id: id ?? null, detail: { hotel_name: inv.hotel_name } })
    }
  }

  // Pass a single hotel — KJST knocks it off the list. Does NOT affect other hotels.
  const passHotel = async (inv: Invitation) => {
    setAwardingId(inv.id)
    await supabase.from('rfp_invitations').update({ status: 'passed' }).eq('id', inv.id)
    setAwardingId(null)
    loadInvites()
  }

  // Re-invite a hotel that was "Passed - Not Available" (never bid) — e.g. once the
  // dates are updated. Puts them back to 'sent' and resends the RFP invitation.
  const reInvitePassed = async (inv: Invitation) => {
    setAwardingId(inv.id)
    await supabase.from('rfp_invitations').update({ status: 'sent' }).eq('id', inv.id)
    await loadInvites()
    setAwardingId(null)
    await sendEmail({ ...inv, status: 'sent' })
  }

  // Undo a pass / unavailable / award for a single hotel. Reset to 'submitted'
  // only if they actually bid; a hotel passed before bidding goes back to 'sent'
  // (never falsely shows as having submitted a bid). Does NOT touch other hotels.
  const resetHotelStatus = async (inv: Invitation) => {
    const backTo = inv.submitted_at ? 'submitted' : 'sent'
    await supabase.from('rfp_invitations').update({ status: backTo }).eq('id', inv.id)
    loadInvites()
  }

  // Reopen a submitted hotel's proposal so they can revise it (e.g. dates changed).
  // Their saved answers are preserved — they edit and resubmit, they don't refill.
  // Clicking Reopen opens a small dialog with an explicit email / no-email choice.
  const [reopeningId, setReopeningId] = useState<string | null>(null)
  const [reopenTarget, setReopenTarget] = useState<Invitation | null>(null)
  const [reopenMessage, setReopenMessage] = useState('')
  const confirmReopen = async (inv: Invitation, notify: boolean) => {
    const message = reopenMessage.trim()
    setReopenTarget(null)
    setReopenMessage('')
    setReopeningId(inv.id)
    const res = await reopenRfp(inv.id, { notify, message: message || undefined })
    setReopeningId(null)
    if ('error' in res) {
      alert(`Could not reopen: ${res.error}`)
      return
    }
    if (res.warning) alert(res.warning)
    else if (notify && res.emailed) alert(`Reopened. Email sent to ${res.sent_to}.`)
    else if (notify && !res.emailed) alert('Reopened, but the email could not be sent.')
    loadInvites()
  }

  // Remove a hotel from this RFP entirely (sidebar — receives MouseEvent to stop propagation)
  const removeInvite = async (inv: Invitation, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Remove "${inv.hotel_name}" from this RFP?\n\nThis deletes their invitation and any submitted bid. This cannot be undone.`)) return
    await supabase.from('rfp_invitations').delete().eq('id', inv.id)
    if (selectedId === inv.id) setSelectedId(null)
    loadInvites()
  }

  // Remove a hotel from this RFP entirely (table row — no MouseEvent needed, stopPropagation handled by td)
  const removeInviteFromTable = async (inv: Invitation) => {
    if (!confirm(`Remove "${inv.hotel_name}" from this RFP?\n\nThis deletes their invitation and any submitted bid. This cannot be undone.`)) return
    await supabase.from('rfp_invitations').delete().eq('id', inv.id)
    if (selectedId === inv.id) setSelectedId(null)
    loadInvites()
  }

  // Close export dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const doSendReminders = async () => {
    if (!id) return
    setSendingReminders(true); setReminderResult(null); setError(null)
    const result = await sendReminderEmails(id)
    setSendingReminders(false)
    if ('error' in result) setError(result.error)
    else {
      setReminderResult(result)
      if (result.sent > 0) {
        void logActivity({ event_type: 'reminder_sent', client_id: trip?.client_id ?? null, trip_id: id, detail: { count: result.sent } })
      }
    }
  }

  const sendDeclines = async () => {
    if (!invites) return
    const passed = invites.filter((i) => i.status === 'passed')
    if (passed.length === 0) return
    setSendingDeclines(true)
    setShowDeclineModal(false)
    await Promise.allSettled(
      passed.map((inv) =>
        supabase.functions.invoke('send-decline-email', { body: { invitation_id: inv.id } })
      )
    )
    setSendingDeclines(false)
    setDeclineToast(`Decline emails sent to ${passed.length} hotel${passed.length !== 1 ? 's' : ''}`)
    setTimeout(() => setDeclineToast(null), 4000)
  }

  const confirmScenario = async (scenario: DateScenario) => {
    setConfirmingScenarioSaving(true)
    await supabase.from('trips').update({
      arrival_date: scenario.arrival_date,
      departure_date: scenario.departure_date,
      game_date: scenario.game_date ?? null,
      date_scenarios: [],
    }).eq('id', id!)
    const { data } = await supabase.from('trips').select('*, clients(id, team_name, league)').eq('id', id!).single()
    if (data) setTrip(data as Trip & { clients: Pick<Client, 'id' | 'team_name' | 'league'> | null })
    setConfirmingScenarioSaving(false)
    setConfirmingScenario(false)
  }

  const removeTrip = async () => {
    if (!confirm('Delete this trip and all its invitations? This cannot be undone.')) return
    setDeleting(true)
    const { error } = await supabase.from('trips').delete().eq('id', id!)
    if (error) { setError(error.message); setDeleting(false) }
    else navigate('/trips')
  }

  const saveVersion = async () => {
    const label = window.prompt('Version label:', `Updated ${new Date().toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})}`)
    if (!label) return
    setSavingVersion(true)
    const snapshot = {
      version: 1,
      saved_at: new Date().toISOString(),
      hotels: (invites ?? []).map((inv) => ({
        id: inv.id,
        hotel_name: inv.hotel_name,
        status: inv.status,
        king_rate: allResponses.get(inv.id)?.best_king_rate ?? null,
      }))
    }
    await supabase.from('grid_versions').insert({ trip_id: id, version_label: label, snapshot })
    setSavingVersion(false)
    const { data } = await supabase.from('grid_versions').select('id, version_label, created_at').eq('trip_id', id).order('created_at', { ascending: false })
    setVersions((data as any[]) ?? [])
  }

  const viewVersion = async (versionId: string) => {
    const { data } = await supabase.from('grid_versions').select('snapshot, version_label').eq('id', versionId).single()
    if (data) setViewingVersion({ label: data.version_label as string, snapshot: data.snapshot })
  }

  const exportForTeam = () => {
    if (!trip || !invites) return
    const tripData = trip as any
    exportTeamGrid(
      {
        city: trip.city,
        arrival_date: trip.arrival_date,
        departure_date: trip.departure_date,
        opponent_label: trip.opponent_label,
        clients: tripData.clients ? { team_name: tripData.clients.team_name } : null,
      },
      invites.map((inv) => ({ ...inv, staff_notes: inv.staff_notes ?? null })),
      allResponses as Map<string, any>,
      allAnswers as Map<string, any[]>,
      concessionItems,
    )
    markProposalSent()
  }

  // Records the "proposal delivered" moment for the lifecycle pipeline. Fires
  // automatically whenever a manager generates a client-facing deliverable
  // (grid or PDF) — that's the last in-app step before everything moves to
  // email. Deduped server-side, so re-exporting a trip never double-logs.
  const markProposalSent = () => {
    if (!id) return
    void supabase.rpc('mark_proposal_sent', { p_trip_id: id, p_client_id: trip?.client_id ?? null })
    setProposalSentMarked(true)
  }

  if (error && !trip) return <ErrorNote message={error} />
  if (!trip || !invites) return <Loading />

  const sibIndex = siblings.findIndex((s) => s.id === id)
  const prevTrip = sibIndex > 0 ? siblings[sibIndex - 1] : null
  const nextTrip = sibIndex >= 0 && sibIndex < siblings.length - 1 ? siblings[sibIndex + 1] : null

  const submittedInvites = invites.filter((i) => ['submitted', 'awarded'].includes(i.status))
  const unprintedCount = submittedInvites.filter((i) => !i.printed_at).length

  const noEmailSent = invites.filter((i) => !i.sent_at && i.hotel_contact_email).length
  // Hotels passed without ever bidding (unavailable for the proposed dates) —
  // surface them so KJST can re-invite once the dates change/become official.
  const passedUnavailable = invites.filter((i) => i.status === 'passed' && !i.submitted_at)
  const allResponded = invites.length > 0 && invites.filter((i) => ['submitted', 'awarded'].includes(i.status)).length === invites.filter((i) => i.status !== 'passed' && i.status !== 'unavailable').length
  const awarded = invites.find((i) => i.status === 'awarded')

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] lg:min-h-[calc(100vh-4rem)] flex-col -mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {trip.opponent_label || 'Untitled trip'}
            </h1>
            {trip.stay2_arrival_date && (
              <span title="This RFP covers 2 visits to this city (Visit 1 + Visit 2)" className="rounded-full bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                2 visits
              </span>
            )}
            <Badge status={trip.status} />
            {awarded && <span className="rounded-full bg-amber-100 dark:bg-amber-900/20 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">🏆 {awarded.hotel_name}</span>}
            {isViewer && (
              <span className="rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-2 py-0.5 text-xs text-slate-400 dark:text-slate-500">
                👁 View only
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[trip.clients?.team_name, trip.city].filter(Boolean).join(' · ')}
          </p>
          {/* Next / Prev city — jump between this client's trips without leaving.
              Prev is hidden at the first city, Next at the last. */}
          {siblings.length > 1 && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs">
              {prevTrip && (
                <button
                  onClick={() => navigate(`/trips/${prevTrip.id}`)}
                  title={`Previous city: ${prevTrip.city ?? 'Trip'}`}
                  className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  ← {prevTrip.city ?? 'Prev'}
                </button>
              )}
              <span className="px-1 text-slate-400 dark:text-slate-500 tabular-nums">
                City {sibIndex + 1} of {siblings.length}
              </span>
              {nextTrip && (
                <button
                  onClick={() => navigate(`/trips/${nextTrip.id}`)}
                  title={`Next city: ${nextTrip.city ?? 'Trip'}`}
                  className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {nextTrip.city ?? 'Next'} →
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {reminderResult && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ {reminderResult.sent} reminder{reminderResult.sent !== 1 ? 's' : ''} sent</span>
          )}
          <button
            onClick={() => setShowTripInfo((s) => !s)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${showTripInfo ? 'border-[#1C1008] bg-[#1C1008] text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
          >
            Trip info
          </button>
          {!isViewer && (
            <button onClick={doSendReminders} disabled={sendingReminders} title="Nudge every hotel that hasn't responded yet. Sending from here keeps all follow-ups in one place." className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors">
              {sendingReminders ? 'Sending…' : 'Send reminders'}
            </button>
          )}
          {!isViewer && invites.some((i) => i.status === 'passed') && (
            <button
              onClick={() => setShowDeclineModal(true)}
              disabled={sendingDeclines}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {sendingDeclines ? 'Sending…' : 'Send Declines'}
            </button>
          )}
          {/* Send to client — one home for the two client-facing deliverables.
              (The internal comparison lives on the grid page via "Full grid".) */}
          {!isViewer && (
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen(v => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Send to client
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg overflow-hidden">
                  {/* Batch-print the full write-ups. "New" prints only bids not yet
                      printed, so the team never re-prints the same batch. */}
                  <Link
                    to={`/trips/${id}/proposal?hotel=all`}
                    target="_blank"
                    onClick={() => setExportOpen(false)}
                    className={`flex w-full flex-col border-b border-slate-100 dark:border-slate-700 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${submittedInvites.length === 0 ? 'pointer-events-none opacity-40' : ''}`}
                  >
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">🖨️ Print all proposals ({submittedInvites.length})</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">Full write-up for every bid received</span>
                  </Link>
                  <Link
                    to={`/trips/${id}/proposal?hotel=new`}
                    target="_blank"
                    onClick={() => setExportOpen(false)}
                    className={`flex w-full flex-col border-b border-slate-100 dark:border-slate-700 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${unprintedCount === 0 ? 'pointer-events-none opacity-40' : ''}`}
                  >
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">🖨️ Print new proposals ({unprintedCount})</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {unprintedCount === 0 ? 'Nothing new since last print' : 'Only bids not yet printed'}
                    </span>
                  </Link>
                  <button
                    onClick={() => { exportForTeam(); setExportOpen(false) }}
                    disabled={!invites || invites.filter((i) => ['submitted', 'awarded'].includes(i.status)).length === 0}
                    className="flex w-full flex-col border-b border-slate-100 dark:border-slate-700 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">↓ Client grid (.xlsx)</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">Hotel options for this trip, client-ready</span>
                  </button>
                  <Link
                    to={`/trips/${id}/proposal`}
                    target="_blank"
                    onClick={() => { markProposalSent(); setExportOpen(false) }}
                    className="flex w-full flex-col border-b border-slate-100 dark:border-slate-700 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Proposal PDF</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">Clean proposal to email the client</span>
                  </Link>
                  {/* Backstop: generating either deliverable above already records
                      the proposal as delivered (markProposalSent, deduped server-side).
                      This stays as a manual confirm for the rare case a proposal went
                      out without exporting from here. Copy stays workflow-oriented. */}
                  <button
                    onClick={() => { markProposalSent(); setExportOpen(false) }}
                    title="Usually recorded automatically when you generate the grid or PDF above. Use this only if a proposal went out another way."
                    className="flex w-full flex-col px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {proposalSentMarked ? 'Marked as sent ✓' : 'Mark proposal sent'}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {proposalSentMarked ? 'Recorded' : 'Only if you sent it without exporting here'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
          {!isViewer && (
            <button
              onClick={saveVersion}
              disabled={savingVersion}
              title="Save a snapshot when you finalize a build, so you can point back to what the client saw."
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {savingVersion ? 'Saving…' : '💾 Save Version'}
            </button>
          )}
          <LinkButton to={`/trips/${id}/grid`} variant="secondary">
            Full grid →
          </LinkButton>
          {trip && canEditClient(trip.client_id) && (
            <LinkButton to={`/trips/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
          )}
          {trip && canEditClient(trip.client_id) && (
            <button
              onClick={removeTrip}
              disabled={deleting}
              className="rounded-lg border border-red-200 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 hover:text-red-700 disabled:opacity-40 transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      {/* ── Banners ── */}
      {error && <div className="border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-6 py-2 text-xs text-red-700 dark:text-red-400">{error}</div>}
      {!awarded && noEmailSent > 0 && (
        <div className="border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-6 py-2 text-xs text-amber-800 dark:text-amber-300">
          📧 <strong>{noEmailSent} hotel{noEmailSent > 1 ? 's' : ''}</strong> {noEmailSent > 1 ? "haven't" : "hasn't"} been emailed yet — select them on the left and hit <strong>Send email</strong>.
        </div>
      )}
      {!awarded && allResponded && invites.length > 0 && (
        <div className="border-b border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-6 py-2 text-xs text-emerald-800 dark:text-emerald-300">
          ✅ All hotels have responded — select a winner below or open the <Link to={`/trips/${id}/grid`} className="font-semibold underline">full comparison grid</Link>.
        </div>
      )}
      {!isViewer && passedUnavailable.length > 0 && (
        <div className="border-b border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-indigo-800 dark:text-indigo-300">
          <span>
            <strong>{passedUnavailable.length} hotel{passedUnavailable.length !== 1 ? 's' : ''}</strong> marked <strong>Passed - Not Available</strong> (couldn't do the proposed dates). If the dates changed, re-invite:
          </span>
          {passedUnavailable.map((inv) => (
            <button
              key={inv.id}
              onClick={() => reInvitePassed(inv)}
              disabled={!inv.hotel_contact_email || awardingId === inv.id}
              title={!inv.hotel_contact_email ? 'No email address on file' : `Re-invite ${inv.hotel_name} with the current dates`}
              className="rounded-md border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 px-2 py-1 font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-40 transition-colors"
            >
              ↻ Re-invite {inv.hotel_name}
            </button>
          ))}
        </div>
      )}

      {/* ── Scenario collapse banner ── */}
      {trip.date_scenarios?.length > 0 && !isViewer && (
        <div className="border-b border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 px-6 py-2 flex items-center justify-between gap-4">
          <p className="text-xs text-violet-800 dark:text-violet-300">
            <strong>Dates TBD</strong> — {trip.date_scenarios.length} scenario{trip.date_scenarios.length !== 1 ? 's' : ''} pending confirmation
            {' ('}
            {trip.date_scenarios.map((s) => `${s.label}: ${formatDate(s.arrival_date)} – ${formatDate(s.departure_date)}`).join(', ')}
            {')'}
          </p>
          <button
            onClick={() => setConfirmingScenario(true)}
            className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 transition-colors"
          >
            Confirm dates
          </button>
        </div>
      )}

      {/* ── What-to-do-here hint ── */}
      {!isViewer && (
        <div className="mx-6 mt-4">
          <PageHint id="trip-workspace">
            This is a trip's workspace. <strong>Invite hotels</strong>, then their bids land here as they submit.
            Once bids are in, open the <strong>comparison grid</strong> to review side by side, mark a winner, and use
            <strong> Send to client</strong> to export the grid or print proposals.
          </PageHint>
        </div>
      )}

      {/* ── F&B forecast plan — only for teams whose RFP collects per-person meal prices ── */}
      {!isViewer && concessionItems.some((c) => c.answer_type === 'currency' && /breakfast|lunch|brunch|dinner|\bmeal\b|menu|per person/i.test(c.label)) && (() => {
        const currencyItems = concessionItems.filter((c) => c.answer_type === 'currency')
        const activeCount = currencyItems.filter((c) => Number(fnbPlan[c.id]) > 0).length
        return (
          <div className="mx-6 mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <button
              onClick={() => setFnbOpen((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-3 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">🍽️ F&amp;B forecast plan</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {activeCount > 0
                    ? `${activeCount} meal${activeCount !== 1 ? 's' : ''} set — the grid auto-computes each hotel's Forecasted F&B`
                    : 'Set person-meals per meal to auto-compute F&B totals on the grid'}
                </p>
              </div>
              <span className="text-xs text-slate-400">{fnbSaving ? 'Saving…' : fnbOpen ? '▲' : '▼'}</span>
            </button>
            {fnbOpen && (
              <div className="border-t border-slate-100 dark:border-slate-700 px-5 py-4">
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  For each meal, enter <strong>person-meals</strong> = headcount × how many of that meal over the stay.
                  Leave non-meal items (e.g. baggage) blank. The grid multiplies each hotel's entered price by this number.
                </p>
                <div className="space-y-2">
                  {currencyItems.map((c) => (
                    <div key={c.id} className="flex items-center gap-3">
                      <label className="flex-1 text-xs text-slate-600 dark:text-slate-300">{c.label}</label>
                      <input
                        type="number"
                        min={0}
                        value={fnbPlan[c.id] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value))
                          setFnbPlan((p) => ({ ...p, [c.id]: v }))
                        }}
                        onBlur={() => saveFnbPlan(fnbPlan)}
                        placeholder="—"
                        className="w-28 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-right text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1C1008]/30"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Grid discovery banner (shown when ≥2 hotels submitted) ── */}
      {invites && invites.filter((i) => ['submitted', 'awarded'].includes(i.status)).length >= 2 && (
        <div className="mx-6 mb-0 mt-4 flex items-center justify-between rounded-xl border border-[#1C1008]/20 bg-[#1C1008]/5 px-5 py-3.5">
          <div>
            <p className="text-sm font-semibold text-[#1C1008]">
              {invites.filter((i) => ['submitted', 'awarded'].includes(i.status)).length} bids in — ready to compare
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              View all bids side by side on the comparison grid
            </p>
          </div>
          <Link
            to={`/trips/${id}/grid`}
            className="shrink-0 rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d1e0e] transition-colors"
          >
            View Comparison Grid →
          </Link>
        </div>
      )}

      {/* ── Bid summary table (shown when ≥1 hotel submitted) ── */}
      {invites && invites.some((i) => ['submitted', 'awarded'].includes(i.status)) && (
        <BidSummaryTable
          invites={invites}
          responses={allResponses}
          answers={allAnswers}
          concessionItems={concessionItems}
          scores={scores}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onPass={passHotel}
          onResetStatus={resetHotelStatus}
          onReopen={setReopenTarget}
          reopeningId={reopeningId}
          onRemove={removeInviteFromTable}
          passingId={awardingId}
          isViewer={isViewer}
        />
      )}

      {/* ── Body: trip info slide + split panel ── */}
      <div className="flex flex-1">

        {/* Trip info slide-over */}
        {showTripInfo && (
          <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Trip info</span>
              <div className="flex items-center gap-2">
                <Link to={`/trips/${id}/edit`} className="text-xs text-[#1C1008] hover:underline">Edit</Link>
                <button onClick={() => setShowTripInfo(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600">✕</button>
              </div>
            </div>
            <TripInfoPanel trip={trip} />
          </div>
        )}

        {/* Left: hotel list */}
        <div className="flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          {invites.length > 0 && <ResponseProgress invites={invites} />}

          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Hotels {invites.length > 0 && `(${invites.length})`}
            </span>
            {!isViewer && invites.some((i) => !i.sent_at && i.hotel_contact_email) && (
              <button
                onClick={selectAllNotSent}
                className="text-xs font-medium text-[#1C1008] hover:underline"
              >
                Select all not sent
              </button>
            )}
          </div>

          {!isViewer && selectedInviteIds.size > 0 && (
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 px-4 py-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">{selectedInviteIds.size} selected</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedInviteIds(new Set())}
                  className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600"
                >
                  Clear
                </button>
                <button
                  onClick={sendBulkInvites}
                  disabled={bulkSending}
                  className="rounded-lg bg-[#1C1008] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50"
                >
                  {bulkSending ? 'Sending…' : `Send email (${selectedInviteIds.size})`}
                </button>
              </div>
            </div>
          )}

          {/* Hotel list — flows with the page (whole workspace scrolls) */}
          <div className="flex-1">
            {invites.length === 0 && !showInvite && (
              <div className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                No hotels added to RFP yet.<br />Add one below to get started.
              </div>
            )}
            {invites.map((inv) => {
              const isSelected = inv.id === selectedId
              const isAwarded = inv.status === 'awarded'
              return (
                <div
                  key={inv.id}
                  className={`group relative flex items-center border-b border-slate-50 dark:border-slate-700 transition-colors ${
                    isSelected ? 'bg-slate-100 dark:bg-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {!isViewer && (
                    <input
                      type="checkbox"
                      checked={selectedInviteIds.has(inv.id)}
                      disabled={!canEmailStatus(inv.status)}
                      onChange={(e) => { e.stopPropagation(); toggleInviteSelected(inv.id) }}
                      onClick={(e) => e.stopPropagation()}
                      title={!canEmailStatus(inv.status) ? 'Proposal already in — no email needed' : undefined}
                      className="ml-4 h-3.5 w-3.5 shrink-0 rounded border-slate-300 dark:border-slate-600 text-[#1C1008] focus:ring-[#1C1008] disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                  )}
                  <button
                    onClick={() => setSelectedId(inv.id)}
                    className={`flex flex-1 min-w-0 items-center gap-3 py-3 pr-4 text-left ${isViewer ? 'pl-4' : 'pl-3'}`}
                  >
                    <StatusDot status={inv.status} sentAt={inv.sent_at} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm font-medium ${isAwarded ? 'text-amber-700' : inv.status === 'passed' || inv.status === 'unavailable' ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-200'}`}>
                        {isAwarded && '🏆 '}{inv.hotel_name}
                      </div>
                      {(inv.status === 'passed' || inv.status === 'unavailable') ? (
                        <span className="mt-0.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:bg-red-900/30 dark:text-red-400">
                          {inv.status === 'passed' ? passedLabel(inv.submitted_at) : 'Not available'}
                        </span>
                      ) : inv.hotel_contact_name ? (
                        <div className="truncate text-xs text-slate-400 dark:text-slate-500">{inv.hotel_contact_name}</div>
                      ) : null}
                    </div>
                    {isSelected && <span className="text-slate-300 dark:text-slate-600">›</span>}
                  </button>
                  {/* Remove button — visible on row hover, hidden for viewers */}
                  {!isViewer && (
                    <button
                      onClick={(e) => removeInvite(inv, e)}
                      className="invisible group-hover:visible mr-2 shrink-0 rounded p-1 text-slate-300 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
                      title="Remove from RFP"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Invite form — pinned above footer so hotel list stays scrollable */}
          {showInvite && (
            <InviteForm
              tripId={id!}
              defaultLeague={trip.clients?.league}
              onDone={() => { setShowInvite(false); loadInvites() }}
              onCancel={() => setShowInvite(false)}
            />
          )}

          {/* Version history */}
          {versions.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Version History</p>
              <div className="space-y-1">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-600 dark:text-slate-300">📌 {v.version_label}</span>
                    <button
                      onClick={() => viewVersion(v.id)}
                      className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      View
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {versions.length === 0 && (
            <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-2">
              <p className="text-xs text-slate-300 dark:text-slate-600 italic">No versions saved yet</p>
            </div>
          )}

          {/* Add hotel button — hidden for viewers */}
          {!isViewer && (
            <div className="border-t border-slate-100 dark:border-slate-700 p-3">
              <button
                onClick={() => { setShowInvite((s) => !s) }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-[#1C1008] hover:text-[#1C1008] transition-colors"
              >
                + Add hotel
              </button>
            </div>
          )}
        </div>

        {/* Right: hotel detail or empty state */}
        <div className="flex-1 bg-slate-50 dark:bg-slate-700/50">
          {selectedInvite ? (
            <HotelPanel
              inv={selectedInvite}
              trip={trip}
              concessionItems={concessionItems}
              preloadedAnswers={allAnswers.get(selectedInvite.id)}
              score={scores.get(selectedInvite.id)?.score}
              onSendEmail={sendEmail}
              onSendReminder={sendReminder}
              onPass={passHotel}
              onResetStatus={resetHotelStatus}
              onReopen={setReopenTarget}
              reopeningId={reopeningId}
              onCopyLink={copyLink}
              onContactUpdated={(id, name, email) => {
                setInvites((prev) =>
                  prev?.map((i) =>
                    i.id === id
                      ? { ...i, hotel_contact_name: name, hotel_contact_email: email }
                      : i
                  ) ?? prev
                )
              }}
              sendingEmail={sendingEmail}
              sendingReminder={sendingReminder}
              reminderFlash={reminderFlash}
              emailFlash={emailFlash}
              copied={copied}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
              {invites.length === 0 ? 'Add a hotel to get started' : 'Select a hotel to view their bid'}
            </div>
          )}
        </div>
      </div>

      {/* ── Bulk send result — dismissible, does not auto-hide ── */}
      {bulkSendResult && (
        <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 px-4 py-3">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Bulk send results — {bulkSendResult.filter((r) => r.ok).length}/{bulkSendResult.length} sent
            </span>
            <button
              onClick={() => setBulkSendResult(null)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {bulkSendResult.map((r, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs">
                <span className={r.ok ? 'text-emerald-500' : 'text-red-500'}>{r.ok ? '✓' : '✗'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-700 dark:text-slate-300">{r.hotelName}</div>
                  {r.ok ? (
                    <div className="truncate text-slate-400 dark:text-slate-500">{r.email}</div>
                  ) : (
                    <div className="truncate text-red-500">{r.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Decline toast ── */}
      {declineToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-800 dark:bg-slate-100 px-5 py-3 text-sm font-medium text-white dark:text-slate-800 shadow-lg">
          ✓ {declineToast}
        </div>
      )}

      {/* ── Decline confirmation modal ── */}
      {showDeclineModal && (() => {
        const passed = invites.filter((i) => i.status === 'passed')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-2xl p-6">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-2">Send decline emails?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                This will send a polite "thank you but we went elsewhere" email to <strong>{passed.length} hotel{passed.length !== 1 ? 's' : ''}</strong>:
              </p>
              <ul className="mb-4 space-y-1 rounded-lg bg-slate-50 dark:bg-slate-700/50 px-4 py-3">
                {passed.map((inv) => (
                  <li key={inv.id} className="text-sm text-slate-700 dark:text-slate-300">• {inv.hotel_name}</li>
                ))}
              </ul>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">This cannot be undone.</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowDeclineModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={sendDeclines}
                  className="rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d1e0e] transition-colors"
                >
                  Send {passed.length} Email{passed.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Scenario confirmation modal ── */}
      {confirmingScenario && trip.date_scenarios?.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-2xl p-6">
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">Confirm date scenario</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Select the scenario that was confirmed. The trip's dates will be updated and the other scenarios dismissed.
            </p>
            <div className="space-y-2 mb-5">
              {trip.date_scenarios.map((s) => (
                <button
                  key={s.label}
                  onClick={() => confirmScenario(s)}
                  disabled={confirmingScenarioSaving}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-left hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-100 group-hover:text-violet-700 dark:group-hover:text-violet-300">
                      Scenario {s.label}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 group-hover:text-violet-600">Select →</span>
                  </div>
                  <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    {formatDate(s.arrival_date)} – {formatDate(s.departure_date)}
                    {s.game_date && ` · Game: ${formatDate(s.game_date)}`}
                  </div>
                  {s.notes && (
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 italic">{s.notes}</p>
                  )}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setConfirmingScenario(false)}
                disabled={confirmingScenarioSaving}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {confirmingScenarioSaving ? 'Saving…' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Version history modal ── */}
      {viewingVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Version: {viewingVersion.label}</h2>
              <button onClick={() => setViewingVersion(null)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600">✕</button>
            </div>
            <div className="p-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs font-semibold text-slate-400 dark:text-slate-500">
                    <th className="pb-2 pr-4">Hotel</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 text-right">King Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                  {(viewingVersion.snapshot?.hotels ?? []).map((h: any, i: number) => (
                    <tr key={i}>
                      <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-200">{h.hotel_name}</td>
                      <td className="py-2 pr-4 capitalize text-slate-500 dark:text-slate-400">{h.status}</td>
                      <td className="py-2 text-right text-slate-700 dark:text-slate-300">{h.king_rate != null ? `$${h.king_rate.toLocaleString()}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 text-right">
                <button onClick={() => setViewingVersion(null)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reopen dialog — personalized message + explicit email / no-email choice */}
      {reopenTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setReopenTarget(null); setReopenMessage('') }}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Reopen {reopenTarget.hotel_name}'s proposal?
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Their bid stays on your grid and <strong>all their previous answers are saved</strong> — reopening just lets them go back in, adjust what changed, and resubmit.
            </p>

            {/* Personalized message — dates, a late checkout, a check-in change, anything */}
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Message to the hotel (optional)
            </label>
            <textarea
              value={reopenMessage}
              onChange={(e) => setReopenMessage(e.target.value)}
              rows={4}
              placeholder="e.g. The check-out dates moved to March 27–29, and we now need a 1pm late checkout on game day. Please review and resubmit."
              className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              This becomes the body of the email. Leave blank for a generic "please review and resubmit" note.
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => confirmReopen(reopenTarget, true)}
                className="rounded-lg bg-[#1C1008] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2d1e0e]"
              >
                Reopen &amp; email them their link
              </button>
              <button
                onClick={() => confirmReopen(reopenTarget, false)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Reopen — I'll contact them myself
              </button>
              <button
                onClick={() => { setReopenTarget(null); setReopenMessage('') }}
                className="mt-1 px-4 py-2 text-sm font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
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
