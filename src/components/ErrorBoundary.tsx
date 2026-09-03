import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../lib/reportError'

type Props = { children: ReactNode }
type State = { error: Error | null; ref: string | null }

// Short, human-friendly reference so a user's report ties to the logged error.
function makeRef(): string {
  try {
    return 'E-' + crypto.randomUUID().slice(0, 6).toUpperCase()
  } catch {
    return 'E-' + Math.random().toString(36).slice(2, 8).toUpperCase()
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, ref: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, ref: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const ref = makeRef()
    this.setState({ ref })
    console.error('[ErrorBoundary]', ref, error, info.componentStack)
    reportError({
      kind: 'react-boundary',
      message: error.message,
      stack: error.stack ?? null,
      componentStack: info.componentStack ?? null,
      context: { ref },
    })
  }

  render() {
    const { error, ref } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-800/40 dark:bg-slate-800">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Something went wrong
          </h1>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            This was <span className="font-medium text-slate-700 dark:text-slate-300">automatically reported to our team</span>, so you usually don't need to submit a ticket. A reload often fixes it. If it keeps happening, contact us with the reference below.
          </p>
          {ref && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              <span className="text-slate-500 dark:text-slate-400">Reference:</span>{' '}
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{ref}</span>
            </div>
          )}
          <details className="mb-5 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 dark:text-slate-400">
              Error details
            </summary>
            <pre className="mt-2 overflow-auto text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg bg-[#1C1008] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2d1e0e] transition-colors"
          >
            Reload page
          </button>
          <a
            href={`mailto:info@cymbul.co?subject=${encodeURIComponent('Error ' + (ref ?? '') )}&body=${encodeURIComponent('What I was doing when it happened:\n\n\n(Reference: ' + (ref ?? '') + ')')}`}
            className="mt-2 block w-full rounded-lg border border-slate-200 px-4 py-2.5 text-center text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            Still stuck? Contact support
          </a>
        </div>
      </div>
    )
  }
}
