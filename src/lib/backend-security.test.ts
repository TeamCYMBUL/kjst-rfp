import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// EXTENDED BACKEND SECURITY REGRESSION SUITE.
//
// Complements rls-isolation.test.ts (anon-can't-read core tables). Runs against
// the LIVE project with the PUBLIC anon key — exactly what an attacker holds.
// Every check here is SAFE by construction:
//   - reads return nothing (RLS),
//   - writes are rejected by RLS so nothing ever persists,
//   - RPCs are permission-denied (this session's grant hardening),
//   - edge functions are called with NO or INVALID credentials, so they error
//     out before doing any work.
// Hitting the live backend on purpose means these test the REAL deployed policies
// and functions, never a copy that could drift.

const SUPABASE_URL = 'https://gfofmxmrhbnsrbfrogev.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdmb2ZteG1yaGJuc3JiZnJvZ2V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjIyMjUsImV4cCI6MjA5NTYzODIyNX0.7JJB4s_0k0ArJ5XbHxNOVrwB2CvFr4sOSTECFaoeGlE'
const FN = `${SUPABASE_URL}/functions/v1`
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
const T = 15000

const fn = (path: string, opts: RequestInit = {}) =>
  fetch(`${FN}/${path}`, {
    ...opts,
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })

// 1) Anon cannot READ additional sensitive tables (beyond the core isolation set).
const READ_PROTECTED = [
  'hotel_contacts', 'profiles', 'activity_events', 'contracts',
  'backup_status', 'uptime_checks', 'error_logs',
]
describe('anon read isolation — extended tables', () => {
  for (const table of READ_PROTECTED) {
    it(`anon cannot read ${table}`, async () => {
      const { data } = await anon.from(table).select('*').limit(5)
      expect(data ?? []).toHaveLength(0) // 401 -> null, filtered -> []; both = no leak
    }, T)
  }
})

// 2) Anon cannot WRITE confidential tables — RLS rejects the insert; nothing persists.
//    Real columns are used so the request reaches the RLS check (not a schema error).
const WRITE_ATTEMPTS: Array<[string, Record<string, unknown>]> = [
  ['clients', { team_name: 'SEC_TEST_SHOULD_NEVER_PERSIST' }],
  ['trips', { city: 'SEC_TEST_SHOULD_NEVER_PERSIST' }],
  ['rfp_invitations', { hotel_name: 'SEC_TEST_SHOULD_NEVER_PERSIST' }],
  ['rfp_responses', { best_king_rate: '1' }],
  ['concession_answers', { comment: 'SEC_TEST_SHOULD_NEVER_PERSIST' }],
]
describe('anon write isolation — inserts denied', () => {
  for (const [table, payload] of WRITE_ATTEMPTS) {
    it(`anon cannot insert into ${table}`, async () => {
      const { data, error } = await anon.from(table).insert(payload as any).select()
      expect(error).not.toBeNull()        // rejected
      expect(data ?? []).toHaveLength(0)  // nothing written back
    }, T)
  }
})

// 3) Anon cannot execute SECURITY DEFINER RPCs (regression for the grant hardening).
const LOCKED_RPCS: Array<[string, Record<string, unknown>]> = [
  ['get_lifecycle_metrics', { p_client_id: null }],
  ['get_lifecycle_timeline', { p_client_id: null }],
  ['mark_proposal_sent', { p_trip_id: '00000000-0000-0000-0000-000000000000', p_client_id: '00000000-0000-0000-0000-000000000000' }],
  ['snapshot_concession_items_for_trip', { p_trip_id: '00000000-0000-0000-0000-000000000000' }],
]
describe('anon cannot execute SECURITY DEFINER RPCs', () => {
  for (const [rpc, args] of LOCKED_RPCS) {
    it(`anon rpc ${rpc} is denied`, async () => {
      const { error } = await anon.rpc(rpc, args as any)
      expect(error).not.toBeNull()
    }, T)
  }
})

// 4) Public edge functions reject missing / invalid credentials before doing work.
describe('public edge functions — auth gating', () => {
  it('rfp-get with no token is not 200', async () => {
    expect((await fn('rfp-get')).status).not.toBe(200)
  }, T)
  it('rfp-get with a bogus token returns 404 (no data)', async () => {
    expect((await fn('rfp-get?token=deadbeefdeadbeefdeadbeefdeadbeef')).status).toBe(404)
  }, T)
  it('rfp-respond with no token is rejected', async () => {
    expect((await fn('rfp-respond', { method: 'POST', body: '{}' })).ok).toBe(false)
  }, T)
  it('rfp-decline with no token is rejected', async () => {
    expect((await fn('rfp-decline', { method: 'POST', body: '{}' })).ok).toBe(false)
  }, T)
  it('contract-upload with no token is rejected', async () => {
    expect((await fn('contract-upload', { method: 'POST', body: '{}' })).ok).toBe(false)
  }, T)
})

// 5) Secret-gated internal functions reject anyone without the shared secret.
describe('secret-gated edge functions — reject without the secret', () => {
  for (const f of ['uptime-check', 'backup-monitor', 'error-digest']) {
    it(`${f} without x-cron-secret returns 401`, async () => {
      expect((await fn(f, { method: 'POST', body: JSON.stringify({ event: 'check' }) })).status).toBe(401)
    }, T)
  }
})

// 6) Injection safety — a SQL-injection payload in a filter is treated as a literal
//    (parameterized), returning nothing and never executing.
describe('injection safety', () => {
  it('SQLi payload in a filter is treated as a literal — no rows leak', async () => {
    // The security property is that the payload is parameterized (never executed)
    // and leaks nothing. Retry on a transient edge/CDN hiccup so a network blip
    // can't fail a security assertion; a real leak would return rows and fail.
    let data: unknown[] | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await anon
        .from('organizations')
        .select('id')
        .eq('name', "x'; DROP TABLE clients; --")
        .limit(5)
      data = res.data
      if (!res.error) break
      await new Promise((r) => setTimeout(r, 600))
    }
    expect(data ?? []).toHaveLength(0)
  }, T)
})
