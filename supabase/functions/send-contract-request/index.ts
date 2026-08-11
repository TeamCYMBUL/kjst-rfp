import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Send the awarded hotel a contract-request email. Staff compose a fully editable
// subject + message (prefilled from a template client-side); this delivers it as
// the sending manager, CC'ing the assigned managers + Jon and any hotel brand CC.
// It also ensures a `contracts` record + token exists and appends a secure upload
// link so the hotel can return its signed agreement straight into the platform.

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

async function getCcRecipients(sb: ReturnType<typeof createClient>, clientId: string | null): Promise<CcRecipient[]> {
  const recipients: CcRecipient[] = []
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

// A hotel's persistent card can carry an "Always CC" (brand_cc) copied on every
// message to that property. Match by contact email first, then name+city.
async function getHotelBrandCc(
  sb: ReturnType<typeof createClient>,
  contactEmail: string | null,
  hotelName: string | null,
  city: string | null,
): Promise<CcRecipient | null> {
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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escMultiline(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>')
}

function buildHtml(p: {
  hotelName: string
  teamName: string | null
  city: string | null
  message: string
  uploadLink: string
  senderName: string
  senderTitle: string
  senderEmail: string
  senderPhone: string | null
  contactEmail: string
}): string {
  const signatureLines = [
    `<strong style="color:#1e293b">${esc(p.senderName)}</strong>`,
    `<span style="color:#64748b">${esc(p.senderTitle)} | KJ Sports Travel</span>`,
    p.senderPhone ? `<span style="color:#64748b">${esc(p.senderPhone)}</span>` : null,
    `<a href="mailto:${p.senderEmail}" style="color:#1C1008;text-decoration:none">${p.senderEmail}</a>`,
  ].filter(Boolean).join('<br>')
  const tripRef = [p.teamName, p.city].filter(Boolean).join(' · ')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Room Agreement Request – KJ Sports Travel</title></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#1C1008;padding:24px 32px">
        <p style="margin:0;color:#d6c3b0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">KJ Sports Travel</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:21px;font-weight:700;">You've been selected — room agreement request</h1>
      </td></tr>
      <tr><td style="padding:32px">
        ${tripRef ? `<p style="margin:0 0 16px;font-size:13px;color:#94a3b8">Re: <strong style="color:#475569">${esc(tripRef)}</strong></p>` : ''}
        <div style="font-size:15px;color:#475569;line-height:1.6">${escMultiline(p.message.trim())}</div>
        <table cellpadding="0" cellspacing="0" style="margin:24px 0 0">
          <tr><td style="background:#059669;border-radius:8px">
            <a href="${p.uploadLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">Upload your signed agreement →</a>
          </td></tr>
        </table>
        <p style="margin:10px 0 0;font-size:12px;color:#94a3b8">Or paste this secure link into your browser:</p>
        <p style="margin:2px 0 0;font-size:12px;color:#64748b;word-break:break-all">${p.uploadLink}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 20px">
        <p style="margin:0 0 20px;font-size:13px;line-height:1.8">${signatureLines}</p>
        <p style="margin:0;font-size:13px;color:#94a3b8">Questions? Reply to this email or contact us at <a href="mailto:${p.contactEmail}" style="color:#1C1008">${p.contactEmail}</a>.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
        <p style="margin:0;font-size:11px;color:#94a3b8">KJ Sports Travel, Inc. · IATA #05732731</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS })
  if (!RESEND_API_KEY) return Response.json({ error: 'RESEND_API_KEY not set' }, { status: 500, headers: CORS })

  let body: { invitation_id?: string; subject?: string; message?: string; base_url?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS }) }

  const invitation_id = body.invitation_id
  const message = (body.message ?? '').trim()
  if (!invitation_id) return Response.json({ error: 'invitation_id is required' }, { status: 400, headers: CORS })
  if (!message) return Response.json({ error: 'message is required' }, { status: 400, headers: CORS })
  const baseUrl = (body.base_url ?? Deno.env.get('SITE_URL') ?? 'https://rfp.kjsportstravel.com').replace(/\/$/, '')

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
    .select(`id, hotel_name, hotel_contact_name, hotel_contact_email, status,
      trips ( id, client_id, city, opponent_label,
        clients ( team_name, always_cc_enabled, always_cc_name, always_cc_email ) )`)
    .eq('id', invitation_id)
    .single()

  if (invErr || !inv) return Response.json({ error: 'Invitation not found' }, { status: 404, headers: CORS })
  if (!inv.hotel_contact_email) return Response.json({ error: 'No email address on file for this hotel' }, { status: 400, headers: CORS })

  const trip = inv.trips as any
  const client = trip?.clients as any

  // Ensure a contract record + upload token exists for this awarded hotel.
  let { data: contract } = await sb
    .from('contracts')
    .select('id, token')
    .eq('invitation_id', invitation_id)
    .maybeSingle()
  if (!contract) {
    const { data: created, error: cErr } = await sb
      .from('contracts')
      .insert({ invitation_id, trip_id: trip?.id ?? null, client_id: trip?.client_id ?? null, status: 'requested' })
      .select('id, token')
      .single()
    if (cErr || !created) return Response.json({ error: 'Failed to create contract record: ' + (cErr?.message ?? '') }, { status: 500, headers: CORS })
    contract = created
  }
  const uploadLink = `${baseUrl}/contract/${contract.token}`

  const subject = (body.subject ?? '').trim() ||
    `Room Agreement Request: ${inv.hotel_name} · ${client?.team_name ?? 'KJ Sports Travel'} @ ${trip?.city ?? 'Trip'}`

  const html = buildHtml({
    hotelName: inv.hotel_name,
    teamName: client?.team_name ?? null,
    city: trip?.city ?? null,
    message,
    uploadLink,
    senderName,
    senderTitle,
    senderEmail,
    senderPhone,
    contactEmail: CONTACT_EMAIL,
  })

  const ccRecipients = await getCcRecipients(sb, trip?.client_id ?? null)
  const ccList: string[] = ccRecipients.map((r) => `${r.name} <${r.email}>`)
  if (client?.always_cc_enabled && client?.always_cc_email) {
    ccList.push(client.always_cc_name ? `${client.always_cc_name} <${client.always_cc_email}>` : client.always_cc_email)
  }

  // Brand-level Always CC (e.g. Marriott -> Dominick) — copied on every message.
  const hotelCc = await getHotelBrandCc(sb, inv.hotel_contact_email, inv.hotel_name, trip?.city ?? null)
  if (
    hotelCc &&
    hotelCc.email.toLowerCase() !== (inv.hotel_contact_email ?? '').toLowerCase() &&
    !ccList.some((c) => c.toLowerCase().includes(hotelCc.email.toLowerCase()))
  ) {
    ccList.push(`${hotelCc.name} <${hotelCc.email}>`)
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
    return Response.json({ error: `Resend API error: ${errText}` }, { status: 500, headers: CORS })
  }

  return Response.json({ ok: true, sent_to: inv.hotel_contact_email, cc: ccList }, { headers: CORS })
})
