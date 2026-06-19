import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '../../lib/supabase'
import { useRole } from '../../lib/useRole'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

type Props = {
  isOpen: boolean
  onClose: () => void
  onImported: (count: number) => void
}

type RawRow = Record<string, string>

type MappedField = {
  key: string
  label: string
  required: boolean
  dbField: string
}

const FIELDS: MappedField[] = [
  { key: 'opponent', label: 'Opponent', required: true, dbField: 'opponent_label' },
  { key: 'city', label: 'City', required: true, dbField: 'city' },
  { key: 'game_date', label: 'Game Date', required: false, dbField: 'game_date' },
  { key: 'arrival_date', label: 'Arrival Date', required: false, dbField: 'arrival_date' },
  { key: 'departure_date', label: 'Departure Date', required: false, dbField: 'departure_date' },
  { key: 'king_rooms', label: 'King Rooms', required: false, dbField: 'king_rooms_requested' },
  { key: 'suites', label: 'Suites', required: false, dbField: 'suites_requested' },
]

function autoDetect(header: string): string | null {
  const h = header.toLowerCase()
  if (h.includes('opponent')) return 'opponent'
  if (h.includes('city')) return 'city'
  if (h.includes('game')) return 'game_date'
  if (h.includes('arrival') || h.includes('check-in')) return 'arrival_date'
  if (h.includes('departure') || h.includes('checkout')) return 'departure_date'
  if (h.includes('king') || h.includes('rooms')) return 'king_rooms'
  if (h.includes('suite')) return 'suites'
  return null
}

async function parsePdfToRows(buffer: ArrayBuffer): Promise<string[][]> {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const allRows: string[][] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // Cluster text items by y-position (same row = within 4pt of each other)
    type Item = { x: number; y: number; str: string }
    const items: Item[] = (content.items as any[])
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: Math.round(it.transform[5]), str: it.str.trim() }))

    const buckets = new Map<number, Item[]>()
    for (const item of items) {
      // Find existing bucket within 4pt tolerance
      let key = item.y
      for (const k of buckets.keys()) {
        if (Math.abs(k - item.y) <= 4) { key = k; break }
      }
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(item)
    }

    // Sort rows top-to-bottom (PDF y=0 is bottom), sort cells left-to-right
    const sortedYs = [...buckets.keys()].sort((a, b) => b - a)
    for (const y of sortedYs) {
      const cells = buckets.get(y)!.sort((a, b) => a.x - b.x).map((it) => it.str)
      if (cells.some((c) => c.length > 0)) allRows.push(cells)
    }
  }

  return allRows
}

