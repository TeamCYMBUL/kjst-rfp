import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { Button, Card, ErrorNote, Loading, PageHeader, TextArea, TextField } from '../../components/ui'

type Attachment = { path: string; name: string; size?: number; type?: string }

type Ticket = {
  id: string
  created_by_name: string | null
  created_by_email: string | null
  title: string
  description: string
  page_url: string | null
  status: 'open' | 'in_progress' | 'resolved'
  created_at: string
  attachments: Attachment[] | null
}

const TICKET_BUCKET = 'ticket-attachments'
const MAX_TICKET_BYTES = 25 * 1024 * 1024

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

async function openTicketAttachment(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(TICKET_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) {
    alert('Could not open the file: ' + (error?.message ?? 'unknown error'))
    return
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setAttachError(null)
    setUploading(true)
    try {
      const added: Attachment[] = []
      for (const file of Array.from(files)) {
        if (file.size > MAX_TICKET_BYTES) {
          setAttachError(`"${file.name}" is larger than 25 MB — please attach a smaller file.`)
          continue
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
        const { error } = await supabase.storage
          .from(TICKET_BUCKET)
          .upload(path, file, { contentType: file.type || undefined, upsert: false })
        if (error) {
          setAttachError(`Could not upload "${file.name}": ${error.message}`)
          continue
        }
        added.push({ path, name: file.name, size: file.size, type: file.type || undefined })
      }
      if (added.length > 0) setAttachments((prev) => [...prev, ...added])
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = (path: string) => setAttachments((prev) => prev.filter((a) => a.path !== path))

  const loadTickets = () => {
    supabase
      .from('tickets')
      .select('id, created_by_name, created_by_email, title, description, page_url, status, created_at, attachments')
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
        body: JSON.stringify({ title: title.trim(), description: description.trim(), page_url: pageUrl.trim() || null, attachments }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Failed to submit ticket')
      setTitle('')
      setDescription('')
      setAttachments([])
      setAttachError(null)
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
        title="Submit a Ticket"
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

          {/* Attachments — screenshots, PDFs, docs */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Attachments (optional)
            </label>
            {attachments.length > 0 && (
              <ul className="mb-2 space-y-2">
                {attachments.map((a) => (
                  <li
                    key={a.path}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                      📎 {a.name}{a.size ? ` · ${formatBytes(a.size)}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.path)}
                      className="shrink-0 text-xs font-medium text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600">
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => { uploadFiles(e.target.files); e.target.value = '' }}
              />
              {uploading ? 'Uploading…' : '+ Add photos / PDFs / docs'}
            </label>
            {attachError && <p className="mt-2 text-sm text-red-600">{attachError}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting || uploading || !title.trim() || !description.trim()}>
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
                  {Array.isArray(t.attachments) && t.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {t.attachments.map((a) => (
                        <button
                          key={a.path}
                          onClick={() => openTicketAttachment(a.path)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        >
                          <span>📎</span>
                          <span className="max-w-[200px] truncate">{a.name}</span>
                          <span className="text-[#1C1008] dark:text-amber-400">↗</span>
                        </button>
                      ))}
                    </div>
                  )}
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
