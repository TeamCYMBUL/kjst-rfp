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
  meeting_space_notes: string
  general_comments: string
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
}: {
  item: ConcessionItem
  answer: AnswerState
  onChange: (update: Partial<AnswerState>) => void
  disabled?: boolean
}) {
  const isYesNo = item.answer_type === 'yes_no'
  const showComment = isYesNo ? answer.answer_yes_no === false : answer.commentOpen

  const handleYesNo = (v: boolean) => {
    // When toggling to No, auto-open the comment box.
    onChange({ answer_yes_no: v, commentOpen: !v })
  }

  const hasRequestedValue =
    item.requested_value && item.requested_value !== '—' && item.requested_value !== null

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
            <ValueInput item={item} value={answer.answer_value} onChange={(v) => onChange({ answer_value: v })} disabled={disabled} />
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

// ── Trip banner (read-only, top of the form) ──────────────────────────────────

function TripBanner({ data }: { data: RfpData }) {
  const { invitation } = data
  const trip = invitation.trips
  const client = trip.clients

  return (
    <div className="mb-8 rounded-xl border border-[#E5D5C8] bg-[#F5EFE8] p-6">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#1C1008]/50">
        KJ Sports Travel — Hotel RFP
      </div>
      <h1 className="text-2xl font-bold text-slate-900">{client.team_name}</h1>
      <p className="mt-0.5 text-sm text-slate-600">
        {trip.opponent_label || 'Road trip'} · {trip.city || ''}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">
            {trip.stay2_arrival_date ? 'Stay 1 dates' : 'Dates'}
          </dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-700">
            {formatDate(trip.arrival_date)} – {formatDate(trip.departure_date)}
            {trip.nights != null ? ` (${trip.nights}n)` : ''}
          </dd>
        </div>
        {trip.stay2_arrival_date && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Stay 2 dates</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-700">
              {formatDate(trip.stay2_arrival_date)} – {formatDate(trip.stay2_departure_date)}
            </dd>
          </div>
        )}
        {trip.game_date && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">
              {trip.stay2_arrival_date ? 'Game (stay 1)' : 'Game'}
            </dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-700">
              {formatDate(trip.game_date)}
              {trip.game_time ? ` · ${trip.game_time}` : ''}
            </dd>
          </div>
        )}
        {trip.stay2_game_date && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Game (stay 2)</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-700">
              {formatDate(trip.stay2_game_date)}
              {trip.stay2_game_time ? ` · ${trip.stay2_game_time}` : ''}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Room block</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-700">
            {[
              trip.king_rooms_requested != null ? `${trip.king_rooms_requested} kings` : null,
              trip.suites_requested != null ? `${trip.suites_requested} suites` : null,
              trip.total_rooms_requested != null ? `${trip.total_rooms_requested} total` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </dd>
        </div>
        {trip.response_deadline && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Response deadline</dt>
            <dd className="mt-0.5 text-sm font-medium text-red-700">
              {formatDate(trip.response_deadline)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Your hotel</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-700">{invitation.hotel_name}</dd>
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
    meeting_space_notes: '',
    general_comments: '',
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

        // Populate existing response if save-and-resume
        if (d.response) {
          const r = d.response
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
            meeting_space_notes: r.meeting_space_notes ?? '',
            general_comments: r.general_comments ?? '',
          })
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
        meeting_space_notes: r.meeting_space_notes,
        general_comments: r.general_comments,
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
    [token],
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
    if (!resp.best_king_rate.trim()) {
      setValidationError('Best Available King Rate is required before submitting.')
      return
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

  // Group items by section, in order
  const sections = ['concessions', 'facilities', 'in_season_tournament', 'postseason'] as const
  const bySection: Record<string, ConcessionItem[]> = {}
  data.items.forEach((item) => {
    if (!bySection[item.section]) bySection[item.section] = []
    bySection[item.section].push(item)
  })

  const isReadOnly = data.invitation.status === 'submitted'

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <TripBanner data={data} />

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

          {/* ── Section 2: Rates ─── */}
          {(() => {
            const trip = data.invitation.trips
            const hasStay2 = Boolean(trip.stay2_arrival_date)
            return (
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <SectionHeading>Rates</SectionHeading>

                {hasStay2 && (
                  <div className="mb-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    This trip covers <strong>2 stays</strong> — please provide separate King rates for each stay date.
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Stay 1 King Rate */}
                  <div>
                    <FieldLabel required htmlFor="rfp-king-rate">
                      {hasStay2 ? 'King Rate — Stay 1 ($)' : 'Best Available King Rate ($)'}
                    </FieldLabel>
                    <div className="flex items-center">
                      <span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">$</span>
                      <input
                        id="rfp-king-rate"
                        type="number" min="0" step="0.01"
                        className={`${inputCls} rounded-l-none`}
                        value={resp.best_king_rate}
                        onChange={setRespField('best_king_rate')}
                        disabled={isReadOnly}
                        placeholder="0.00"
                        aria-required="true"
                      />
                    </div>
                    {hasStay2 && (
                      <p className="mt-1 text-xs text-slate-400">
                        {formatDate(trip.arrival_date)} – {formatDate(trip.departure_date)}
                      </p>
                    )}
                  </div>

                  {/* Stay 1 Selling Rate */}
                  <div>
                    <FieldLabel htmlFor="rfp-selling-rate">
                      {hasStay2 ? 'Current Selling Rate — Stay 1' : 'Current Selling Rate'}
                    </FieldLabel>
                    <input
                      id="rfp-selling-rate"
                      type="text"
                      className={inputCls}
                      value={resp.current_selling_rate}
                      onChange={setRespField('current_selling_rate')}
                      disabled={isReadOnly}
                      placeholder="e.g. $595"
                    />
                  </div>

                  {/* Stay 2 rates — only shown when trip has a second stay */}
                  {hasStay2 && (
                    <>
                      <div>
                        <FieldLabel htmlFor="rfp-stay2-king">King Rate — Stay 2 ($)</FieldLabel>
                        <div className="flex items-center">
                          <span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">$</span>
                          <input
                            id="rfp-stay2-king"
                            type="number" min="0" step="0.01"
                            className={`${inputCls} rounded-l-none`}
                            value={resp.stay2_king_rate}
                            onChange={setRespField('stay2_king_rate')}
                            disabled={isReadOnly}
                            placeholder="0.00"
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDate(trip.stay2_arrival_date)} – {formatDate(trip.stay2_departure_date)}
                        </p>
                      </div>
                      <div>
                        <FieldLabel htmlFor="rfp-stay2-selling">Current Selling Rate — Stay 2</FieldLabel>
                        <input
                          id="rfp-stay2-selling"
                          type="text"
                          className={inputCls}
                          value={resp.stay2_selling_rate}
                          onChange={setRespField('stay2_selling_rate')}
                          disabled={isReadOnly}
                          placeholder="e.g. $685"
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="rfp-stay2-suite">Suite Rate — Stay 2 ($)</FieldLabel>
                        <div className="flex items-center">
                          <span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">$</span>
                          <input
                            id="rfp-stay2-suite"
                            type="number" min="0" step="0.01"
                            className={`${inputCls} rounded-l-none`}
                            value={resp.stay2_suite_rate}
                            onChange={setRespField('stay2_suite_rate')}
                            disabled={isReadOnly}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div className="sm:col-span-1">
                        <FieldLabel htmlFor="rfp-king-notes">Rate Notes</FieldLabel>
                        <input
                          id="rfp-king-notes"
                          type="text"
                          className={inputCls}
                          value={resp.king_rate_notes}
                          onChange={setRespField('king_rate_notes')}
                          disabled={isReadOnly}
                          placeholder="Any notes on rate variances…"
                        />
                      </div>
                    </>
                  )}

                  {/* Suite Rate (stay 1 / single stay) */}
                  <div>
                    <FieldLabel htmlFor="rfp-suite-rate">
                      {hasStay2 ? 'Suite Rate — Stay 1 ($)' : 'Best Suite Rate ($)'}
                    </FieldLabel>
                    <div className="flex items-center">
                      <span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">$</span>
                      <input
                        id="rfp-suite-rate"
                        type="number" min="0" step="0.01"
                        className={`${inputCls} rounded-l-none`}
                        value={resp.best_suite_rate}
                        onChange={setRespField('best_suite_rate')}
                        disabled={isReadOnly}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {/* Occupancy tax */}
                  <div>
                    <FieldLabel htmlFor="rfp-occupancy-tax">Occupancy Tax</FieldLabel>
                    <input
                      id="rfp-occupancy-tax"
                      type="text"
                      className={inputCls}
                      value={resp.occupancy_tax}
                      onChange={setRespField('occupancy_tax')}
                      disabled={isReadOnly}
                      placeholder="e.g. 16.9% + $5/night"
                    />
                  </div>

                  {/* King rate notes for single-stay trips */}
                  {!hasStay2 && (
                    <div className="sm:col-span-2">
                      <FieldLabel htmlFor="rfp-king-notes">Rate Notes <span className="font-normal text-slate-400">(optional)</span></FieldLabel>
                      <input
                        id="rfp-king-notes"
                        type="text"
                        className={inputCls}
                        value={resp.king_rate_notes}
                        onChange={setRespField('king_rate_notes')}
                        disabled={isReadOnly}
                        placeholder="Any notes on rate variances, special pricing…"
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── Sections 3–6: Concession items ─── */}
          {sections.map((section) => {
            const items = bySection[section]
            if (!items || items.length === 0) return null
            return (
              <div key={section} className="rounded-xl border border-slate-200 bg-white p-6">
                <SectionHeading>{SECTION_LABELS[section]}</SectionHeading>

                {/* Show window context for tournament / postseason */}
                {section === 'in_season_tournament' && data.invitation.trips.in_season_tournament_window && (
                  <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Window: {data.invitation.trips.in_season_tournament_window}
                  </div>
                )}
                {section === 'postseason' && data.invitation.trips.postseason_window && (
                  <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Window: {data.invitation.trips.postseason_window}
                    {data.invitation.trips.postseason_rooms_text
                      ? ` · ${data.invitation.trips.postseason_rooms_text}`
                      : ''}
                  </div>
                )}

                {items.map((item) => (
                  <ConcessionRow
                    key={item.id}
                    item={item}
                    answer={
                      answers[item.id] ?? {
                        answer_yes_no: null,
                        answer_value: '',
                        comment: '',
                        commentOpen: false,
                      }
                    }
                    onChange={(update) => setAnswer(item.id, update)}
                    disabled={isReadOnly}
                  />
                ))}
              </div>
            )
          })}

          {/* ── Section 7: Meeting space + general comments ─── */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <SectionHeading>Additional Information</SectionHeading>
            <div className="space-y-4">
              <div>
                <FieldLabel htmlFor="rfp-meeting-notes">Meeting space (names, sq ft)</FieldLabel>
                <textarea
                  id="rfp-meeting-notes"
                  className={`${inputCls} resize-none`}
                  rows={3}
                  value={resp.meeting_space_notes}
                  onChange={setRespField('meeting_space_notes')}
                  disabled={isReadOnly}
                  placeholder="List available meeting rooms with dimensions…"
                />
              </div>
              <div>
                <FieldLabel htmlFor="rfp-general-comments">General comments</FieldLabel>
                <textarea
                  id="rfp-general-comments"
                  className={`${inputCls} resize-none`}
                  rows={3}
                  value={resp.general_comments}
                  onChange={setRespField('general_comments')}
                  disabled={isReadOnly}
                  placeholder="Any additional notes, clarifications, or offers…"
                />
              </div>
            </div>
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
