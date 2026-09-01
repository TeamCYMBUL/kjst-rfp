// Shared rate-limit guard for the public (token-gated) edge functions.
//
// The hotel-facing surface runs with the service role and is gated only by an
// unguessable token. Tokens are 192-bit, so guessing is hopeless, but there was
// no ceiling on how fast someone could hammer an endpoint and no signal if they
// did. This adds both: a per-IP fixed-window counter (public.check_rate_limit),
// with limits set generously so a real hotel filling a form is never affected.
//
// It creates its own service-role client so it can run as the FIRST thing in a
// handler, before any body parsing or validation — otherwise a malformed-request
// flood would slip past the limiter entirely.
//
// FAIL OPEN: if the counter itself errors for any reason, we allow the request.
// A bug in rate limiting must never take down the RFP flow.
import { createClient } from 'jsr:@supabase/supabase-js@2'

let _client: ReturnType<typeof createClient> | null = null
function rlClient() {
  if (!_client) {
    _client = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )
  }
  return _client
}

// Best-effort caller IP. Supabase puts the real client IP first in x-forwarded-for.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  const first = xff.split(',')[0].trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

// Returns true when the request should be REJECTED (over the limit).
export async function rateLimited(
  req: Request,
  name: string,
  max = 100,
  windowSecs = 60,
): Promise<boolean> {
  try {
    const { data, error } = await rlClient().rpc('check_rate_limit', {
      p_bucket: `${name}:${clientIp(req)}`,
      p_max: max,
      p_window_secs: windowSecs,
    })
    if (error) return false // fail open
    return data === false // check_rate_limit returns "allowed"; false = over limit
  } catch {
    return false // fail open
  }
}

// Standard 429 body for a rate-limited request.
export function tooManyRequests(cors: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }),
    { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '30' } },
  )
}
