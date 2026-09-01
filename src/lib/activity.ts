import { supabase } from './supabase'

// The lifecycle Timeline is restricted to these accounts (not all staff).
// Mirrors the SQL is_timeline_admin() helper, which is the ENFORCED gate — keep
// this list and that function in sync if it ever changes.
export const TIMELINE_ADMIN_EMAILS = [
  'info@cymbul.co',
  'cgibson@kjsportstravel.com',
  'acabrera@kjsportstravel.com',
]
export function isTimelineAdmin(email: string | null | undefined): boolean {
  return TIMELINE_ADMIN_EMAILS.includes((email ?? '').trim().toLowerCase())
}
// Kept for existing imports.
export const TIMELINE_ADMIN_EMAIL = 'info@cymbul.co'

// The Contracts page is available to every signed-in KJST staff member (opened
// up Sep 2026 at Mike's request; it was previously limited to a rollout list).
// The contracts table already permits any authenticated staff to read/write
// (RLS `using (true)`), so this only lifts the UI gate. CONTRACTS_EMAILS is kept
// as historical reference and is no longer used as the gate.
export const CONTRACTS_EMAILS = [
  'info@cymbul.co',
  'cgibson@kjsportstravel.com',
  'acabrera@kjsportstravel.com',
  'tlopez@kjsportstravel.com',
]
export function isContractsUser(email: string | null | undefined): boolean {
  return !!(email && email.trim())
}

// Who can edit the AI fact-check rules (matches the DB RLS on
// contract_check_rules — keep the two in sync). Owner + Anabel + Catherine.
export const CONTRACT_RULES_ADMIN_EMAILS = [
  'info@cymbul.co',
  'cgibson@kjsportstravel.com',
  'acabrera@kjsportstravel.com',
]
export function isContractRulesAdmin(email: string | null | undefined): boolean {
  return CONTRACT_RULES_ADMIN_EMAILS.includes((email ?? '').trim().toLowerCase())
}

// The Platform Status page (monitoring heartbeat scoreboard) is private to the
// CYMBUL owner only — not visible to any KJST staff. Both owner addresses are
// allowed so Mike sees it whichever he's signed in with. Mirrors the email
// check ENFORCED inside the SQL monitoring_scoreboard() function — keep in sync.
export const STATUS_VIEWER_EMAILS = [
  'info@cymbul.co',
  'team@cymbul.co',
]
export function isStatusViewer(email: string | null | undefined): boolean {
  return STATUS_VIEWER_EMAILS.includes((email ?? '').trim().toLowerCase())
}

// Lifecycle moments that have no timestamp home on a base table and so must be
// logged explicitly. Everything else (trip_created, invite_sent, bid_received,
// bid_declined, build_saved) is derived from base-table timestamps by the
// get_lifecycle_timeline() RPC and needs no logging.
export type LoggedEventType =
  | 'schedule_imported' | 'reminder_sent' | 'awarded' | 'proposal_sent'
  // Deletion audit trail. FK columns (trip_id/client_id) are intentionally left
  // null on these — the FKs are NO ACTION, so referencing a row we're about to
  // delete would block the delete. The deleted entity's id + name live in detail.
  | 'trip_deleted' | 'invitation_deleted' | 'client_deleted'

type LogArgs = {
  event_type: LoggedEventType
  client_id?: string | null
  trip_id?: string | null
  detail?: Record<string, unknown>
}

// Best-effort append to activity_events. Never throws — a logging failure must
// never block the underlying action (award, import, proposal send, reminder).
// organization_id is filled server-side by the column's current_org_id() default.
export async function logActivity({ event_type, client_id, trip_id, detail }: LogArgs): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser()
    await supabase.from('activity_events').insert({
      event_type,
      client_id: client_id ?? null,
      trip_id: trip_id ?? null,
      actor_id: data.user?.id ?? null,
      detail: detail ?? {},
    })
  } catch {
    // swallow — timeline logging is non-critical
  }
}
