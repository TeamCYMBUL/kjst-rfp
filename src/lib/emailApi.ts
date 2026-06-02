// Typed helpers for calling email Edge Functions from the staff app.
// Both functions require an authenticated session (JWT verified server-side).

import { supabase } from './supabase'

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token ?? ''}`,
  }
}

/** Send (or resend) the RFP invitation email for a single hotel. */
export async function sendInvitationEmail(
  invitation_id: string,
): Promise<{ ok: true; sent_to: string } | { error: string }> {
  const res = await fetch(`${FN_BASE}/send-invitation`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ invitation_id, base_url: window.location.origin }),
  })
  return res.json()
}

/** Send reminder emails to all non-submitted hotels for a trip. */
export async function sendReminderEmails(
  trip_id: string,
): Promise<{ sent: number; skipped: number } | { error: string }> {
  const res = await fetch(`${FN_BASE}/send-reminders`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ trip_id, base_url: window.location.origin }),
  })
  return res.json()
}
