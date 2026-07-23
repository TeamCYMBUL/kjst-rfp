import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { Badge, Card, EmptyState, ErrorNote, LinkButton, Loading, PageHeader } from '../../components/ui'
import { useRole } from '../../lib/useRole'

type Row = {
  id: string
  opponent_label: string | null
  city: string | null
  arrival_date: string | null
  departure_date: string | null
  stay2_arrival_date: string | null
  status: string
  clients: { team_name: string } | null
  rfp_invitations: { id: string; status: string; hotel_name: string }[]
}

export default function TripsList() {
  const { role } = useRole()
  const isViewer = role === 'viewer'
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const load = () => {
    supabase
      .from('trips')
      .select(
        'id, opponent_label, city, arrival_date, departure_date, stay2_arrival_date, status, clients(team_name), rfp_invitations(id, status, hotel_name)',
      )
      .order('city', { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows(data as unknown as Row[])
      })
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const { error } = await supabase.from('trips').delete().eq('id', id)
    if (error) {
      setError(error.message)
      setDeletingId(null)
    } else {
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? null)
      setDeletingId(null)
    }
    setConfirmId(null)
  }

  if (error) return <ErrorNote message={error} />
  if (!rows) return <Loading />

  return (
    <div>
      <PageHeader
        title="Trips"
        subtitle="Road trips an RFP is being run for."
        action={
          !isViewer ? <LinkButton to="/trips/new">+ New trip</LinkButton> : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="No trips yet.">
          <LinkButton to="/trips/new">Add your first trip</LinkButton>
        </EmptyState>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <th className="px-5 py-3 font-medium">Trip / Client</th>
                <th className="px-5 py-3 font-medium">City · Dates</th>
                <th className="px-5 py-3 font-medium">Hotels</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const invited = t.rfp_invitations.length
                const submitted = t.rfp_invitations.filter((i) =>
                  ['submitted', 'awarded'].includes(i.status),
                ).length
                const isConfirming = confirmId === t.id
                const isDeleting = deletingId === t.id

                return (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700 group"
                  >
                    <td className="px-5 py-3">
                      <Link
                        to={`/trips/${t.id}`}
                        className="font-semibold text-[#1C1008] hover:underline"
                      >
                        {t.opponent_label || 'Untitled trip'}
                      </Link>
                      {t.clients?.team_name && (
                        <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{t.clients.team_name}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-400">
                      {t.city && <div className="font-medium text-slate-700 dark:text-slate-300">{t.city}</div>}
                      <div className="text-xs text-slate-400 dark:text-slate-500">
                        {formatDate(t.arrival_date)} – {formatDate(t.departure_date)}
                        {t.stay2_arrival_date && (
                          <span className="ml-1.5 inline-block rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            +2nd visit {formatDate(t.stay2_arrival_date)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {invited === 0 ? (
                        <span className="text-xs text-slate-400 dark:text-slate-500">None invited</span>
                      ) : (
                        <div>
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            {submitted}/{invited}
                          </span>
                          <div className="text-xs text-slate-400 dark:text-slate-500">
                            bid{submitted !== 1 ? 's' : ''} in · {invited} invited
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge status={t.status} />
                        {t.status === 'closed' && (() => {
                          const winner = t.rfp_invitations.find((i) => i.status === 'awarded')?.hotel_name
                          return winner ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                              🏆 {winner}
                            </span>
                          ) : null
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isViewer && (isConfirming ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-slate-500 dark:text-slate-400">Delete?</span>
                          <button
                            onClick={() => handleDelete(t.id)}
                            disabled={isDeleting}
                            className="rounded px-2 py-1 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
                          >
                            {isDeleting ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded px-2 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(t.id)}
                          className="invisible group-hover:visible rounded p-1.5 text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title="Delete trip"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
