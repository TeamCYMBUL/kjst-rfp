// Fact-check panel for one uploaded contract. Shows exactly what the hotel
// committed to in its winning bid (the source of truth) so the team can verify
// the uploaded contract matches — manually today, and via the AI analysis once
// the Anthropic key is wired. Renders any stored `analysis` (jsonb) result.
import { useEffect, useState } from 'react'
import { fetchBidSummary, analyzeContract } from '../../lib/contractsApi'
import type { AwardedContract, BidSummary, BidTerm, ContractAnalysis } from '../../lib/contractsApi'

function TermList({ title, terms }: { title: string; terms: BidTerm[] }) {
  if (terms.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</div>
      <dl className="space-y-1">
        {terms.map((t, i) => (
          <div key={i} className="flex items-start justify-between gap-3 text-sm">
            <dt className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
              {t.label}
              {t.note && <span className="mt-0.5 block text-xs italic text-blue-700 dark:text-blue-400">"{t.note}"</span>}
            </dt>
            <dd className="shrink-0 font-medium tabular-nums text-slate-800 dark:text-slate-100">{t.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const CHECK_STYLE: Record<string, string> = {
  match: 'text-emerald-600 dark:text-emerald-400',
  mismatch: 'text-red-600 dark:text-red-400',
  missing: 'text-amber-600 dark:text-amber-400',
  extra: 'text-amber-600 dark:text-amber-400',
}
const CHECK_ICON: Record<string, string> = { match: '✓', mismatch: '✗', missing: '⚠', extra: '⚠' }

function AnalysisResult({ analysis, analyzedAt }: { analysis: ContractAnalysis; analyzedAt: string | null }) {
  const issues = analysis.checks.filter((c) => c.status !== 'match')
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`text-sm font-semibold ${analysis.overall === 'match' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
          {analysis.overall === 'match' ? '✓ Contract matches the bid' : `⚠ ${issues.length} discrepanc${issues.length === 1 ? 'y' : 'ies'} to review`}
        </span>
        {analyzedAt && <span className="text-xs text-slate-400">· {new Date(analyzedAt).toLocaleDateString()}</span>}
      </div>
      {analysis.summary && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{analysis.summary}</p>}
      <ul className="space-y-1.5">
        {analysis.checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 shrink-0 font-bold ${CHECK_STYLE[c.status]}`}>{CHECK_ICON[c.status]}</span>
            <div className="min-w-0">
              <span className="text-slate-700 dark:text-slate-200">{c.label}</span>
              {c.status !== 'match' && (
                <span className="text-slate-500 dark:text-slate-400">
                  {' '}— bid: <strong>{c.bid_value ?? '—'}</strong>, contract: <strong>{c.contract_value ?? '—'}</strong>
                </span>
              )}
              {c.note && <span className="block text-xs italic text-slate-400">{c.note}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ContractFactCheck({ row, onDone }: { row: AwardedContract; onDone?: () => void }) {
  const [bid, setBid] = useState<BidSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<ContractAnalysis | null>(row.contract?.analysis ?? null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const contractId = row.contract?.id ?? null

  const runFactCheck = async () => {
    if (!contractId) return
    setRunning(true); setRunError(null)
    try {
      const result = await analyzeContract(contractId)
      setAnalysis(result)
      onDone?.()
    } catch (e: any) {
      setRunError(e.message ?? 'Fact-check failed')
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchBidSummary(row.invitation_id)
      .then((b) => alive && setBid(b))
      .catch((e) => alive && setError(e.message ?? 'Failed to load bid'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [row.invitation_id])

  return (
    <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 px-5 py-4">
      {/* AI result + run/re-run control */}
      <div className="mb-4 space-y-2">
        {analysis && <AnalysisResult analysis={analysis} analyzedAt={row.contract?.analyzed_at ?? null} />}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runFactCheck}
            disabled={running || !contractId}
            className="rounded-lg bg-[#1C1008] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2a1a0f] disabled:opacity-50 transition-colors"
          >
            {running ? 'Analyzing…' : analysis ? 'Re-run AI fact-check' : 'Run AI fact-check'}
          </button>
          {running && <span className="text-xs text-slate-500 dark:text-slate-400">Reading the contract and comparing it to the bid…</span>}
          {runError && <span className="text-xs text-red-600 dark:text-red-400">{runError}</span>}
          {!analysis && !running && !runError && (
            <span className="text-xs text-slate-500 dark:text-slate-400">Cross-checks the contract against the bid terms below and flags any discrepancies.</span>
          )}
        </div>
      </div>

      {/* The winning bid — the source of truth */}
      <div className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">What {row.hotel_name} agreed to in its bid</div>
      {loading && <p className="text-sm text-slate-400">Loading bid…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {bid && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TermList title="Rates" terms={bid.rates} />
          <TermList title="Room block" terms={bid.roomBlock} />
          <TermList title="Dates" terms={bid.dates} />
          {bid.concessions.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <TermList title="Concessions the hotel agreed to" terms={bid.concessions} />
            </div>
          )}
          {(bid.meetingSpaceNotes || bid.generalComments) && (
            <div className="sm:col-span-2 lg:col-span-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
              {bid.meetingSpaceNotes && <p><span className="font-medium text-slate-600 dark:text-slate-300">Meeting space:</span> {bid.meetingSpaceNotes}</p>}
              {bid.generalComments && <p><span className="font-medium text-slate-600 dark:text-slate-300">General comments:</span> {bid.generalComments}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