function parseDate(val: string | number | null | undefined): string | null {
  if (val == null || val === '') return null
  const s = String(val).trim()
  // Excel serial number
  if (/^\d+$/.test(s) && Number(s) > 40000) {
    return new Date(Math.round((Number(s) - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // M/D/YYYY or MM/DD/YYYY
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

export default function ScheduleImportModal({ isOpen, onClose, onImported }: Props) {
  const { role, assignedClientIds, canEditClient } = useRole()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<RawRow[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [clients, setClients] = useState<{ id: string; team_name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [importing, setImporting] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [skippedMapping, setSkippedMapping] = useState(false)

  useEffect(() => {
    if (!isOpen || role === null) return
    supabase.from('clients').select('id, team_name').order('team_name')
      .then(({ data }) => {
        const all = (data as any[]) ?? []
        setClients(role === 'admin' ? all : all.filter((c: any) => assignedClientIds.has(c.id)))
      })
  }, [isOpen, role, assignedClientIds])

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep(1); setHeaders([]); setRows([]); setMapping({}); setClientId(''); setError(null); setSkippedMapping(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const processRows = (raw: string[][]) => {
    if (raw.length < 2) { setError('File is empty or has no data rows.'); return }
    const hdrs = raw[0].map((h) => String(h ?? ''))
    const dataRows: RawRow[] = raw.slice(1)
      .filter((r) => r.some((c) => c != null && c !== ''))
      .map((r) => {
        const obj: RawRow = {}
        hdrs.forEach((h, i) => { obj[h] = String(r[i] ?? '') })
        return obj
      })
    setHeaders(hdrs)
    setRows(dataRows)
    const detected: Record<string, string> = {}
    hdrs.forEach((h) => {
      const field = autoDetect(h)
      if (field && !Object.values(detected).includes(field)) detected[h] = field
    })
    setMapping(detected)
    const hasOpponent = Object.values(detected).includes('opponent')
    const hasCity = Object.values(detected).includes('city')
    const skip = hasOpponent && hasCity
    setSkippedMapping(skip)
    setStep(skip ? 3 : 2)
  }

  const handleFile = (file: File) => {
    if (!clientId) { setError('Please select a team before uploading your file.'); return }
    setError(null)
    const ext = file.name.toLowerCase().split('.').pop()

    if (ext === 'pdf') {
      setParsing(true)
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const raw = await parsePdfToRows(e.target!.result as ArrayBuffer)
          processRows(raw)
        } catch (err: any) {
          setError('Could not read PDF: ' + err.message)
        } finally {
          setParsing(false)
        }
      }
      reader.readAsArrayBuffer(file)
      return
    }

    const reader = new FileReader()
    const isCsv = ext === 'csv'
    reader.onload = (e) => {
      try {
        let wb: XLSX.WorkBook
        if (isCsv) {
          wb = XLSX.read(e.target!.result as string, { type: 'string' })
        } else {
          wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        }
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
        processRows(raw.map((r) => r.map((c) => String(c ?? ''))))
      } catch (err: any) {
        setError('Could not parse file: ' + err.message)
      }
    }
    if (isCsv) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['opponent', 'city', 'game_date', 'arrival_date', 'departure_date', 'king_rooms', 'suites'],
      ['@ Boston Celtics', 'Boston', '2026-05-18', '2026-05-17', '2026-05-19', '25', '4'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
    XLSX.writeFile(wb, 'kjst_schedule_template.csv', { bookType: 'csv' })
  }

  // Build preview rows from mapping
  const getVal = (row: RawRow, fieldKey: string): string => {
    const csvCol = Object.entries(mapping).find(([, fk]) => fk === fieldKey)?.[0]
    return csvCol ? (row[csvCol] ?? '') : ''
  }

  const validRows = rows.filter((r) => {
    const opp = getVal(r, 'opponent').trim()
    const city = getVal(r, 'city').trim()
    return opp !== '' && city !== ''
  })

  const doImport = async () => {
    if (!clientId) { setError('Please select a client.'); return }
    if (!canEditClient(clientId)) { setError("You don't have permission to create trips for this team."); return }
    setImporting(true); setError(null)
    const inserts = validRows.map((r) => {
      const rec: any = {
        client_id: clientId,
        status: 'draft',
        opponent_label: getVal(r, 'opponent').trim() || null,
        city: getVal(r, 'city').trim() || null,
        game_date: parseDate(getVal(r, 'game_date')),
        arrival_date: parseDate(getVal(r, 'arrival_date')),
        departure_date: parseDate(getVal(r, 'departure_date')),
        king_rooms_requested: getVal(r, 'king_rooms').trim() ? Number(getVal(r, 'king_rooms').trim()) : null,
        suites_requested: getVal(r, 'suites').trim() ? Number(getVal(r, 'suites').trim()) : null,
      }
      return rec
    })
    const { error: insertError } = await supabase.from('trips').insert(inserts)
    setImporting(false)
    if (insertError) { setError(insertError.message); return }
    setStep(4)
    onImported(inserts.length)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Import from Schedule</h2>
            <p className="text-xs text-slate-400 mt-0.5">Upload a CSV, Excel, or PDF file to create multiple draft trips at once.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-slate-100 px-6 py-2 shrink-0 gap-4">
          {(['1. Upload', '2. Map columns', '3. Preview & import', '4. Done'] as const).map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3 | 4
            const active = step === n
            const done = step > n
            return (
              <span key={label} className={`text-xs font-medium ${active ? 'text-[#1C1008]' : done ? 'text-slate-400 line-through' : 'text-slate-300'}`}>
                {label}
              </span>
            )
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>
          )}

          {/* Step 1: Upload + client select */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Team *</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  <option value="">Choose a team…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.team_name}</option>
                  ))}
                </select>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-12 transition-colors cursor-pointer ${dragOver ? 'border-[#1C1008] bg-[#1C1008]/5' : 'border-slate-300 hover:border-slate-400'} ${parsing ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={() => !parsing && document.getElementById('schedule-file-input')?.click()}
              >
                {parsing ? (
                  <>
                    <div className="text-3xl mb-3 animate-spin">⏳</div>
                    <p className="text-sm font-medium text-slate-700">Reading PDF…</p>
                    <p className="mt-1 text-xs text-slate-400">Extracting schedule data</p>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-3">📁</div>
                    <p className="text-sm font-medium text-slate-700">Drop a file here, or click to browse</p>
                    <p className="mt-1 text-xs text-slate-400">Accepts .csv, .xlsx, .xls, .pdf</p>
                  </>
                )}
                <input
                  id="schedule-file-input"
                  type="file"
                  accept=".csv,.xlsx,.xls,.pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />
              </div>
              <div className="text-center">
                <button onClick={downloadTemplate} className="text-xs text-[#1C1008] hover:underline font-medium">
                  ↓ Download template CSV
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Map columns */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">Map each field to a column from your file. Required fields must be mapped.</p>
              <div className="space-y-3">
                {FIELDS.map((f) => {
                  const currentCol = Object.entries(mapping).find(([, fk]) => fk === f.key)?.[0] ?? ''
                  return (
                    <div key={f.key} className="flex items-center gap-4">
                      <div className="w-40 shrink-0">
                        <span className="text-sm font-medium text-slate-700">{f.label}</span>
                        {f.required && <span className="ml-1 text-red-400">*</span>}
                      </div>
                      <select
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none"
                        value={currentCol}
                        onChange={(e) => {
                          setMapping((prev) => {
                            const next = { ...prev }
                            // Remove previous mapping for this field
                            Object.keys(next).forEach((col) => { if (next[col] === f.key) delete next[col] })
                            if (e.target.value) next[e.target.value] = f.key
                            return next
                          })
                        }}
                      >
                        <option value="">— not mapped —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(3)} className="rounded-lg bg-[#1C1008] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d1e0e]">
                  Continue
                </button>
                <button onClick={() => setStep(1)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50">
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Preview & import */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs text-slate-500">
                  <strong className="text-slate-700">{validRows.length}</strong> of {rows.length} rows are valid and will be imported.
                  {rows.length - validRows.length > 0 && <span className="ml-1 text-amber-600">{rows.length - validRows.length} will be skipped (missing opponent or city).</span>}
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                        <th className="px-3 py-2 font-semibold">Opponent</th>
                        <th className="px-3 py-2 font-semibold">City</th>
                        <th className="px-3 py-2 font-semibold">Arrival</th>
                        <th className="px-3 py-2 font-semibold">Departure</th>
                        <th className="px-3 py-2 font-semibold text-right">Kings</th>
                        <th className="px-3 py-2 font-semibold text-right">Suites</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r, i) => {
                        const opp = getVal(r, 'opponent').trim()
                        const city = getVal(r, 'city').trim()
                        const isSkipped = !opp || !city
                        return (
                          <tr key={i} className={isSkipped ? 'bg-red-50' : ''}>
                            <td className={`px-3 py-2 ${isSkipped ? 'text-red-500 italic' : 'text-slate-800'}`}>
                              {opp || <span className="text-red-400">missing</span>}
                              {isSkipped && <span className="ml-1 text-[10px] text-red-400">will be skipped</span>}
                            </td>
                            <td className={`px-3 py-2 ${isSkipped ? 'text-red-500 italic' : 'text-slate-700'}`}>
                              {city || <span className="text-red-400">missing</span>}
                            </td>
                            <td className="px-3 py-2 text-slate-500">{parseDate(getVal(r, 'arrival_date')) ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-500">{parseDate(getVal(r, 'departure_date')) ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{getVal(r, 'king_rooms') || '—'}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{getVal(r, 'suites') || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={doImport}
                  disabled={importing || !clientId || validRows.length === 0}
                  className="rounded-lg bg-[#1C1008] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50"
                >
                  {importing ? 'Creating…' : `Create ${validRows.length} draft trip${validRows.length !== 1 ? 's' : ''}`}
                </button>
                <button onClick={() => setStep(skippedMapping ? 1 : 2)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50">
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 4 && (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">✅</div>
              <h3 className="text-base font-semibold text-slate-800">Import complete!</h3>
              <p className="mt-1 text-sm text-slate-500">{validRows.length} draft trip{validRows.length !== 1 ? 's' : ''} created successfully.</p>
              <button onClick={onClose} className="mt-4 rounded-lg bg-[#1C1008] px-5 py-2 text-sm font-semibold text-white hover:bg-[#2d1e0e]">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
