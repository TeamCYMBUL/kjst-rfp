import { Link } from 'react-router-dom'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'
import { Loading, PageHeader } from '../components/ui'

export default function GettingStarted() {
  const { steps, completedCount, allDone, loading } = useOnboardingProgress()

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="Get Started"
        subtitle="Follow these steps to run your first hotel RFP from start to finish."
      />

      {allDone ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-8 py-10 text-center">
          <div className="mb-3 text-4xl">🎉</div>
          <h2 className="text-xl font-bold text-emerald-800">You're all set!</h2>
          <p className="mt-2 text-sm text-emerald-700">
            You've completed the full RFP cycle. Head to your dashboard to manage active trips and
            incoming bids.
          </p>
          <Link
            to="/"
            className="mt-5 inline-block rounded-lg bg-[#1C1008] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2d1e0e] transition-colors"
          >
            Go to Dashboard →
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-2 py-2">
          {/* Progress bar */}
          <div className="mb-2 px-4 pt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-slate-500">
                {completedCount} of {steps.length} steps completed
              </span>
              <span className="text-xs font-semibold text-[#1C1008]">
                {Math.round((completedCount / steps.length) * 100)}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full bg-[#1C1008] transition-all duration-500"
                style={{ width: `${(completedCount / steps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Steps */}
          <ol className="divide-y divide-slate-100">
            {steps.map((step) => (
              <li key={step.n} className="flex items-start gap-4 px-4 py-5">
                {/* Status circle */}
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors
                  ${step.done ? 'bg-emerald-500' : 'border-2 border-slate-200 bg-white'}"
                  style={step.done
                    ? { background: '#10b981' }
                    : { border: '2px solid #e2e8f0', background: 'white' }
                  }
                >
                  {step.done ? (
                    <svg className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <span className="text-xs font-bold text-slate-400">{step.n}</span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${step.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                    {step.title}
                  </p>
                  {!step.done && (
                    <p className="mt-0.5 text-sm text-slate-500">{step.description}</p>
                  )}
                </div>

                {/* CTA */}
                {!step.done && (
                  <Link
                    to={step.href}
                    className="shrink-0 rounded-lg bg-[#1C1008] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d1e0e] transition-colors"
                  >
                    {step.cta} →
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Tip */}
      {!allDone && (
        <p className="text-center text-xs text-slate-400">
          This page updates automatically as you complete each step. Come back any time.
        </p>
      )}
    </div>
  )
}
