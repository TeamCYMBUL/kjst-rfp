// In-platform document viewer for a stored contract file. Opens in a modal so
// staff can read the agreement without it downloading to their machine.
//   • PDF  → shown inline in an <iframe> off a short-lived signed URL.
//   • .docx → converted to HTML in the browser with mammoth (nothing is sent to
//             any third-party viewer; the file never leaves the platform).
//   • legacy .doc / anything else → offer download / open-in-tab as a fallback.
import { useEffect, useState } from 'react'
import { contractFileUrl, contractFileBytes } from '../../lib/contractsApi'

type Kind = 'pdf' | 'docx' | 'other'
function kindOf(name: string | null): Kind {
  const n = (name ?? '').toLowerCase()
  if (n.endsWith('.pdf')) return 'pdf'
  if (n.endsWith('.docx')) return 'docx'
  return 'other'
}

// Minimal sanitizer for mammoth's HTML: drop scripts/styles and any event
// handlers, and neutralize non-http links so a crafted document can't run code.
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, iframe, object, embed, link').forEach((el) => el.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  })
  return doc.body.innerHTML
}

export function ContractViewer({
  path, fileName, title, onClose,
}: { path: string; fileName: string | null; title: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [docHtml, setDocHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const kind = kindOf(fileName)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null); setDocHtml(null)
    ;(async () => {
      const signed = await contractFileUrl(path)
      if (!alive) return
      if (!signed) { setError('Could not open the file.'); setLoading(false); return }
      setUrl(signed)
      if (kind === 'docx') {
        try {
          const buf = await contractFileBytes(path)
          if (!buf) throw new Error('Could not read the file.')
          const mod: any = await import('mammoth/mammoth.browser')
          const mammoth = mod.default ?? mod
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (alive) setDocHtml(sanitize(value || '<p>(empty document)</p>'))
        } catch (e: any) {
          if (alive) setError('Could not render this Word document. ' + (e?.message ?? ''))
        }
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [path, kind])

  // Close on Escape.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" onClick={onClose}>
      <div
        className="mx-auto my-4 flex h-[calc(100vh-2rem)] w-[min(1000px,95vw)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</div>
            {fileName && <div className="truncate text-xs text-slate-400">{fileName}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {url && (
              <a
                href={url} target="_blank" rel="noopener noreferrer"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Open in new tab
              </a>
            )}
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 dark:bg-slate-950">
          {loading && <div className="p-8 text-center text-sm text-slate-500">Loading the agreement…</div>}
          {error && <div className="p-8 text-center text-sm text-red-600">{error}</div>}

          {!loading && !error && kind === 'pdf' && url && (
            <iframe title={title} src={url} className="h-full w-full border-0" />
          )}

          {!loading && !error && kind === 'docx' && docHtml && (
            <div className="mx-auto max-w-[820px] px-6 py-8">
              <div className="contract-doc rounded-lg bg-white p-8 text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100">
                <div dangerouslySetInnerHTML={{ __html: docHtml }} />
              </div>
            </div>
          )}

          {!loading && !error && kind === 'other' && (
            <div className="p-8 text-center text-sm text-slate-600 dark:text-slate-300">
              <p>This file type can't be previewed in the browser.</p>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                  Open / download the file
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rendering styles for the converted Word document. */}
      <style>{`
        .contract-doc { line-height: 1.55; font-size: 14px; }
        .contract-doc p { margin: 0 0 0.7em; }
        .contract-doc h1, .contract-doc h2, .contract-doc h3 { font-weight: 700; margin: 1.1em 0 0.5em; line-height: 1.25; }
        .contract-doc h1 { font-size: 1.4em; }
        .contract-doc h2 { font-size: 1.2em; }
        .contract-doc h3 { font-size: 1.05em; }
        .contract-doc ul, .contract-doc ol { margin: 0 0 0.7em 1.4em; }
        .contract-doc li { margin: 0.2em 0; }
        .contract-doc table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 0.92em; }
        .contract-doc td, .contract-doc th { border: 1px solid #cbd5e1; padding: 4px 8px; text-align: left; vertical-align: top; }
        .contract-doc strong { font-weight: 700; }
        .contract-doc a { color: #2563eb; text-decoration: underline; }
        .contract-doc img { max-width: 100%; height: auto; }
      `}</style>
    </div>
  )
}
