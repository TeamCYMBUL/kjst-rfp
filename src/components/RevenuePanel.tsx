// Private CYMBUL owner panel — revenue & commissions from awarded trips.
// Renders ONLY when signed in as info@cymbul.co; invisible to all other logins.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchCommissions } from '../lib/commissions'
import type { CommissionRow, CommissionSummary } from '../lib/commissions'

// The logins allowed to see this panel (CYMBUL ownership).
const OWNER_EMAILS = ['info@cymbul.co', 'aaron@galetapartners.com']

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function stayLabel(r: CommissionRow): string {
  if (!r.twoVisit) return ''
  const s: string[] = []
  if (r.wonStay1) s.push('1')
  if (r.wonStay2) s.push('2')
  return s.length ? `Stay ${s.join(' & ')}` : ''
}

export function RevenuePanel() {
  const { user } = useAuth()
  const isOwner = OWNER_EMAILS.includes((user?.email ?? '').trim().toLowerCase())

  const [data, setData] = useState<CommissionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false) // start collapsed on load for a clean page
  const [clientFilter, setClientFilter] = useState<string | null>(null)

  useEffect(() => {
    if (!isOwner) return
    let alive = true
    fetchCommissions()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message ?? 'Failed to load'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [isOwner])

  // Distinct clients for the filter chip row.
  const clientOptions = useMemo(() => {
    if (!data) return [] as Array<[string, string]>
    return [...new Map(data.rows.map((r) => [r.clientId ?? r.clientName, r.clientName])).entries()].sort(
      (a, b) => a[1].localeCompare(b[1]),
    )
  }, [data])

  // Rows after the client filter, grouped by client with per-client subtotals.
  const groups = useMemo(() => {
    if (!data) return []
    const rows = clientFilter ? data.rows.filter((r) => (r.clientId ?? r.clientName) === clientFilter) : data.rows
    const byClient = new Map<string, CommissionRow[]>()
    for (const r of rows) {
      const k = r.clientId ?? r.clientName
      if (!byClient.has(k)) byClient.set(k, [])
      byClient.get(k)!.push(r)
    }
    return [...byClient.entries()]
      .map(([k, rs]) => ({
        key: k,
        name: rs[0].clientName,
        rows: rs.sort((a, b) => a.city.localeCompare(b.city)),
        revenue: rs.reduce((s, r) => s + r.revenue, 0),
        commission: rs.reduce((s, r) => s + r.commission, 0),
      }))
      .sort((a, b) => b.commission - a.commission)
  }, [data, clientFilter])

  // Totals reflect the active filter.
  const shown = useMemo(() => {
    const rows = groups.flatMap((g) => g.rows)
    return {
      bookings: rows.length,
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      commission: rows.reduce((s, r) => s + r.commission, 0),
    }
  }, [groups])

  if (!isOwner) return null

  return (
    <section className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-emerald-900 dark:text-emerald-100">Revenue &amp; Commissions</span>
          <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            CYMBUL private
          </span>
        </div>
        <div className="flex items-center gap-4">
          {data && !loading && (
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {usd(data.totalCommission)} <span className="font-medium text-emerald-600/70">commission</span>
            </span>
          )}
          <span className="text-emerald-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-emerald-200 dark:border-emerald-900/50 px-5 py-4 space-y-4">
          {loading && <p className="text-sm text-emerald-700/70 dark:text-emerald-300/70">Loading awarded trips…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {data && !loading && (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Commission earned', value: usd(shown.commission), strong: true },
                  { label: 'Room revenue booked', value: usd(shown.revenue) },
                  { label: 'Awarded bookings', value: String(shown.bookings) },
                  { label: 'Avg commission', value: `${data.avgPct.toFixed(1)}%` },
                ].map((t) => (
                  <div
                    key={t.label}
                    className="rounded-lg border border-emerald-200/70 dark:border-emerald-900/50 bg-white dark:bg-slate-900/40 px-4 py-3"
                  >
                    <div
                      className={`font-bold tabular-nums ${
                        t.strong ? 'text-2xl text-emerald-700 dark:text-emerald-300' : 'text-xl text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {t.value}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{t.label}</div>
                  </div>
                ))}
              </div>

              {/* Client filter */}
              {clientOptions.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setClientFilter(null)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      clientFilter === null
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    All clients
                  </button>
                  {clientOptions.map(([id, name]) => (
                    <button
                      key={id}
                      onClick={() => setClientFilter(id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        clientFilter === id
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {/* Per-trip table, grouped by client */}
              {shown.bookings === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No awarded trips yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        <th className="py-2 pl-4 pr-3 font-medium">City</th>
                        <th className="py-2 px-3 font-medium">Awarded hotel</th>
                        <th className="py-2 px-3 font-medium text-right">Rooms x Nights</th>
                        <th className="py-2 px-3 font-medium text-right">Room revenue</th>
                        <th className="py-2 px-3 font-medium text-right">Comm %</th>
                        <th className="py-2 pr-4 pl-3 font-medium text-right">Commission</th>
                      </tr>
                    </thead>
                    {groups.map((g) => (
                        <tbody key={g.key}>
                          <tr className="bg-slate-50 dark:bg-slate-800/40">
                            <td colSpan={6} className="px-4 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                              {g.name}
                            </td>
                          </tr>
                          {g.rows.map((r) => {
                            const sl = stayLabel(r)
                            const nightsText = r.twoVisit
                              ? [r.wonStay1 ? `${r.nights1}n` : null, r.wonStay2 ? `${r.nights2}n` : null].filter(Boolean).join(' + ')
                              : `${r.nights1}n`
                            return (
                              <tr key={r.invitationId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 pl-4 pr-3 text-slate-700 dark:text-slate-300">
                                  {r.city || '—'}
                                  {sl && (
                                    <span className="ml-1.5 rounded bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                                      {sl}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                                  {r.hotelName}
                                  {r.flags.length > 0 && (
                                    <span className="ml-1.5 rounded bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400" title={r.flags.join(' · ')}>
                                      {r.flags[0]}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400">
                                  {r.rooms} x {nightsText}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                                  {r.revenue ? usd(r.revenue) : '—'}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400">
                                  {r.commissionPct ? `${r.commissionPct}%` : '—'}
                                </td>
                                <td className="py-2 pr-4 pl-3 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                                  {r.commission ? usd(r.commission) : '—'}
                                </td>
                              </tr>
                            )
                          })}
                          <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                            <td colSpan={3} className="px-4 py-1.5 text-right text-xs font-medium text-slate-400 dark:text-slate-500">
                              {g.name} subtotal
                            </td>
                            <td className="py-1.5 px-3 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">{usd(g.revenue)}</td>
                            <td></td>
                            <td className="py-1.5 pr-4 pl-3 text-right text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{usd(g.commission)}</td>
                          </tr>
                        </tbody>
                      ))}
                    <tfoot>
                      <tr className="bg-emerald-50 dark:bg-emerald-950/30">
                        <td colSpan={3} className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                          Total
                        </td>
                        <td className="py-2 px-3 text-right font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{usd(shown.revenue)}</td>
                        <td></td>
                        <td className="py-2 pr-4 pl-3 text-right font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{usd(shown.commission)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Room revenue = awarded king rate x room block x nights (excl. tax), per stay. Commission % is pulled from each
                winning hotel&apos;s own bid. Visible only to {OWNER_EMAILS.join(' and ')}.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
