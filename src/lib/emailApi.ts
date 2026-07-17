// Typed helpers for calling email Edge Functions from the staff app.
// Both functions require an authenticated session (JWT verified server-side).

import { supabase } from './supabase'
import { PUBLIC_APP_URL } from './config'

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
    body: JSON.stringify({ invitation_id, base_url: PUBLIC_APP_URL }),
  })
  return res.json()
}

/** Send a short nudge reminder to a single hotel (not the full proposal). */
export async function sendSingleReminderEmail(
  invitation_id: string,
): Promise<{ ok: true; sent_to: string } | { error: string }> {
  const res = await fetch(`${FN_BASE}/send-single-reminder`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ invitation_id, base_url: PUBLIC_APP_URL }),
  })
  return res.json()
}

/**
 * Reopen a submitted hotel's proposal so they can revise (not refill) it — e.g.
 * after a trip's dates change. Their saved answers are preserved. When notify is
 * true (default), the hotel is emailed their existing link with a review-and-
 * resubmit note.
 */
export async function reopenRfp(
  invitation_id: string,
  opts?: { notify?: boolean; note?: string },
): Promise<{ ok: true; reopened: true; emailed: boolean; sent_to?: string; warning?: string } | { error: string }> {
  const res = await fetch(`${FN_BASE}/rfp-reopen`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      invitation_id,
      base_url: PUBLIC_APP_URL,
      notify: opts?.notify ?? true,
      note: opts?.note ?? null,
    }),
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
    body: JSON.stringify({ trip_id, base_url: PUBLIC_APP_URL }),
  })
  return res.json()
}
