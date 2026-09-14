// Shared server-side error logger for edge functions. Writes a row to
// public.error_logs with kind='server' so failures that happen on the server
// (failed emails, failed AI fact-checks, unchecked DB writes, thrown handlers)
// land in the SAME place the daily error-digest and the monitoring scoreboard
// already read. Before this, no edge function logged anywhere, so those failures
// were invisible until a user reported them.
//
// Design rules:
//  - MUST NEVER THROW. Logging is best-effort; a logging failure must not cascade
//    into the caller's flow. Every path is wrapped and swallowed.
//  - Uses the service role (RLS-exempt) so it works from any function context.
//  - Caps field sizes so a giant stack can't bloat the table.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cap = (v: unknown, n: number): string | null => {
  if (v == null) return null
  const s = String(v)
  return s.length > n ? s.slice(0, n) : s
}

export async function logServerError(
  fn: string,
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) return
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack ?? null : null
    const sb = createClient(url, key, { auth: { persistSession: false } })
    await sb.from('error_logs').insert({
      kind: 'server',
      message: cap(`[${fn}] ${message}`, 2000),
      stack: cap(stack, 8000),
      url: cap(fn, 500),
      app_version: 'edge',
      context: context && typeof context === 'object' ? context : null,
    })
  } catch {
    // Best-effort only — never let logging break the caller.
  }
}
