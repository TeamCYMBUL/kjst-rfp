import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { Loading, ErrorNote } from '../../components/ui'

type Hotel = {
  id: string
  name: string
  chain: string | null
  city: string | null
  logo_url: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
}

type HotelNote = {
  id: string
  note: string
  created_at: string
}

type TripUsage = {
  id: string
  opponent_label: string | null
  city: string | null
  arrival_date: string | null
  status: string
  clients: { team_name: string } | null
}

type SortBy = 'brand' | 'city' | 'name'

// Chain color avatars (fallback when no logo)
const CHAIN_COLORS: Record<string, { bg: string; text: string; initials: string }> = {
  'Four Seasons':  { bg: 'bg-amber-100',   text: 'text-amber-800',  initials: 'FS' },
  'Ritz-Carlton':  { bg: 'bg-blue-100',    text: 'text-blue-800',   initials: 'RC' },
  'Marriott':      { bg: 'bg-red-100',     text: 'text-red-800',    initials: 'MA' },
  'Hilton':        { bg: 'bg-indigo-100',  text: 'text-indigo-800', initials: 'HI' },
  'Westin':        { bg: 'bg-teal-100',    text: 'text-teal-800',   initials: 'WE' },
  'W Hotels':      { bg: 'bg-purple-100',  text: 'text-purple-800', initials: 'W'  },
  'Omni':          { bg: 'bg-green-100',   text: 'text-green-800',  initials: 'OM' },
}

