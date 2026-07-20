import { useState, type ReactNode } from 'react'

// A subtle, dismissible "what to do here" strip. Dismissal is remembered per
// hint id in localStorage, so new staff get guidance and power users can hide it.
export function PageHint({ id, children }: { id: string; children: ReactNode }) {
  const key = `kjst-hint-dismissed:${id}`
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  if (dismissed) return null
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5">
      <span className="mt-px shrink-0 rounded bg-[#1C1008] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Tip</span>
      <p className="flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{children}</p>
      <button
        onClick={() => { try { localStorage.setItem(key, '1') } catch { /* ignore */ }; setDismissed(true) }}
        className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
        aria-label="Dismiss tip"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
