// A horizontal row of RFP stages: a check circle per stage (click to toggle
// done / not done), the label, and an info (i) button that reveals a one-line
// how-to tip below the row. Purely presentational — the parent owns state and
// persistence, so this can never affect the RFP flow.
import { useState } from 'react'
import type { StageDef, StageKey } from '../lib/rfpStages'

export function StageTimeline({
  stages,
  isDone,
  currentKey,
  tipFor,
  onToggle,
  onLabelClick,
  size = 'md',
}: {
  stages: StageDef[]
  isDone: (k: StageKey) => boolean
  currentKey: StageKey | null
  tipFor: (k: StageKey) => string
  onToggle: (k: StageKey) => void
  onLabelClick?: (k: StageKey) => void
  size?: 'sm' | 'md'
}) {
  const [openTip, setOpenTip] = useState<StageKey | null>(null)
  const dim = size === 'sm' ? 'h-6 w-6 text-[11px]' : 'h-8 w-8 text-xs'

  return (
    <div>
      <div className="flex items-start">
        {stages.map((s, i) => {
          const done = isDone(s.key)
          const current = s.key === currentKey
          return (
            <div key={s.key} className="relative flex flex-1 flex-col items-center text-center">
              {i > 0 && (
                <div
                  className={`absolute top-3 h-0.5 w-full ${done || current ? 'bg-[#1C1008] dark:bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                  style={{ left: '-50%' }}
                  aria-hidden
                />
              )}
              <button
                type="button"
                onClick={() => onToggle(s.key)}
                title={done ? 'Mark not done' : 'Mark done'}
                aria-label={`${s.label}: ${done ? 'done, click to undo' : 'not done, click to mark done'}`}
                className={`relative z-10 flex ${dim} items-center justify-center rounded-full font-bold transition-colors ${
                  done
                    ? 'bg-[#1C1008] text-white dark:bg-amber-500'
                    : current
                      ? 'border-2 border-[#1C1008] bg-white text-[#1C1008] dark:border-amber-500 dark:bg-slate-800 dark:text-amber-400'
                      : 'border border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500'
                }`}
              >
                {done ? '✓' : i + 1}
              </button>
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onLabelClick?.(s.key)}
                  className={`text-[11px] leading-tight ${current ? 'font-semibold text-slate-800 dark:text-slate-100' : done ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'} ${onLabelClick ? 'hover:underline' : 'cursor-default'}`}
                >
                  {s.label}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenTip((k) => (k === s.key ? null : s.key))}
                  aria-label={`What is “${s.label}”?`}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[9px] font-bold text-slate-400 hover:border-[#1C1008] hover:text-[#1C1008] dark:border-slate-600 dark:text-slate-500 dark:hover:border-amber-500 dark:hover:text-amber-400"
                >
                  i
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {openTip && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1C1008] text-[9px] font-bold text-white dark:bg-amber-500">i</span>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{stages.find((s) => s.key === openTip)?.label}:</span>{' '}
            {tipFor(openTip)}
          </p>
        </div>
      )}
    </div>
  )
}
