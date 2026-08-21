import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getRfp, respondRfp, declineRfp, fetchRfpPrefill } from '../../lib/rfpApi'
import type { RfpPrefill } from '../../lib/rfpApi'
import { supabase } from '../../lib/supabase'
import { formatDate, formatGameTime, publicClientName } from '../../lib/format'
import type {
  AnswerPayload,
  ConcessionItem,
  ExistingAnswer,
  MenuAttachment,
  ResponseFields,
  RfpData,
  ScenarioRate,
} from '../../lib/rfpApi'
import type { DateScenario } from '../../lib/types'

const MENU_BUCKET = 'rfp-menus'
const MAX_MENU_BYTES = 15 * 1024 * 1024

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Public URL for a KJST-provided sample menu (client-sample-menus is a public bucket).
function clientSampleMenuUrl(path: string): string {
  return supabase.storage.from('client-sample-menus').getPublicUrl(path).data.publicUrl
}

// ── Types for local form state ────────────────────────────────────────────────

type AnswerState = {
  answer_yes_no: boolean | null
  answer_value: string
  comment: string
  // show the comment box (auto-shown when Yes/No is 'No', toggleable for others)
  commentOpen: boolean
}

type RespState = {
  completed_by_name: string
  completed_date: string
  best_king_rate: string
  king_rate_notes: string
  current_selling_rate: string
  stay2_king_rate: string
  stay2_selling_rate: string
  stay2_suite_rate: string
  best_suite_rate: string
  occupancy_tax: string
  resort_fee: string
  meeting_space_notes: string
  meeting_space_type: string
  meeting_space_count: string
  general_comments: string
  // Per-scenario rates keyed by night count string: {"1": {rate:"199", available:true}, "2": ...}
  scenario_rates: Record<string, { rate: string; available: boolean }>
}

// ── Small presentational helpers ──────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 border-b border-slate-200 pb-2 text-base font-semibold text-slate-700">
      {children}
    </h2>
  )
}

function FieldLabel({
  children,
  required,
  htmlFor,
}: {
  children: React.ReactNode
  required?: boolean
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
      {children}
      {required && (
        <span className="ml-0.5 text-red-500" aria-hidden="true">
          *
        </span>
      )}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400'

// ── Yes / No toggle ───────────────────────────────────────────────────────────

function YesNoToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean | null
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const base = 'px-4 py-1.5 text-sm font-medium rounded-lg border transition'
  const yes =
    value === true
      ? 'bg-emerald-600 border-emerald-600 text-white'
      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
  const no =
    value === false
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
  return (
    <div className="flex gap-2" role="group">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === true}
        className={`${base} ${yes}`}
        onClick={() => onChange(true)}
      >
        Yes
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === false}
        className={`${base} ${no}`}
        onClick={() => onChange(false)}
      >
        No
      </button>
    </div>
  )
}

// ── Answer control for non-yes_no items ───────────────────────────────────────

