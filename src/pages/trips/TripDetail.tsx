import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Client, Invitation, Trip } from '../../lib/types'
import { formatDate, generateToken } from '../../lib/format'
import { sendInvitationEmail, sendReminderEmails } from '../../lib/emailApi'
import { Badge, ErrorNote, LinkButton, Loading } from '../../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

type HotelResponse = {
  id: string
  best_king_rate: number | null
  best_suite_rate: number | null
  current_selling_rate: string | null
  occupancy_tax: string | null
  king_rate_notes: string | null
  meeting_space_notes: string | null
  general_comments: string | null
  stay2_king_rate: number | null
  stay2_suite_rate: number | null
  stay2_selling_rate: string | null
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

// ── Score calculation ─────────────────────────────────────────────────────────

function calcScores(
  submittedInvites: { id: string }[],
  responses: Map<string, HotelResponse>,
  answers: Map<string, Answer[]>,
): Map<string, number> {
  const scores = new Map<string, number>()
  if (submittedInvites.length === 0) return scores

  // Rate score (40 pts) — lowest rate = 40, others proportional
  const rates = submittedInvites
    .map((inv) => responses.get(inv.id)?.best_king_rate ?? null)
    .filter((r): r is number => r != null)
  const minRate = rates.length > 0 ? Math.min(...rates) : null

  for (const inv of submittedInvites) {
    const resp = responses.get(inv.id)
    const ans = answers.get(inv.id) ?? []

    let rateScore = 0
    if (minRate != null && resp?.best_king_rate != null) {
      rateScore = Math.round((minRate / resp.best_king_rate) * 40)
    } else if (resp?.best_king_rate == null) {
      rateScore = 0
    } else {
      rateScore = 40 // only one hotel submitted
    }

    let concessionScore = 0
    if (ans.length > 0) {
      const yesCount = ans.filter((a) => a.answer_yes_no === true).length
      concessionScore = Math.round((yesCount / ans.length) * 60)
    }

    scores.set(inv.id, Math.min(100, rateScore + concessionScore))
  }
  return scores
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-emerald-100 text-emerald-700' :
    score >= 60 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>
      {score}
    </span>
  )
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'submitted' || status === 'awarded'
      ? 'bg-emerald-500'
      : status === 'opened'
        ? 'bg-amber-400'
        : status === 'passed'
          ? 'bg-slate-300'
          : status === 'unavailable'
            ? 'bg-slate-200'
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
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span><strong className="text-slate-700">{submitted}/{total}</strong> responded</span>
        <span>{pct}%</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-emerald-500 transition-all" style={{ width: `${(submitted / total) * 100}%` }} />
        <div className="bg-amber-400 transition-all" style={{ width: `${(opened / total) * 100}%` }} />
      </div>
    </div>
  )
}

// ── Invite form (slide-in panel) ──────────────────────────────────────────────

