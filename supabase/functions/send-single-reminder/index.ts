import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

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

// Whoever is assigned to a client (client_assignments -> profiles) is who
// should be copied on that client's mail — never a hardcoded name. Jon is
// always added on top as company-wide oversight.
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

function buildNudgeHtml(p: {
  hotelName: string
  contactName: string | null
  teamName: string | null
  city: string | null
  responseDeadline: string | null
  rfpLink: string
  senderName: string
  senderTitle: string
  senderEmail: string
  senderPhone: string | null
  contactEmail: string
}): string {
  const greeting = p.contactName ? `Dear ${p.contactName},` : `To whom it may concern,`
  const signatureLines = [
    `<strong style="color:#1e293b">${p.senderName}</strong>`,
    `<span style="color:#64748b">${p.senderTitle} | KJ Sports Travel</span>`,
    `<a href="mailto:${p.senderEmail}" style="color:#1C1008;text-decoration:none">${p.senderEmail}</a>`,
    p.senderPhone ? `<span style="color:#64748b">${p.senderPhone}</span>` : null,
  ].filter(Boolean).join('<br>')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quick Reminder – KJ Sports Travel</title></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#1C1008;padding:28px 32px">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="border:2.5px solid #ffffff;padding:3px">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="border:1px solid #ffffff;padding:4px 8px;font-size:14px;font-weight:900;color:#ffffff;letter-spacing:1px">KJ</td>
            </tr></table>
          </td>
          <td style="padding-left:12px">
            <div style="font-size:10px;font-weight:900;letter-spacing:3px;color:#ffffff;line-height:1.4">SPORTS</div>
            <div style="font-size:10px;font-weight:900;letter-spacing:3px;color:#ffffff;line-height:1.4">TRAVEL</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px">
        <p style="margin:0 0 16px;font-size:15px;color:#1e293b">${greeting}</p>
        <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6">
          Just a quick follow-up — we sent over an RFP for
          <strong>${p.teamName ?? 'one of our clients'}</strong>${p.city ? ` in <strong>${p.city}</strong>` : ''}
          and wanted to check in. Would you be able to take a moment to complete your proposal?
        </p>
        ${p.responseDeadline ? `<p style="margin:0 0 20px;font-size:14px;color:#dc2626;font-weight:600">⏰ Response requested by ${fmt(p.responseDeadline)}.</p>` : ''}
        <table cellpadding="0" cellspacing="0" style="margin-bottom:24px">
          <tr><td style="background:#1C1008;border-radius:8px">
            <a href="${p.rfpLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">Complete Your Proposal →</a>
          </td></tr>
        </table>
        <p style="margin:0 0 6px;font-size:12px;color:#94a3b8">Or copy this link:</p>
        <p style="margin:0 0 28px;font-size:12px;color:#64748b;word-break:break-all">${p.rfpLink}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px">
        <p style="margin:0 0 20px;font-size:13px;line-height:1.8">${signatureLines}</p>
        <p style="margin:0;font-size:13px;color:#94a3b8">
          Questions? Reply to this email or contact us at <a href="mailto:${p.contactEmail}" style="color:#1C1008">${p.contactEmail}</a>.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
        <p style="margin:0;font-size:11px;color:#94a3b8">KJ Sports Travel · This link is unique to ${p.hotelName} and should not be shared.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (!RESEND_API_KEY) return Response.json({ error: 'RESEND_API_KEY secret not set.' }, { status: 500, headers: CORS })

  let body: { invitation_id?: string; base_url?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS }) }

  const { invitation_id, base_url = Deno.env.get('SITE_URL') ?? 'https://kjst-rfp.vercel.app' } = body
  if (!invitation_id) return Response.json({ error: 'invitation_id is required' }, { status: 400, headers: CORS })

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await sb.auth.getUser(jwt)
  const senderEmail = user?.email ?? ''

  const { data: profile } = await sb
    .from('staff_profiles')
    .select('display_name, title, phone')
    .eq('id', user?.id ?? '')
    .maybeSingle()

  const senderName = profile?.display_name ?? FROM_NAME
  const senderTitle = profile?.title ?? 'Travel Manager'
  const senderPhone = profile?.phone ?? null

  const { data: inv, error: invErr } = await sb
    .from('rfp_invitations')
    .select(`id, hotel_name, hotel_contact_name, hotel_contact_email, token, status, visit_scope,
      trips ( client_id, city, opponent_label, arrival_date, stay2_arrival_date, response_deadline,
        clients ( team_name, always_cc_enabled, always_cc_name, always_cc_email ) )`)
    .eq('id', invitation_id)
    .single()

  if (invErr || !inv) return Response.json({ error: 'Invitation not found' }, { status: 404, headers: CORS })
  if (!inv.hotel_contact_email) return Response.json({ error: 'No email address on file for this hotel' }, { status: 400, headers: CORS })

  const trip = inv.trips as any
  const client = trip?.clients as any
  const rfpLink = `${base_url}/rfp/${inv.token}`
  const monY = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
  // Subject months honor per-visit scoping: only the stay(s) this hotel is quoting.
  const scope = ((inv as any).visit_scope ?? 'both') as 'both' | 'stay1' | 'stay2'
  const datesText = [
    scope !== 'stay2' ? monY(trip?.arrival_date) : '',
    (Boolean(trip?.stay2_arrival_date) && scope !== 'stay1') ? monY(trip?.stay2_arrival_date) : '',
  ].filter(Boolean).join(' & ')
  const subjectHotel = (inv.hotel_name || '').replace(/\s+/g, ' ').trim() || 'Hotel'
  const subject = `Following up: RFP for ${subjectHotel} · ${client?.team_name ?? 'KJ Sports Travel Client'} @ ${trip?.city ?? 'Trip'}${datesText ? ` (${datesText})` : ''}`

  const html = buildNudgeHtml({
    hotelName: inv.hotel_name,
    contactName: inv.hotel_contact_name,
    teamName: client?.team_name ?? null,
    city: trip?.city ?? null,
    responseDeadline: trip?.response_deadline ?? null,
    rfpLink,
    senderName,
    senderTitle,
    senderEmail,
    senderPhone,
    contactEmail: CONTACT_EMAIL,
  })

  // Whoever is actually assigned to this client gets copied — never a
  // hardcoded name. Jon is always added as company-wide oversight.
  const assignedRecipients = await getCcRecipients(sb, trip?.client_id ?? null)
  const ccList: string[] = assignedRecipients.map((r) => `${r.name} <${r.email}>`)
  if (client?.always_cc_enabled && client?.always_cc_email) {
    ccList.push(client.always_cc_name ? `${client.always_cc_name} <${client.always_cc_email}>` : client.always_cc_email)
  }

  // Always send from whoever is actually logged in and sending it — never a
  // shared/hardcoded address impersonating someone else.
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
    return Response.json({ error: `Resend API error: ${errText}` }, { status: 500, headers: CORS })
  }

  return Response.json({ ok: true, sent_to: inv.hotel_contact_email, cc: ccList }, { headers: CORS })
})
