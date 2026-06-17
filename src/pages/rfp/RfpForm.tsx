import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getRfp, respondRfp } from '../../lib/rfpApi'
import { formatDate } from '../../lib/format'
import type {
  AnswerPayload,
  ConcessionItem,
  ExistingAnswer,
  ResponseFields,
  RfpData,
  ScenarioRate,
} from '../../lib/rfpApi'

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

// ── Single concession item row ────────────────────────────────────────────────

function ConcessionRow({
  item,
  answer,
  onChange,
  disabled,
  showCommissionWarning,
}: {
  item: ConcessionItem
  answer: AnswerState
  onChange: (update: Partial<AnswerState>) => void
  disabled?: boolean
  showCommissionWarning?: boolean
}) {
  const isYesNo = item.answer_type === 'yes_no'
  const showComment = isYesNo
    ? answer.answer_yes_no === false && item.allow_comment === true
    : answer.commentOpen

  const handleYesNo = (v: boolean) => {
    // When toggling to No, auto-open the comment box (only if allow_comment is true).
    onChange({ answer_yes_no: v, commentOpen: !v && item.allow_comment === true })
  }

  const hasRequestedValue =
    item.requested_value && item.requested_value !== '—' && item.requested_value !== null

  const commVal = answer.answer_value?.trim() ?? ''
  const warnZeroCommission = showCommissionWarning && (commVal === '0' || commVal === '')

  return (
    <div className="border-b border-slate-100 py-4 last:border-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        {/* Label + requested value */}
        <div className="flex-1">
          <p className="text-sm leading-relaxed text-slate-800">{item.label}</p>
          {hasRequestedValue && (
            <p className="mt-0.5 text-xs text-slate-400">
              Requested: <span className="font-medium text-slate-500">{item.requested_value}</span>
            </p>
          )}
        </div>

        {/* Answer control */}
        <div className="flex-shrink-0 sm:w-48">
          {isYesNo ? (
            <YesNoToggle value={answer.answer_yes_no} onChange={handleYesNo} disabled={disabled} />
          ) : (
            <div>
              <ValueInput item={item} value={answer.answer_value} onChange={(v) => onChange({ answer_value: v })} disabled={disabled} />
              {warnZeroCommission && (
                <p className="mt-1 text-xs text-amber-600">
                  ⚠️ Zero commission bids are typically ineligible for team selection.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Inline comment / counteroffer box */}
      {showComment && (
        <div className="mt-3">
          <textarea
            className={`${inputCls} resize-none`}
            rows={2}
            placeholder="Reason or counteroffer…"
            value={answer.comment}
            onChange={(e) => onChange({ comment: e.target.value })}
            disabled={disabled}
          />
        </div>
      )}

      {/* Toggle comment for non-yes_no items */}
      {!isYesNo && !answer.commentOpen && !disabled && (
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
  in_season_tournament: 'In-Season Tournament Guarantee',
  postseason: 'Postseason / Playoff Guarantee',
}

// ── RFP header — mirrors the Word doc layout ─────────────────────────────────

type RfpHeaderProps = {
  data: RfpData
  resp: RespState
  setResp: React.Dispatch<React.SetStateAction<RespState>>
  isReadOnly: boolean
}

function RfpHeader({ data, resp, setResp, isReadOnly }: RfpHeaderProps) {
  const { invitation, org } = data
  const trip = invitation.trips
  const client = trip.clients

  const hasStay2 = Boolean(trip.stay2_arrival_date)
  const scenarios = trip.night_scenarios ?? [1]
  const isMultiScenario = scenarios.length > 1

  // ── Helper: table cell styles ─────────────────────────────────────────────
  const th = 'border border-slate-300 bg-slate-100 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500'
  const td = 'border border-slate-300 px-3 py-1.5 text-sm text-slate-800'
  const tdLabel = 'border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-32'
  const rateInput = `w-full border-0 bg-transparent px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1C1008] disabled:text-slate-400 min-w-0`

  // Build dates rows
  const dateRows: Array<{ opponent: string; arr: string | null; dep: string | null; nts: number | null; game: string | null; time: string | null }> = []
  dateRows.push({
    opponent: trip.opponent_label || '—',
    arr: trip.arrival_date,
    dep: trip.departure_date,
    nts: trip.nights,
    game: trip.game_date,
    time: trip.game_time,
  })
  if (hasStay2) {
    const arr = trip.stay2_arrival_date
    const dep = trip.stay2_departure_date
    let nts: number | null = null
    if (arr && dep) {
      nts = Math.round((new Date(dep).getTime() - new Date(arr).getTime()) / 86400000)
    }
    dateRows.push({
      opponent: trip.opponent_label ? `${trip.opponent_label} (Visit 2)` : 'Visit 2',
      arr, dep, nts,
      game: trip.stay2_game_date,
      time: trip.stay2_game_time,
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
                ['Company', client.team_name, org?.name || 'KJ Sports Travel'],
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
                <th className={th}>One Bedroom Suite</th>
                <th className={th}>Total Rooms</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${td} text-center`}>{trip.king_rooms_requested ?? '—'}</td>
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
                  <td className={td}>{formatDate(row.game)}</td>
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
            <table className="w-full border-collapse text-sm">
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
        ) : (
          /* Single scenario: horizontal rate row matching Word doc */
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rates</p>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>
                    Best Available King/Double Rate(s){hasStay2 ? ' — Visit 1' : ''}
                  </th>
                  <th className={th}>VS. Current Selling Rate</th>
                  <th className={th}>Best Available Suite Rate(s){hasStay2 ? ' — Visit 1' : ''}</th>
                  <th className={th}>Occupancy Tax</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 p-0">
                    <div className="flex items-center">
                      <span className="border-r border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">$</span>
                      <input type="number" min="0" step="0.01" className={rateInput}
                        value={resp.best_king_rate} placeholder="0.00" aria-required="true"
                        onChange={(e) => setResp((r) => ({ ...r, best_king_rate: e.target.value }))}
                        disabled={isReadOnly} />
                    </div>
                  </td>
                  <td className="border border-slate-300 p-0">
                    <input type="text" className={rateInput} value={resp.current_selling_rate}
                      placeholder="e.g. $595"
                      onChange={(e) => setResp((r) => ({ ...r, current_selling_rate: e.target.value }))}
                      disabled={isReadOnly} />
                  </td>
                  <td className="border border-slate-300 p-0">
                    <div className="flex items-center">
                      <span className="border-r border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">$</span>
                      <input type="number" min="0" step="0.01" className={rateInput}
                        value={resp.best_suite_rate} placeholder="0.00"
                        onChange={(e) => setResp((r) => ({ ...r, best_suite_rate: e.target.value }))}
                        disabled={isReadOnly} />
                    </div>
                  </td>
                  <td className="border border-slate-300 p-0">
                    <input type="text" className={rateInput} value={resp.occupancy_tax}
                      placeholder="e.g. 16.9% + $5/night"
                      onChange={(e) => setResp((r) => ({ ...r, occupancy_tax: e.target.value }))}
                      disabled={isReadOnly} />
                  </td>
                </tr>
              </tbody>
            </table>
            {/* Visit 2 rates row */}
            {hasStay2 && (
              <table className="mt-1 w-full border-collapse text-sm">
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
                        <input type="number" min="0" step="0.01" className={rateInput}
                          value={resp.stay2_king_rate} placeholder="0.00"
                          onChange={(e) => setResp((r) => ({ ...r, stay2_king_rate: e.target.value }))}
                          disabled={isReadOnly} />
                      </div>
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input type="text" className={rateInput} value={resp.stay2_selling_rate}
                        placeholder="e.g. $685"
                        onChange={(e) => setResp((r) => ({ ...r, stay2_selling_rate: e.target.value }))}
                        disabled={isReadOnly} />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <div className="flex items-center">
                        <span className="border-r border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">$</span>
                        <input type="number" min="0" step="0.01" className={rateInput}
                          value={resp.stay2_suite_rate} placeholder="0.00"
                          onChange={(e) => setResp((r) => ({ ...r, stay2_suite_rate: e.target.value }))}
                          disabled={isReadOnly} />
                      </div>
                    </td>
                    <td className="border border-slate-300 p-0" />
                  </tr>
                </tbody>
              </table>
            )}
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
  const [data, setData] = useState<RfpData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Night scenarios state — populated from loaded trip data
  const [nightScenarios, setNightScenarios] = useState<number[]>([1])

  // Per-space detail state for meeting spaces
  // Per-room meeting space details keyed by concession item ID (or index for additional)
  type SpaceDetail = { name: string; dimensions: string; fb_minimum: string; wifi: string; additional_info: string }
  const emptySpace = (): SpaceDetail => ({ name: '', dimensions: '', fb_minimum: '', wifi: '', additional_info: '' })
  const [meetingSpaceDetails, setMeetingSpaceDetails] = useState<Record<string, SpaceDetail>>({})
  // Additional spaces beyond the 4 requested rooms
  const [additionalSpaces, setAdditionalSpaces] = useState<SpaceDetail[]>([])

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

  // Track whether we need to save
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const respRef = useRef(resp)
  const answersRef = useRef(answers)
  respRef.current = resp
  answersRef.current = answers

  // --- Load ---
  useEffect(() => {
    if (!token) return
    getRfp(token)
      .then((d) => {
        setData(d)
        if (d.invitation.status === 'submitted') setSubmitted(true)

        // Populate night scenarios from the trip
        setNightScenarios(d.invitation.trips.night_scenarios ?? [1])

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

          // Restore per-room meeting space details and additional spaces from saved JSON
          if (r.meeting_space_notes) {
            try {
              const parsed = JSON.parse(r.meeting_space_notes)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if (parsed.__details) setMeetingSpaceDetails(parsed.__details)
                if (Array.isArray(parsed.__additional)) setAdditionalSpaces(parsed.__additional)
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
          Object.keys(meetingSpaceDetails).length > 0 || additionalSpaces.length > 0
            ? JSON.stringify({ __details: meetingSpaceDetails, __additional: additionalSpaces })
            : '',
        meeting_space_type: r.meeting_space_type || null,
        meeting_space_count: r.meeting_space_count ? Number(r.meeting_space_count) : null,
        general_comments: r.general_comments,
        scenario_rates: scenarioRatesPayload,
      }

      try {
        await respondRfp({ token, response: responsePayload, answers: answerPayload, submit })
        return true
      } catch (e: unknown) {
        if (!submit) {
          setSaveStatus('error')
          setSaveError((e as Error).message)
        }
        return false
      }
    },
    [token, meetingSpaceDetails, additionalSpaces],
  )

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

  // Trigger autosave whenever resp or answers change (but not on initial load)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    scheduleAutosave()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp, answers])

  // --- Submit ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)

    if (!resp.completed_by_name.trim()) {
      setValidationError('Please enter the name of the person completing this form.')
      return
    }
    const scenarios = nightScenarios
    const isMultiScenario = scenarios.length > 1
    if (!isMultiScenario && !resp.best_king_rate.trim()) {
      setValidationError('Best Available King Rate is required before submitting.')
      return
    }
    if (isMultiScenario) {
      const availableScenarios = scenarios.filter((n) => resp.scenario_rates[String(n)]?.available !== false)
      const missingRates = availableScenarios.filter((n) => !resp.scenario_rates[String(n)]?.rate?.trim())
      if (missingRates.length > 0) {
        setValidationError(`Please enter king rates for all available scenarios (missing: ${missingRates.map((n) => `${n} night${n > 1 ? 's' : ''}`).join(', ')}).`)
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

    // Warn about unanswered Yes/No items
    const unanswered = data?.items.filter(
      (item) => item.answer_type === 'yes_no' && answers[item.id]?.answer_yes_no === null,
    )
    if (unanswered && unanswered.length > 0) {
      const ok = window.confirm(
        `${unanswered.length} question${unanswered.length > 1 ? 's' : ''} still need${unanswered.length === 1 ? 's' : ''} a Yes/No answer. Submit anyway?`,
      )
      if (!ok) return
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
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-2 text-3xl">🔗</div>
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
          <div className="mb-3 text-4xl">✅</div>
          <h1 className="text-xl font-bold text-slate-900">Thank you!</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your bid for <strong>{data.invitation.hotel_name}</strong> on the{' '}
            <strong>{trip.clients.team_name}</strong> trip to{' '}
            <strong>{trip.city || trip.opponent_label}</strong> has been received.
          </p>
          <p className="mt-3 text-xs text-slate-400">
            KJ Sports Travel will follow up with any questions. You can close this window.
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
  const isMeetingSpaceYesNoItem = (item: ConcessionItem) =>
    item.answer_type === 'yes_no' &&
    item.label.toLowerCase().includes('complimentary meeting space')
  const isSuiteConcessionItem = (item: ConcessionItem) =>
    item.label.toLowerCase().includes('suite') &&
    (item.answer_type === 'quantity' || item.answer_type === 'currency')

  const allConcessionItems = data.items.filter(
    (i) => i.section === 'concessions' || i.section === 'facilities',
  )
  const flexCancelItems = allConcessionItems.filter(isFlexCancelItem)
  const commissionItems = allConcessionItems.filter(isCommissionItem)
  const meetingSpaceYesNoItems = allConcessionItems.filter(isMeetingSpaceYesNoItem)
  const suiteConcessionItems = allConcessionItems.filter(isSuiteConcessionItem)
  const postseasonItems = data.items.filter((i) => i.section === 'postseason')
  const inSeasonItems = data.items.filter((i) => i.section === 'in_season_tournament')

  // "Other" = concessions/facilities not in any of the above special groups
  const specialItemIds = new Set([
    ...flexCancelItems,
    ...commissionItems,
    ...meetingSpaceYesNoItems,
    ...suiteConcessionItems,
  ].map((i) => i.id))
  const otherConcessionItems = allConcessionItems.filter((i) => !specialItemIds.has(i.id))

  // Determine if meeting space is answered Yes (to show type/count fields)
  // (meetingSpaceAnsweredYes removed — details now expand inline per item)

  const isReadOnly = data.invitation.status === 'submitted'

  // Helper: render a list of concession items
  const renderItems = (items: ConcessionItem[]) =>
    items.map((item) => (
      <ConcessionRow
        key={item.id}
        item={item}
        answer={answers[item.id] ?? { answer_yes_no: null, answer_value: '', comment: '', commentOpen: false }}
        onChange={(update) => setAnswer(item.id, update)}
        disabled={isReadOnly}
        showCommissionWarning={isCommissionItem(item)}
      />
    ))

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <RfpHeader data={data} resp={resp} setResp={setResp} isReadOnly={isReadOnly} />

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
            {saveStatus === 'saving' && '💾 Saving draft…'}
            {saveStatus === 'saved' && '✓ Draft saved — you can return to this link to finish later.'}
            {saveStatus === 'error' && `⚠ Couldn't auto-save: ${saveError}`}
          </div>
        )}

        {isReadOnly && (
          <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">
            This RFP has already been submitted on{' '}
            {formatDate(data.invitation.submitted_at ?? null)}.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ── Section 1: Submitter info ─── */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <SectionHeading>Submitter</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel required htmlFor="rfp-completed-by">RFP completed by</FieldLabel>
                <input
                  id="rfp-completed-by"
                  type="text"
                  className={inputCls}
                  value={resp.completed_by_name}
                  onChange={setRespField('completed_by_name')}
                  disabled={isReadOnly}
                  placeholder="Full name"
                  aria-required="true"
                />
              </div>
              <div>
                <FieldLabel htmlFor="rfp-date">Date</FieldLabel>
                <input
                  id="rfp-date"
                  type="date"
                  className={inputCls}
                  value={resp.completed_date}
                  onChange={setRespField('completed_date')}
                  disabled={isReadOnly}
                />
              </div>
            </div>
          </div>

          {/* ── Section 2: Flexible Cancellation (#1 dealbreaker) ─── */}
          {flexCancelItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Flexible Cancellation</SectionHeading>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 mb-3">
                The team's travel schedule is subject to league rescheduling and postponements. Please review the flexible cancellation policy carefully.
              </div>
              {renderItems(flexCancelItems)}
            </div>
          )}

          {/* ── Section 3: Commission (#2 dealbreaker) ─── */}
          {commissionItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Commission</SectionHeading>
              {renderItems(commissionItems)}
            </div>
          )}

          {/* ── Section 4: Meeting Space ─── */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <SectionHeading>Meeting Space</SectionHeading>
            <p className="mb-4 text-sm text-slate-500">
              Teams use meeting space for massage tables, recovery equipment, and trainer setups. Answer Yes or No for each room — if Yes, fill in the space details.
            </p>

            {/* Type of meeting space — always shown */}
            <div className="mb-5">
              <FieldLabel htmlFor="rfp-meeting-type">Type of meeting space available at your property</FieldLabel>
              <select
                id="rfp-meeting-type"
                className={inputCls}
                value={resp.meeting_space_type}
                onChange={(e) => setResp((r) => ({ ...r, meeting_space_type: e.target.value }))}
                disabled={isReadOnly}
              >
                <option value="">Select type…</option>
                <option value="function_room">Function Room / Ballroom ✅</option>
                <option value="ballroom">Ballroom ✅</option>
                <option value="restaurant">Restaurant / F&B outlet ⚠️ (may not qualify)</option>
                <option value="suite_converted">Suite with furniture removed ⚠️ (may not qualify)</option>
                <option value="none">None available</option>
              </select>
            </div>

            {/* Per-room Yes/No with inline detail form on Yes */}
            {meetingSpaceYesNoItems.map((item) => {
              const ans = answers[item.id] ?? { answer_yes_no: null, answer_value: '', comment: '', commentOpen: false }
              const detail = meetingSpaceDetails[item.id] ?? emptySpace()
              const answeredYes = ans.answer_yes_no === true
              return (
                <div key={item.id} className="border-b border-slate-100 py-4 last:border-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <p className="flex-1 text-sm leading-relaxed text-slate-800">{item.label}</p>
                    <div className="flex-shrink-0 sm:w-48">
                      <YesNoToggle
                        value={ans.answer_yes_no}
                        onChange={(v) => {
                          setAnswers((prev) => ({ ...prev, [item.id]: { ...ans, answer_yes_no: v } }))
                          // Clear details if switching to No
                          if (!v) setMeetingSpaceDetails((prev) => { const next = { ...prev }; delete next[item.id]; return next })
                        }}
                        disabled={isReadOnly}
                      />
                    </div>
                  </div>
                  {/* Inline detail form — only when Yes */}
                  {answeredYes && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-medium text-slate-500 mb-3">Room details</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel htmlFor={`msd-${item.id}-name`} required>Name of space</FieldLabel>
                          <input
                            id={`msd-${item.id}-name`}
                            type="text"
                            className={inputCls}
                            value={detail.name}
                            onChange={(e) => {
                              const v = e.target.value
                              setMeetingSpaceDetails((prev) => ({ ...prev, [item.id]: { ...detail, name: v } }))
                            }}
                            disabled={isReadOnly}
                            placeholder="e.g. Grand Ballroom A"
                          />
                        </div>
                        <div>
                          <FieldLabel htmlFor={`msd-${item.id}-dim`} required>Dimensions (sq. ft.)</FieldLabel>
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
                        <div>
                          <FieldLabel htmlFor={`msd-${item.id}-fb`}>F&B minimum</FieldLabel>
                          <input
                            id={`msd-${item.id}-fb`}
                            type="text"
                            className={inputCls}
                            value={detail.fb_minimum}
                            onChange={(e) => {
                              const v = e.target.value
                              setMeetingSpaceDetails((prev) => ({ ...prev, [item.id]: { ...detail, fb_minimum: v } }))
                            }}
                            disabled={isReadOnly}
                            placeholder="e.g. $500 or None"
                          />
                        </div>
                        <div>
                          <FieldLabel htmlFor={`msd-${item.id}-wifi`} required>Wi-Fi</FieldLabel>
                          <select
                            id={`msd-${item.id}-wifi`}
                            className={inputCls}
                            value={detail.wifi}
                            onChange={(e) => {
                              const v = e.target.value
                              setMeetingSpaceDetails((prev) => ({ ...prev, [item.id]: { ...detail, wifi: v } }))
                            }}
                            disabled={isReadOnly}
                          >
                            <option value="">Select…</option>
                            <option value="Complimentary">Complimentary</option>
                            <option value="Available at cost">Available at cost</option>
                            <option value="Not available">Not available</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-3">
                        <FieldLabel htmlFor={`msd-${item.id}-info`}>Additional info</FieldLabel>
                        <textarea
                          id={`msd-${item.id}-info`}
                          className={`${inputCls} resize-none`}
                          rows={2}
                          value={detail.additional_info}
                          onChange={(e) => {
                            const v = e.target.value
                            setMeetingSpaceDetails((prev) => ({ ...prev, [item.id]: { ...detail, additional_info: v } }))
                          }}
                          disabled={isReadOnly}
                          placeholder="Any other details (AV equipment, pillars, natural light, etc.)"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

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
                      <FieldLabel htmlFor={`add-${idx}-name`} required>Name of space</FieldLabel>
                      <input
                        id={`add-${idx}-name`}
                        type="text"
                        className={inputCls}
                        value={space.name}
                        onChange={(e) => { const v = e.target.value; setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? { ...s, name: v } : s)) }}
                        disabled={isReadOnly}
                        placeholder="e.g. Boardroom B"
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor={`add-${idx}-dim`} required>Dimensions (sq. ft.)</FieldLabel>
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
                    <div>
                      <FieldLabel htmlFor={`add-${idx}-fb`}>F&B minimum</FieldLabel>
                      <input
                        id={`add-${idx}-fb`}
                        type="text"
                        className={inputCls}
                        value={space.fb_minimum}
                        onChange={(e) => { const v = e.target.value; setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? { ...s, fb_minimum: v } : s)) }}
                        disabled={isReadOnly}
                        placeholder="e.g. $500 or None"
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor={`add-${idx}-wifi`} required>Wi-Fi</FieldLabel>
                      <select
                        id={`add-${idx}-wifi`}
                        className={inputCls}
                        value={space.wifi}
                        onChange={(e) => { const v = e.target.value; setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? { ...s, wifi: v } : s)) }}
                        disabled={isReadOnly}
                      >
                        <option value="">Select…</option>
                        <option value="Complimentary">Complimentary</option>
                        <option value="Available at cost">Available at cost</option>
                        <option value="Not available">Not available</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3">
                    <FieldLabel htmlFor={`add-${idx}-info`}>Additional info</FieldLabel>
                    <textarea
                      id={`add-${idx}-info`}
                      className={`${inputCls} resize-none`}
                      rows={2}
                      value={space.additional_info}
                      onChange={(e) => { const v = e.target.value; setAdditionalSpaces((prev) => prev.map((s, i) => i === idx ? { ...s, additional_info: v } : s)) }}
                      disabled={isReadOnly}
                      placeholder="Any other details (AV equipment, pillars, natural light, etc.)"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section 5: Suite Concessions ─── */}
          {suiteConcessionItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Suite Concessions</SectionHeading>
              {renderItems(suiteConcessionItems)}
            </div>
          )}

          {/* ── Section 6: Postseason / Playoff Clause ─── */}
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

          {/* ── Section 7: Other concession / facility items ─── */}
          {otherConcessionItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <SectionHeading>Concessions &amp; Facilities</SectionHeading>
              {renderItems(otherConcessionItems)}
            </div>
          )}

          {/* ── Section 8: In-Season Tournament ─── */}
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
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {validationError}
            </div>
          )}

          {!isReadOnly && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-400">
                Your progress is auto-saved. You can return to this link to finish later.
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
