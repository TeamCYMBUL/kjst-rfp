import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const REASON_LABELS: Record<string, string> = {
  sold_out: 'Sold out / no availability for these dates',
  insufficient_rooms: 'Insufficient room block available',
  rate_conflict: 'Rate restrictions in effect (e.g. city-wide event)',
  no_suites: 'Unable to accommodate suite requirements',
  not_competing: 'Property has chosen not to compete at this time',
  other: 'Other',
}

// Fallback recipient so a decline is never silently missed if a client has no
// assigned manager yet. Mirrors rfp-respond.
const JON_EMAIL = 'jcohen@kjsportstravel.com'
const JON_NAME = 'Jon Cohen'

// The KJST team member(s) assigned to this client, so the decline notification
// reaches the owner directly (not just a shared inbox). Same source as the
// submission notification in rfp-respond.
async function getAssignedManagers(sb: ReturnType<typeof createClient>, clientId: string | null): Promise<{ name: string; email: string }[]> {
  const recipients: { name: string; email: string }[] = []
  if (clientId) {
    const { data } = await sb
      .from('client_assignments')
      .select('profiles(full_name, email)')
      .eq('client_id', clientId)
    for (const row of (data ?? []) as any[]) {
      const p = row.profiles
      if (p?.email && !recipients.some((r) => r.email === p.email)) {
        recipients.push({ name: p.full_name || p.email, email: p.email })
      }
    }
  }
  return recipients
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { token?: string; decline_reason?: string; decline_notes?: string; visit?: number }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { token, decline_reason, decline_notes, visit } = body
  if (!token) return json({ error: 'Missing token' }, 400)
  if (!decline_reason) return json({ error: 'Missing decline_reason' }, 400)
  if (!REASON_LABELS[decline_reason]) return json({ error: 'Invalid decline_reason' }, 400)
  if (visit !== undefined && visit !== 1 && visit !== 2) return json({ error: 'visit must be 1 or 2' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: inv, error: invErr } = await supabase
    .from('rfp_invitations')
    .select(`id, status, revoked_at, hotel_name, hotel_contact_name, visit1_declined, visit2_declined,
      trips(id, client_id, city, opponent_label, arrival_date, departure_date, stay2_arrival_date, stay2_departure_date, clients(team_name))`)
    .eq('token', token)
    .single()

  if (invErr || !inv) return json({ error: 'Invalid token' }, 404)
  if ((inv as any).revoked_at) return json({ error: 'This link has been deactivated. Please contact KJST.' }, 403)
  if (inv.status === 'submitted') return json({ error: 'This RFP has already been submitted.' }, 409)
  if (inv.status === 'declined') return json({ ok: true, already_declined: true })

  const trip = inv.trips as any
  const hasStay2 = Boolean(trip?.stay2_arrival_date)
  const now = new Date().toISOString()

  if (visit === 2 && !hasStay2) return json({ error: 'This trip has no second visit.' }, 400)

  if (visit === 1 && inv.visit1_declined) return json({ ok: true, already_declined: true })
  if (visit === 2 && inv.visit2_declined) return json({ ok: true, already_declined: true })

  const update: Record<string, unknown> = {}

  if (visit === 1 || visit === 2) {
    update[`visit${visit}_declined`] = true
    update[`visit${visit}_decline_reason`] = decline_reason
    update[`visit${visit}_decline_notes`] = decline_notes ?? null
    update[`visit${visit}_declined_at`] = now

    const otherVisitDeclined = visit === 1 ? Boolean(inv.visit2_declined) : Boolean(inv.visit1_declined)
    const fullyDeclined = hasStay2 ? otherVisitDeclined : true // this visit is being declined right now
    if (fullyDeclined) {
      update.status = 'declined'
      update.decline_reason = decline_reason
      update.decline_notes = decline_notes ?? null
      update.declined_at = now
    }
  } else {
    // Whole-invitation decline (no visit specified) — existing behavior,
    // plus mark each visit that exists as declined for consistency.
    update.status = 'declined'
    update.decline_reason = decline_reason
    update.decline_notes = decline_notes ?? null
    update.declined_at = now
    update.visit1_declined = true
    update.visit1_decline_reason = decline_reason
    update.visit1_decline_notes = decline_notes ?? null
    update.visit1_declined_at = now
    if (hasStay2) {
      update.visit2_declined = true
      update.visit2_decline_reason = decline_reason
      update.visit2_decline_notes = decline_notes ?? null
      update.visit2_declined_at = now
    }
  }

  const { error: updateErr } = await supabase
    .from('rfp_invitations')
    .update(update)
    .eq('id', inv.id)

  if (updateErr) return json({ error: 'Failed to record decline: ' + updateErr.message }, 500)

  // Staff notification email — sent to the KJST team member(s) assigned to this
  // client (so the owner is notified directly), plus Jon as a fallback and the
  // global NOTIFY_EMAIL inbox, all deduped.
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const notifyEmail = Deno.env.get('NOTIFY_EMAIL')
  const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'noreply@kjsportstravel.com'
  const fromName = Deno.env.get('FROM_NAME') ?? 'KJ Sports Travel'

  const assignedManagers = await getAssignedManagers(supabase, trip?.client_id ?? null)
  const notifyList = assignedManagers.map((m) => `${m.name} <${m.email}>`)
  if (!assignedManagers.some((m) => m.email === JON_EMAIL)) notifyList.push(`${JON_NAME} <${JON_EMAIL}>`)
  const staffRecipients = Array.from(new Set([notifyEmail, ...notifyList].filter(Boolean) as string[]))
  const fromAddress = assignedManagers[0]
    ? `${assignedManagers[0].name} <${assignedManagers[0].email}>`
    : `${fromName} <${fromEmail}>`

  if (resendKey && staffRecipients.length > 0) {
    const client = trip?.clients as any
    const teamName = client?.team_name ?? 'Unknown team'
    const city = trip?.city ?? trip?.opponent_label ?? 'Unknown city'
    const reasonLabel = REASON_LABELS[decline_reason]

    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
    const visitLabel = visit === 1
      ? `Visit 1 (${fmtDate(trip?.arrival_date)} – ${fmtDate(trip?.departure_date)}) only`
      : visit === 2
        ? `Visit 2 (${fmtDate(trip?.stay2_arrival_date)} – ${fmtDate(trip?.stay2_departure_date)}) only`
        : hasStay2 ? 'Both visits' : 'This trip'

    const notesRow = decline_notes
      ? `<tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;">Notes</td><td style="padding:8px 12px;border:1px solid #e2e8f0;color:#1e293b;">${decline_notes.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td></tr>`
      : ''

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:600px;">
  <tr><td style="background:#dc2626;padding:24px 32px;">
    <p style="margin:0;color:#fecaca;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJST Platform &middot; Hotel Decline</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">Hotel Unable to Bid</h1>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="margin:0 0 20px;font-size:15px;color:#1e293b;"><strong>${inv.hotel_name}</strong> has indicated they cannot submit a bid for the <strong>${teamName}</strong> trip to <strong>${city}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;width:130px;">Hotel</td><td style="padding:8px 12px;border:1px solid #e2e8f0;color:#1e293b;">${inv.hotel_name}</td></tr>
      <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;">Team / Trip</td><td style="padding:8px 12px;border:1px solid #e2e8f0;color:#1e293b;">${teamName} &middot; ${city}</td></tr>
      ${hasStay2 ? `<tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;">Scope</td><td style="padding:8px 12px;border:1px solid #e2e8f0;color:#1e293b;">${visitLabel}</td></tr>` : ''}
      <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;">Reason</td><td style="padding:8px 12px;border:1px solid #e2e8f0;color:#1e293b;">${reasonLabel}</td></tr>
      ${notesRow}
    </table>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: staffRecipients,
        subject: `[KJST] Hotel declined RFP: ${inv.hotel_name} – ${teamName} · ${city}${visit ? ` (Visit ${visit})` : ''}`,
        html,
      }),
    })
  }

  return json({ ok: true, fully_declined: Boolean(update.status) })
})
