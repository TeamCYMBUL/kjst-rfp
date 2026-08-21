// Staff-triggered: (re)send a hotel a copy of its OWN completed RFP.
// Same summary email the hotel gets automatically on self-submit — rebuilt on
// demand so staff can fulfill "please send me a copy" requests, and so hotels
// whose bids were entered by KJST (no auto-email) can still get their copy.
//
// Auth: verify_jwt = true (KJST staff only). Reads/sends with the service role.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const IATA = '05732731'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function fmtMoney(n: number | null | undefined): string | null {
  return n == null ? null : `$${Number(n).toLocaleString()}`
}

const MEETING_SPACE_TYPE_LABELS: Record<string, string> = {
  function_room: 'Function Room / Ballroom',
  restaurant: 'Restaurant / F&B outlet',
  suite_converted: 'Suite (furniture removed)',
  other: 'Other',
}
function formatMeetingSpaceNotes(raw: string | null | undefined): string {
  if (!raw) return ''
  let parsed: any
  try { parsed = JSON.parse(raw) } catch { return raw }
  if (!parsed || typeof parsed !== 'object') return raw
  const spaces: any[] = []
  if (parsed.__details && typeof parsed.__details === 'object') spaces.push(...Object.values(parsed.__details))
  if (Array.isArray(parsed.__additional)) spaces.push(...parsed.__additional)
  const fmtSpace = (s: any): string | null => {
    if (!s || typeof s !== 'object') return null
    const parts: string[] = []
    if (s.name) parts.push(String(s.name))
    if (s.space_type) parts.push(MEETING_SPACE_TYPE_LABELS[s.space_type] ?? String(s.space_type))
    if (s.dimensions) parts.push(`Size: ${s.dimensions}`)
    if (s.fb_minimum) parts.push(`F&B min: ${s.fb_minimum}`)
    if (s.wifi) parts.push(`Wi-Fi: ${s.wifi}`)
    if (s.additional_info) parts.push(String(s.additional_info))
    return parts.length ? parts.join(' · ') : null
  }
  const lines = spaces.map(fmtSpace).filter(Boolean) as string[]
  if (parsed.__named && typeof parsed.__named === 'object') {
    for (const itemSpaces of Object.values(parsed.__named)) {
      if (!itemSpaces || typeof itemSpaces !== 'object') continue
      for (const s of Object.values(itemSpaces as Record<string, any>)) {
        if (!s || typeof s !== 'object') continue
        const valueParts: string[] = []
        if (s.name) valueParts.push(String(s.name))
        if (s.dimensions) valueParts.push(`Size: ${s.dimensions}`)
        if (!valueParts.length) continue
        lines.push(s.spaceLabel ? `${s.spaceLabel}: ${valueParts.join(' · ')}` : valueParts.join(' · '))
      }
    }
  }
  return lines.join('; ')
}

const SECTION_LABELS: Record<string, string> = {
  concessions: 'Concessions',
  facilities: 'Facilities',
  in_season_tournament: 'In-Season Tournament Guarantee',
  postseason: 'Postseason Guarantee',
}
const SECTION_ORDER = ['concessions', 'facilities', 'in_season_tournament', 'postseason']

