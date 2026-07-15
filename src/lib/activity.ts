import { supabase } from './supabase'

// Lifecycle moments that have no timestamp home on a base table and so must be
// logged explicitly. Everything else (trip_created, invite_sent, bid_received,
// bid_declined, build_saved) is derived from base-table timestamps by the
// get_lifecycle_timeline() RPC and needs no logging.
export type LoggedEventType = 'schedule_imported' | 'reminder_sent' | 'awarded' | 'proposal_sent'

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
