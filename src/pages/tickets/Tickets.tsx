import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { Button, Card, ErrorNote, Loading, PageHeader, TextArea, TextField } from '../../components/ui'

type Ticket = {
  id: string
  created_by_name: string | null
  created_by_email: string | null
  title: string
  description: string
  page_url: string | null
  status: 'open' | 'in_progress' | 'resolved'
  created_at: string
}

const STATUS_LABELS: Record<Ticket['status'], string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
}

const STATUS_COLORS: Record<Ticket['status'], string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
}

function StatusPill({ status }: { status: Ticket['status'] }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export default function Tickets() {
  const { isAdmin } = useProfile()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const loadTickets = () => {
    supabase
      .from('tickets')
      .select('id, created_by_name, created_by_email, title, description, page_url, status, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTickets((data as Ticket[]) ?? [])
        setLoading(false)
      })
  }

  useEffect(() => {
    // Pre-fill "Page" with wherever the user came from, so it's rarely left blank.
    const ref = document.referrer
    if (ref && ref.includes(window.location.host)) {
      try { setPageUrl(new URL(ref).pathname) } catch { /* ignore */ }
    }
    loadTickets()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${FN_BASE}/submit-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), page_url: pageUrl.trim() || null }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Failed to submit ticket')
      setTitle('')
      setDescription('')
      setJustSubmitted(true)
      setTimeout(() => setJustSubmitted(false), 4000)
      loadTickets()
    } catch (err: any) {
      setError(err.message ?? 'Failed to submit ticket')
    } finally {
      setSubmitting(false)
    }
  }

  const setStatus = async (ticket: Ticket, status: Ticket['status']) => {
    setUpdatingId(ticket.id)
    const { error } = await supabase
      .from('tickets')
      .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
      .eq('id', ticket.id)
    setUpdatingId(null)
    if (error) setError(error.message)
    else setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status } : t)))
  }

  return (
    <div>
      <PageHeader
        title="Tickets"
        subtitle="Spot a bug or something worth tweaking? Submit it here — it goes straight to the team so we can fix it fast."
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <Card className="p-6 mb-6">
        <form onSubmit={submit} className="space-y-4">
          <TextField
            label="What's the issue?"
            placeholder="e.g. Suite Upgrades column shows blank for submitted bids"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <TextArea
            label="Details"
            placeholder="What did you expect to happen, and what happened instead? Include the hotel/trip if relevant."
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <TextField
            label="Page (optional)"
            placeholder="e.g. /trips/abc123"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting || !title.trim() || !description.trim()}>
              {submitting ? 'Submitting…' : 'Submit ticket'}
            </Button>
            {justSubmitted && <span className="text-sm text-emerald-600">✓ Sent — thanks!</span>}
          </div>
        </form>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        All tickets
      </h2>

      {loading ? (
        <Loading />
      ) : tickets.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-400">No tickets yet.</Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{t.title}</span>
                    <StatusPill status={t.status} />
                  </div>
                  <p className="mt-1.5 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{t.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                    <span>{t.created_by_name ?? t.created_by_email ?? 'Unknown'}</span>
                    <span>·</span>
                    <span>{timeAgo(t.created_at)}</span>
                    {t.page_url && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{t.page_url}</span>
                      </>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 gap-1.5">
                    {t.status !== 'in_progress' && (
                      <button
                        onClick={() => setStatus(t, 'in_progress')}
                        disabled={updatingId === t.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
                      >
                        In progress
                      </button>
                    )}
                    {t.status !== 'resolved' ? (
                      <button
                        onClick={() => setStatus(t, 'resolved')}
                        disabled={updatingId === t.id}
                        className="rounded-lg border border-emerald-200 px-3 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                      >
                        Resolve
                      </button>
                    ) : (
                      <button
                        onClick={() => setStatus(t, 'open')}
                        disabled={updatingId === t.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
