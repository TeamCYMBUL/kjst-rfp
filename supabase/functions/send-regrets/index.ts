import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Notify the hotels that submitted a bid but were NOT selected for a trip
// (the "losers"). Mirrors the RFP invitation + contract-request flow: sent as the
// signed-in manager, CC'ing the assigned managers + Jon and any hotel brand CC.
// For a cancelled trip, every submitted hotel is a non-winner. Staff compose an
// editable message; a sensible default is used if none is provided.

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

type CcRecipient = { name: string; email: string }

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

async function getCcRecipients(sb: ReturnType<typeof createClient>, clientId: string | null): Promise<CcRecipient[]> {
  const recipients: CcRecipient[] = []
  if (clientId) {
    const { data } = await sb.from('client_assignments').select('profiles(full_name, email)').eq('client_id', clientId)
    for (const row of (data ?? []) as any[]) {
      const p = row.profiles
      if (p?.email && !recipients.some((r) => r.email === p.email)) recipients.push({ name: p.full_name || p.email, email: p.email })
    }
  }
  if (!recipients.some((r) => r.email === JON_EMAIL)) recipients.push({ name: JON_NAME, email: JON_EMAIL })
  return recipients
}

async function getHotelBrandCc(sb: ReturnType<typeof createClient>, contactEmail: string | null, hotelName: string | null, city: string | null): Promise<CcRecipient | null> {
  const pick = (rows: any[] | null): CcRecipient | null => {
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

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function escMultiline(s: string): string { return esc(s).replace(/\r?\n/g, '<br>') }

function buildHtml(p: {
  hotelName: string; teamName: string | null; city: string | null; message: string
  senderName: string; senderTitle: string; senderEmail: string; senderPhone: string | null; contactEmail: string
}): string {
  const signatureLines = [
    `<strong style="color:#1e293b">${esc(p.senderName)}</strong>`,
    `<span style="color:#64748b">${esc(p.senderTitle)} | KJ Sports Travel</span>`,
    p.senderPhone ? `<span style="color:#64748b">${esc(p.senderPhone)}</span>` : null,
    `<a href="mailto:${p.senderEmail}" style="color:#1C1008;text-decoration:none">${p.senderEmail}</a>`,
  ].filter(Boolean).join('<br>')
  const tripRef = [p.teamName, p.city].filter(Boolean).join(' · ')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RFP Update – KJ Sports Travel</title></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:32px 16px"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="background:#1C1008;padding:24px 32px">
      <p style="margin:0;color:#d6c3b0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">KJ Sports Travel</p>
      <h1 style="margin:6px 0 0;color:#ffffff;font-size:21px;font-weight:700;">Thank you for your proposal</h1>
    </td></tr>
    <tr><td style="padding:32px">
      ${tripRef ? `<p style="margin:0 0 16px;font-size:13px;color:#94a3b8">Re: <strong style="color:#475569">${esc(tripRef)}</strong></p>` : ''}
      <div style="font-size:15px;color:#475569;line-height:1.6">${escMultiline(p.message.trim())}</div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 20px">
      <p style="margin:0 0 20px;font-size:13px;line-height:1.8">${signatureLines}</p>
      <p style="margin:0;font-size:13px;color:#94a3b8">Questions? Reply to this email or contact us at <a href="mailto:${p.contactEmail}" style="color:#1C1008">${p.contactEmail}</a>.</p>
    </td></tr>
    <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
      <p style="margin:0;font-size:11px;color:#94a3b8">KJ Sports Travel, Inc. · IATA #05732731</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS })
  if (!RESEND_API_KEY) return Response.json({ error: 'RESEND_API_KEY not set' }, { status: 500, headers: CORS })

  let body: { trip_id?: string; message?: string; base_url?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS }) }
  const trip_id = body.trip_id
  if (!trip_id) return Response.json({ error: 'trip_id is required' }, { status: 400, headers: CORS })

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const authHeader = req.headers.get('Authorization') ?? ''
  const { data: { user } } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401, headers: CORS })
  const senderEmail = user.email ?? ''

  const { data: profile } = await sb.from('staff_profiles').select('display_name, title, phone').eq('id', user.id).maybeSingle()
  const senderName = profile?.display_name ?? FROM_NAME
  const senderTitle = profile?.title ?? 'Travel Manager'
  const senderPhone = profile?.phone ?? null

  const { data: trip, error: tErr } = await sb
    .from('trips')
    .select('id, client_id, city, opponent_label, cancelled, clients ( team_name, always_cc_enabled, always_cc_name, always_cc_email )')
    .eq('id', trip_id)
    .single()
  if (tErr || !trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: CORS })
  const client = (trip as any).clients

  // Losers = submitted bids that did not win either visit.
  const { data: invs } = await sb
    .from('rfp_invitations')
    .select('id, hotel_name, hotel_contact_name, hotel_contact_email, status, awarded_stay1, awarded_stay2')
    .eq('trip_id', trip_id)
    .in('status', ['submitted', 'passed'])
  const losers = (invs ?? []).filter((i: any) => !i.awarded_stay1 && !i.awarded_stay2 && i.hotel_contact_email)

  if (losers.length === 0) return Response.json({ ok: true, sent: 0, recipients: [] }, { headers: CORS })

  const tripRef = [client?.team_name, (trip as any).city].filter(Boolean).join(' · ')
  const defaultMessage = (trip as any).cancelled
    ? `Thank you for taking the time to submit a proposal for ${tripRef || 'our recent request'}. Unfortunately, this trip has been cancelled, so we will not be moving forward with a booking at this time. We sincerely appreciate your effort and look forward to the opportunity to work together on a future trip.`
    : `Thank you for taking the time to submit a proposal for ${tripRef || 'our recent request'}. After careful review, we have decided to move forward with another property for this particular trip. We sincerely appreciate your effort and the opportunity, and we look forward to the possibility of working together in the future.`
  const message = (body.message ?? '').trim() || defaultMessage

  const ccRecipients = await getCcRecipients(sb, trip.client_id ?? null)
  const baseCc: string[] = ccRecipients.map((r) => `${r.name} <${r.email}>`)
  if (client?.always_cc_enabled && client?.always_cc_email) {
    baseCc.push(client.always_cc_name ? `${client.always_cc_name} <${client.always_cc_email}>` : client.always_cc_email)
  }
  const fromAddress = senderEmail || FROM_EMAIL

  const sent: string[] = []
  const failed: { hotel: string; error: string }[] = []
  for (const inv of losers) {
    const html = buildHtml({
      hotelName: inv.hotel_name, teamName: client?.team_name ?? null, city: (trip as any).city ?? null,
      message, senderName, senderTitle, senderEmail, senderPhone, contactEmail: CONTACT_EMAIL,
    })
    const ccList = [...baseCc]
    const hotelCc = await getHotelBrandCc(sb, inv.hotel_contact_email, inv.hotel_name, (trip as any).city ?? null)
    if (hotelCc && hotelCc.email.toLowerCase() !== (inv.hotel_contact_email ?? '').toLowerCase() &&
        !ccList.some((c) => c.toLowerCase().includes(hotelCc.email.toLowerCase()))) {
      ccList.push(`${hotelCc.name} <${hotelCc.email}>`)
    }
    const resendBody: Record<string, unknown> = {
      from: `${senderName || FROM_NAME} <${fromAddress}>`,
      to: [inv.hotel_contact_email],
      reply_to: senderEmail || undefined,
      subject: `Thank you for your proposal — ${client?.team_name ?? 'KJ Sports Travel'}${(trip as any).city ? ` @ ${(trip as any).city}` : ''}`,
      html,
    }
    if (ccList.length > 0) resendBody.cc = ccList
    const res = await sendResend(resendBody, RESEND_API_KEY)
    if (res.ok) sent.push(inv.hotel_contact_email)
    else failed.push({ hotel: inv.hotel_name, error: await res.text() })
    await new Promise((r) => setTimeout(r, 350)) // pace to stay under provider rate limits
  }

  return Response.json({ ok: true, sent: sent.length, recipients: sent, failed }, { headers: CORS })
})