function buildAnswerSectionsHtml(
  items: { id: string; section: string; label: string; answer_type: string; sort_order: number }[],
  answersByItemId: Map<string, { answer_yes_no: boolean | null; answer_value: string | null; comment: string | null }>,
): string {
  const bySection = new Map<string, typeof items>()
  for (const item of items) {
    if (!bySection.has(item.section)) bySection.set(item.section, [])
    bySection.get(item.section)!.push(item)
  }
  let html = ''
  for (const sectionKey of SECTION_ORDER) {
    const sectionItems = (bySection.get(sectionKey) ?? []).sort((a, b) => a.sort_order - b.sort_order)
    if (sectionItems.length === 0) continue
    const rows = sectionItems.map((item) => {
      const ans = answersByItemId.get(item.id)
      let valueText: string
      if (!ans || (ans.answer_yes_no == null && !ans.answer_value)) {
        valueText = '—'
      } else if (item.answer_type === 'yes_no') {
        valueText = ans.answer_yes_no === true ? 'Yes' : ans.answer_yes_no === false ? 'No' : '—'
      } else {
        valueText = ans.answer_value || '—'
      }
      const commentHtml = ans?.comment
        ? `<div style="margin-top:2px;font-size:12px;color:#92400e;background:#fffbeb;border-radius:4px;padding:4px 8px;">${esc(ans.comment)}</div>`
        : ''
      return `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#374151;border-bottom:1px solid #f1f5f9;vertical-align:top;">${esc(item.label)}${commentHtml}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;vertical-align:top;">${esc(valueText)}</td>
      </tr>`
    }).join('')
    html += `
      <tr><td colspan="2" style="padding:16px 12px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">${SECTION_LABELS[sectionKey] ?? sectionKey}</td></tr>
      ${rows}`
  }
  return html
}

