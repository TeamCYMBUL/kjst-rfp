import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { Badge, ErrorNote, Loading } from '../../components/ui'

// ── Types ──────────────────────────────────────────────────────────────────────

type RfpRow = {
  id: string
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  status: string
  sent_at: string | null
  submitted_at: string | null
  trips: {
    id: string
    city: string | null
    opponent_label: string | null
    arrival_date: string | null
    response_deadline: string | null
    status: string
    clients: { team_name: string } | null
  } | null
}

type ViewTab = 'invitations' | 'contacts'
type StatusFilter = 'all' | 'pending' | 'submitted' | 'awarded' | 'overdue'

function isOverdue(row: RfpRow): boolean {
  if (!row.trips?.response_deadline) return false
  if (['submitted', 'awarded', 'passed'].includes(row.status)) return false
  return new Date(row.trips.response_deadline) < new Date()
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function RfpsList() {
  const [rows, setRows] = useState<RfpRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<ViewTab>('invitations')
  const [filter, setFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('rfp_invitations')
        .select(`
          id, hotel_name, hotel_contact_name, hotel_contact_email,
          status, sent_at, submitted_at,
          trips (
            id, city, opponent_label, arrival_date, response_deadline, status,
            clients (team_name)
          )
        `)
        .order('created_at', { ascending: false })

      if (error) setError(error.message)
      else setRows((data as unknown as RfpRow[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  // ── Counts for filter pills ────────────────────────────────────────────────
  const counts = useMemo(
    () => ({
      all: rows.length,
      pending: rows.filter((r) => ['sent', 'opened'].includes(r.status)).length,
      submitted: rows.filter((r) => r.status === 'submitted').length,
      awarded: rows.filter((r) => r.status === 'awarded').length,
      overdue: rows.filter(isOverdue).length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    switch (filter) {
      case 'pending':
        return rows.filter((r) => ['sent', 'opened'].includes(r.status))
      case 'submitted':
        return rows.filter((r) => r.status === 'submitted')
      case 'awarded':
        return rows.filter((r) => r.status === 'awarded')
      case 'overdue':
        return rows.filter(isOverdue)
      default:
        return rows
    }
  }, [rows, filter])

  // ── Contact sheet: unique hotel contacts aggregated from all invitations ───
  const contacts = useMemo(() => {
    const map = new Map<
      string,
      {
        hotel_name: string
        contact_name: string | null
        email: string | null
        trip_count: number
        last_arrival: string | null
      }
    >()
    for (const r of rows) {
      const key = `${r.hotel_name}||${r.hotel_contact_name ?? ''}||${r.hotel_contact_email ?? ''}`
      const existing = map.get(key)
      const arrival = r.trips?.arrival_date ?? null
      if (existing) {
        existing.trip_count++
        if (arrival && (!existing.last_arrival || arrival > existing.last_arrival)) {
          existing.last_arrival = arrival
        }
      } else {
        map.set(key, {
          hotel_name: r.hotel_name,
          contact_name: r.hotel_contact_name,
          email: r.hotel_contact_email,
          trip_count: 1,
          last_arrival: arrival,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.hotel_name.localeCompare(b.hotel_name))
  }, [rows])

  if (loading) return <Loading />
  if (error) return <ErrorNote message={error} />

  const FILTER_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'awarded', label: 'Awarded' },
    { key: 'overdue', label: 'Overdue' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Invitations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every hotel invitation across all trips — all in one place.
        </p>
      </div>

      {/* View tabs */}
      <div className="flex gap-0 border-b border-slate-200">
        {(['invitations', 'contacts'] as ViewTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setViewTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              viewTab === tab
                ? 'border-[#1C1008] text-[#1C1008]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'invitations' ? 'Invitations' : 'Contact Sheet'}
            {tab === 'invitations' && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {rows.length}
              </span>
            )}
            {tab === 'contacts' && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {contacts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {viewTab === 'invitations' ? (
        <>
          {/* Status filter pills */}
          <div className="flex flex-wrap gap-2">
            {FILTER_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  filter === key
                    ? 'bg-[#1C1008] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
                {counts[key] > 0 && (
                  <span
                    className={`ml-1.5 text-xs ${filter === key ? 'opacity-60' : 'text-slate-400'}`}
                  >
                    {counts[key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Overdue alert */}
          {counts.overdue > 0 && filter !== 'overdue' && (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>⚠️</span>
              <span>
                <strong>{counts.overdue}</strong> invitation{counts.overdue > 1 ? 's are' : ' is'} past
                deadline with no response.
              </span>
              <button
                onClick={() => setFilter('overdue')}
                className="ml-auto font-medium underline"
              >
                View
              </button>
            </div>
          )}

          {/* Invitations table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-400">
                No invitations match this filter.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Hotel
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Team
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Trip
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Deadline
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Responded
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                      &nbsp;
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((row) => {
                    const overdue = isOverdue(row)
                    const trip = row.trips
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{row.hotel_name}</div>
                          {row.hotel_contact_name && (
                            <div className="text-xs text-slate-400">{row.hotel_contact_name}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {trip?.clients?.team_name ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {trip ? (
                            <div>
                              <div className="text-slate-800">
                                {trip.opponent_label || 'Unnamed trip'}
                              </div>
                              {trip.city && (
                                <div className="text-xs text-slate-400">{trip.city}</div>
                              )}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge status={row.status} />
                            {overdue && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                                Overdue
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 text-sm ${
                            overdue
                              ? 'font-medium text-red-600'
                              : 'text-slate-500'
                          }`}
                        >
                          {trip?.response_deadline
                            ? formatDate(trip.response_deadline)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {row.submitted_at ? formatDate(row.submitted_at) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {trip && (
                            <div className="flex items-center justify-end gap-3">
                              <Link
                                to={`/trips/${trip.id}`}
                                className="text-xs font-medium text-[#1C1008] hover:underline"
                              >
                                Trip
                              </Link>
                              {['submitted', 'awarded', 'passed'].includes(row.status) && (
                                <Link
                                  to={`/trips/${trip.id}/grid`}
                                  className="text-xs font-medium text-[#1C1008] hover:underline"
                                >
                                  Grid
                                </Link>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        /* ── Contact Sheet ── */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
            <p className="text-sm text-slate-500">
              {contacts.length} unique hotel contact{contacts.length !== 1 ? 's' : ''} — built
              automatically from your invitation history.
            </p>
          </div>
          {contacts.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              No contacts yet. Start inviting hotels to build your contact sheet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Hotel
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Contact
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Last arrival
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Trips
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contacts.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{c.hotel_name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.contact_name || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="text-[#1C1008] hover:underline"
                        >
                          {c.email}
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {c.last_arrival ? formatDate(c.last_arrival) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{c.trip_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