function ValueInput({
  item,
  value,
  onChange,
  disabled,
}: {
  item: ConcessionItem
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  if (item.answer_type === 'currency') {
    return (
      <div className="flex items-center">
        <span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          $
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          className={`${inputCls} rounded-l-none`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </div>
    )
  }
  if (item.answer_type === 'percent') {
    return (
      <div className="flex items-center">
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          className={`${inputCls} rounded-r-none`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <span className="rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          %
        </span>
      </div>
    )
  }
  if (item.answer_type === 'quantity') {
    return (
      <input
        type="number"
        min="0"
        className={inputCls}
        placeholder="QTY"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    )
  }
  // text
  return (
    <input
      type="text"
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  )
}

// Some concessions must not be left as a bare "No" — KJST would then have to
// email the hotel to ask for the number. For these, a "No" REQUIRES a note so
// the hotel states the term they can offer. Matched by label so it covers every
// client's copy of the item. Returns the guidance placeholder, or null.
function noteRequirementOnNo(item: ConcessionItem): { placeholder: string } | null {
  if (item.answer_type !== 'yes_no') return null
  const l = item.label.toLowerCase()
  if (l.includes('attrition')) {
    return { placeholder: 'Required: enter the attrition % you can offer (and any notes)…' }
  }
  // "No F&B Minimum at time of contracting" — NOT the separate "3% F&B increase" items.
  if (l.includes('f&b minimum') || l.includes('food and beverage minimum') || l.includes('food & beverage minimum')) {
    return { placeholder: 'Required: enter the F&B minimum ($) you require (and any notes)…' }
  }
  return null
}

// Short labels for the saved-room dropdown (mirrors the Type-of-room select).
const SPACE_TYPE_LABELS: Record<string, string> = {
  function_room: 'Function room',
  restaurant: 'Restaurant',
  suite_converted: 'Suite',
  ballroom: 'Ballroom',
}

// Room-name input with a dropdown of rooms this hotel has used on prior RFPs.
// Not autofilled — the hotel opens it and picks one, which fills name + size +
// type together. Falls back to a plain text input when there's nothing saved.
type SavedRoom = { name: string; dimensions: string; space_type: string }
function RoomNameField({
  id, value, rooms, disabled, placeholder, onName, onPick,
}: {
  id: string
  value: string
  rooms: SavedRoom[]
  disabled?: boolean
  placeholder?: string
  onName: (name: string) => void
  onPick: (room: SavedRoom) => void
}) {
  const [open, setOpen] = useState(false)
  const q = value.trim().toLowerCase()
  const matches = rooms.filter((r) => !q || r.name.toLowerCase().includes(q))
  const show = open && !disabled && matches.length > 0
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        className={inputCls}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onName(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {show && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Rooms you've used before
          </div>
          {matches.map((r, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(r); setOpen(false) }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50"
            >
              <span className="text-slate-800">{r.name}</span>
              <span className="whitespace-nowrap text-xs text-slate-500">
                {[r.dimensions ? `${r.dimensions} sq ft` : '', SPACE_TYPE_LABELS[r.space_type] ?? ''].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Single concession item row ────────────────────────────────────────────────

function ConcessionRow({
  item,
  answer,
  onChange,
  disabled,
  showCommissionWarning,
  hasError,
  noteSuggestion,
  answerPrefilled,
}: {
  item: ConcessionItem
  answer: AnswerState
  onChange: (update: Partial<AnswerState>) => void
  disabled?: boolean
  showCommissionWarning?: boolean
  hasError?: boolean
  noteSuggestion?: string
  answerPrefilled?: boolean
}) {
  const isYesNo = item.answer_type === 'yes_no'
  // Comment-enabled yes/no items show the box automatically on "No" and can also
  // open it manually (e.g. to note a condition or counteroffer while answering Yes).
  const showComment = isYesNo
    ? item.allow_comment === true && (answer.answer_yes_no === false || answer.commentOpen)
    : answer.commentOpen

  const handleYesNo = (v: boolean) => {
    // Toggling to No auto-opens the comment box; Yes keeps any note already open.
    onChange({ answer_yes_no: v, commentOpen: (answer.commentOpen || !v) && item.allow_comment === true })
  }

  const hasRequestedValue =
    item.requested_value && item.requested_value !== '—' && item.requested_value !== null

  const commVal = answer.answer_value?.trim() ?? ''
  const warnZeroCommission = showCommissionWarning && (commVal === '0' || commVal === '')

  // Items where a "No" must be explained (attrition %, F&B minimum $). When the
  // hotel answers No, the note becomes required — so any submit error on this
  // item points at the note box, not the toggle.
  const noReq = noteRequirementOnNo(item)
  const noteRequired = !!noReq && answer.answer_yes_no === false
  const showNoteError = !!hasError && noteRequired
  const showToggleError = !!hasError && !noteRequired

  return (
    <div className="border-b border-slate-100 py-4 last:border-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        {/* Label + requested value */}
        <div className="flex-1">
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">
            {item.label}<span className="ml-0.5 text-red-500">*</span>
          </p>
          {hasRequestedValue && (
            <p className="mt-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                Requested: <span className="font-bold">{item.requested_value}</span>
              </span>
            </p>
          )}
        </div>

        {/* Answer control */}
        <div className="flex-shrink-0 sm:w-48">
          <div
            id={`concession-item-${item.id}`}
            className={showToggleError ? 'rounded-lg ring-2 ring-red-400 p-1' : ''}
          >
          {isYesNo ? (
            <YesNoToggle value={answer.answer_yes_no} onChange={handleYesNo} disabled={disabled} />
          ) : showCommissionWarning ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center">
                <input
                  type="number" min="0" max="100" step="0.1"
                  className={`${inputCls} rounded-r-none`}
                  placeholder="e.g. 10"
                  value={answer.answer_value}
                  onChange={(e) => onChange({ answer_value: e.target.value })}
                  disabled={disabled}
                />
                <span className="rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">%</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['15', '12', '10', '7'].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ answer_value: pct })}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${answer.answer_value === pct ? 'bg-blue-600 text-white' : 'border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600'} disabled:opacity-50`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              {warnZeroCommission && (
                <p className="text-xs text-amber-600">Please enter a commission rate.</p>
              )}
            </div>
          ) : (
            <ValueInput item={item} value={answer.answer_value} onChange={(v) => onChange({ answer_value: v })} disabled={disabled} />
          )}
          </div>
          {showToggleError && (
            <p className="mt-1 text-xs font-medium text-red-500">Required</p>
          )}
          {answerPrefilled && !disabled && (
            <p className="mt-1 text-[10px] font-medium text-blue-600">Prefilled from your last RFP</p>
          )}
        </div>
      </div>

      {/* Inline comment / counteroffer box */}
      {showComment && (
        <div className="mt-3">
          {noteRequired && (
            <p className="mb-1 text-xs font-medium text-slate-600">
              Since you answered No, please note the term you can offer<span className="ml-0.5 text-red-500">*</span>
            </p>
          )}
          <textarea
            className={`${inputCls} resize-none ${showNoteError ? 'ring-2 ring-red-400' : ''}`}
            rows={2}
            placeholder={noteRequired ? noReq!.placeholder : 'Reason or counteroffer…'}
            value={answer.comment}
            onChange={(e) => onChange({ comment: e.target.value })}
            onKeyDown={(e) => {
              // Tab accepts the saved suggestion when the box is still empty.
              if (e.key === 'Tab' && !e.shiftKey && noteSuggestion && !answer.comment?.trim()) {
                e.preventDefault()
                onChange({ comment: noteSuggestion })
              }
            }}
            disabled={disabled}
          />
          {noteSuggestion && !answer.comment?.trim() && !disabled && (
            <div className="mt-1.5 flex items-start gap-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs ring-1 ring-blue-200">
              <span className="whitespace-nowrap font-medium text-blue-600">From your last RFP:</span>
              <span className="flex-1 italic text-slate-600">"{noteSuggestion}"</span>
              <button
                type="button"
                onClick={() => onChange({ comment: noteSuggestion })}
                className="whitespace-nowrap font-semibold text-blue-600 hover:underline"
              >
                Use (Tab)
              </button>
            </div>
          )}
          {showNoteError && (
            <p className="mt-1 text-xs font-medium text-red-500">A note is required when you answer No here.</p>
          )}
        </div>
      )}

      {/* Toggle comment — non-yes/no items, or comment-enabled yes/no items */}
      {(!isYesNo || item.allow_comment === true) && !showComment && !disabled && (
        <button
          type="button"
          className="mt-1.5 text-xs text-[#1C1008]/60 hover:underline"
          onClick={() => onChange({ commentOpen: true })}
        >
          + Add note or counteroffer
        </button>
      )}
    </div>
  )
}

// ── Section grouping labels ────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  concessions: 'Concessions & Facilities',
  facilities: 'Facilities',
  in_season_tournament: 'In-Season Tournament',
  postseason: 'Postseason',
}

// ── RFP header — mirrors the Word doc layout ─────────────────────────────────

type RfpHeaderProps = {
  data: RfpData
  resp: RespState
  setResp: React.Dispatch<React.SetStateAction<RespState>>
  isReadOnly: boolean
  dateScenarios: DateScenario[]
  scenarioAvailability: Record<string, boolean>
  setScenarioAvailability: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  scheduleAutosave: () => void
  visit1Declined: boolean
  visit2Declined: boolean
  prefilledFields: Set<string>
}

function RfpHeader({ data, resp, setResp, isReadOnly, dateScenarios, scenarioAvailability, setScenarioAvailability, scheduleAutosave, visit1Declined, visit2Declined, prefilledFields }: RfpHeaderProps) {
  const { invitation, org } = data
  const trip = invitation.trips
  const client = trip.clients

  // Per-hotel visit scope (default 'both'). A Stay-1-only invitation never shows
  // the Visit 2 rates or dates; Stay-2-only hides Visit 1. Normal trips: 'both'.
  const visitScope = invitation.visit_scope ?? 'both'
  const showVisit1 = visitScope !== 'stay2'
  // hasStay2 == "show the Visit 2 section" (respects the scope, so it's false for
  // a Stay-1-only invitation even though the trip itself has a second stay).
  const hasStay2 = Boolean(trip.stay2_arrival_date) && visitScope !== 'stay1'
  // Night-scenarios feature removed platform-wide: every RFP is single-rate, even
  // for older trips that were saved with multiple night options.
  const scenarios = [1]
  const isMultiScenario = false

  // ── Helper: table cell styles ─────────────────────────────────────────────
  const th = 'border border-slate-300 bg-slate-100 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500'
  const td = 'border border-slate-300 px-3 py-1.5 text-sm text-slate-800'
  const tdLabel = 'border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-32'
  const rateInput = `w-full border-0 bg-transparent px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1C1008] disabled:text-slate-400 min-w-0`

  // Join a list of game dates (falls back to the single game_date column)
  const gameDatesText = (dates: string[] | null | undefined, single: string | null): string | null => {
    const list = dates && dates.length ? dates : single ? [single] : []
    return list.length ? list.map((d) => formatDate(d)).join(', ') : null
  }

  // Nights from a date range, so both visits compute consistently
  const nightsFor = (arr: string | null, dep: string | null): number | null =>
    arr && dep ? Math.round((new Date(dep).getTime() - new Date(arr).getTime()) / 86400000) : null

  // Build dates rows. `game` is already-formatted text (may list several dates).
  const dateRows: Array<{ opponent: string; arr: string | null; dep: string | null; nts: number | null; game: string | null; time: string | null }> = []
  if (showVisit1) dateRows.push({
    opponent: trip.opponent_label || '—',
    arr: trip.arrival_date,
    dep: trip.departure_date,
    nts: nightsFor(trip.arrival_date, trip.departure_date) ?? trip.nights,
    game: gameDatesText(trip.game_dates, trip.game_date),
    time: formatGameTime(trip.game_time),
  })
  if (hasStay2) {
    const arr = trip.stay2_arrival_date
    const dep = trip.stay2_departure_date
    const nts = nightsFor(arr, dep)
    dateRows.push({
      opponent: trip.opponent_label ? `${trip.opponent_label} (Visit 2)` : 'Visit 2',
      arr, dep, nts,
      game: gameDatesText(trip.stay2_game_dates, trip.stay2_game_date),
      time: formatGameTime(trip.stay2_game_time),
    })
  }

  const setScenarioRate = (n: number, field: 'rate' | 'available', value: string | boolean) => {
    setResp((r) => {
      const updated = {
        ...r,
        scenario_rates: {
          ...r.scenario_rates,
          [String(n)]: {
            rate: r.scenario_rates[String(n)]?.rate ?? '',
            available: r.scenario_rates[String(n)]?.available ?? true,
            [field]: value,
          },
        },
      }
      // Keep best_king_rate in sync with the 1-night scenario rate for backward compat
      if (n === 1 && field === 'rate' && typeof value === 'string') {
        updated.best_king_rate = value
      }
      return updated
    })
  }

  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between bg-[#1C1008] px-6 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-white/50">KJ Sports Travel</div>
          <div className="mt-0.5 text-lg font-bold text-white">Hotel RFP</div>
        </div>
        {org?.season_label && (
          <div className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
            {org.season_label}
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* ── Hotel name & city ── */}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Hotel Name &amp; City</p>
          <p className="text-xl font-bold text-slate-900">
            {invitation.hotel_name}{trip.city ? ` — ${trip.city}` : ''}
          </p>
          {trip.response_deadline && (
            <p className="mt-1 text-xs text-red-600 font-medium">
              Response deadline: {formatDate(trip.response_deadline)}
            </p>
          )}
        </div>

        {/* ── Contact table ── */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={tdLabel} />
                <th className={th}>Organization Contact</th>
                <th className={th}>Third Party Travel Agency Contact{org?.iata_number ? ` (IATA ${org.iata_number})` : ''}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Company', publicClientName(client.team_name), org?.name || 'KJ Sports Travel'],
                ['Name', client.primary_contact_name, org?.contact_name],
                ['Title', client.primary_contact_title, org?.contact_title],
                ['Address', client.primary_contact_address, org?.contact_address],
                ['Phone', client.primary_contact_phone, org?.contact_phone],
                ['E-mail', client.primary_contact_email, org?.contact_email],
              ].map(([label, left, right]) => (
                <tr key={label as string}>
                  <td className={tdLabel}>{label}</td>
                  <td className={td}>{left || '—'}</td>
                  <td className={td}>{right || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Room Block ── */}
        <div className="overflow-x-auto">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Room Block</p>
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>King Room</th>
                <th className={th}>Double Room</th>
                <th className={th}>One Bedroom Suite</th>
                <th className={th}>Total Rooms</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${td} text-center`}>{trip.king_rooms_requested ?? '—'}</td>
                <td className={`${td} text-center`}>{trip.double_rooms_requested ?? '—'}</td>
                <td className={`${td} text-center`}>{trip.suites_requested ?? '—'}</td>
                <td className={`${td} text-center font-semibold`}>{trip.total_rooms_requested ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Dates ── */}
        <div className="overflow-x-auto">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dates</p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Opponent</th>
                <th className={th}>Arr Date</th>
                <th className={th}>Dep Date</th>
                <th className={th}>Nts</th>
                <th className={th}>Game Date</th>
                <th className={th}>Game Time</th>
              </tr>
            </thead>
            <tbody>
              {dateRows.map((row, i) => (
                <tr key={i}>
                  <td className={td}>{row.opponent}</td>
                  <td className={td}>{formatDate(row.arr)}</td>
                  <td className={td}>{formatDate(row.dep)}</td>
                  <td className={`${td} text-center`}>{row.nts ?? '—'}</td>
                  <td className={td}>{row.game || '—'}</td>
                  <td className={td}>{row.time || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Rates — inline inputs matching Word doc layout ── */}
        {isMultiScenario ? (
          /* Multi-scenario: scenario table */
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rates</p>
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <strong>Multiple night scenarios requested.</strong> Please provide a King rate for each scenario below.
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Scenario</th>
                  <th className={th}>King Rate (per night)</th>
                  <th className={th}>Suite Rate ($)</th>
                  <th className={th}>Occupancy Tax</th>
                  <th className={th}>Available?</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.sort((a, b) => a - b).map((n) => {
                  const sr = resp.scenario_rates[String(n)] ?? { rate: '', available: true }
                  return (
                    <tr key={n}>
                      <td className={td}><span className="font-medium">{n} night{n > 1 ? 's' : ''}</span></td>
                      <td className="border border-slate-300 p-0">
                        <div className="flex items-center">
                          <span className="border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-400">$</span>
                          <input type="number" min="0" step="0.01" className={rateInput} value={sr.rate}
                            onChange={(e) => setScenarioRate(n, 'rate', e.target.value)}
                            disabled={isReadOnly || !sr.available} placeholder="0.00" />
                        </div>
                      </td>
                      <td className="border border-slate-300 p-0">
                        <div className="flex items-center">
                          <span className="border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-400">$</span>
                          <input type="number" min="0" step="0.01" className={rateInput}
                            value={n === scenarios[0] ? resp.best_suite_rate : (n === scenarios[1] ? resp.stay2_suite_rate : '')}
                            onChange={(e) => setResp((r) => ({ ...r, [n === scenarios[0] ? 'best_suite_rate' : 'stay2_suite_rate']: e.target.value }))}
                            disabled={isReadOnly} placeholder="0.00" />
                        </div>
                      </td>
                      <td className="border border-slate-300 p-0">
                        {n === scenarios[0] && (
                          <input type="text" className={rateInput} value={resp.occupancy_tax}
                            onChange={(e) => setResp((r) => ({ ...r, occupancy_tax: e.target.value }))}
                            disabled={isReadOnly} placeholder="e.g. 16.9% + $5/night" />
                        )}
                      </td>
                      <td className={td}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
                            checked={sr.available}
                            onChange={(e) => setScenarioRate(n, 'available', e.target.checked)}
                            disabled={isReadOnly} />
                          <span className={`text-xs ${sr.available ? 'text-slate-700' : 'text-slate-400'}`}>
                            {sr.available ? 'Available' : 'Not available'}
                          </span>
                        </label>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        ) : (
          /* Single scenario: horizontal rate row matching Word doc */
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rates</p>
            {visit1Declined && (
              <div className="mb-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Visit 1 — Declined, no King/Suite/Selling rate required.
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr>
                  {showVisit1 && !visit1Declined && (
                    <>
                      <th className={th}>
                        Best Available King/Double Rate(s){hasStay2 ? ' — Visit 1' : ''}
                      </th>
                      <th className={th}>VS. Current Selling Rate</th>
                      <th className={th}>Best Available Suite Rate(s){hasStay2 ? ' — Visit 1' : ''}</th>
                    </>
                  )}
                  <th className={th}>Occupancy Tax</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {showVisit1 && !visit1Declined && (
                    <>
                      <td className="border border-slate-300 p-0">
                        <div className="flex items-center">
                          <span className="border-r border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">$</span>
                          <input id="rate-king" type="number" min="0" step="0.01" className={rateInput}
                            value={resp.best_king_rate} placeholder="0.00" aria-required="true"
                            onChange={(e) => setResp((r) => ({ ...r, best_king_rate: e.target.value }))}
                            disabled={isReadOnly} />
                        </div>
                      </td>
                      <td className="border border-slate-300 p-0">
                        <input id="rate-selling" type="text" className={rateInput} value={resp.current_selling_rate}
                          placeholder="e.g. $595"
                          onChange={(e) => setResp((r) => ({ ...r, current_selling_rate: e.target.value }))}
                          disabled={isReadOnly} />
                      </td>
                      <td className="border border-slate-300 p-0">
                        <div className="flex items-center">
                          <span className="border-r border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">$</span>
                          <input id="rate-suite" type="number" min="0" step="0.01" className={rateInput}
                            value={resp.best_suite_rate} placeholder="0.00"
                            onChange={(e) => setResp((r) => ({ ...r, best_suite_rate: e.target.value }))}
                            disabled={isReadOnly} />
                        </div>
                      </td>
                    </>
                  )}
                  <td className="border border-slate-300 p-0">
                    <input id="rate-occupancy" type="text" className={rateInput} value={resp.occupancy_tax}
                      placeholder="e.g. 16.9% + $5/night"
                      onChange={(e) => setResp((r) => ({ ...r, occupancy_tax: e.target.value }))}
                      disabled={isReadOnly} />
                    {prefilledFields.has('occupancy_tax') && !!resp.occupancy_tax?.trim() && (
                      <div className="px-2 pb-1 text-[10px] font-medium text-blue-600">Prefilled from your last RFP</div>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
            {/* Visit 2 rates row */}
            {hasStay2 && (
              visit2Declined ? (
                <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Visit 2 — Declined, no rates required.
                </div>
              ) : (
              <div className="mt-1 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>King Rate — Visit 2 ({formatDate(trip.stay2_arrival_date)} – {formatDate(trip.stay2_departure_date)})</th>
                    <th className={th}>VS. Current Selling Rate — Visit 2</th>
                    <th className={th}>Suite Rate — Visit 2</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 p-0">
                      <div className="flex items-center">
                        <span className="border-r border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">$</span>
                        <input id="rate-stay2-king" type="number" min="0" step="0.01" className={rateInput}
                          value={resp.stay2_king_rate} placeholder="0.00"
                          onChange={(e) => setResp((r) => ({ ...r, stay2_king_rate: e.target.value }))}
                          disabled={isReadOnly} />
                      </div>
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input id="rate-stay2-selling" type="text" className={rateInput} value={resp.stay2_selling_rate}
                        placeholder="e.g. $685"
                        onChange={(e) => setResp((r) => ({ ...r, stay2_selling_rate: e.target.value }))}
                        disabled={isReadOnly} />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <div className="flex items-center">
                        <span className="border-r border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">$</span>
                        <input id="rate-stay2-suite" type="number" min="0" step="0.01" className={rateInput}
                          value={resp.stay2_suite_rate} placeholder="0.00"
                          onChange={(e) => setResp((r) => ({ ...r, stay2_suite_rate: e.target.value }))}
                          disabled={isReadOnly} />
                      </div>
                    </td>
                    <td className="border border-slate-300 p-0" />
                  </tr>
                </tbody>
              </table>
              </div>
              )
            )}
          </div>
        )}

        {/* ── Date Scenario Availability ── REMOVED from the workflow (kept
            hidden so any legacy trip's data is preserved but never shown). ── */}
        {false && dateScenarios.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Date Scenario Availability
            </p>
            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              The team's travel dates are not yet confirmed. Please indicate which of the following date windows you can accommodate.
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Scenario</th>
                  <th className={th}>Arrival</th>
                  <th className={th}>Departure</th>
                  <th className={th}>Game Date</th>
                  <th className={th}>Available?</th>
                </tr>
              </thead>
              <tbody>
                {dateScenarios.map((s) => (
                  <tr key={s.label}>
                    <td className={td}><span className="font-semibold">Scenario {s.label}</span></td>
                    <td className={td}>{formatDate(s.arrival_date)}</td>
                    <td className={td}>{formatDate(s.departure_date)}</td>
                    <td className={td}>{s.game_date ? formatDate(s.game_date) : '—'}</td>
                    <td className={td}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
                          checked={scenarioAvailability[s.label] ?? true}
                          onChange={(e) => {
                            setScenarioAvailability((prev) => ({ ...prev, [s.label]: e.target.checked }))
                            scheduleAutosave()
                          }}
                          disabled={isReadOnly}
                        />
                        <span className={`text-xs ${(scenarioAvailability[s.label] ?? true) ? 'text-slate-700' : 'text-slate-400'}`}>
                          {(scenarioAvailability[s.label] ?? true) ? 'Available' : 'Not available'}
                        </span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ── Resort Fee (optional) ── */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Resort Fee (if applicable)
          </label>
          <p className="mb-1.5 text-xs text-slate-400">
            Enter the nightly resort/destination fee if your property charges one. Leave blank if none.
          </p>
          <input type="text" className={`${inputCls} text-sm`}
            value={resp.resort_fee}
            onChange={(e) => setResp((r) => ({ ...r, resort_fee: e.target.value }))}
            disabled={isReadOnly}
            placeholder="e.g. $35/night" />
          {prefilledFields.has('resort_fee') && !!resp.resort_fee?.trim() && (
            <div className="mt-1 text-[10px] font-medium text-blue-600">Prefilled from your last RFP</div>
          )}
        </div>

        {/* ── Rate notes (optional) ── */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Rate Notes <span className="font-normal normal-case text-slate-300">(optional — any variances, constraints, or special pricing)</span>
          </label>
          <input type="text" className={`${inputCls} text-sm`}
            value={resp.king_rate_notes}
            onChange={(e) => setResp((r) => ({ ...r, king_rate_notes: e.target.value }))}
            disabled={isReadOnly}
            placeholder="e.g. Rate subject to availability on game night…" />
        </div>

        {/* ── Instruction text ── */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Select <strong>Yes</strong> or <strong>No</strong> for the list of concessions below. If No is selected, note the reason or counteroffer in the comment field.
        </div>
      </div>
    </div>
  )
}


// ── Main form ─────────────────────────────────────────────────────────────────

export default function RfpForm() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<RfpData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set())

  // Decline flow — auto-open if email link included ?decline=1
  const [declined, setDeclined] = useState(false)
  const [showDeclinePanel, setShowDeclinePanel] = useState(searchParams.get('decline') === '1')
  // KJST staff filling the bid on the hotel's behalf (?entry=staff): suppresses
  // the hotel's confirmation email on submit and shows an internal banner.
  const staffEntry = searchParams.get('entry') === 'staff'
  const [declineReason, setDeclineReason] = useState('')
  const [declineNotes, setDeclineNotes] = useState('')
  const [declining, setDeclining] = useState(false)
  const [declineError, setDeclineError] = useState<string | null>(null)
  // Which visit the decline applies to on a two-visit trip ('both' when the
  // trip only has one visit, or when the hotel explicitly declines everything)
  const [declineScope, setDeclineScope] = useState<'both' | 1 | 2>('both')
  const [visit1Declined, setVisit1Declined] = useState(false)
  const [visit2Declined, setVisit2Declined] = useState(false)

  // Auto-populate profile from this hotel's prior RFPs (tax prefill, saved rooms,
  // per-line note suggestions). Only ever this hotel's own past answers.
  const [prefill, setPrefill] = useState<RfpPrefill | null>(null)
  const [prefillDismissed, setPrefillDismissed] = useState(false)
  const [prefilledFields, setPrefilledFields] = useState<Set<string>>(new Set())
  const [prefilledAnswers, setPrefilledAnswers] = useState<Set<string>>(new Set()) // clause items whose Yes/No was prefilled

  // Night scenarios state — populated from loaded trip data
  const [nightScenarios, setNightScenarios] = useState<number[]>([1])

  // Date scenarios — candidate date sets when exact dates are TBD
  const [dateScenarios, setDateScenarios] = useState<DateScenario[]>([])
  // Which date scenarios this hotel confirms availability for
  const [scenarioAvailability, setScenarioAvailability] = useState<Record<string, boolean>>({})

  // Per-space detail state for meeting spaces
  // Per-room meeting space details keyed by concession item ID (or index for additional)
  type SpaceDetail = { name: string; space_type: string; dimensions: string; fb_minimum: string; wifi: string; additional_info: string }
  const emptySpace = (): SpaceDetail => ({ name: '', space_type: '', dimensions: '', fb_minimum: '', wifi: '', additional_info: '' })
  const [meetingSpaceDetails, setMeetingSpaceDetails] = useState<Record<string, SpaceDetail>>({})
  // Additional spaces beyond the 4 requested rooms
  const [additionalSpaces, setAdditionalSpaces] = useState<SpaceDetail[]>([])

  // Fixed named sub-spaces required by a "(3) complimentary function spaces"
  // item — just a room name and square footage per space, no type/Wi-Fi.
  type NamedSpaceDetail = { name: string; dimensions: string; spaceLabel: string }
  const NAMED_FUNCTION_SPACES: { key: string; label: string }[] = [
    { key: 'meal_room', label: 'Meal Room' },
    { key: 'treatment_room', label: 'Treatment Room' },
    { key: 'coaches_meeting_room', label: 'Coaches Meeting Room' },
  ]
  const emptyNamedSpace = (label: string): NamedSpaceDetail => ({ name: '', dimensions: '', spaceLabel: label })
  const [namedSpaceDetails, setNamedSpaceDetails] = useState<Record<string, Record<string, NamedSpaceDetail>>>({})

  // Form state
  const [resp, setResp] = useState<RespState>({
    completed_by_name: '',
    completed_date: new Date().toISOString().slice(0, 10),
    best_king_rate: '',
    king_rate_notes: '',
    current_selling_rate: '',
    stay2_king_rate: '',
    stay2_selling_rate: '',
    stay2_suite_rate: '',
    best_suite_rate: '',
    occupancy_tax: '',
    resort_fee: '',
    meeting_space_notes: '',
    meeting_space_type: '',
    meeting_space_count: '',
    general_comments: '',
    scenario_rates: {},
  })
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  // Hotel-uploaded menus / F&B pricing files (kept separate from the string-only RespState).
  const [menuAttachments, setMenuAttachments] = useState<MenuAttachment[]>([])
  const [menuUploading, setMenuUploading] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)

  // Track whether we need to save
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const respRef = useRef(resp)
  const answersRef = useRef(answers)
  const menuAttachmentsRef = useRef(menuAttachments)
  respRef.current = resp
  answersRef.current = answers
  menuAttachmentsRef.current = menuAttachments

  // --- Load ---
  useEffect(() => {
    if (!token) return
    getRfp(token)
      .then((d) => {
        setData(d)
        // A submitted bid is locked EXCEPT when staff reopened it for edits
        // (reopened_at is newer than submitted_at). Then it opens back up so the
        // hotel can revise and resubmit — their answers pre-load either way.
        const reopenedForEdit =
          !!d.invitation.reopened_at &&
          !!d.invitation.submitted_at &&
          new Date(d.invitation.reopened_at).getTime() > new Date(d.invitation.submitted_at).getTime()
        // Staff editing on the hotel's behalf (?entry=staff) can always edit a
        // submitted bid in place — e.g. a rate renegotiated offline — without
        // reopening it to the hotel or sending any email.
        if (d.invitation.status === 'submitted' && !reopenedForEdit && !staffEntry) setSubmitted(true)
        if (d.invitation.status === 'declined' && !staffEntry) setDeclined(true)
        if (d.invitation.visit1_declined) setVisit1Declined(true)
        if (d.invitation.visit2_declined) setVisit2Declined(true)

        // Populate night scenarios from the trip
        setNightScenarios(d.invitation.trips.night_scenarios ?? [1])

        // Populate date scenarios from the trip
        if (d.invitation.trips.date_scenarios?.length) {
          setDateScenarios(d.invitation.trips.date_scenarios)
          // Default all scenarios to available until hotel says otherwise
          const defaultAvail: Record<string, boolean> = {}
          for (const s of d.invitation.trips.date_scenarios) defaultAvail[s.label] = true
          setScenarioAvailability(defaultAvail)
        }

        // Populate existing response if save-and-resume
        if (d.response) {
          const r = d.response
          // Restore scenario rates from saved JSON
          const savedScenarioRates: Record<string, { rate: string; available: boolean }> = {}
          if (r.scenario_rates) {
            for (const [k, v] of Object.entries(r.scenario_rates as Record<string, ScenarioRate>)) {
              savedScenarioRates[k] = { rate: v.rate != null ? String(v.rate) : '', available: v.available }
            }
          }
          setResp({
            completed_by_name: r.completed_by_name ?? '',
            completed_date: r.completed_date ?? new Date().toISOString().slice(0, 10),
            best_king_rate: r.best_king_rate != null ? String(r.best_king_rate) : '',
            king_rate_notes: r.king_rate_notes ?? '',
            current_selling_rate: r.current_selling_rate ?? '',
            stay2_king_rate: r.stay2_king_rate != null ? String(r.stay2_king_rate) : '',
            stay2_selling_rate: r.stay2_selling_rate ?? '',
            stay2_suite_rate: r.stay2_suite_rate != null ? String(r.stay2_suite_rate) : '',
            best_suite_rate: r.best_suite_rate != null ? String(r.best_suite_rate) : '',
            occupancy_tax: r.occupancy_tax ?? '',
            resort_fee: r.resort_fee ?? '',
            meeting_space_notes: '',   // serialised from meetingSpaces on save
            meeting_space_type: r.meeting_space_type ?? '',
            meeting_space_count: r.meeting_space_count != null ? String(r.meeting_space_count) : '',
            general_comments: r.general_comments ?? '',
            scenario_rates: savedScenarioRates,
          })

          // Restore any previously uploaded menus / F&B pricing files
          setMenuAttachments(Array.isArray(r.menu_attachments) ? r.menu_attachments : [])

          // Restore date scenario availability
          if (r.scenario_availability) {
            setScenarioAvailability(r.scenario_availability)
          }

          // Restore per-room meeting space details and additional spaces from saved JSON
          if (r.meeting_space_notes) {
            try {
              const parsed = JSON.parse(r.meeting_space_notes)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if (parsed.__details) setMeetingSpaceDetails(parsed.__details)
                if (Array.isArray(parsed.__additional)) setAdditionalSpaces(parsed.__additional)
                if (parsed.__named) setNamedSpaceDetails(parsed.__named)
              }
            } catch {
              // Legacy plain-text — ignore, hotel will re-enter
            }
          }
        }

        // Populate existing answers
        const answerMap: Record<string, AnswerState> = {}
        d.items.forEach((item) => {
          const existing: ExistingAnswer | undefined = d.answers.find(
            (a) => a.concession_item_id === item.id,
          )
          answerMap[item.id] = {
            answer_yes_no: existing?.answer_yes_no ?? null,
            answer_value: existing?.answer_value ?? '',
            comment: existing?.comment ?? '',
            commentOpen: existing?.comment ? true : existing?.answer_yes_no === false,
          }
        })
        setAnswers(answerMap)

        // Pull this hotel's prior-RFP profile and prefill the stable single
        // values (tax / resort fee) only where the field is still empty. Runs
        // after the loaded response is applied so it never clobbers real data.
        fetchRfpPrefill(token)
          .then((p) => {
            if (!p.found) return
            setPrefill(p)
            const filled = new Set<string>()
            setResp((prev) => {
              const patch: Partial<typeof prev> = {}
              if (!prev.occupancy_tax?.trim() && p.occupancyTax) { patch.occupancy_tax = p.occupancyTax; filled.add('occupancy_tax') }
              if (!prev.resort_fee?.trim() && p.resortFee) { patch.resort_fee = p.resortFee; filled.add('resort_fee') }
              return Object.keys(patch).length ? { ...prev, ...patch } : prev
            })
            if (filled.size) setPrefilledFields((s) => new Set([...s, ...filled]))

            // Prefill the in-season / postseason clause answers (hotels answer
            // these the same way each time). Only where still unanswered, and
            // only from the email-locked `answers` the server returned.
            if (p.answers) {
              const clauseIds = d.items
                .filter((i) => i.section === 'in_season_tournament' || i.section === 'postseason')
                .map((i) => i.id)
              const prefilled = new Set<string>()
              setAnswers((prev) => {
                const next = { ...prev }
                for (const id of clauseIds) {
                  const pa = p.answers?.[id]
                  if (!pa || (pa.yesNo == null && !pa.value)) continue
                  const cur = next[id]
                  const unanswered = !cur || (cur.answer_yes_no == null && !cur.answer_value?.trim())
                  if (!unanswered) continue
                  next[id] = {
                    answer_yes_no: pa.yesNo,
                    answer_value: pa.value || (cur?.answer_value ?? ''),
                    comment: cur?.comment ?? '',
                    commentOpen: cur?.commentOpen ?? false,
                  }
                  prefilled.add(id)
                }
                return next
              })
              if (prefilled.size) setPrefilledAnswers((s) => new Set([...s, ...prefilled]))
            }
          })
          .catch(() => { /* prefill is best-effort; never block the form */ })
      })
      .catch((e) => setLoadError(e.message))
  }, [token])

  // --- Save helper (also used by submit) ---
  const doSave = useCallback(
    async (submit = false): Promise<boolean> => {
      if (!token) return false
      const r = respRef.current
      const a = answersRef.current

      const answerPayload: AnswerPayload[] = Object.entries(a).map(([itemId, state]) => ({
        concession_item_id: itemId,
        answer_yes_no: state.answer_yes_no,
        answer_value: state.answer_value.trim() || null,
        comment: state.comment.trim() || null,
      }))

      // Convert scenario_rates string form to numeric
      const scenarioRatesPayload: Record<string, ScenarioRate> | null =
        Object.keys(r.scenario_rates).length > 0
          ? Object.fromEntries(
              Object.entries(r.scenario_rates).map(([k, v]) => [
                k,
                { rate: v.rate ? Number(v.rate) : null, available: v.available },
              ]),
            )
          : null

      const responsePayload: ResponseFields = {
        completed_by_name: r.completed_by_name,
        completed_date: r.completed_date,
        best_king_rate: r.best_king_rate ? Number(r.best_king_rate) : null,
        king_rate_notes: r.king_rate_notes,
        current_selling_rate: r.current_selling_rate,
        stay2_king_rate: r.stay2_king_rate ? Number(r.stay2_king_rate) : null,
        stay2_suite_rate: r.stay2_suite_rate ? Number(r.stay2_suite_rate) : null,
        stay2_selling_rate: r.stay2_selling_rate,
        best_suite_rate: r.best_suite_rate ? Number(r.best_suite_rate) : null,
        occupancy_tax: r.occupancy_tax,
        resort_fee: r.resort_fee,
        meeting_space_notes:
          Object.keys(meetingSpaceDetails).length > 0 || additionalSpaces.length > 0 || Object.keys(namedSpaceDetails).length > 0
            ? JSON.stringify({ __details: meetingSpaceDetails, __additional: additionalSpaces, __named: namedSpaceDetails })
            : '',
        meeting_space_type: r.meeting_space_type || null,
        meeting_space_count: r.meeting_space_count ? Number(r.meeting_space_count) : null,
        general_comments: r.general_comments,
        scenario_rates: scenarioRatesPayload,
        scenario_availability: Object.keys(scenarioAvailability).length > 0 ? scenarioAvailability : null,
        menu_attachments: menuAttachmentsRef.current,
      }

      try {
        await respondRfp({ token, response: responsePayload, answers: answerPayload, submit, staffEntry })
        return true
      } catch (e: unknown) {
        if (!submit) {
          setSaveStatus('error')
          setSaveError((e as Error).message)
        }
        return false
      }
    },
    [token, meetingSpaceDetails, additionalSpaces, namedSpaceDetails, scenarioAvailability],
  )

  // --- Decline ---
  const hasStay2ForDecline = Boolean(data?.invitation.trips.stay2_arrival_date) && (data?.invitation.visit_scope ?? 'both') !== 'stay1'
  const handleDecline = async () => {
    if (!token || !declineReason) return
    setDeclining(true)
    setDeclineError(null)
    try {
      const visitArg: 1 | 2 | undefined =
        hasStay2ForDecline && declineScope !== 'both' ? declineScope : undefined
      const result = await declineRfp({ token, decline_reason: declineReason, decline_notes: declineNotes || undefined, visit: visitArg })
      if (visitArg === 1) setVisit1Declined(true)
      else if (visitArg === 2) setVisit2Declined(true)
      else {
        setVisit1Declined(true)
        if (hasStay2ForDecline) setVisit2Declined(true)
      }
      if (!hasStay2ForDecline || result.fully_declined || declineScope === 'both') setDeclined(true)
      else {
        setShowDeclinePanel(false)
        setDeclineReason('')
        setDeclineNotes('')
        setDeclineScope('both')
      }
    } catch (e: unknown) {
      setDeclineError((e as Error).message)
    } finally {
      setDeclining(false)
    }
  }

  // --- Autosave: debounce 1.5s after any field change ---
  const scheduleAutosave = useCallback(() => {
    if (submitted) return
    dirty.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving')
      const ok = await doSave(false)
      setSaveStatus(ok ? 'saved' : 'error')
      dirty.current = false
    }, 1500)
  }, [doSave, submitted])

  // Upload menu / F&B pricing files straight to the private rfp-menus bucket,
  // then autosave the paths onto the response. Anon can upload but not read, so
  // one hotel can never see another's file.
  const handleMenuUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !token) return
      setMenuError(null)
      setMenuUploading(true)
      try {
        const added: MenuAttachment[] = []
        for (const file of Array.from(files)) {
          if (file.size > MAX_MENU_BYTES) {
            setMenuError(`"${file.name}" is larger than 15 MB — please upload a smaller file.`)
            continue
          }
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
          const path = `${token}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
          const { error } = await supabase.storage
            .from(MENU_BUCKET)
            .upload(path, file, { contentType: file.type || undefined, upsert: false })
          if (error) {
            setMenuError(`Could not upload "${file.name}": ${error.message}`)
            continue
          }
          added.push({ path, name: file.name, size: file.size, type: file.type || undefined })
        }
        if (added.length > 0) {
          setMenuAttachments((prev) => [...prev, ...added])
          scheduleAutosave()
        }
      } finally {
        setMenuUploading(false)
      }
    },
    [token, scheduleAutosave],
  )

  const removeMenuAttachment = useCallback(
    (path: string) => {
      setMenuAttachments((prev) => prev.filter((m) => m.path !== path))
      scheduleAutosave()
    },
    [scheduleAutosave],
  )

  // Trigger autosave whenever any answer field changes (but not on initial load).
  // Includes the meeting-space detail state — previously only [resp, answers] was
  // watched, so room-name / square-footage edits weren't saved until some other
  // change happened to fire an autosave; on refresh those edits could be lost.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    scheduleAutosave()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp, answers, meetingSpaceDetails, additionalSpaces, namedSpaceDetails, scenarioAvailability])

  // --- Submit ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)
    setFieldErrors(new Set())

    // Take the hotel straight to the offending field instead of a generic
    // "scroll to top", so they can find and fix the mistake immediately.
    const focusField = (id: string) => {
      const el = document.getElementById(id) as HTMLElement | null
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (el) setTimeout(() => el.focus(), 350)
    }

    if (!resp.completed_by_name.trim()) {
      setValidationError('Please enter the name of the person completing this form.')
      document.getElementById('rfp-completed-by')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (!resp.completed_date) {
      setValidationError('Please enter the date for the person completing this form.')
      document.getElementById('rfp-date')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const scenarios = nightScenarios
    const isMultiScenario = scenarios.length > 1
    // Respect the per-hotel visit scope: a Stay-2-only invitation never asks for
    // Visit 1 rates, a Stay-1-only one never asks for Visit 2.
    const submitScope = data?.invitation.visit_scope ?? 'both'
    const scopeShowsV1 = submitScope !== 'stay2'
    if (scopeShowsV1 && !visit1Declined && !isMultiScenario && !resp.best_king_rate.trim()) {
      setValidationError('Best Available King Rate is required before submitting.')
      focusField('rate-king')
      return
    }
    if (!visit1Declined && isMultiScenario) {
      const availableScenarios = scenarios.filter((n) => resp.scenario_rates[String(n)]?.available !== false)
      const missingRates = availableScenarios.filter((n) => !resp.scenario_rates[String(n)]?.rate?.trim())
      if (missingRates.length > 0) {
        setValidationError(`Please enter king rates for all available scenarios (missing: ${missingRates.map((n) => `${n} night${n > 1 ? 's' : ''}`).join(', ')}).`)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
    }

    // Required: VS. Current Selling Rate
    if (!visit1Declined && !isMultiScenario && !resp.current_selling_rate.trim()) {
      setValidationError('VS. Current Selling Rate is required before submitting.')
      focusField('rate-selling')
      return
    }

    // Required: Occupancy Tax — one shared value for the property, not
    // per-visit, so it's still required as long as any visit is active
    if (!resp.occupancy_tax.trim()) {
      setValidationError('Occupancy Tax is required before submitting.')
      focusField('rate-occupancy')
      return
    }

    // Required: Suite Rate (always)
    if (!visit1Declined && !isMultiScenario && !resp.best_suite_rate.trim()) {
      setValidationError('Best Available Suite Rate is required before submitting.')
      focusField('rate-suite')
      return
    }

    // Required: Visit 2 rates when a second stay exists and it wasn't declined
    const hasStay2Val = Boolean(data?.invitation.trips.stay2_arrival_date) && submitScope !== 'stay1'
    if (hasStay2Val && !visit2Declined) {
      if (!resp.stay2_king_rate.trim()) {
        setValidationError('King Rate for Visit 2 is required before submitting.')
        focusField('rate-stay2-king')
        return
      }
      if (!resp.stay2_selling_rate.trim()) {
        setValidationError('VS. Current Selling Rate for Visit 2 is required before submitting.')
        focusField('rate-stay2-selling')
        return
      }
      if (!resp.stay2_suite_rate.trim()) {
        setValidationError('Suite Rate for Visit 2 is required before submitting.')
        focusField('rate-stay2-suite')
        return
      }
    }

    // Warn if commission is zero
    const commissionItem = data?.items.find(
      (i) => i.answer_type === 'percent' && (i.label.toLowerCase().includes('commissionable') || i.label.toLowerCase().includes('commission')),
    )
    if (commissionItem) {
      const commVal = answers[commissionItem.id]?.answer_value?.trim() ?? ''
      if (commVal === '0' || commVal === '') {
        const ok = window.confirm(
          'Commission is set to 0% (or not filled in). Are you sure you want to submit with 0% commission?'
        )
        if (!ok) return
      }
    }

    // Meeting space detail fields required when hotel answered Yes
    const msYesNoItems = (data?.items ?? []).filter(
      (item) => item.answer_type === 'yes_no' && item.label.toLowerCase().includes('complimentary meeting space'),
    )
    const msErrors: string[] = []
    for (const item of msYesNoItems) {
      if (answers[item.id]?.answer_yes_no === true) {
        const detail = meetingSpaceDetails[item.id]
        const label = item.label.replace(/\[.*?\]/g, '…').slice(0, 50)
        if (!detail?.name?.trim()) msErrors.push(`${label} — Room name`)
        if (!detail?.space_type) msErrors.push(`${label} — Type of room`)
        if (!detail?.dimensions?.trim()) msErrors.push(`${label} — Size of room`)
      }
    }
    for (let idx = 0; idx < additionalSpaces.length; idx++) {
      const space = additionalSpaces[idx]
      const prefix = `Additional Space ${idx + 1}`
      if (!space.name?.trim()) msErrors.push(`${prefix} — Room name`)
      if (!space.space_type) msErrors.push(`${prefix} — Type of room`)
      if (!space.dimensions?.trim()) msErrors.push(`${prefix} — Size of room`)
    }

    // Named function-space fields (Meal Room / Treatment Room / Coaches
    // Meeting Room) required when the hotel answered Yes. Must mirror the RENDER
    // filter (isNamedFunctionSpaceItem) EXACTLY: an item that also says
    // "complimentary meeting space" (e.g. the Timberwolves' Treatment Room item,
    // whose body mentions "Treatment Room/Function space") is rendered as a
    // single room-detail card, not the 3 named sub-spaces — so validating it as a
    // named-function-space item demanded fields the form never showed, blocking
    // submission. Exclude those here so validation and render agree.
    const namedFnItems = (data?.items ?? []).filter(
      (item) =>
        item.answer_type === 'yes_no' &&
        item.label.toLowerCase().includes('function space') &&
        !item.label.toLowerCase().includes('complimentary meeting space'),
    )
    // Simple/sponsor-block mode: the function-space question is informational —
    // a "Yes" must never require the Meal/Treatment/Coaches room detail fields
    // (they aren't even shown) or block submission.
    const simpleSpace = (data as any)?.invitation?.trips?.clients?.default_terms?.meeting_space_mode === 'simple'
    if (!simpleSpace) {
      for (const item of namedFnItems) {
        if (answers[item.id]?.answer_yes_no === true) {
          const forItem = namedSpaceDetails[item.id] ?? {}
          for (const space of NAMED_FUNCTION_SPACES) {
            const detail = forItem[space.key]
            if (!detail?.name?.trim()) msErrors.push(`${space.label} — Room name`)
            if (!detail?.dimensions?.trim()) msErrors.push(`${space.label} — Square footage`)
          }
        }
      }
    }
    if (msErrors.length > 0) {
      setValidationError(
        `Please complete the required meeting space fields:\n${msErrors.map((e) => `• ${e}`).join('\n')}`,
      )
      document.getElementById('rfp-validation-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    // Hard block: every concession question must be answered before submitting
    const unansweredYesNo = (data?.items ?? []).filter(
      (item) => !(item as any).optional && item.answer_type === 'yes_no' && answers[item.id]?.answer_yes_no === null,
    )
    const unansweredValue = (data?.items ?? []).filter(
      (item) =>
        !(item as any).optional &&
        item.answer_type !== 'yes_no' &&
        !item.label.includes('(if applicable)') &&
        !answers[item.id]?.answer_value?.trim(),
    )
    // Items where a "No" must be explained (attrition %, F&B minimum $) — a bare
    // No with no note is treated as missing, so KJST never has to chase it later.
    const missingRequiredNote = (data?.items ?? []).filter(
      (item) =>
        noteRequirementOnNo(item) &&
        answers[item.id]?.answer_yes_no === false &&
        !answers[item.id]?.comment?.trim(),
    )
    const allMissing = [...unansweredYesNo, ...unansweredValue, ...missingRequiredNote]
    if (allMissing.length > 0) {
      const missingIds = new Set(allMissing.map((i) => i.id))
      setFieldErrors(missingIds)
      const preview = allMissing
        .slice(0, 4)
        .map((i) => `• ${i.label.replace(/\[.*?\]/g, '…').slice(0, 70).trim()}`)
      const extra = allMissing.length > 4 ? `\n…and ${allMissing.length - 4} more` : ''
      setValidationError(
        `Please answer all questions before submitting — ${allMissing.length} item${allMissing.length > 1 ? 's' : ''} still need${allMissing.length === 1 ? 's' : ''} a response:\n${preview.join('\n')}${extra}`,
      )
      // Scroll to first unanswered item
      const firstMissingEl = document.getElementById(`concession-item-${allMissing[0].id}`)
      firstMissingEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const ok = await doSave(true)
    setSubmitting(false)

    if (ok) {
      setSubmitted(true)
    } else {
      setValidationError(saveError ?? 'Submission failed — please try again.')
    }
  }

  const setRespField =
    (k: keyof RespState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setResp((r) => ({ ...r, [k]: e.target.value }))
    }

  const setAnswer = (itemId: string, update: Partial<AnswerState>) => {
    setAnswers((a) => ({ ...a, [itemId]: { ...a[itemId], ...update } }))
    if (
      ('answer_yes_no' in update && update.answer_yes_no !== null) ||
      ('answer_value' in update && update.answer_value?.trim())
    ) {
      setFieldErrors((prev) => {
        if (!prev.has(itemId)) return prev
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-2 text-3xl"></div>
          <h1 className="text-lg font-semibold text-slate-800">Link not found</h1>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Loading your RFP…</p>
      </div>
    )
  }

  if (submitted) {
    const trip = data.invitation.trips
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-xl border border-emerald-200 bg-white p-10 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Thank you!</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your bid for <strong>{data.invitation.hotel_name}</strong> on the{' '}
            <strong>{publicClientName(trip.clients.team_name)}</strong> trip to{' '}
            <strong>{trip.city || trip.opponent_label}</strong> has been received.
          </p>
          <p className="mt-3 text-xs text-slate-400">
            KJ Sports Travel will follow up with any questions. You can close this window.
          </p>
        </div>
      </div>
    )
  }

  if (declined) {
    const trip = data.invitation.trips
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mb-3 text-3xl"></div>
          <h1 className="text-xl font-bold text-slate-900">Response Recorded</h1>
          <p className="mt-2 text-sm text-slate-600">
            Thank you for letting us know. We've noted that{' '}
            <strong>{data.invitation.hotel_name}</strong> is unable to bid on the{' '}
            <strong>{publicClientName(trip.clients.team_name)}</strong> trip to{' '}
            <strong>{trip.city || trip.opponent_label}</strong>.
          </p>
          <p className="mt-3 text-xs text-slate-400">
            KJ Sports Travel appreciates the response. You can close this window.
          </p>
        </div>
      </div>
    )
  }

  // Classify concession items for ordered rendering
  // Helpers: identify items by label keywords
  const isFlexCancelItem = (item: ConcessionItem) =>
    item.label.toLowerCase().includes('cancellation') || item.label.toLowerCase().includes('flexible cancellation')
  const isCommissionItem = (item: ConcessionItem) =>
    item.answer_type === 'percent' &&
    (item.label.toLowerCase().includes('commission') || item.label.toLowerCase().includes('commissionable'))
  const isRebateItem = (item: ConcessionItem) =>
    item.label.toLowerCase().includes('rebate')
  const isMeetingSpaceYesNoItem = (item: ConcessionItem) =>
    item.answer_type === 'yes_no' &&
    item.label.toLowerCase().includes('complimentary meeting space')
  const isNamedFunctionSpaceItem = (item: ConcessionItem) =>
    item.answer_type === 'yes_no' &&
    item.label.toLowerCase().includes('function space') &&
    // A "meeting space" item that merely mentions "function space" in its body
    // (e.g. a Treatment Room described as a "Treatment Room/Function space") is a
    // meeting-space item, not a separate function space — don't list it twice.
    !item.label.toLowerCase().includes('complimentary meeting space')
  // The Massage Room furniture-removal item belongs with the meeting-space group
  // conceptually (the team sets it up alongside the treatment/meeting rooms), but
  // its label doesn't say "meeting space" so it would otherwise fall into the
  // general list. Pull it up under the Meeting Space heading as a plain Yes/No.
  const isMeetingSpaceExtraItem = (item: ConcessionItem) =>
    item.answer_type === 'yes_no' &&
    !isMeetingSpaceYesNoItem(item) &&
    item.label.toLowerCase().includes('furniture removal')

  const allConcessionItems = data.items.filter(
    (i) => i.section === 'concessions' || i.section === 'facilities',
  )
  const flexCancelItems = allConcessionItems.filter(isFlexCancelItem)
  const commissionItems = allConcessionItems.filter(isCommissionItem)
  const rebateItems = allConcessionItems.filter(isRebateItem)
  const meetingSpaceYesNoItems = allConcessionItems.filter(isMeetingSpaceYesNoItem)
  const meetingSpaceExtraItems = allConcessionItems.filter(isMeetingSpaceExtraItem)
  const namedFunctionSpaceItems = allConcessionItems.filter(isNamedFunctionSpaceItem)
  // "Simple" meeting-space mode (sponsor-block stays): hide the full meeting-space
  // box (per-room details + "additional spaces" count) and ask only a plain Yes/No
  // "does the hotel offer complimentary function space?" — informational, not a
  // deal-breaker. Toggled per client via default_terms.meeting_space_mode.
  const simpleFunctionSpace =
    (data.invitation.trips.clients.default_terms as any)?.meeting_space_mode === 'simple'
  const postseasonItems = data.items.filter((i) => i.section === 'postseason')
  const inSeasonItems = data.items.filter((i) => i.section === 'in_season_tournament')

  // Show the menu / F&B pricing upload only where the RFP actually asks for F&B
  // pricing (a currency question about meals/food/beverage/per-person pricing).
  const hasFnbPricing = data.items.some(
    (i) =>
      i.answer_type === 'currency' &&
      /breakfast|lunch|dinner|brunch|per\s*-?\s*person|f\s*&\s*b|food|beverage|menu|meal|banquet|cater/i.test(i.label),
  )

  // "Other" = concessions/facilities not in any of the above special groups
  // Suites stay in the main list (sort_order 9-10) to match the real RFP order
  const specialItemIds = new Set([
    ...flexCancelItems,
    ...commissionItems,
    ...rebateItems,
    ...meetingSpaceYesNoItems,
    ...meetingSpaceExtraItems,
    ...namedFunctionSpaceItems,
  ].map((i) => i.id))
  const remainingItems = allConcessionItems.filter((i) => !specialItemIds.has(i.id))
  const otherConcessionItems = remainingItems.filter((i) => i.section === 'concessions')
  const facilitiesItems = remainingItems.filter((i) => i.section === 'facilities')

  // Editable again after a staff reopen (reopened_at newer than submitted_at),
  // even though the bid stays "submitted" on the grid.
  const reopenedForEdit =
    !!data.invitation.reopened_at &&
    !!data.invitation.submitted_at &&
    new Date(data.invitation.reopened_at).getTime() > new Date(data.invitation.submitted_at).getTime()
  const isReadOnly = data.invitation.status === 'submitted' && !reopenedForEdit && !staffEntry
  const hasStay2 = Boolean(data.invitation.trips.stay2_arrival_date) && (data.invitation.visit_scope ?? 'both') !== 'stay1'

  // Substitute [TEAM NAME], [ROOMS], [SUITES], [KINGS] placeholders with real trip data
  const teamName = data.invitation.trips.clients.team_name ?? 'Team'
  const substituteLabel = (label: string) =>
    label
      .replace(/\[TEAM NAME\]/g, teamName)
      .replace(/\[ROOMS\]/g, String(data.invitation.trips.total_rooms_requested ?? ''))
      .replace(/\[SUITES\]/g, String(data.invitation.trips.suites_requested ?? ''))
      .replace(/\[KINGS\]/g, String(data.invitation.trips.king_rooms_requested ?? ''))

  // Helper: render a list of concession items
  const renderItems = (items: ConcessionItem[]) =>
    items.map((item) => (
      <ConcessionRow
        key={item.id}
        item={{ ...item, label: substituteLabel(item.label) }}
        answer={answers[item.id] ?? { answer_yes_no: null, answer_value: '', comment: '', commentOpen: false }}
        onChange={(update) => setAnswer(item.id, update)}
        disabled={isReadOnly}
        showCommissionWarning={isCommissionItem(item)}
        hasError={fieldErrors.has(item.id)}
        noteSuggestion={prefill?.notes?.[item.id]}
        answerPrefilled={prefilledAnswers.has(item.id)}
      />
    ))

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <RfpHeader
          data={data}
          resp={resp}
          setResp={setResp}
          isReadOnly={isReadOnly}
          dateScenarios={dateScenarios}
          scenarioAvailability={scenarioAvailability}
          setScenarioAvailability={setScenarioAvailability}
          scheduleAutosave={scheduleAutosave}
          visit1Declined={visit1Declined}
          visit2Declined={visit2Declined}
          prefilledFields={prefilledFields}
        />

        {/* ── KJST staff-entry banner: filling the bid on the hotel's behalf ── */}
        {staffEntry && (
          <div className="mb-6 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3">
            <p className="text-sm font-semibold text-indigo-900">KJST entry mode — entering this bid on the hotel's behalf.</p>
            <p className="mt-1 text-sm text-indigo-800">
              Fill in the hotel's terms and submit. The hotel will NOT receive a confirmation email. When you're done, award them and send the contract request from the trip page.
            </p>
          </div>
        )}

        {/* ── Reopened notice: KJST reopened this bid so the hotel can revise ── */}
        {reopenedForEdit && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">This RFP was reopened for edits.</p>
            <p className="mt-1 text-sm text-amber-800">
              Your previous answers are saved below. Please review the details in the email from KJ Sports Travel, update anything affected, and resubmit. You do not need to start over.
            </p>
          </div>
        )}

        {/* ── Already-declined visit notices (two-visit trips) ── */}
        {hasStay2 && (visit1Declined || visit2Declined) && (
          <div className="mb-6 space-y-2">
            {visit1Declined && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Visit 1 has been recorded as declined. The Visit 1 rate fields below are no longer required.
              </div>
            )}
            {visit2Declined && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Visit 2 has been recorded as declined. The Visit 2 rate fields below are no longer required.
              </div>
            )}
          </div>
        )}

        {/* ── Can't bid panel ── */}
        {!isReadOnly && !(hasStay2 && visit1Declined && visit2Declined) && (
          <div className="mb-6 rounded-xl border-2 border-red-300 bg-red-50 overflow-hidden">
            {!showDeclinePanel ? (
              <button
                type="button"
                onClick={() => {
                  if (hasStay2 && visit1Declined && !visit2Declined) setDeclineScope(2)
                  else if (hasStay2 && visit2Declined && !visit1Declined) setDeclineScope(1)
                  setShowDeclinePanel(true)
                }}
                className="w-full px-6 py-4 text-center text-base font-bold text-red-700 hover:bg-red-100 transition-colors rounded-xl"
              >
                {hasStay2 && (visit1Declined || visit2Declined) ? 'Unable to bid on the remaining visit?' : 'Unable to bid on this RFP?'}{' '}
                <span className="underline">Let us know →</span>
              </button>
            ) : (
              <div className="p-6">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">Unable to Submit a Bid</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Please let us know why your property cannot participate. This helps KJ Sports Travel plan accordingly.
                </p>
                {hasStay2 && !visit1Declined && !visit2Declined && (
                  <div className="mb-4">
                    <FieldLabel htmlFor="decline-scope" required>Which visit?</FieldLabel>
                    <select
                      id="decline-scope"
                      className={inputCls}
                      value={declineScope}
                      onChange={(e) => setDeclineScope(e.target.value === 'both' ? 'both' : (Number(e.target.value) as 1 | 2))}
                    >
                      <option value="both">Both visits — can't bid on this trip at all</option>
                      <option value="1">Visit 1 only</option>
                      <option value="2">Visit 2 only</option>
                    </select>
                  </div>
                )}
                <div className="mb-4">
                  <FieldLabel htmlFor="decline-reason" required>Reason</FieldLabel>
                  <select
                    id="decline-reason"
                    className={inputCls}
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                  >
                    <option value="">Select a reason…</option>
                    <option value="sold_out">Sold out / no availability for these dates</option>
                    <option value="insufficient_rooms">Insufficient room block available</option>
                    <option value="rate_conflict">Rate restrictions in effect (e.g. city-wide event)</option>
                    <option value="no_suites">Unable to accommodate suite requirements</option>
                    <option value="not_competing">Property has chosen not to compete at this time</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="mb-4">
                  <FieldLabel htmlFor="decline-notes">
                    Additional notes{' '}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </FieldLabel>
                  <textarea
                    id="decline-notes"
                    className={`${inputCls} resize-none`}
                    rows={2}
                    placeholder="Any context or clarification…"
                    value={declineNotes}
                    onChange={(e) => setDeclineNotes(e.target.value)}
                  />
                </div>
                {declineError && (
                  <p className="mb-3 text-sm text-red-600">{declineError}</p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={!declineReason || declining}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {declining ? 'Submitting…' : 'Confirm — we cannot bid'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeclinePanel(false)
                      setDeclineReason('')
                      setDeclineNotes('')
                      setDeclineError(null)
                      setDeclineScope('both')
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Save status indicator */}
        {!isReadOnly && saveStatus !== 'idle' && (
          <div
            className={`mb-4 rounded-lg px-4 py-2 text-xs ${
              saveStatus === 'saving'
                ? 'bg-slate-100 text-slate-500'
                : saveStatus === 'saved'
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-red-50 text-red-600'
            }`}
          >
            {saveStatus === 'saving' && 'Saving draft…'}
            {saveStatus === 'saved' && '✓Draft saved — you can return to this link to finish later.'}
            {saveStatus === 'error' && `Couldn't auto-save: ${saveError}`}
          </div>
        )}

        {isReadOnly && (
          <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">
            This RFP has already been submitted on{' '}
            {formatDate(data.invitation.submitted_at ?? null)}.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Returning-hotel autofill banner */}
          {prefill?.found && !prefillDismissed && !isReadOnly && (
            <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>
              <div className="flex-1 text-sm text-blue-900">
                <span className="font-semibold">Welcome back{prefill.hotelName ? `, ${prefill.hotelName}` : ''}.</span>{' '}
                We pulled details from your prior RFPs to save you time. Your occupancy tax {prefill.resortFee ? 'and resort fee are' : 'is'} filled in below, your saved meeting rooms are available in each room dropdown, and your past counteroffers appear as suggestions you can accept. Review and update anything that has changed.
              </div>
              <button type="button" onClick={() => setPrefillDismissed(true)} className="flex-shrink-0 text-blue-400 hover:text-blue-600" aria-label="Dismiss">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          {/* ── Section 1: Flexible Cancellation ─── */}
          {flexCancelItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Flexible Cancellation</SectionHeading>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 mb-3">
                The team's travel schedule is subject to league rescheduling and postponements. Please review the flexible cancellation policy carefully.
              </div>
              {renderItems(flexCancelItems)}
            </div>
          )}

          {/* ── Section 3: Commission + Rebate (#2 dealbreaker) ─── */}
          {(commissionItems.length > 0 || rebateItems.length > 0) && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Commission</SectionHeading>
              {renderItems(commissionItems)}
              {rebateItems.length > 0 && (
                <>
                  <p className="mb-3 mt-4 text-sm text-slate-500">
                    Some hotels offer a rebate in addition to standard commission. Enter the rebate amount per room night, or leave blank if not applicable.
                  </p>
                  {renderItems(rebateItems)}
                </>
              )}
            </div>
          )}

          {/* ── Section 4: Meeting Space ─── (hidden in simple/sponsor-block mode) */}
          {!simpleFunctionSpace && (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <SectionHeading>Meeting Space</SectionHeading>
            {data.invitation.trips.clients.default_terms?.default_meeting_spaces && (
              <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                This team requires <strong>{data.invitation.trips.clients.default_terms.default_meeting_spaces} meeting spaces</strong>.
              </p>
            )}

            {/* Per-room Yes/No with inline detail form on Yes */}
            {meetingSpaceYesNoItems.map((item) => {
              const ans = answers[item.id] ?? { answer_yes_no: null, answer_value: '', comment: '', commentOpen: false }
              const detail = meetingSpaceDetails[item.id] ?? emptySpace()
              const answeredYes = ans.answer_yes_no === true
              const msHasError = fieldErrors.has(item.id)
              return (
                <div key={item.id} className="border-b border-slate-100 py-4 last:border-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <p className="flex-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{item.label}</p>
                    <div className="flex-shrink-0 sm:w-48">
                      <div
                        id={`concession-item-${item.id}`}
                        className={msHasError ? 'rounded-lg ring-2 ring-red-400 p-1' : ''}
                      >
                      <YesNoToggle
                        value={ans.answer_yes_no}
                        onChange={(v) => {
                          setAnswer(item.id, { answer_yes_no: v })
                          // Clear details if switching to No
                          if (!v) setMeetingSpaceDetails((prev) => { const next = { ...prev }; delete next[item.id]; return next })
                        }}
                        disabled={isReadOnly}
                      />
                      </div>
                      {msHasError && (
                        <p className="mt-1 text-xs font-medium text-red-500">Required</p>
                      )}
                    </div>
                  </div>
                  {/* Inline detail form — only when Yes */}
                  {answeredYes && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-medium text-slate-500 mb-3">Room details</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel htmlFor={`msd-${item.id}-name`} required>Room name</FieldLabel>
                          <RoomNameField
                            id={`msd-${item.id}-name`}
                            value={detail.name}
                            rooms={prefill?.rooms ?? []}
                            disabled={isReadOnly}
                            placeholder="e.g. Grand Ballroom A"
                            onName={(name) => setMeetingSpaceDetails((prev) => ({ ...prev, [item.id]: { ...detail, name } }))}
                            onPick={(room) => setMeetingSpaceDetails((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...detail,
                                name: room.name,
                                dimensions: room.dimensions || detail.dimensions,
                                space_type: room.space_type || detail.space_type,
                              },
                            }))}
                          />
                        </div>
                        <div>
                          <FieldLabel htmlFor={`msd-${item.id}-type`} required>Type of room</FieldLabel>
                          <select
                            id={`msd-${item.id}-type`}
                            className={inputCls}
                            value={detail.space_type}
                            onChange={(e) => {
                              const v = e.target.value
                              setMeetingSpaceDetails((prev) => ({ ...prev, [item.id]: { ...detail, space_type: v } }))
                            }}
                            disabled={isReadOnly}
                          >
                            <option value="">Select type…</option>
                            <option value="function_room">Function Room / Ballroom</option>
                            <option value="restaurant">Restaurant / F&B outlet</option>
                            <option value="suite_converted">Suite with furniture removed</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div>
                          <FieldLabel htmlFor={`msd-${item.id}-dim`} required>Size of room (sq. ft.)</FieldLabel>
                          <input
                            id={`msd-${item.id}-dim`}
                            type="text"
                            className={inputCls}
                            value={detail.dimensions}
                            onChange={(e) => {
                              const v = e.target.value
                              setMeetingSpaceDetails((prev) => ({ ...prev, [item.id]: { ...detail, dimensions: v } }))
                            }}
                            disabled={isReadOnly}
                            placeholder="e.g. 3,200 sq. ft."
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Counteroffer / comment box when the hotel answers No */}
                  {ans.answer_yes_no === false && (
                    <div className="mt-3">
                      <FieldLabel htmlFor={`msc-${item.id}`}>Counteroffer / comment (optional)</FieldLabel>
                      <textarea
                        id={`msc-${item.id}`}
                        className={`${inputCls} resize-none`}
                        rows={2}
                        value={ans.comment ?? ''}
                        onChange={(e) => setAnswer(item.id, { comment: e.target.value })}
                        disabled={isReadOnly}
                        placeholder="If this is a 'no' to the extra complimentary items rather than the space itself, or you'd like to counter, note it here."
                      />
                    </div>
                  )}
                </div>
              )
            })}

            {/* Meeting-space-adjacent Yes/No items (e.g. Massage Room furniture
                removal) rendered as plain rows under the same heading. */}
            {meetingSpaceExtraItems.length > 0 && (
              <div className="border-t border-slate-100">
                {renderItems(meetingSpaceExtraItems)}
              </div>
            )}

            {/* Additional spaces beyond the requested rooms */}
            <div className="mt-5 border-t border-slate-100 pt-5">
              <div className="flex items-center gap-4">
                <p className="text-sm font-medium text-slate-700">Any additional spaces?</p>
                <input
                  type="number"
                  min="0"
                  max="10"
                  className={`w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none disabled:bg-slate-50`}
                  value={additionalSpaces.length || ''}
                  onChange={(e) => {
                    const n = parseInt(e.target.value) || 0
                    setAdditionalSpaces((prev) => {
                      const next = [...prev]
                      while (next.length < n) next.push(emptySpace())
                      return next.slice(0, n)
                    })
                  }}
                  disabled={isReadOnly}
                  placeholder="0"
                />
                <span className="text-xs text-slate-400">Enter a number to add detail cards</span>
              </div>

              {additionalSpaces.map((space, idx) => (
                <div key={idx} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-700 mb-3">Additional Space {idx + 1}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel htmlFor={`add-${idx}-name`} required>Room name</FieldLabel>
                      <RoomNameField
                        id={`add-${idx}-name`}
                        value={space.name}
                        rooms={prefill?.rooms ?? []}
                        disabled={isReadOnly}
                        placeholder="e.g. Boardroom B"
                        onName={(name) => setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? { ...s, name } : s))}
                        onPick={(room) => setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? {
                          ...s,
                          name: room.name,
                          dimensions: room.dimensions || s.dimensions,
                          space_type: room.space_type || s.space_type,
                        } : s))}
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor={`add-${idx}-type`} required>Type of room</FieldLabel>
                      <select
                        id={`add-${idx}-type`}
                        className={inputCls}
                        value={space.space_type}
                        onChange={(e) => { const v = e.target.value; setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? { ...s, space_type: v } : s)) }}
                        disabled={isReadOnly}
                      >
                        <option value="">Select type…</option>
                        <option value="function_room">Function Room / Ballroom</option>
                        <option value="restaurant">Restaurant / F&B outlet</option>
                        <option value="suite_converted">Suite with furniture removed</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <FieldLabel htmlFor={`add-${idx}-dim`} required>Size of room (sq. ft.)</FieldLabel>
                      <input
                        id={`add-${idx}-dim`}
                        type="text"
                        className={inputCls}
                        value={space.dimensions}
                        onChange={(e) => { const v = e.target.value; setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? { ...s, dimensions: v } : s)) }}
                        disabled={isReadOnly}
                        placeholder="e.g. 800 sq. ft."
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* ── Section 4b: Named Function Spaces ─── */}
          {namedFunctionSpaceItems.map((item) => {
            const ans = answers[item.id] ?? { answer_yes_no: null, answer_value: '', comment: '', commentOpen: false }
            const answeredYes = ans.answer_yes_no === true
            const nfsHasError = fieldErrors.has(item.id)
            const forItem = namedSpaceDetails[item.id] ?? {}
            return (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-6">
                <SectionHeading>Function Spaces</SectionHeading>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <p className="flex-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{item.label}</p>
                  <div className="flex-shrink-0 sm:w-48">
                    <div id={`concession-item-${item.id}`} className={nfsHasError ? 'rounded-lg ring-2 ring-red-400 p-1' : ''}>
                      <YesNoToggle
                        value={ans.answer_yes_no}
                        onChange={(v) => {
                          setAnswer(item.id, { answer_yes_no: v })
                          if (!v) setNamedSpaceDetails((prev) => { const next = { ...prev }; delete next[item.id]; return next })
                        }}
                        disabled={isReadOnly}
                      />
                    </div>
                    {nfsHasError && <p className="mt-1 text-xs font-medium text-red-500">Required</p>}
                  </div>
                </div>

                {answeredYes && !simpleFunctionSpace && (
                  <div className="mt-3 space-y-3">
                    {NAMED_FUNCTION_SPACES.map((space) => {
                      const detail = forItem[space.key] ?? emptyNamedSpace(space.label)
                      return (
                        <div key={space.key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-medium text-slate-500 mb-3">{space.label}</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <FieldLabel htmlFor={`nfs-${item.id}-${space.key}-name`} required>Room name at your property</FieldLabel>
                              <RoomNameField
                                id={`nfs-${item.id}-${space.key}-name`}
                                value={detail.name}
                                rooms={prefill?.rooms ?? []}
                                disabled={isReadOnly}
                                placeholder="e.g. Bayview Room"
                                onName={(name) => setNamedSpaceDetails((prev) => ({
                                  ...prev,
                                  [item.id]: { ...forItem, [space.key]: { ...detail, spaceLabel: space.label, name } },
                                }))}
                                onPick={(room) => setNamedSpaceDetails((prev) => ({
                                  ...prev,
                                  [item.id]: { ...forItem, [space.key]: { ...detail, spaceLabel: space.label, name: room.name, dimensions: room.dimensions || detail.dimensions } },
                                }))}
                              />
                            </div>
                            <div>
                              <FieldLabel htmlFor={`nfs-${item.id}-${space.key}-dim`} required>Square footage</FieldLabel>
                              <input
                                id={`nfs-${item.id}-${space.key}-dim`}
                                type="text"
                                className={inputCls}
                                value={detail.dimensions}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setNamedSpaceDetails((prev) => ({
                                    ...prev,
                                    [item.id]: { ...forItem, [space.key]: { ...detail, spaceLabel: space.label, dimensions: v } },
                                  }))
                                }}
                                disabled={isReadOnly}
                                placeholder="e.g. 800 sq ft"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Section 5: Concessions (remaining items in RFP sort order) ─── */}
          {otherConcessionItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Concessions</SectionHeading>
              {renderItems(otherConcessionItems)}
            </div>
          )}

          {/* ── Section 6: Facilities ─── */}
          {facilitiesItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Facilities</SectionHeading>
              {renderItems(facilitiesItems)}
            </div>
          )}

          {/* ── Section 7: In-Season Tournament ─── */}
          {inSeasonItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>{SECTION_LABELS['in_season_tournament']}</SectionHeading>
              {data.invitation.trips.in_season_tournament_window && (
                <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  Window: {data.invitation.trips.in_season_tournament_window}
                </div>
              )}
              {renderItems(inSeasonItems)}
            </div>
          )}

          {/* ── Section 8: Postseason / Playoff Clause ─── */}
          {postseasonItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>{SECTION_LABELS['postseason']}</SectionHeading>
              {data.invitation.trips.postseason_window && (
                <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  Window: {data.invitation.trips.postseason_window}
                  {data.invitation.trips.postseason_rooms_text
                    ? ` · ${data.invitation.trips.postseason_rooms_text}`
                    : ''}
                </div>
              )}
              {renderItems(postseasonItems)}
            </div>
          )}

          {/* ── Submitter info (matches Word doc — "RFP completed by" at bottom) ─── */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <SectionHeading>RFP Completed By</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel required htmlFor="rfp-completed-by">Name</FieldLabel>
                <input id="rfp-completed-by" type="text" className={inputCls}
                  value={resp.completed_by_name} onChange={setRespField('completed_by_name')}
                  disabled={isReadOnly} placeholder="Full name" aria-required="true" />
              </div>
              <div>
                <FieldLabel required htmlFor="rfp-date">Date</FieldLabel>
                <input id="rfp-date" type="date" className={inputCls}
                  value={resp.completed_date} onChange={setRespField('completed_date')}
                  disabled={isReadOnly} />
              </div>
            </div>
          </div>

          {/* ── Sample menus from KJST (reference files the team provides) ─── */}
          {(data.invitation.trips.clients.sample_menus ?? []).length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Sample Menus from KJ Sports Travel</SectionHeading>
              <p className="mb-3 text-sm text-slate-500">
                Reference menus / pricing examples from KJ Sports Travel for this team. Please use these as a guide when entering your F&amp;B pricing.
              </p>
              <ul className="space-y-2">
                {(data.invitation.trips.clients.sample_menus ?? []).map((m) => (
                  <li key={m.path}>
                    <a
                      href={clientSampleMenuUrl(m.path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <span></span>
                      <span>{m.name}</span>
                      <span className="text-[#1C1008]">↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Menu / F&B pricing attachments — only when the RFP asks for F&B pricing ─── */}
          {hasFnbPricing && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Menu &amp; F&amp;B Pricing</SectionHeading>
              <p className="mb-3 text-sm text-slate-500">
                Attach your banquet / catering menu or F&amp;B pricing sheet (PDF, image, Word, or Excel). You can add more than one file.
              </p>

              {menuAttachments.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {menuAttachments.map((m) => (
                    <li
                      key={m.path}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                        {m.name}{m.size ? ` · ${formatBytes(m.size)}` : ''}
                      </span>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => removeMenuAttachment(m.path)}
                          className="shrink-0 text-xs font-medium text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {!isReadOnly && (
                <div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/*"
                      className="hidden"
                      disabled={menuUploading}
                      onChange={(e) => { handleMenuUpload(e.target.files); e.target.value = '' }}
                    />
                    {menuUploading ? 'Uploading…' : '+ Attach menu / pricing'}
                  </label>
                  {menuError && <p className="mt-2 text-sm text-red-600">{menuError}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── Section 9: General comments ─── */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <SectionHeading>General Comments</SectionHeading>
            <textarea
              id="rfp-general-comments"
              className={`${inputCls} resize-none`}
              rows={4}
              value={resp.general_comments}
              onChange={setRespField('general_comments')}
              disabled={isReadOnly}
              placeholder="Any additional notes, clarifications, or offers not covered above…"
            />
          </div>

          {/* ── Validation error + Submit ─── */}
          {validationError && (
            <div id="rfp-validation-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-line">
              {validationError}
            </div>
          )}

          {!isReadOnly && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-400">
                Your progress is auto-saved. You can return to this link to finish later.{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">Privacy</a>
                {' · '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">Terms</a>
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[#1C1008] px-6 py-3 text-sm font-medium text-white hover:bg-[#2C1A0D] disabled:opacity-50 sm:w-auto sm:py-2.5"
              >
                {submitting ? 'Submitting…' : 'Submit bid'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
