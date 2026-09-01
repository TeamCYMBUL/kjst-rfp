import { useEffect, useState } from 'react'
import { fetchSeasonSavings, type SavingsSummary } from '../lib/savings'

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// "What this platform saved you" — the gap between each hotel's own market
// (selling) rate and the rate the client actually got, on awarded trips. Shown
// to KJST so the value is in their hands. Renders nothing until there's a real,
// benchmarked number to show, so it never displays an empty or misleading zero.
export default function SeasonSavings({ clientId }: { clientId?: string }) {
  const [data, setData] = useState<SavingsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setExpanded(false)
    fetchSeasonSavings(clientId)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId])

  if (loading || !data || data.benchmarkedTrips === 0) return null

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Saved vs. market rates
          </div>
          <div className="mt-1 text-2xl font-bold text-emerald-800 dark:text-emerald-300 tabular-nums">
            {fmtUSD(data.total)}
          </div>
          <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
            across {data.benchmarkedTrips} awarded trip{data.benchmarkedTrips === 1 ? '' : 's'} with a market benchmark
          </div>
        </div>
        {data.trips.length > 1 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex-shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            {expanded ? 'Hide' : 'Breakdown'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-1 border-t border-emerald-200/60 dark:border-emerald-800/60 pt-3">
          {data.trips.slice(0, 12).map((t) => (
            <div key={t.tripId} className="flex items-center justify-between gap-4 text-xs">
              <span className="truncate text-emerald-900/80 dark:text-emerald-200/80">{t.label}</span>
              <span className="flex-shrink-0 font-semibold text-emerald-800 dark:text-emerald-300 tabular-nums">
                {fmtUSD(t.saved)}
              </span>
            </div>
          ))}
          {data.trips.length > 12 && (
            <div className="text-xs text-emerald-700/60 dark:text-emerald-400/60">
              …and {data.trips.length - 12} more
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-snug text-emerald-700/60 dark:text-emerald-400/60">
        Benchmark is each hotel's own current selling rate, where captured (NBA/WNBA RFPs). Trips without a benchmark aren't counted.
      </p>
    </div>
  )
}
