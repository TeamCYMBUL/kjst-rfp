import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Reopen a submitted RFP so the hotel can REVISE (not refill) their proposal.
// IMPORTANT: the invitation's status is left as-is (submitted/awarded) so the
// hotel's original bid stays on the comparison grid, in the proposals, and in
// the responded count. We only stamp reopened_at; the form treats a bid whose
// reopened_at is newer than submitted_at as editable again (rfp-respond mirrors
// this to allow the resubmit). Their saved response + answers are untouched, so
// their prior bid pre-loads and they only adjust what changed. The KJST sender
// can include a personalized message (dates, a late checkout, whatever changed).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev'
const FROM_NAME = Deno.env.get('FROM_NAME') ?? 'KJ Sports Travel'
const CONTACT_EMAIL = Deno.env.get('CONTACT_EMAIL') ?? 'info@kjsportstravel.com'
const JON_EMAIL = 'jcohen@kjsportstravel.com'
const JON_NAME = 'Jon Cohen'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getCcRecipients(sb: ReturnType<typeof createClient>, clientId: string | null): Promise<{ name: string; email: string }[]> {
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
  if (!recipients.some((r) => r.email === JON_EMAIL)) recipients.push({ name: JON_NAME, email: JON_EMAIL })
  return recipients
}

function fmt(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Preserve the sender's line breaks in the personalized message.
function escMultiline(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>')
}

function buildReopenHtml(p: {
  hotelName: string
  contactName: string | null
  teamName: string | null
  city: string | null
  arrivalDate: string | null
  departureDate: string | null
  rfpLink: string
  message: string | null
  senderName: string
  senderTitle: string
  senderEmail: string
  senderPhone: string | null
  contactEmail: string
}): string {
  const greeting = p.contactName ? `Dear ${p.contactName},` : `To whom it may concern,`
  const dates = [fmt(p.arrivalDate), fmt(p.departureDate)].filter(Boolean).join(' – ')
  const tripRef = [p.teamName, p.city].filter(Boolean).join(' · ')
  const signatureLines = [
    `<strong style="color:#1e293b">${esc(p.senderName)}</strong>`,
    `<span style="color:#64748b">${esc(p.senderTitle)} | KJ Sports Travel</span>`,
    `<a href="mailto:${p.senderEmail}" style="color:#1C1008;text-decoration:none">${p.senderEmail}</a>`,
    p.senderPhone ? `<span style="color:#64748b">${esc(p.senderPhone)}</span>` : null,
  ].filter(Boolean).join('<br>')

  // The sender's personalized note is the heart of the email. Fall back to a
  // neutral line only if they didn't write one (it is not always about dates).
  const bodyMessage = p.message && p.message.trim()
    ? `<p style="margin:0 0 18px;font-size:15px;color:#475569;line-height:1.6">${escMultiline(p.message.trim())}</p>`
    : `<p style="margin:0 0 18px;font-size:15px;color:#475569;line-height:1.6">We’ve reopened your proposal so you can review it and make any adjustments needed.</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Please review your RFP – KJ Sports Travel</title></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#1C1008;padding:24px 32px">
        <p style="margin:0;color:#d6c3b0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">KJ Sports Travel</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:21px;font-weight:700;">Please review your proposal</h1>
      </td></tr>
      <tr><td style="padding:32px">
        <p style="margin:0 0 16px;font-size:15px;color:#1e293b">${greeting}</p>
        ${tripRef ? `<p style="margin:0 0 16px;font-size:13px;color:#94a3b8">Re: <strong style="color:#475569">${esc(tripRef)}</strong>${dates ? ` · ${esc(dates)}` : ''}</p>` : ''}
        ${bodyMessage}
        <p style="margin:0 0 18px;font-size:15px;color:#475569;line-height:1.6">
          <strong>Your previous answers are saved</strong> — you don’t need to start over. Just open your proposal, update anything that needs to change, and resubmit.
        </p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:22px">
          <tr><td style="background:#1C1008;border-radius:8px">
            <a href="${p.rfpLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">Review &amp; Resubmit →</a>
          </td></tr>
        </table>
        <p style="margin:0 0 6px;font-size:12px;color:#94a3b8">Or copy this link:</p>
        <p style="margin:0 0 24px;font-size:12px;color:#64748b;word-break:break-all">${p.rfpLink}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px">
        <p style="margin:0 0 20px;font-size:13px;line-height:1.8">${signatureLines}</p>
        <p style="margin:0;font-size:13px;color:#94a3b8">
          Questions? Reply to this email or contact us at <a href="mailto:${p.contactEmail}" style="color:#1C1008">${p.contactEmail}</a>.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
        <p style="margin:0;font-size:11px;color:#94a3b8">KJ Sports Travel · This link is unique to ${esc(p.hotelName)} and should not be shared.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS })

  let body: { invitation_id?: string; base_url?: string; notify?: boolean; message?: string; note?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS }) }

  const {
    invitation_id,
    base_url = Deno.env.get('SITE_URL') ?? 'https://kjst-rfp.vercel.app',
    notify = true,
  } = body
  // Accept `message` (new, personalized) or legacy `note`.
  const message = (body.message ?? body.note ?? null)
  if (!invitation_id) return Response.json({ error: 'invitation_id is required' }, { status: 400, headers: CORS })

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await sb.auth.getUser(jwt)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401, headers: CORS })
  const senderEmail = user.email ?? ''

  const { data: profile } = await sb
    .from('staff_profiles')
    .select('display_name, title, phone')
    .eq('id', user.id)
    .maybeSingle()
  const senderName = profile?.display_name ?? FROM_NAME
  const senderTitle = profile?.title ?? 'Travel Manager'
  const senderPhone = profile?.phone ?? null

  const { data: inv, error: invErr } = await sb
    .from('rfp_invitations')
    .select(`id, hotel_name, hotel_contact_name, hotel_contact_email, token, status,
      trips ( client_id, city, opponent_label, arrival_date, departure_date, stay2_arrival_date,
        clients ( team_name, always_cc_enabled, always_cc_name, always_cc_email ) )`)
    .eq('id', invitation_id)
    .single()

  if (invErr || !inv) return Response.json({ error: 'Invitation not found' }, { status: 404, headers: CORS })

  // Reopen WITHOUT changing status: stamp reopened_at only. Leaving status at
  // 'submitted'/'awarded' keeps the original bid on the grid and in proposals;
  // the form + rfp-respond use reopened_at > submitted_at to re-enable editing.
  const { error: updErr } = await sb
    .from('rfp_invitations')
    .update({ reopened_at: new Date().toISOString() })
    .eq('id', inv.id)
  if (updErr) return Response.json({ error: 'Failed to reopen: ' + updErr.message }, { status: 500, headers: CORS })

  if (!notify) {
    return Response.json({ ok: true, reopened: true, emailed: false }, { headers: CORS })
  }

  if (!inv.hotel_contact_email) {
    return Response.json({ ok: true, reopened: true, emailed: false, warning: 'Reopened, but no email address on file for this hotel.' }, { headers: CORS })
  }
  if (!RESEND_API_KEY) {
    return Response.json({ ok: true, reopened: true, emailed: false, warning: 'Reopened, but RESEND_API_KEY is not set.' }, { headers: CORS })
  }

  const trip = inv.trips as any
  const client = trip?.clients as any
  const rfpLink = `${base_url}/rfp/${inv.token}`
  const subjectHotel = (inv.hotel_name || '').replace(/\s+/g, ' ').trim() || 'Hotel'
  const subject = `Please review your RFP: ${subjectHotel} · ${client?.team_name ?? 'KJ Sports Travel Client'} @ ${trip?.city ?? 'Trip'}`

  const html = buildReopenHtml({
    hotelName: inv.hotel_name,
    contactName: inv.hotel_contact_name,
    teamName: client?.team_name ?? null,
    city: trip?.city ?? null,
    arrivalDate: trip?.arrival_date ?? null,
    departureDate: trip?.departure_date ?? null,
    rfpLink,
    message,
    senderName,
    senderTitle,
    senderEmail,
    senderPhone,
    contactEmail: CONTACT_EMAIL,
  })

  const assignedRecipients = await getCcRecipients(sb, trip?.client_id ?? null)
  const ccList: string[] = assignedRecipients.map((r) => `${r.name} <${r.email}>`)
  if (client?.always_cc_enabled && client?.always_cc_email) {
    ccList.push(client.always_cc_name ? `${client.always_cc_name} <${client.always_cc_email}>` : client.always_cc_email)
  }

  const fromAddress = senderEmail || FROM_EMAIL
  const resendBody: Record<string, unknown> = {
    from: `${senderName || FROM_NAME} <${fromAddress}>`,
    to: [inv.hotel_contact_email],
    reply_to: senderEmail || undefined,
    subject,
    html,
  }
  if (ccList.length > 0) resendBody.cc = ccList

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(resendBody),
  })
  if (!resendRes.ok) {
    const errText = await resendRes.text()
    return Response.json({ ok: true, reopened: true, emailed: false, warning: `Reopened, but email failed: ${errText}` }, { headers: CORS })
  }

  return Response.json({ ok: true, reopened: true, emailed: true, sent_to: inv.hotel_contact_email, cc: ccList }, { headers: CORS })
})