function HotelAvatar({
  chain,
  name,
  logoUrl,
  size = 'md',
}: {
  chain: string | null
  name: string
  logoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const prevUrl = useRef(logoUrl)
  if (prevUrl.current !== logoUrl) {
    prevUrl.current = logoUrl
    setImgFailed(false)
  }

  const sizeClass =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-14 w-14' : 'h-10 w-10'

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={() => setImgFailed(true)}
        className={`${sizeClass} shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-1`}
      />
    )
  }

  const cfg = chain ? CHAIN_COLORS[chain] : null
  const bg = cfg?.bg ?? 'bg-slate-100'
  const text = cfg?.text ?? 'text-slate-500'
  const initials = cfg?.initials ?? name.slice(0, 2).toUpperCase()
  return (
    <div className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-xl ${bg}`}>
      <span className={`text-xs font-black ${text}`}>{initials}</span>
    </div>
  )
}

// Add/Edit form
function HotelForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Hotel>
  onSave: () => void
  onCancel: () => void
}) {
  const [f, setF] = useState({
    name: initial?.name ?? '',
    chain: initial?.chain ?? '',
    city: initial?.city ?? '',
    contact_name: initial?.contact_name ?? '',
    contact_email: initial?.contact_email ?? '',
    contact_phone: initial?.contact_phone ?? '',
    notes: initial?.notes ?? '',
  })
  const [logoUrl, setLogoUrl] = useState<string | null>(initial?.logo_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    const ext = file.name.split('.').pop() ?? 'png'
    const fileName = `${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('hotel-logos')
      .upload(fileName, file, { upsert: true })
    if (uploadError) {
      setError(`Logo upload failed: ${uploadError.message}`)
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('hotel-logos').getPublicUrl(fileName)
    setLogoUrl(data.publicUrl)
    setUploading(false)
    e.target.value = ''
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) { setError('Hotel name is required.'); return }
    setSaving(true); setError(null)
    const payload = {
      name: f.name.trim(),
      chain: f.chain.trim() || null,
      city: f.city.trim() || null,
      logo_url: logoUrl ?? null,
      contact_name: f.contact_name.trim() || null,
      contact_email: f.contact_email.trim() || null,
      contact_phone: f.contact_phone.trim() || null,
      notes: f.notes.trim() || null,
    }
    if (initial?.id) {
      await supabase.from('hotels').update(payload).eq('id', initial.id)
    } else {
      await supabase.from('hotels').insert(payload)
    }
    setSaving(false)
    onSave()
  }

  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]'
  const labelCls = 'mb-1 block text-xs font-medium text-slate-600'

  return (
    <form onSubmit={submit} className="space-y-3 p-6">
      <h3 className="text-sm font-semibold text-slate-800">{initial?.id ? 'Edit hotel' : 'Add hotel'}</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Logo upload */}
      <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-white">
          {logoUrl ? (
            <img src={logoUrl} alt="Hotel logo" className="h-full w-full object-contain p-1" />
          ) : (
            <span className="text-xl">🏨</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className={`cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 ${uploading ? 'cursor-not-allowed opacity-50' : ''}`}>
            {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={handleLogoUpload}
              disabled={uploading}
            />
          </label>
          {logoUrl && (
            <button type="button" onClick={() => setLogoUrl(null)}
              className="text-xs text-red-400 hover:text-red-600 transition-colors">
              Remove
            </button>
          )}
        </div>
      </div>

      <div>
        <label className={labelCls}>Property name *</label>
        <input className={inputCls} value={f.name} onChange={set('name')} required placeholder="e.g. Four Seasons Miami" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Chain / Brand</label>
          <input className={inputCls} value={f.chain} onChange={set('chain')} placeholder="e.g. Four Seasons" />
        </div>
        <div>
          <label className={labelCls}>City</label>
          <input className={inputCls} value={f.city} onChange={set('city')} placeholder="e.g. Miami" />
        </div>
      </div>
      <div>
        <label className={labelCls}>Contact name</label>
        <input className={inputCls} value={f.contact_name} onChange={set('contact_name')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Contact email</label>
          <input type="email" className={inputCls} value={f.contact_email} onChange={set('contact_email')} />
        </div>
        <div>
          <label className={labelCls}>Contact phone</label>
          <input className={inputCls} value={f.contact_phone} onChange={set('contact_phone')} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Notes</label>
        <textarea className={inputCls + ' resize-none'} rows={2} value={f.notes} onChange={set('notes')} placeholder="Any notes about this property…" />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="rounded-lg bg-[#1C1008] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50">
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Add hotel'}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  )
}

// Right panel — hotel detail
function HotelDetail({
  hotel,
  onEdit,
  onDelete,
}: {
  hotel: Hotel
  onEdit: () => void
  onDelete: () => void
}) {
  const [trips, setTrips] = useState<TripUsage[]>([])
  const [loadingTrips, setLoadingTrips] = useState(true)
  const [hotelNotes, setHotelNotes] = useState<HotelNote[]>([])
  const [loadingNotes, setLoadingNotes] = useState(true)
  const [showAddNote, setShowAddNote] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const loadNotes = () => {
    setLoadingNotes(true)
    supabase
      .from('hotel_notes')
      .select('id, note, created_at')
      .eq('hotel_id', hotel.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setHotelNotes((data as HotelNote[]) ?? [])
        setLoadingNotes(false)
      })
  }

  useEffect(() => {
    setLoadingTrips(true)
    supabase
      .from('rfp_invitations')
      .select('trips(id, opponent_label, city, arrival_date, status, clients(team_name))')
      .ilike('hotel_name', `%${hotel.name}%`)
      .then(({ data }) => {
        const seen = new Set<string>()
        const unique: TripUsage[] = []
        ;(data ?? []).forEach((row: any) => {
          const t = row.trips
          if (t && !seen.has(t.id)) { seen.add(t.id); unique.push(t) }
        })
        setTrips(unique)
        setLoadingTrips(false)
      })
    loadNotes()
  }, [hotel.id, hotel.name])

  const saveNote = async () => {
    if (!newNote.trim()) return
    setSavingNote(true)
    const { data: profile } = await supabase.from('profiles').select('id').single()
    await supabase.from('hotel_notes').insert({
      hotel_id: hotel.id,
      note: newNote.trim(),
      created_by: profile?.id ?? null,
    })
    setSavingNote(false)
    setNewNote('')
    setShowAddNote(false)
    loadNotes()
  }

  const deleteNote = async (noteId: string) => {
    if (!confirm('Delete this note?')) return
    await supabase.from('hotel_notes').delete().eq('id', noteId)
    loadNotes()
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <HotelAvatar chain={hotel.chain} name={hotel.name} logoUrl={hotel.logo_url} size="lg" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{hotel.name}</h2>
              <p className="text-sm text-slate-500">
                {[hotel.chain, hotel.city].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onEdit}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Edit
            </button>
            <button onClick={onDelete}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {/* Contact */}
        <div className="px-6 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Sales Contact</h3>
          {hotel.contact_name || hotel.contact_email || hotel.contact_phone ? (
            <dl className="space-y-2">
              {hotel.contact_name && (
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-400">Name</dt>
                  <dd className="text-sm font-medium text-slate-800">{hotel.contact_name}</dd>
                </div>
              )}
              {hotel.contact_email && (
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-400">Email</dt>
                  <dd className="text-sm text-slate-800">
                    <a href={`mailto:${hotel.contact_email}`} className="text-[#1C1008] hover:underline">
                      {hotel.contact_email}
                    </a>
                  </dd>
                </div>
              )}
              {hotel.contact_phone && (
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-400">Phone</dt>
                  <dd className="text-sm text-slate-800">{hotel.contact_phone}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-xs text-slate-400">No contact info on file.</p>
          )}
        </div>

        {/* Notes (general) */}
        {hotel.notes && (
          <div className="px-6 py-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">General Notes</h3>
            <p className="text-sm text-slate-600">{hotel.notes}</p>
          </div>
        )}

        {/* Issues & Notes log */}
        <div className="px-6 py-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Issues &amp; Notes
              {hotelNotes.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 normal-case">
                  {hotelNotes.length}
                </span>
              )}
            </h3>
            {!showAddNote && (
              <button
                onClick={() => setShowAddNote(true)}
                className="text-xs font-medium text-[#1C1008] hover:underline transition-colors"
              >
                + Add note
              </button>
            )}
          </div>

          {/* Add note form */}
          {showAddNote && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <textarea
                autoFocus
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008] resize-none"
                rows={3}
                placeholder="Describe what happened — e.g. room shortage, billing dispute, late checkout issue…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={saveNote}
                  disabled={savingNote || !newNote.trim()}
                  className="rounded bg-[#1C1008] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50"
                >
                  {savingNote ? 'Saving…' : 'Save note'}
                </button>
                <button
                  onClick={() => { setShowAddNote(false); setNewNote('') }}
                  className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Notes timeline */}
          {loadingNotes ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : hotelNotes.length === 0 ? (
            <p className="text-xs text-slate-400">No issues or notes logged yet.</p>
          ) : (
            <div className="space-y-3">
              {hotelNotes.map((n) => (
                <div key={n.id} className="relative pl-4 before:absolute before:left-1 before:top-2 before:h-1.5 before:w-1.5 before:rounded-full before:bg-amber-400">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-700 leading-snug">{n.note}</p>
                    <button
                      onClick={() => deleteNote(n.id)}
                      className="shrink-0 text-xs text-slate-300 hover:text-red-400 transition-colors"
                      title="Delete note"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">{fmtDate(n.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trip history */}
        <div className="px-6 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Trip History {!loadingTrips && trips.length > 0 && <span className="ml-1 font-normal normal-case text-slate-300">({trips.length})</span>}
          </h3>
          {loadingTrips ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : trips.length === 0 ? (
            <p className="text-xs text-slate-400">Not yet used on any trips.</p>
          ) : (
            <div className="space-y-2">
              {trips.map((t) => (
                <Link key={t.id} to={`/trips/${t.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{t.opponent_label || 'Untitled trip'}</p>
                    <p className="text-xs text-slate-400">
                      {[t.clients?.team_name, t.city].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">{t.arrival_date?.slice(0, 7) ?? ''}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── CSV Import Modal ──────────────────────────────────────────────────────────

type ImportModalProps = { onClose: () => void; onImported: (count: number) => void }

type ImportRow = {
  name: string
  chain: string
  city: string
  contact_name: string
  contact_email: string
  contact_phone: string
}

function HotelImportModal({ onClose, onImported }: ImportModalProps) {
  const [parsed, setParsed] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)

  const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, '_')

  const parseFile = (file: File) => {
    setImportError(null)
    setParsed([])
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
        if (rows.length === 0) { setImportError('No data rows found in file.'); return }

        // Build a header map from first row keys
        const firstRow = rows[0]
        const headerMap: Record<string, string> = {}
        for (const key of Object.keys(firstRow)) {
          headerMap[normalizeHeader(key)] = key
        }

        const getCol = (row: Record<string, string>, ...aliases: string[]) => {
          for (const alias of aliases) {
            const raw = headerMap[normalizeHeader(alias)]
            if (raw !== undefined && row[raw] !== undefined) return String(row[raw]).trim()
          }
          return ''
        }

        const valid: ImportRow[] = []
        for (const row of rows) {
          const name = getCol(row, 'name', 'property_name', 'hotel_name', 'hotel')
          if (!name) continue
          valid.push({
            name,
            chain: getCol(row, 'chain', 'brand', 'chain_brand'),
            city: getCol(row, 'city', 'location'),
            contact_name: getCol(row, 'contact_name', 'contact', 'contact name'),
            contact_email: getCol(row, 'contact_email', 'email', 'contact email'),
            contact_phone: getCol(row, 'contact_phone', 'phone', 'contact phone'),
          })
        }

        if (valid.length === 0) { setImportError('No valid rows found. Make sure the file has a "name" column.'); return }
        setParsed(valid)
      } catch {
        setImportError('Could not parse file. Make sure it is a valid CSV or Excel file.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['name', 'chain', 'city', 'contact_name', 'contact_email', 'contact_phone'],
      ['Four Seasons Miami', 'Four Seasons', 'Miami', 'John Smith', 'jsmith@fourseasons.com', '305-555-0100'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Hotels')
    XLSX.writeFile(wb, 'hotel_import_template.csv')
  }

  const doImport = async () => {
    if (parsed.length === 0) return
    setImporting(true)
    setImportError(null)
    const payload = parsed.map((r) => ({
      name: r.name,
      chain: r.chain || null,
      city: r.city || null,
      contact_name: r.contact_name || null,
      contact_email: r.contact_email || null,
      contact_phone: r.contact_phone || null,
    }))
    // Insert in batches of 100
    const BATCH = 100
    let inserted = 0
    for (let i = 0; i < payload.length; i += BATCH) {
      const batch = payload.slice(i, i + BATCH)
      const { error } = await supabase.from('hotels').insert(batch)
      if (error) { setImportError(error.message); setImporting(false); return }
      inserted += batch.length
    }
    setImporting(false)
    setSuccess(inserted)
    setTimeout(() => onImported(inserted), 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Import Hotels from CSV</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-6 space-y-4">
          {/* Template download */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Download template</p>
              <p className="text-xs text-slate-400">CSV with the expected column headers and an example row</p>
            </div>
            <button
              onClick={downloadTemplate}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              ↓ Template
            </button>
          </div>

          {/* File upload */}
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-6 py-8 text-center hover:border-[#1C1008]/30 transition-colors">
              <span className="text-2xl mb-2">📁</span>
              <span className="text-sm font-medium text-slate-700">Click to upload CSV or Excel file</span>
              <span className="mt-1 text-xs text-slate-400">Columns: name (required), chain, city, contact_name, contact_email, contact_phone</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f) }}
              />
            </label>
          </div>

          {importError && (
            <p className="text-xs text-red-600">{importError}</p>
          )}

          {/* Preview table */}
          {parsed.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{parsed.length} hotels ready to import</p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-left text-slate-400">
                      <th className="px-3 py-2 font-semibold">Name</th>
                      <th className="px-3 py-2 font-semibold">Chain</th>
                      <th className="px-3 py-2 font-semibold">City</th>
                      <th className="px-3 py-2 font-semibold">Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {parsed.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                        <td className="px-3 py-2 text-slate-500">{row.chain || '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{row.city || '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{row.contact_name || row.contact_email || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {success !== null && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              ✅ {success} hotel{success !== 1 ? 's' : ''} imported successfully!
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50">
              Cancel
            </button>
            {parsed.length > 0 && success === null && (
              <button
                onClick={doImport}
                disabled={importing}
                className="rounded-lg bg-[#1C1008] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50 transition-colors"
              >
                {importing ? 'Importing…' : `Import ${parsed.length} hotel${parsed.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HotelsList() {
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'add' | 'edit'>('view')
  const [sortBy, setSortBy] = useState<SortBy>('brand')
  const [showImport, setShowImport] = useState(false)

  const load = () => {
    supabase.from('hotels').select('*').order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else { setHotels(data as Hotel[]); if (!selectedId && data?.length) setSelectedId(data[0].id) }
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [])

  const selected = hotels.find((h) => h.id === selectedId) ?? null

  const filtered = hotels.filter((h) =>
    !search || [h.name, h.chain, h.city, h.contact_name].some((v) => v?.toLowerCase().includes(search.toLowerCase()))
  )

  // Group by chain
  const chains = new Map<string, Hotel[]>()
  for (const h of filtered) {
    const key = h.chain ?? 'Other'
    if (!chains.has(key)) chains.set(key, [])
    chains.get(key)!.push(h)
  }
  const sortedChains = [...chains.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const deleteHotel = async (hotel: Hotel) => {
    if (!confirm(`Delete "${hotel.name}" from the database?\n\nThis won't affect past trip invitations.`)) return
    await supabase.from('hotels').delete().eq('id', hotel.id)
    setSelectedId(null)
    setMode('view')
    load()
  }

  if (loading) return <Loading />
  if (error) return <ErrorNote message={error} />

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col -mx-8 -my-8">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Hotel Database</h1>
          <p className="text-sm text-slate-500">{hotels.length} propert{hotels.length === 1 ? 'y' : 'ies'} · click any hotel to view details</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            ↑ Import CSV
          </button>
          <button
            onClick={() => { setMode('add'); setSelectedId(null) }}
            className="rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d1e0e] transition-colors"
          >
            + Add hotel
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: hotel list */}
        <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
          {/* Search */}
          <div className="border-b border-slate-100 p-3">
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hotels…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008]"
            />
          </div>

          {/* Sort toggle */}
          <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sort:</span>
            {(['brand', 'city', 'name'] as SortBy[]).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors capitalize ${
                  sortBy === s
                    ? 'bg-[#1C1008] text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Hotel list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-slate-400">No hotels found.</p>
            )}

            {sortBy === 'brand' ? (
              /* Grouped by chain */
              sortedChains.map(([chain, chainHotels]) => (
                <div key={chain}>
                  <div className="sticky top-0 bg-slate-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    {chain}
                  </div>
                  {chainHotels.map((hotel) => {
                    const isSelected = hotel.id === selectedId && mode !== 'add'
                    return (
                      <button
                        key={hotel.id}
                        onClick={() => { setSelectedId(hotel.id); setMode('view') }}
                        className={`flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors ${
                          isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                        }`}
                      >
                        <HotelAvatar chain={hotel.chain} name={hotel.name} logoUrl={hotel.logo_url} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{hotel.name}</p>
                          <p className="truncate text-xs text-slate-400">{hotel.city ?? '—'}</p>
                        </div>
                        {isSelected && <span className="text-slate-300 shrink-0">›</span>}
                      </button>
                    )
                  })}
                </div>
              ))
            ) : (
              /* Flat list sorted by city or name */
              [...filtered]
                .sort((a, b) => {
                  const va = sortBy === 'city' ? (a.city ?? '') : a.name
                  const vb = sortBy === 'city' ? (b.city ?? '') : b.name
                  return va.localeCompare(vb)
                })
                .map((hotel) => {
                  const isSelected = hotel.id === selectedId && mode !== 'add'
                  return (
                    <button
                      key={hotel.id}
                      onClick={() => { setSelectedId(hotel.id); setMode('view') }}
                      className={`flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors ${
                        isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                      }`}
                    >
                      <HotelAvatar chain={hotel.chain} name={hotel.name} logoUrl={hotel.logo_url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{hotel.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          {sortBy === 'city'
                            ? (hotel.city ?? '—')
                            : [hotel.chain, hotel.city].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      {isSelected && <span className="text-slate-300 shrink-0">›</span>}
                    </button>
                  )
                })
            )}
          </div>
        </div>

        {/* Right: detail / form */}
        <div className="flex-1 overflow-hidden bg-slate-50">
          {mode === 'add' && (
            <div className="mx-auto max-w-lg pt-8">
              <div className="rounded-xl border border-slate-200 bg-white">
                <HotelForm
                  onSave={() => { setMode('view'); load() }}
                  onCancel={() => setMode('view')}
                />
              </div>
            </div>
          )}
          {mode === 'edit' && selected && (
            <div className="mx-auto max-w-lg pt-8">
              <div className="rounded-xl border border-slate-200 bg-white">
                <HotelForm
                  initial={selected}
                  onSave={() => { setMode('view'); load() }}
                  onCancel={() => setMode('view')}
                />
              </div>
            </div>
          )}
          {mode === 'view' && selected && (
            <HotelDetail
              hotel={selected}
              onEdit={() => setMode('edit')}
              onDelete={() => deleteHotel(selected)}
            />
          )}
          {mode === 'view' && !selected && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Select a hotel to view details
            </div>
          )}
        </div>
      </div>

      {showImport && (
        <HotelImportModal
          onClose={() => setShowImport(false)}
          onImported={(_n) => { setShowImport(false); load() }}
        />
      )}
    </div>
  )
}
