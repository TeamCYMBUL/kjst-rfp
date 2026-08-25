import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!url || !key) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

// Supabase coordinates auth-token refresh across browser tabs using the Web Locks
// API. Its default lock fails fast when a lock can't be grabbed immediately and
// throws "Acquiring an exclusive Navigator LockManager lock ... immediately
// failed" as an unhandled rejection. That is harmless (most visibly on the public
// RFP form, which has no session to refresh) but it flooded our error log. This
// wrapper waits for the lock instead of failing fast, and if the Web Locks API is
// unavailable or errors it simply runs without the lock — strictly safer than the
// default, which throws and skips the refresh entirely in that case.
async function gracefulLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) return fn()
  try {
    return await navigator.locks.request(name, { mode: 'exclusive' }, async () => fn())
  } catch {
    return fn()
  }
}

export const supabase = createClient(url, key, {
  auth: { lock: gracefulLock },
})