function InviteForm({
  tripId,
  onDone,
  onCancel,
}: {
  tripId: string
  onDone: () => void
  onCancel: () => void
}) {
  const [hotelName, setHotelName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<{ hotel_name: string; hotel_contact_name: string | null; hotel_contact_email: string | null }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = async (q: string) => {
    if (q.length < 2) { setSuggestions([]); setShowSuggestions(false); return }
    const { data } = await supabase.from('rfp_invitations').select('hotel_name, hotel_contact_name, hotel_contact_email').ilike('hotel_name', `%${q}%`).order('hotel_name').limit(8)
    if (data && data.length > 0) {
      const seen = new Set<string>()
      const unique = data.filter((r) => { const k = `${r.hotel_name}||${r.hotel_contact_email ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true })
      setSuggestions(unique); setShowSuggestions(true)
    } else { setSuggestions([]); setShowSuggestions(false) }
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
    <div className="border-b border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-700">Add a hotel</p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <form onSubmit={submit} className="space-y-3">
        <div ref={ref} className="relative">
          <label className="mb-1 block text-xs font-medium text-slate-600">Hotel name *</label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
            value={hotelName} required autoComplete="off"
            placeholder="Start typing to search history…"
            onChange={(e) => { setHotelName(e.target.value); search(e.target.value) }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
              {suggestions.map((s, i) => (
                <button key={i} type="button"
                  onMouseDown={() => { setHotelName(s.hotel_name); setContactName(s.hotel_contact_name ?? ''); setContactEmail(s.hotel_contact_email ?? ''); setShowSuggestions(false) }}
                  className="flex w-full flex-col border-b border-slate-100 px-3 py-2.5 text-left text-sm hover:bg-slate-50 last:border-0"
                >
                  <span className="font-medium text-slate-800">{s.hotel_name}</span>
                  {(s.hotel_contact_name || s.hotel_contact_email) && (
                    <span className="text-xs text-slate-400">{[s.hotel_contact_name, s.hotel_contact_email].filter(Boolean).join(' · ')}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Contact name</label>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Contact email</label>
          <input type="email" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="rounded-lg bg-[#1C1008] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50">
            {saving ? 'Adding…' : 'Add hotel'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
        </div>
      </form>
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
}: {
  invites: Invitation[]
  responses: Map<string, HotelResponse>
  answers: Map<string, Answer[]>
  concessionItems: ConcessionItem[]
  scores: Map<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const submitted = invites.filter((i) => ['submitted', 'awarded'].includes(i.status))
  if (submitted.length === 0) return null

  // Find concession item IDs for key fields
  const commissionItem = concessionItems.find((c) =>
    c.label.toLowerCase().includes('commissionable') || c.label.toLowerCase().includes('commission')
  )
  const noWalkItem = concessionItems.find((c) => c.label.toLowerCase().includes('no walk'))

  const getAnswer = (invId: string, itemId: string | undefined) => {
    if (!itemId) return null
    return answers.get(invId)?.find((a) => a.concession_item_id === itemId) ?? null
  }

  return (
    <div className="border-b border-slate-200 bg-white px-6 py-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Submitted Bids — {submitted.length} hotel{submitted.length !== 1 ? 's' : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-400">
              <th className="pb-2 pr-4">Hotel</th>
              <th className="pb-2 pr-4 text-right whitespace-nowrap">King Rate</th>
              <th className="pb-2 pr-4 text-right whitespace-nowrap">Occ. Tax</th>
              <th className="pb-2 pr-4 text-right whitespace-nowrap">Commission</th>
              <th className="pb-2 pr-4 text-center whitespace-nowrap">No Walk</th>
              <th className="pb-2 text-center whitespace-nowrap">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {[...submitted].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)).map((inv) => {
              const resp = responses.get(inv.id)
              const commAns = getAnswer(inv.id, commissionItem?.id)
              const noWalkAns = getAnswer(inv.id, noWalkItem?.id)
              const score = scores.get(inv.id) ?? 0
              const isSelected = inv.id === selectedId
              return (
                <tr
                  key={inv.id}
                  onClick={() => onSelect(inv.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#1C1008]/5' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-2.5 pr-4">
                    <span className={`font-medium ${isSelected ? 'text-[#1C1008]' : 'text-slate-800'}`}>
                      {inv.status === 'awarded' && '🏆 '}
                      {inv.hotel_name}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right font-medium text-slate-700">
                    {resp?.best_king_rate != null ? `$${resp.best_king_rate.toLocaleString()}` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">
                    {resp?.occupancy_tax || '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">
                    {commAns?.answer_value || (commAns?.answer_yes_no === true ? 'Yes' : commAns?.answer_yes_no === false ? 'No' : '—')}
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    {noWalkAns?.answer_yes_no === true ? (
                      <span className="text-emerald-600 font-semibold">✓</span>
                    ) : noWalkAns?.answer_yes_no === false ? (
                      <span className="text-red-500">✗</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2.5 text-center">
                    <ScoreBadge score={score} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
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
  onMarkUnavailable,
  onCopyLink,
  onContactUpdated,
  sendingEmail,
  emailFlash,
  copied,
}: {
  inv: Invitation
  trip: Trip
  concessionItems: ConcessionItem[]
  preloadedAnswers: Answer[] | undefined
  score: number | undefined
  onSendEmail: (inv: Invitation) => void
  onMarkUnavailable: (inv: Invitation) => void
  onCopyLink: (token: string) => void
  onContactUpdated: (id: string, name: string | null, email: string | null) => void
  sendingEmail: string | null
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
    Promise.all([
      supabase.from('rfp_responses').select('*').eq('invitation_id', inv.id).single(),
      supabase.from('rfp_answers').select('concession_item_id, answer_yes_no, answer_value, comment').eq('invitation_id', inv.id),
    ]).then(([respRes, answersRes]) => {
      setResponse(respRes.data as HotelResponse ?? null)
      setAnswers((answersRes.data as Answer[]) ?? [])
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* Hotel header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{inv.hotel_name}</h2>
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
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-0.5 flex items-center gap-2">
                <p className="text-sm text-slate-500">
                  {[inv.hotel_contact_name, inv.hotel_contact_email].filter(Boolean).join(' · ') || <span className="italic text-slate-400">No contact info</span>}
                </p>
                <button onClick={() => setEditingContact(true)}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  title="Edit contact">
                  ✎
                </button>
              </div>
            )}
            {inv.sent_at && (
              <p className="mt-0.5 text-xs text-slate-400">Emailed {formatDate(inv.sent_at)}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={inv.status} />
            <button
              onClick={() => onCopyLink(inv.token)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {copied === inv.token ? '✓ Copied' : 'Copy link'}
            </button>
            {inv.status !== 'submitted' && inv.status !== 'awarded' && inv.status !== 'unavailable' && (
              <button
                onClick={() => onSendEmail(inv)}
                disabled={!inv.hotel_contact_email || sendingEmail === inv.id}
                title={!inv.hotel_contact_email ? 'No email address on file' : undefined}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              >
                {sendingEmail === inv.id ? 'Sending…' : emailFlash === inv.id ? '✓ Sent!' : inv.sent_at ? 'Resend email' : 'Send email'}
              </button>
            )}
            {['sent', 'opened'].includes(inv.status) && (
              <button
                onClick={() => onMarkUnavailable(inv)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-50 transition-colors"
              >
                Not available
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isUnavailable && (
          <div className="m-6 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            This hotel marked as unavailable for these dates.
          </div>
        )}

        {isPassed && (
          <div className="m-6 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Passed on this hotel.
          </div>
        )}

        {!isSubmitted && !isPassed && !isUnavailable && (
          <div className="m-6 rounded-xl border border-amber-100 bg-amber-50 p-6 text-center">
            <p className="text-sm font-medium text-amber-800">Awaiting response</p>
            <p className="mt-1 text-xs text-amber-600">
              {inv.sent_at ? `Invited ${formatDate(inv.sent_at)}` : 'Email not sent yet'}
            </p>
          </div>
        )}

        {isSubmitted && loadingBid && (
          <div className="flex items-center justify-center p-12"><Loading /></div>
        )}

        {isSubmitted && !loadingBid && response && (
          <div className="space-y-0 divide-y divide-slate-100">
            {/* Quick stats chips */}
            {(() => {
              const ansMap = new Map((preloadedAnswers ?? answers).map((a) => [a.concession_item_id, a]))
              const commItem = concessionItems.find((c) => c.label.toLowerCase().includes('commissionable') || c.label.toLowerCase().includes('commission'))
              const noWalkItem = concessionItems.find((c) => c.label.toLowerCase().includes('no walk'))
              const compRoomsItem = concessionItems.find((c) => c.label.toLowerCase().includes('complimentary') && c.label.toLowerCase().includes('room'))
              const commAns = commItem ? ansMap.get(commItem.id) : null
              const noWalkAns = noWalkItem ? ansMap.get(noWalkItem.id) : null
              const compAns = compRoomsItem ? ansMap.get(compRoomsItem.id) : null
              const chips = [
                { label: 'Commission', value: commAns?.answer_value || (commAns?.answer_yes_no === true ? 'Yes' : commAns?.answer_yes_no === false ? 'No' : null) },
                { label: 'No Walk', value: noWalkAns?.answer_yes_no === true ? 'Yes ✓' : noWalkAns?.answer_yes_no === false ? 'No ✗' : null, ok: noWalkAns?.answer_yes_no },
                { label: 'Comp Rooms', value: compAns?.answer_value || (compAns?.answer_yes_no === true ? 'Yes' : compAns?.answer_yes_no === false ? 'No' : null) },
                { label: 'Score', value: score != null ? String(score) : null, isScore: true },
              ].filter((c) => c.value != null)
              if (chips.length === 0) return null
              return (
                <div className="flex flex-wrap gap-2 px-6 py-3 bg-slate-50 border-b border-slate-100">
                  {chips.map((chip) => (
                    <span key={chip.label} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      chip.isScore
                        ? (score! >= 80 ? 'bg-emerald-100 text-emerald-700' : score! >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600')
                        : chip.ok === false ? 'bg-red-50 text-red-600' : chip.ok === true ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      <span className="text-slate-400">{chip.label}:</span> {chip.value}
                    </span>
                  ))}
                </div>
              )
            })()}

            {/* Rates */}
            <div className="px-6 py-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {hasStay2 ? 'Stay 1 Rates' : 'Rates'}
                {hasStay2 && trip.arrival_date && (
                  <span className="ml-2 font-normal normal-case text-slate-300">
                    {fmt(trip.arrival_date)} – {fmt(trip.departure_date)}
                  </span>
                )}
              </h3>
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
                <p className="mt-3 text-xs text-slate-500"><span className="font-medium">Rate notes:</span> {response.king_rate_notes}</p>
              )}
            </div>

            {/* Stay 2 rates */}
            {hasStay2 && (response.stay2_king_rate || response.stay2_suite_rate || response.stay2_selling_rate) && (
              <div className="px-6 py-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Stay 2 Rates
                  {trip.stay2_arrival_date && (
                    <span className="ml-2 font-normal normal-case text-slate-300">
                      {fmt(trip.stay2_arrival_date)} – {fmt(trip.stay2_departure_date)}
                    </span>
                  )}
                </h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  <RateField label="King rate" value={fmtRate(response.stay2_king_rate)} />
                  <RateField label="Suite rate" value={fmtRate(response.stay2_suite_rate)} />
                  <RateField label="Selling rate" value={response.stay2_selling_rate || '—'} />
                </dl>
              </div>
            )}

            {/* Meeting space & comments */}
            {(response.meeting_space_notes || response.general_comments) && (
              <div className="px-6 py-5 space-y-3">
                {response.meeting_space_notes && (
                  <p className="text-xs text-slate-500"><span className="font-medium text-slate-600">Meeting space:</span> {response.meeting_space_notes}</p>
                )}
                {response.general_comments && (
                  <p className="text-xs text-slate-500"><span className="font-medium text-slate-600">General comments:</span> {response.general_comments}</p>
                )}
              </div>
            )}

            {/* Concessions */}
            {sections.map((section) => {
              const items = concessionItems.filter((c) => c.section === section)
              if (items.length === 0) return null
              const answeredItems = items.filter((c) => answerMap.has(c.id))
              if (answeredItems.length === 0) return null
              return (
                <div key={section} className="px-6 py-5">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{sectionLabels[section]}</h3>
                  <div className="space-y-2">
                    {answeredItems.map((item) => {
                      const ans = answerMap.get(item.id)!
                      const isYes = ans.answer_yes_no === true
                      const isNo = ans.answer_yes_no === false
                      return (
                        <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                          <span className="text-slate-600">{item.label}</span>
                          <div className="text-right shrink-0">
                            {item.answer_type === 'yes_no' ? (
                              <span className={`font-medium ${isYes ? 'text-emerald-600' : isNo ? 'text-red-500' : 'text-slate-400'}`}>
                                {isYes ? '✓ Yes' : isNo ? '✗ No' : '—'}
                              </span>
                            ) : (
                              <span className="font-medium text-slate-700">{ans.answer_value || '—'}</span>
                            )}
                            {ans.comment && (
                              <p className="mt-0.5 text-xs text-slate-400 italic">"{ans.comment}"</p>
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
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${highlight ? 'text-[#1C1008]' : 'text-slate-800'}`}>{value}</dd>
    </div>
  )
}

// ── Trip info panel (right panel when no hotel selected) ──────────────────────

function TripInfoPanel({ trip }: { trip: Trip & { clients: Pick<Client, 'id' | 'team_name'> | null } }) {
  const fmt = (d: string | null) => formatDate(d) || '—'
  const hasStay2 = Boolean(trip.stay2_arrival_date)
  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Trip details</h3>
        <dl className="space-y-3">
          <InfoRow label="Client" value={trip.clients?.team_name} />
          <InfoRow label="City" value={trip.city} />
          <InfoRow label={hasStay2 ? 'Stay 1 arrival' : 'Arrival'} value={fmt(trip.arrival_date)} />
          <InfoRow label={hasStay2 ? 'Stay 1 departure' : 'Departure'} value={fmt(trip.departure_date)} />
          {trip.nights != null && <InfoRow label="Nights" value={String(trip.nights)} />}
          <InfoRow label="Game date" value={fmt(trip.game_date)} />
          {trip.game_time && <InfoRow label="Game time" value={trip.game_time} />}
          <InfoRow label="Response deadline" value={fmt(trip.response_deadline)} />
        </dl>
      </div>
      {hasStay2 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Stay 2</h3>
          <dl className="space-y-3">
            <InfoRow label="Arrival" value={fmt(trip.stay2_arrival_date)} />
            <InfoRow label="Departure" value={fmt(trip.stay2_departure_date)} />
            {trip.stay2_game_date && <InfoRow label="Game date" value={fmt(trip.stay2_game_date)} />}
            {trip.stay2_game_time && <InfoRow label="Game time" value={trip.stay2_game_time} />}
          </dl>
        </div>
      )}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Rooms requested</h3>
        <dl className="space-y-3">
          <InfoRow label="King rooms" value={trip.king_rooms_requested != null ? String(trip.king_rooms_requested) : null} />
          <InfoRow label="Suites" value={trip.suites_requested != null ? String(trip.suites_requested) : null} />
          <InfoRow label="Total rooms" value={trip.total_rooms_requested != null ? String(trip.total_rooms_requested) : null} />
        </dl>
      </div>
      {(trip.in_season_tournament_window || trip.postseason_window) && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Special windows</h3>
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
      <dt className="text-xs text-slate-400 shrink-0">{label}</dt>
      <dd className="text-sm text-slate-700 text-right">{value || '—'}</dd>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<(Trip & { clients: Pick<Client, 'id' | 'team_name'> | null }) | null>(null)
  const [invites, setInvites] = useState<Invitation[] | null>(null)
  const [concessionItems, setConcessionItems] = useState<ConcessionItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [showTripInfo, setShowTripInfo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)
  const [emailFlash, setEmailFlash] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [sendingReminders, setSendingReminders] = useState(false)
  const [reminderResult, setReminderResult] = useState<{ sent: number; skipped: number } | null>(null)
  // Bulk responses + answers for the summary table and scoring
  const [allResponses, setAllResponses] = useState<Map<string, HotelResponse>>(new Map())
  const [allAnswers, setAllAnswers] = useState<Map<string, Answer[]>>(new Map())
  const [scores, setScores] = useState<Map<string, number>>(new Map())

  const loadInvites = () => {
    supabase.from('rfp_invitations').select('*').eq('trip_id', id).order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setInvites(data as Invitation[])
      })
  }

  useEffect(() => {
    supabase.from('trips').select('*, clients(id, team_name)').eq('id', id!).single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTrip(data as Trip & { clients: Pick<Client, 'id' | 'team_name'> | null })
      })
    loadInvites()
    supabase.from('concession_items').select('id, sort_order, section, label, answer_type, requested_value').order('sort_order')
      .then(({ data }) => { if (data) setConcessionItems(data as ConcessionItem[]) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Auto-select first submitted hotel when invites load
  useEffect(() => {
    if (!invites || selectedId) return
    const first = invites.find((i) => ['submitted', 'awarded'].includes(i.status)) ?? invites[0]
    if (first) setSelectedId(first.id)
  }, [invites, selectedId])

  // Bulk-fetch responses + answers for all submitted hotels (for summary table + scoring)
  useEffect(() => {
    if (!invites) return
    const submitted = invites.filter((i) => ['submitted', 'awarded'].includes(i.status))
    if (submitted.length === 0) return
    const ids = submitted.map((i) => i.id)
    Promise.all([
      supabase.from('rfp_responses').select('*').in('invitation_id', ids),
      supabase.from('rfp_answers').select('invitation_id, concession_item_id, answer_yes_no, answer_value, comment').in('invitation_id', ids),
    ]).then(([respRes, ansRes]) => {
      const respMap = new Map<string, HotelResponse>()
      ;(respRes.data ?? []).forEach((r: any) => respMap.set(r.invitation_id, r))

      const ansMap = new Map<string, Answer[]>()
      ;(ansRes.data ?? []).forEach((a: any) => {
        if (!ansMap.has(a.invitation_id)) ansMap.set(a.invitation_id, [])
        ansMap.get(a.invitation_id)!.push(a)
      })

      setAllResponses(respMap)
      setAllAnswers(ansMap)
      setScores(calcScores(submitted, respMap, ansMap))
    })
  }, [invites])

  const selectedInvite = invites?.find((i) => i.id === selectedId) ?? null

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/rfp/${token}`)
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

  const markUnavailable = async (inv: Invitation) => {
    if (!confirm(`Mark "${inv.hotel_name}" as unavailable?\nThey'll be grayed out on the grid.`)) return
    await supabase.from('rfp_invitations').update({ status: 'unavailable' }).eq('id', inv.id)
    loadInvites()
  }

  const doSendReminders = async () => {
    if (!id) return
    setSendingReminders(true); setReminderResult(null); setError(null)
    const result = await sendReminderEmails(id)
    setSendingReminders(false)
    if ('error' in result) setError(result.error)
    else setReminderResult(result)
  }

  const removeTrip = async () => {
    if (!confirm('Delete this trip and all its invitations? This cannot be undone.')) return
    setDeleting(true)
    const { error } = await supabase.from('trips').delete().eq('id', id!)
    if (error) { setError(error.message); setDeleting(false) }
    else navigate('/trips')
  }

  if (error && !trip) return <ErrorNote message={error} />
  if (!trip || !invites) return <Loading />

  const noEmailSent = invites.filter((i) => !i.sent_at && i.hotel_contact_email).length
  const allResponded = invites.length > 0 && invites.filter((i) => ['submitted', 'awarded'].includes(i.status)).length === invites.filter((i) => i.status !== 'passed' && i.status !== 'unavailable').length
  const awarded = invites.find((i) => i.status === 'awarded')

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col -mx-8 -my-8">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">
              {trip.opponent_label || 'Untitled trip'}
            </h1>
            <Badge status={trip.status} />
            {awarded && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">🏆 {awarded.hotel_name}</span>}
          </div>
          <p className="text-sm text-slate-500">
            {[trip.clients?.team_name, trip.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reminderResult && (
            <span className="text-xs font-medium text-emerald-600">✓ {reminderResult.sent} reminder{reminderResult.sent !== 1 ? 's' : ''} sent</span>
          )}
          <button
            onClick={() => setShowTripInfo((s) => !s)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${showTripInfo ? 'border-[#1C1008] bg-[#1C1008] text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            Trip info
          </button>
          <button onClick={doSendReminders} disabled={sendingReminders} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
            {sendingReminders ? 'Sending…' : 'Send reminders'}
          </button>
          <LinkButton to={`/trips/${id}/grid`} variant="secondary">
            Full grid →
          </LinkButton>
          <LinkButton to={`/trips/${id}/edit`} variant="secondary">
            Edit
          </LinkButton>
          <button
            onClick={removeTrip}
            disabled={deleting}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 hover:border-red-300 hover:text-red-700 disabled:opacity-40 transition-colors"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* ── Banners ── */}
      {error && <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-700">{error}</div>}
      {!awarded && noEmailSent > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-800">
          📧 <strong>{noEmailSent} hotel{noEmailSent > 1 ? 's' : ''}</strong> {noEmailSent > 1 ? "haven't" : "hasn't"} been emailed yet — select them on the left and hit <strong>Send email</strong>.
        </div>
      )}
      {!awarded && allResponded && invites.length > 0 && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-6 py-2 text-xs text-emerald-800">
          ✅ All hotels have responded — select a winner below or open the <Link to={`/trips/${id}/grid`} className="font-semibold underline">full comparison grid</Link>.
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
        />
      )}

      {/* ── Body: trip info slide + split panel ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Trip info slide-over */}
        {showTripInfo && (
          <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Trip info</span>
              <div className="flex items-center gap-2">
                <Link to={`/trips/${id}/edit`} className="text-xs text-[#1C1008] hover:underline">Edit</Link>
                <button onClick={() => setShowTripInfo(false)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
            </div>
            <TripInfoPanel trip={trip} />
          </div>
        )}

        {/* Left: hotel list */}
        <div className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
          {invites.length > 0 && <ResponseProgress invites={invites} />}

          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Hotels {invites.length > 0 && `(${invites.length})`}
            </span>
          </div>

          {/* Invite form */}
          {showInvite && (
            <InviteForm
              tripId={id!}
              onDone={() => { setShowInvite(false); loadInvites() }}
              onCancel={() => setShowInvite(false)}
            />
          )}

          {/* Hotel list */}
          <div className="flex-1 overflow-y-auto">
            {invites.length === 0 && !showInvite && (
              <div className="px-4 py-6 text-center text-xs text-slate-400">
                No hotels yet.<br />Add one below to get started.
              </div>
            )}
            {invites.map((inv) => {
              const isSelected = inv.id === selectedId
              const isAwarded = inv.status === 'awarded'
              return (
                <button
                  key={inv.id}
                  onClick={() => setSelectedId(inv.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50 ${
                    isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                  }`}
                >
                  <StatusDot status={inv.status} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-medium ${isAwarded ? 'text-amber-700' : 'text-slate-800'}`}>
                      {isAwarded && '🏆 '}{inv.hotel_name}
                    </div>
                    {inv.hotel_contact_name && (
                      <div className="truncate text-xs text-slate-400">{inv.hotel_contact_name}</div>
                    )}
                  </div>
                  {isSelected && <span className="text-slate-300">›</span>}
                </button>
              )
            })}
          </div>

          {/* Add hotel button */}
          <div className="border-t border-slate-100 p-3">
            <button
              onClick={() => { setShowInvite((s) => !s) }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-[#1C1008] hover:text-[#1C1008] transition-colors"
            >
              + Add hotel
            </button>
          </div>
        </div>

        {/* Right: hotel detail or empty state */}
        <div className="flex-1 overflow-hidden bg-slate-50">
          {selectedInvite ? (
            <HotelPanel
              inv={selectedInvite}
              trip={trip}
              concessionItems={concessionItems}
              preloadedAnswers={allAnswers.get(selectedInvite.id)}
              score={scores.get(selectedInvite.id)}
              onSendEmail={sendEmail}
              onMarkUnavailable={markUnavailable}
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
              emailFlash={emailFlash}
              copied={copied}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              {invites.length === 0 ? 'Add a hotel to get started' : 'Select a hotel to view their bid'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
