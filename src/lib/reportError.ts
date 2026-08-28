// Fire-and-forget client error reporting. Sends errors to the public
// `log-error` edge function so problems surface to staff instead of failing
// silently in a user's browser. Designed to never make things worse:
//  - swallows its own failures (a logging error must not cascade)
//  - de-dupes identical messages within a short window
//  - caps total reports per page load so a render loop can't flood the table
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-error`
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

type ErrorKind = 'react-boundary' | 'window-error' | 'unhandled-rejection'

const recent = new Map<string, number>() // message -> last-sent epoch ms
const DEDUPE_MS = 60_000
let sent = 0
const MAX_PER_LOAD = 25

// Messages we deliberately do NOT report — they are not actionable bugs in this
// app, so logging them only buries real errors in the daily digest:
//  - Navigator LockManager chatter from Supabase's cross-tab auth-token refresh
//    (benign; also mitigated at the source in lib/supabase.ts).
//  - "Object Not Found Matching Id ... MethodName:update" is injected by browser
//    password-manager / autofill extensions on the user's device, not our code.
//  - ResizeObserver loop notices are a benign browser quirk.
const IGNORE_PATTERNS: RegExp[] = [
  /Navigator ?LockManager lock/i,
  /Acquiring an exclusive Navigator/i,
  /Object Not Found Matching Id/i,
  /ResizeObserver loop/i,
  // Transient network conditions (connection dropped, offline, tab throttled,
  // request aborted on navigation) — not app bugs. Every error tracker filters
  // these; a real backend outage is caught by the uptime monitor instead.
  /Failed to fetch/i,
  /NetworkError/i,
  /Load failed/i,
  /The (network )?connection was lost/i,
  /aborted/i,
]

export function reportError(input: {
  kind: ErrorKind
  message: string
  stack?: string | null
  componentStack?: string | null
  context?: Record<string, unknown>
}): void {
  try {
    const message = (input.message || '').trim()
    if (!message) return
    if (IGNORE_PATTERNS.some((re) => re.test(message))) return
    if (sent >= MAX_PER_LOAD) return

    const now = Date.now()
    const last = recent.get(message)
    if (last && now - last < DEDUPE_MS) return
    recent.set(message, now)
    sent++

    const payload = {
      kind: input.kind,
      message,
      stack: input.stack ?? null,
      component_stack: input.componentStack ?? null,
      url: typeof location !== 'undefined' ? location.pathname + location.search : null,
      app_version: APP_VERSION,
      context: input.context ?? null,
    }

    // keepalive lets the request survive a page unload; we intentionally do not
    // await it and swallow any failure.
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* reporting must never throw */
  }
}

// Attaches global handlers for uncaught errors and unhandled promise
// rejections. Safe to call once at app startup.
export function installGlobalErrorReporting(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e: ErrorEvent) => {
    reportError({
      kind: 'window-error',
      message: e.message || String(e.error ?? 'Unknown error'),
      stack: e.error?.stack ?? null,
      context: e.filename ? { filename: e.filename, line: e.lineno, col: e.colno } : undefined,
    })
  })
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason: any = e.reason
    reportError({
      kind: 'unhandled-rejection',
      message: reason?.message ? String(reason.message) : String(reason ?? 'Unhandled rejection'),
      stack: reason?.stack ?? null,
    })
  })
}
