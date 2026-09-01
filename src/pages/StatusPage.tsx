import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Live platform health. Reads the SAME public.monitoring_scoreboard() SQL
// function the daily heartbeat email uses, so this page and the email can never
// disagree. The function is SECURITY DEFINER and granted to authenticated staff
// only, so it can surface cron + monitoring internals without loosening RLS.

type Check = { key: string; label: string; ok: boolean; value: string; detail: string }
type Scoreboard = { generated_at: string; overall_ok: boolean; checks: Check[] }

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { timeStyle: 'medium', dateStyle: 'medium' })
  } catch {
    return iso
  }
}

export default function StatusPage() {
  const [sb, setSb] = useState<Scoreboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('monitoring_scoreboard')
    if (error) setError(error.message)
    else setSb(data as Scoreboard)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    // Light auto-refresh so a tab left open stays current.
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Platform Status</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Live health of the RFP platform. A daily heartbeat of this same scoreboard is emailed to the team each morning.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          Couldn't load status: {error}
        </div>
      )}

      {!error && !sb && loading && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-8 text-center text-sm text-slate-400">
          Loading…
        </div>
      )}

      {sb && (
        <>
          {/* Overall banner */}
          <div
            className={`mb-5 flex items-center gap-3 rounded-xl px-5 py-4 ${
              sb.overall_ok
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 flex-shrink-0 rounded-full ${sb.overall_ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
            />
            <div>
              <div className={`text-base font-bold ${sb.overall_ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}`}>
                {sb.overall_ok
                  ? 'All systems normal'
                  : `${sb.checks.filter((c) => !c.ok).length} check(s) need attention`}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">As of {fmt(sb.generated_at)}</div>
            </div>
          </div>

          {/* Checks */}
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            {sb.checks.map((c, i) => (
              <div
                key={c.key}
                className={`flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:gap-4 ${
                  i > 0 ? 'border-t border-slate-100 dark:border-slate-700' : ''
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${c.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{c.label}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{c.detail}</div>
                  </div>
                </div>
                <div className="ml-5 flex items-center gap-3 sm:ml-0">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{c.value}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      c.ok
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {c.ok ? 'OK' : 'Check'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            If the morning heartbeat email ever doesn't arrive, the monitoring itself may be down — that absence is the alarm. This page auto-refreshes every minute.
          </p>
        </>
      )}
    </div>
  )
}
