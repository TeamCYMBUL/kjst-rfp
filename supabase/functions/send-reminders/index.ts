import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Transfer checklist: update FROM_EMAIL + CONTACT_EMAIL secrets when domain changes
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev'
const FROM_NAME = Deno.env.get('FROM_NAME') ?? 'KJ Sports Travel'
const CONTACT_EMAIL = Deno.env.get('CONTACT_EMAIL') ?? 'info@kjsportstravel.com'
const JON_EMAIL = 'jcohen@kjsportstravel.com'
const JON_NAME = 'Jon Cohen'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Retry a Resend send ONLY on 429 (rate limited = the email was never accepted),
// honoring Retry-After, with capped backoff + jitter. Any other status returns
// as-is, so success and real errors behave exactly as before. No double-send
// risk: a 429 means nothing was sent.
async function sendResend(payload: unknown, apiKey: string, maxAttempts = 4): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status !== 429 || attempt >= maxAttempts) return res
    const retryAfter = Number(res.headers.get('Retry-After'))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(2000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150)
    await new Promise((r) => setTimeout(r, waitMs))
  }
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

// Brand-level Always CC (e.g. Marriott -> Dominick) on the hotel's card, copied
// on every message. Match by contact email first, then name+city.
async function getHotelBrandCc(
  sb: ReturnType<typeof createClient>,
  contactEmail: string | null,
  hotelName: string | null,
  city: string | null,
): Promise<{ name: string; email: string } | null> {
  const pick = (rows: any[] | null) => {
    const r = (rows ?? [])[0]
    return r?.brand_cc_email ? { name: r.brand_cc_name || r.brand_cc_email, email: r.brand_cc_email as string } : null
  }
  if (contactEmail) {
    const { data } = await sb.from('hotels').select('brand_cc_name, brand_cc_email').ilike('contact_email', contactEmail).limit(1)
    const hit = pick(data as any[]); if (hit) return hit
  }
  if (hotelName) {
    let q = sb.from('hotels').select('brand_cc_name, brand_cc_email').ilike('name', hotelName)
    if (city) q = q.ilike('city', city)
    const { data } = await q.limit(1)
    const hit = pick(data as any[]); if (hit) return hit
  }
  return null
}