function copyHtml(p: {
  contactName: string | null
  teamName: string
  opponentLabel: string | null
  city: string | null
  arrivalDate: string | null
  departureDate: string | null
  rates: {
    bestKingRate: number | null
    bestSuiteRate: number | null
    currentSellingRate: string | null
    occupancyTax: string | null
    resortFee: string | null
    stay2KingRate: number | null
    stay2SuiteRate: number | null
  }
  meetingSpaceNotes: string
  generalComments: string | null
  answerSectionsHtml: string
}) {
  const greeting = p.contactName ? `Dear ${p.contactName},` : 'Dear Valued Partner,'
  const dates = [p.arrivalDate, p.departureDate].filter(Boolean).join(' – ')
  const trip = [p.opponentLabel, p.city].filter(Boolean).join(' · ')
  const rateRows = [
    ['King Rate', fmtMoney(p.rates.bestKingRate)],
    ['Suite Rate', fmtMoney(p.rates.bestSuiteRate)],
    ['Selling Rate', p.rates.currentSellingRate],
    ['Occupancy Tax', p.rates.occupancyTax],
    ['Resort Fee', p.rates.resortFee],
    ['King Rate — Stay 2', fmtMoney(p.rates.stay2KingRate)],
    ['Suite Rate — Stay 2', fmtMoney(p.rates.stay2SuiteRate)],
  ].filter(([, v]) => v)
  const rateRowsHtml = rateRows.map(([label, value]) =>
    `<tr><td style="padding:4px 12px;font-size:13px;color:#64748b;">${label}</td><td style="padding:4px 12px;font-size:13px;font-weight:600;color:#111827;text-align:right;">${esc(String(value))}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Your RFP Submission</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
      <tr><td style="background:#059669;padding:24px 32px;">
        <p style="margin:0;color:#a7f3d0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJ Sports Travel · IATA ${IATA}</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">Your RFP — copy for your records</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 20px;color:#374151;font-size:15px;">${greeting}</p>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          As requested, here is a copy of the RFP on file for <strong>${esc(p.teamName)}</strong>${trip ? ' (' + esc(trip) + ')' : ''}.${dates ? ' Dates: <strong>' + esc(dates) + '</strong>.' : ''}
        </p>
        <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">Below are all the details currently on file for your submission.</p>
        ${rateRowsHtml ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;">
          <tr><td style="padding:12px 12px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Rates</td></tr>
          ${rateRowsHtml}
        </table>` : ''}
        ${p.meetingSpaceNotes ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;"><strong>Meeting space:</strong> ${esc(p.meetingSpaceNotes)}</p>` : ''}
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;">
          ${p.answerSectionsHtml}
        </table>
        ${p.generalComments ? `<p style="margin:20px 0 0;font-size:13px;color:#374151;"><strong>General comments:</strong> ${esc(p.generalComments)}</p>` : ''}
        <p style="margin:24px 0 8px;color:#9ca3af;font-size:12px;">Need to make a correction? Reply to this email and we'll assist you.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;">
        <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">KJ Sports Travel, Inc. · IATA #${IATA}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

async function getAssignedManagers(sb: ReturnType<typeof createClient>, clientId: string | null): Promise<{ name: string; email: string }[]> {
  const recipients: { name: string; email: string }[] = []
  if (clientId) {
    const { data } = await sb.from('client_assignments').select('profiles(full_name, email)').eq('client_id', clientId)
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

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const invitationId = body?.invitation_id
  if (!invitationId) return json({ error: 'Missing invitation_id' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: inv, error: invErr } = await supabase
    .from('rfp_invitations')
    .select('id, status, hotel_name, hotel_contact_name, hotel_contact_email, trips(id, client_id, opponent_label, city, arrival_date, departure_date, clients(team_name))')
    .eq('id', invitationId)
    .single()
  if (invErr || !inv) return json({ error: 'Invitation not found' }, 404)
  if (!inv.hotel_contact_email) return json({ error: 'This hotel has no contact email on file.' }, 400)

  const { data: resp } = await supabase
    .from('rfp_responses')
    .select('id, best_king_rate, best_suite_rate, current_selling_rate, occupancy_tax, resort_fee, stay2_king_rate, stay2_suite_rate, meeting_space_notes, general_comments')
    .eq('invitation_id', inv.id)
    .maybeSingle()
  if (!resp) return json({ error: 'This hotel has not submitted an RFP yet — nothing to send.' }, 400)

  const trip = inv.trips as any
  const client = trip?.clients as any
  if (client?.team_name) client.team_name = client.team_name.replace(/\s*—\s*Sponsor Block\s*$/i, '') // hotel-facing: team name only
  const teamName = client?.team_name ?? 'the team'
  const clientId = trip?.client_id ?? null
  const orClause = clientId ? `client_id.is.null,client_id.eq.${clientId}` : 'client_id.is.null'

  const { data: items } = await supabase
    .from('concession_items')
    .select('id, section, label, answer_type, sort_order')
    .or(orClause)
    .eq('archived', false)
    .order('sort_order')

  const { data: finalAnswers } = await supabase
    .from('concession_answers')
    .select('concession_item_id, answer_yes_no, answer_value, comment')
    .eq('response_id', resp.id)

  const answersByItemId = new Map((finalAnswers ?? []).map((a: any) => [a.concession_item_id, a]))
  const answerSectionsHtml = buildAnswerSectionsHtml((items ?? []) as any, answersByItemId as any)

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'KJ Sports Travel <noreply@kjsportstravel.com>'
  if (!resendKey) return json({ error: 'Email is not configured (missing RESEND_API_KEY).' }, 500)

  const assignedManagers = await getAssignedManagers(supabase, clientId)
  const fromAddress = assignedManagers[0] ? `${assignedManagers[0].name} <${assignedManagers[0].email}>` : fromEmail

  const html = copyHtml({
    contactName: inv.hotel_contact_name,
    teamName,
    opponentLabel: trip?.opponent_label ?? null,
    city: trip?.city ?? null,
    arrivalDate: trip?.arrival_date ?? null,
    departureDate: trip?.departure_date ?? null,
    rates: {
      bestKingRate: resp.best_king_rate,
      bestSuiteRate: resp.best_suite_rate,
      currentSellingRate: resp.current_selling_rate,
      occupancyTax: resp.occupancy_tax,
      resortFee: resp.resort_fee,
      stay2KingRate: resp.stay2_king_rate,
      stay2SuiteRate: resp.stay2_suite_rate,
    },
    meetingSpaceNotes: formatMeetingSpaceNotes(resp.meeting_space_notes),
    generalComments: resp.general_comments,
    answerSectionsHtml,
  })
  const subject = `Your RFP on file: ${teamName} – ${trip?.city ?? trip?.opponent_label ?? 'Road Trip'}`

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress, to: [inv.hotel_contact_email], subject, html }),
  })
  if (!emailRes.ok) {
    const errText = await emailRes.text()
    return json({ error: 'Failed to send email: ' + errText }, 502)
  }
  return json({ ok: true, sent_to: inv.hotel_contact_email })
})
