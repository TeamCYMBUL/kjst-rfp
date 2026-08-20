import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// SECURITY REGRESSION TEST (the CLAUDE.md non-negotiable guardrail).
//
// Uses the PUBLIC anon key — the same key shipped in the app bundle, i.e. exactly
// what an attacker has — to prove an unauthenticated caller cannot read any hotel
// bid or client data directly. All read policies gate on current_org_id(), which
// is null/denied for anon, so RLS returns nothing.
//
// Read-only: never writes. Hits the live project on purpose so it tests the REAL
// deployed policies, not a copy that could drift.
//
// In practice anon gets HTTP 401 ("permission denied for function
// current_org_id") on the confidential tables and an empty array on
// organizations — both mean "no rows leaked". We assert zero rows either way.

const SUPABASE_URL = 'https://gfofmxmrhbnsrbfrogev.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdmb2ZteG1yaGJuc3JiZnJvZ2V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjIyMjUsImV4cCI6MjA5NTYzODIyNX0.7JJB4s_0k0ArJ5XbHxNOVrwB2CvFr4sOSTECFaoeGlE'

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

// Confidential hotel-bid + client data — anon must read none of it.
const PROTECTED = ['rfp_responses', 'concession_answers', 'rfp_invitations', 'trips', 'clients']

describe('RLS isolation (live, read-only, public anon key)', () => {
  // Connectivity control: this query legitimately reaches PostgREST and returns
  // an empty set for anon. If the backend is unreachable this fails, so a network
  // outage can never masquerade as a passing isolation test below.
  it('reaches the API and anon sees no organizations', async () => {
    const { data, error } = await anon.from('organizations').select('id').limit(1)
    expect(error).toBeNull()
    expect(data).toEqual([])
  }, 15000)

  for (const table of PROTECTED) {
    it(`anon cannot read ${table}`, async () => {
      const { data } = await anon.from(table).select('*').limit(5)
      // 401 → data is null; allowed-but-filtered → []. Both mean zero rows.
      // A leak (RLS turned off) would return rows and fail here.
      expect(data ?? []).toHaveLength(0)
    }, 15000)
  }
})