function fmt(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function buildReminderHtml(p: {
  hotelName: string
  contactName: string | null
  teamName: string | null
  city: string | null
  opponentLabel: string | null
  arrivalDate: string | null
  responseDeadline: string | null
  rfpLink: string
  daysLeft: number
  senderName: string
  senderTitle: string
  senderEmail: string
  senderPhone: string | null
  contactEmail: string
}): string {
  const greeting = p.contactName ? `Dear ${p.contactName},` : `To whom it may concern,`
  const urgency = p.daysLeft <= 0
    ? `<strong style="color:#dc2626">This proposal is now past due.</strong>`
    : p.daysLeft === 1
      ? `<strong style="color:#dc2626">Your response is due tomorrow.</strong>`
      : `<strong style="color:#d97706">Your response is due in ${p.daysLeft} day${p.daysLeft !== 1 ? 's' : ''}.</strong>`

  const signatureLines = [
    `<strong style="color:#1e293b">${p.senderName}</strong>`,
    `<span style="color:#64748b">${p.senderTitle} | KJ Sports Travel</span>`,
    `<a href="mailto:${p.senderEmail}" style="color:#1C1008;text-decoration:none">${p.senderEmail}</a>`,
    p.senderPhone ? `<span style="color:#64748b">${p.senderPhone}</span>` : null,
  ].filter(Boolean).join('<br>')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reminder: RFP Response Due – KJ Sports Travel</title></head>
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
      <tr><td style="background:#fef3c7;border-bottom:1px solid #fde68a;padding:12px 32px">
        <p style="margin:0;font-size:14px;color:#92400e">⏰ Reminder – ${urgency}</p>
      </td></tr>
      <tr><td style="padding:32px">
        <p style="margin:0 0 16px;font-size:15px;color:#1e293b">${greeting}</p>
        <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6">
          This is a friendly reminder that we have not yet received your proposal for the following trip.
          Please submit at your earliest convenience.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:24px">
          <tr><td style="padding:20px 24px">
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Trip Details</p>
            ${p.teamName || p.opponentLabel ? `<p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#1e293b">${[p.teamName, p.city, p.opponentLabel ? `vs. ${p.opponentLabel}` : null].filter(Boolean).join(' · ')}</p>` : ''}
            <table cellpadding="0" cellspacing="0">
              ${p.arrivalDate ? `<tr><td style="padding:4px 8px 4px 0;font-size:13px;color:#64748b">Arrival</td><td style="padding:4px 0;font-size:13px;color:#1e293b;font-weight:500">${fmt(p.arrivalDate)}</td></tr>` : ''}
              ${p.responseDeadline ? `<tr><td style="padding:4px 8px 4px 0;font-size:13px;color:#dc2626;font-weight:600">Response by</td><td style="padding:4px 0;font-size:13px;color:#dc2626;font-weight:700">${fmt(p.responseDeadline)}</td></tr>` : ''}
            </table>
          </td></tr>
        </table>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:24px">
          <tr><td style="background:#1C1008;border-radius:8px">
            <a href="${p.rfpLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">Submit Your Proposal →</a>
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

  let body: { trip_id?: string; base_url?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS }) }

  const { trip_id, base_url = Deno.env.get('SITE_URL') ?? 'https://kjst-rfp.vercel.app' } = body
  if (!trip_id) return Response.json({ error: 'trip_id is required' }, { status: 400, headers: CORS })

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
  const senderTitle = profile?.title ?? 'Sales Manager'
  const senderPhone = profile?.phone ?? null

  const { data: tripData } = await sb
    .from('trips')
    .select('client_id, city, opponent_label, arrival_date, stay2_arrival_date, response_deadline, clients(team_name, always_cc_enabled, always_cc_name, always_cc_email)')
    .eq('id', trip_id)
    .single()

  const { data: invitations, error: invErr } = await sb
    .from('rfp_invitations')
    .select('id, hotel_name, hotel_contact_name, hotel_contact_email, token, status')
    .eq('trip_id', trip_id)
    .not('status', 'in', '("submitted","awarded","passed")')

  if (invErr || !invitations) return Response.json({ error: 'Failed to fetch invitations' }, { status: 500, headers: CORS })

  const trip = tripData as any
  const client = trip?.clients as any
  const deadline = trip?.response_deadline ? new Date(trip.response_deadline) : null
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 999

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

  let sent = 0, skipped = 0

  for (const inv of invitations) {
    if (!inv.hotel_contact_email) { skipped++; continue }

    const rfpLink = `${base_url}/rfp/${inv.token}`
    const monY = (iso: string | null | undefined) =>
      iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
    const datesText = [monY(trip?.arrival_date), monY(trip?.stay2_arrival_date)].filter(Boolean).join(' & ')
    const subjectHotel = (inv.hotel_name || '').replace(/\s+/g, ' ').trim() || 'Hotel'
    const subject = `Reminder: RFP Response Needed – ${subjectHotel} · ${client?.team_name ?? 'KJ Sports Travel'} @ ${trip?.city ?? 'Trip'}${datesText ? ` (${datesText})` : ''}`

    const html = buildReminderHtml({
      hotelName: inv.hotel_name,
      contactName: inv.hotel_contact_name,
      teamName: client?.team_name ?? null,
      city: trip?.city ?? null,
      opponentLabel: trip?.opponent_label ?? null,
      arrivalDate: trip?.arrival_date ?? null,
      responseDeadline: trip?.response_deadline ?? null,
      rfpLink,
      daysLeft,
      senderName,
      senderTitle,
      senderEmail,
      senderPhone,
      contactEmail: CONTACT_EMAIL,
    })

    // Per-hotel CC = assigned managers + this hotel's brand Always CC.
    const perHotelCc = [...ccList]
    const hotelCc = await getHotelBrandCc(sb, inv.hotel_contact_email, inv.hotel_name, trip?.city ?? null)
    if (
      hotelCc &&
      hotelCc.email.toLowerCase() !== (inv.hotel_contact_email ?? '').toLowerCase() &&
      !perHotelCc.some((c) => c.toLowerCase().includes(hotelCc.email.toLowerCase()))
    ) {
      perHotelCc.push(`${hotelCc.name} <${hotelCc.email}>`)
    }

    const resendBody: Record<string, unknown> = {
      from: `${senderName || FROM_NAME} <${fromAddress}>`,
      to: [inv.hotel_contact_email],
      subject,
      html,
    }
    if (perHotelCc.length > 0) resendBody.cc = perHotelCc

    const resendRes = await sendResend(resendBody, RESEND_API_KEY)

    if (resendRes.ok) { sent++ } else {
      console.error(`Failed to send to ${inv.hotel_contact_email}:`, await resendRes.text())
      skipped++
    }
  }

  return Response.json({ sent, skipped }, { headers: CORS })
})
