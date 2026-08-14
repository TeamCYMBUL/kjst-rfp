// In-platform document viewer for a stored contract file. Opens in a modal so
// staff can read the agreement without it downloading to their machine.
//   • PDF  → shown inline in an <iframe> off a short-lived signed URL.
//   • .docx → rendered with docx-preview, which reproduces the Word document's
//             own formatting (fonts, spacing, tables, page layout) so it looks
//             like the original — same fidelity as viewing a proposal. Fully
//             client-side: the file never leaves the platform.
//   • legacy .doc / anything else → offer download / open-in-tab as a fallback.
import { useEffect, useRef, useState } from 'react'
import { contractFileUrl, contractFileBytes } from '../../lib/contractsApi'

type Kind = 'pdf' | 'docx' | 'other'
function kindOf(name: string | null): Kind {
  const n = (name ?? '').toLowerCase()
  if (n.endsWith('.pdf')) return 'pdf'
  if (n.endsWith('.docx')) return 'docx'
  return 'other'
}

export function ContractViewer({
  path, fileName, title, onClose,
}: { path: string; fileName: string | null; title: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const docxRef = useRef<HTMLDivElement>(null)
  const kind = kindOf(fileName)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    ;(async () => {
      const signed = await contractFileUrl(path)
      if (!alive) return
      if (!signed) { setError('Could not open the file.'); setLoading(false); return }
      setUrl(signed)
      if (kind === 'docx') {
        try {
          const buf = await contractFileBytes(path)
          if (!alive) return
          if (!buf) throw new Error('Could not read the file.')
          const { renderAsync } = await import('docx-preview')
          if (!alive || !docxRef.current) return
          docxRef.current.innerHTML = ''
          await renderAsync(buf, docxRef.current, undefined, {
            className: 'docx',
            inWrapper: true,
            breakPages: true,
            useBase64URL: true,
            experimental: true,
            renderHeaders: true,
            renderFooters: true,
          })
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

        <div className="relative min-h-0 flex-1 overflow-auto bg-slate-200 dark:bg-slate-800">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-200/80 text-sm text-slate-500 dark:bg-slate-800/80">
              Loading the agreement…
            </div>
          )}
          {error && <div className="p-8 text-center text-sm text-red-600">{error}</div>}

          {/* Word document — docx-preview renders faithful pages into this host. */}
          {kind === 'docx' && !error && <div ref={docxRef} className="docx-view py-4" />}

          {kind === 'pdf' && url && !error && (
            <iframe title={title} src={url} className="h-full w-full border-0" />
          )}

          {kind === 'other' && !loading && !error && (
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

      {/* docx-preview injects its own styles; keep its page wrapper centered and tidy. */}
      <style>{`
        .docx-view .docx-wrapper { background: transparent; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 16px; }
        .docx-view .docx-wrapper > section.docx { box-shadow: 0 1px 6px rgba(0,0,0,0.18); margin: 0; background: #fff; }
      `}</style>
    </div>
  )
}
