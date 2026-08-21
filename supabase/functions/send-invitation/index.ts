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

type CcRecipient = { name: string; email: string }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

function fmt(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fmtList(dates: string[] | null | undefined, single: string | null): string {
  const list = (dates && dates.length ? dates : (single ? [single] : [])).filter(Boolean)
  return list.map((d) => fmt(d)).join(', ')
}

function buildSampleMenusHtml(menus: { name: string; url: string }[]): string {
  if (!menus.length) return ''
  const links = menus.map((m) =>
    `<tr><td style="padding:3px 0;font-size:14px;color:#475569">• <a href="${m.url}" style="color:#1C1008">${esc(m.name)}</a></td></tr>`
  ).join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#fffdf7;border:1px solid #f2e9d6;border-radius:8px;margin-bottom:24px">
          <tr><td style="padding:16px 24px">
            <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Sample Menus / F&amp;B Pricing</p>
            <p style="margin:0 0 10px;font-size:14px;color:#475569;line-height:1.6">Please use these as a guide for your food &amp; beverage pricing on the RFP:</p>
            <table cellpadding="0" cellspacing="0" style="width:100%">${links}</table>
          </td></tr>
        </table>`
}

function buildInviteHtml(p: {
  hotelName: string
  contactName: string | null
  teamName: string | null
  season: string | null
  city: string | null
  opponentLabel: string | null
  arrivalDate: string | null
  departureDate: string | null
  gameDatesText: string
  stay2ArrivalDate: string | null
  stay2DepartureDate: string | null
  stay2GameDatesText: string
  visitScope: 'both' | 'stay1' | 'stay2'
  responseDeadline: string | null
  kingRooms: number | null
  doubleRooms: number | null
  suites: number | null
  totalRooms: number | null
  rfpLink: string
  declineLink: string
  senderName: string
  senderTitle: string
  senderEmail: string
  senderPhone: string | null
  contactEmail: string
  ccRecipients: CcRecipient[]
  sampleMenusHtml: string
}): string {
  // Sponsor/partner blocks are labeled "<Team> — Sponsor Block" internally for
  // our own differentiation, but hotels should only ever see the team name.
  const isSponsorBlock = /—\s*sponsor block\s*$/i.test(p.teamName ?? '')
  const teamName = (p.teamName ?? 'our client').replace(/\s*—\s*Sponsor Block\s*$/i, '')
  const seasonLabel = p.season || (p.arrivalDate
    ? (() => { const d = new Date(p.arrivalDate); const y = d.getUTCFullYear(); return d.getUTCMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}` })()
    : '2026-2027')
  // Trip heading — team then opponent only (sponsor blocks have no opponent).
  const tripDesc = [teamName, (!isSponsorBlock && p.opponentLabel) ? `vs. ${p.opponentLabel}` : null].filter(Boolean).join(' · ')
  const roomParts = [
    p.kingRooms ? `${p.kingRooms} king rooms` : null,
    p.doubleRooms ? `${p.doubleRooms} double rooms` : null,
    p.suites ? `${p.suites} suites` : null,
  ].filter(Boolean)
  const roomBlock = (roomParts.length ? roomParts.join(', ') : 'TBD') + (p.totalRooms ? ` (${p.totalRooms} total)` : '')

  // Which visit(s) this hotel is asked to quote. When scoped to a single stay we
  // show only that stay's dates and drop the "Visit 1 / Visit 2" labels entirely,
  // so the hotel never sees dates for the stay it isn't bidding on.
  const scope = p.visitScope ?? 'both'
  const showV1 = scope !== 'stay2'
  const showV2 = Boolean(p.stay2ArrivalDate) && scope !== 'stay1'
  const twoVisit = showV1 && showV2

  const dateRow = (label: string, val: string) =>
    val ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;width:140px">${label}</td><td style="padding:4px 0;font-size:13px;color:#1e293b;font-weight:500">${val}</td></tr>` : ''
  const visitLabel = (t: string) =>
    `<tr><td colspan="2" style="padding:8px 0 2px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">${t}</td></tr>`

  let datesHtml = ''
  if (showV1) {
    if (twoVisit) datesHtml += visitLabel('Visit 1')
    datesHtml += dateRow('Arrival', p.arrivalDate ? fmt(p.arrivalDate) : '')
    datesHtml += dateRow('Departure', p.departureDate ? fmt(p.departureDate) : '')
    datesHtml += dateRow('Game date(s)', p.gameDatesText)
  }
  if (showV2) {
    if (twoVisit) datesHtml += visitLabel('Visit 2')
    datesHtml += dateRow('Arrival', p.stay2ArrivalDate ? fmt(p.stay2ArrivalDate) : '')
    datesHtml += dateRow('Departure', p.stay2DepartureDate ? fmt(p.stay2DepartureDate) : '')
    datesHtml += dateRow('Game date(s)', p.stay2GameDatesText)
  }

  const signatureLines = [
    `<strong style="color:#1e293b">${p.senderName}</strong>`,
    `<span style="color:#64748b">${p.senderTitle}</span>`,
    `<span style="color:#64748b">KJ Sports Travel, Inc. (IATA# 05732731)</span>`,
    `<span style="color:#64748b">572 East Green Street, Suite 200, Pasadena, CA 91101</span>`,
    p.senderPhone ? `<span style="color:#64748b">M: ${p.senderPhone}</span>` : null,
    `<a href="mailto:${p.senderEmail}" style="color:#1C1008;text-decoration:none">E: ${p.senderEmail}</a>`,
  ].filter(Boolean).join('<br>')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RFP Request – KJ Sports Travel</title></head>
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
        <p style="margin:0 0 16px;font-size:15px;color:#1e293b">Greetings,</p>
        <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">I hope this email finds you well.</p>
        <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6">
          We are reaching out on behalf of the <strong>${teamName}</strong> to request pricing and availability
          for the ${seasonLabel} season. Please use the link below to view specific dates and requirements and submit your response.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:24px">
          <tr><td style="padding:20px 24px">
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Trip Details</p>
            ${tripDesc ? `<p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1e293b">${tripDesc}</p>` : ''}
            <table cellpadding="0" cellspacing="0" style="width:100%">
              ${datesHtml}
              <tr><td style="padding:8px 0 4px;font-size:13px;color:#64748b">Room block</td><td style="padding:8px 0 4px;font-size:13px;color:#1e293b;font-weight:500">${roomBlock}</td></tr>
              ${p.responseDeadline ? `<tr><td style="padding:8px 0 4px;font-size:13px;color:#dc2626;font-weight:600">Response by</td><td style="padding:8px 0 4px;font-size:13px;color:#dc2626;font-weight:700">${fmt(p.responseDeadline)}</td></tr>` : ''}
            </table>
          </td></tr>
        </table>
        ${p.sampleMenusHtml}
        <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6">
          If there are any requested concessions your property is unable to approve, we welcome counteroffers in the spaces provided.
        </p>
        <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6">
          Hotel selections will be made based on overall value, ${isSponsorBlock ? 'including rates and concessions.' : 'including rates, concessions, and suite upgrade offerings.'}
        </p>
        <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6">
          We kindly ask that you complete and return the attached RFP ${p.responseDeadline ? `by <strong>${fmt(p.responseDeadline)}</strong>` : '<strong>as soon as possible</strong>'}.
        </p>
        <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">
          Thank you in advance for your time and consideration. We look forward to the opportunity to work together${isSponsorBlock ? '.' : ` during the ${seasonLabel} season.`}
        </p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:16px">
          <tr><td style="background:#1C1008;border-radius:8px">
            <a href="${p.rfpLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">Submit Your Proposal →</a>
          </td></tr>
        </table>
        <p style="margin:0 0 6px;font-size:12px;color:#94a3b8">Or copy this link:</p>
        <p style="margin:0 0 20px;font-size:12px;color:#64748b;word-break:break-all">${p.rfpLink}</p>
        <p style="margin:0 0 28px;font-size:12px;color:#94a3b8">
          Unable to bid on this trip? <a href="${p.declineLink}" style="color:#64748b;text-decoration:underline">Click here to let us know.</a>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px">
        <p style="margin:0 0 8px;font-size:14px;color:#475569">Warm Regards,</p>
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
      trips ( city, opponent_label, arrival_date, departure_date, game_date, game_dates, stay2_arrival_date, stay2_departure_date, stay2_game_date, stay2_game_dates, response_deadline, king_rooms_requested, double_rooms_requested, suites_requested, total_rooms_requested,
        clients ( id, team_name, season, always_cc_enabled, always_cc_name, always_cc_email, sample_menus ) )`)
    .eq('id', invitation_id)
    .single()

  if (invErr || !inv) return Response.json({ error: 'Invitation not found' }, { status: 404, headers: CORS })
  if (!inv.hotel_contact_email) return Response.json({ error: 'No email address on file for this hotel' }, { status: 400, headers: CORS })

  const trip = inv.trips as any
  const client = trip?.clients as any
  const scope = ((inv as any).visit_scope ?? 'both') as 'both' | 'stay1' | 'stay2'
  const rfpLink = `${base_url}/rfp/${inv.token}`
  const declineLink = `${base_url}/rfp/${inv.token}?decline=1`
  const monY = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
  // Subject line months honor the scope: only the stay(s) this hotel is quoting.
  const subjectShowV1 = scope !== 'stay2'
  const subjectShowV2 = Boolean(trip?.stay2_arrival_date) && scope !== 'stay1'
  const stayMonths = [
    subjectShowV1 ? monY(trip?.arrival_date) : '',
    subjectShowV2 ? monY(trip?.stay2_arrival_date) : '',
  ].filter(Boolean)
  const datesText = stayMonths.join(' & ')
  const subjectHotel = (inv.hotel_name || '').replace(/\s+/g, ' ').trim() || 'Hotel'
  const publicTeam = (client?.team_name ?? 'KJ Sports Travel Client').replace(/\s*—\s*Sponsor Block\s*$/i, '')
  const subject = `RFP Request: ${subjectHotel} – ${publicTeam} @ ${trip?.city ?? 'Trip'}${datesText ? ` (${datesText})` : ''}`

  const ccRecipients = await getCcRecipients(sb, client?.id ?? null)

  const sampleMenus = (Array.isArray(client?.sample_menus) ? client.sample_menus : [])
    .filter((m: any) => m && typeof m.path === 'string' && typeof m.name === 'string')
    .map((m: any) => ({ name: m.name as string, url: `${SUPABASE_URL}/storage/v1/object/public/client-sample-menus/${m.path}` }))
  const sampleMenusHtml = buildSampleMenusHtml(sampleMenus)

  const html = buildInviteHtml({
    hotelName: inv.hotel_name,
    contactName: inv.hotel_contact_name,
    teamName: client?.team_name ?? null,
    season: client?.season ?? null,
    city: trip?.city ?? null,
    opponentLabel: trip?.opponent_label ?? null,
    arrivalDate: trip?.arrival_date ?? null,
    departureDate: trip?.departure_date ?? null,
    gameDatesText: fmtList(trip?.game_dates ?? null, trip?.game_date ?? null),
    stay2ArrivalDate: trip?.stay2_arrival_date ?? null,
    stay2DepartureDate: trip?.stay2_departure_date ?? null,
    stay2GameDatesText: fmtList(trip?.stay2_game_dates ?? null, trip?.stay2_game_date ?? null),
    visitScope: scope,
    responseDeadline: trip?.response_deadline ?? null,
    kingRooms: trip?.king_rooms_requested ?? null,
    doubleRooms: trip?.double_rooms_requested ?? null,
    suites: trip?.suites_requested ?? null,
    totalRooms: trip?.total_rooms_requested ?? null,
    rfpLink,
    declineLink,
    senderName,
    senderTitle,
    senderEmail,
    senderPhone,
    contactEmail: CONTACT_EMAIL,
    ccRecipients,
    sampleMenusHtml,
  })

  const ccList: string[] = ccRecipients.map((r) => `${r.name} <${r.email}>`)
  if (client?.always_cc_enabled && client?.always_cc_email) {
    ccList.push(client.always_cc_name ? `${client.always_cc_name} <${client.always_cc_email}>` : client.always_cc_email)
  }

  const hotelCc = await getHotelBrandCc(sb, inv.hotel_contact_email, inv.hotel_name, trip?.city ?? null)
  if (
    hotelCc &&
    hotelCc.email.toLowerCase() !== (inv.hotel_contact_email ?? '').toLowerCase() &&
    !ccList.some((c) => c.toLowerCase().includes(hotelCc.email.toLowerCase()))
  ) {
    ccList.push(`${hotelCc.name} <${hotelCc.email}>`)
  }

  const replyTo = Array.from(new Set([senderEmail, ...ccRecipients.map((r) => r.email)].filter(Boolean)))

  const fromAddress = senderEmail || FROM_EMAIL

  const resendBody: Record<string, unknown> = {
    from: `${senderName || FROM_NAME} <${fromAddress}>`,
    to: [inv.hotel_contact_email],
    reply_to: replyTo,
    subject,
    html,
  }
  if (ccList.length > 0) resendBody.cc = ccList

  const resendRes = await sendResend(resendBody, RESEND_API_KEY)

  if (!resendRes.ok) {
    const errText = await resendRes.text()
    return Response.json({ error: `Resend API error: ${errText}` }, { status: 500, headers: CORS })
  }

  await sb.from('rfp_invitations').update({ sent_at: new Date().toISOString() }).eq('id', invitation_id)
  return Response.json({ ok: true, sent_to: inv.hotel_contact_email, cc: ccList, reply_to: replyTo, from: fromAddress }, { headers: CORS })
})
