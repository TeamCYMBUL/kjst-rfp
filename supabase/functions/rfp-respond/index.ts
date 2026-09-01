import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { rateLimited, tooManyRequests } from '../_shared/rateLimit.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const JON_EMAIL = 'jcohen@kjsportstravel.com'
const JON_NAME = 'Jon Cohen'

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const IATA = '05732731'

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

function confirmationHtml(p: {
  hotelName: string
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
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>RFP Submitted</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
      <tr><td style="background:#059669;padding:24px 32px;">
        <p style="margin:0;color:#a7f3d0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJ Sports Travel · IATA ${IATA}</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">✓ RFP Received</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 20px;color:#374151;font-size:15px;">${greeting}</p>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          Thank you — your RFP response for <strong>${esc(p.teamName)}</strong>${trip ? ' (' + esc(trip) + ')' : ''} has been successfully submitted.${dates ? ' Dates: <strong>' + esc(dates) + '</strong>.' : ''}
        </p>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          A KJ Sports Travel representative will review all proposals and follow up if any clarification is needed. Thank you for your partnership.
        </p>
        <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">Below is a copy of everything you submitted, for your records.</p>
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
        <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">KJ Sports Travel, Inc. · IATA #${IATA}<br>This confirmation was sent automatically upon RFP submission.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function staffNotificationHtml(p: {
  hotelName: string
  teamName: string
  opponentLabel: string | null
  city: string | null
  submittedAt: string
  gridUrl: string
}) {
  const trip = [p.opponentLabel, p.city].filter(Boolean).join(' · ')
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New RFP Submission</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
      <tr><td style="background:#4f46e5;padding:24px 32px;">
        <p style="margin:0;color:#c7d2fe;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJST Platform · Notification</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">New RFP Submission</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px;color:#374151;font-size:15px;"><strong>${p.hotelName}</strong> has submitted their RFP for <strong>${p.teamName}</strong>${trip ? ' · ' + trip : ''}.</p>
        <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">Submitted at: ${p.submittedAt} ET</p>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:#4f46e5;border-radius:8px;">
            <a href="${p.gridUrl}" style="display:inline-block;padding:12px 24px;color:#fff;font-size:14px;font-weight:600;text-decoration:none;">View comparison grid →</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Generous: autosave fires while a hotel fills the form, so this only bites a grinder.
  if (await rateLimited(req, 'rfp-respond', 180)) return tooManyRequests(CORS)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { token, response: responseFields, answers, submit } = body
  // When a KJST staff member enters the bid on the hotel's behalf, suppress the
  // automated emails (the hotel didn't actually submit; KJST logged it).
  const staffEntry = body?.staff_entry === true
  if (!token) return json({ error: 'Missing token' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // --- Validate token ---
  const { data: inv, error: invErr } = await supabase
    .from('rfp_invitations')
    .select('id, status, revoked_at, submitted_at, reopened_at, original_bid, hotel_name, hotel_contact_name, hotel_contact_email, token, trips(id, client_id, opponent_label, city, arrival_date, departure_date, clients(team_name))')
    .eq('token', token)
    .single()

  if (invErr || !inv) return json({ error: 'Invalid token' }, 404)
  if ((inv as any).revoked_at) return json({ error: 'This link has been deactivated. Please contact KJST.' }, 403)
  // A submitted bid is locked UNLESS staff reopened it for edits (reopened_at is
  // newer than submitted_at). Reopening no longer changes status — it keeps the
  // bid on the grid — so we gate the resubmit on reopened_at, not on status.
  // Staff editing on the hotel's behalf (?entry=staff, e.g. a rate renegotiated
  // offline via the "Edit bid" button) can always save — this mirrors the
  // client's own isReadOnly rule, which also unlocks the form for staffEntry.
  // Without this exception the fields look editable but every save returned 409.
  const reopenedForEdit = !!(inv as any).reopened_at &&
    (!(inv as any).submitted_at || new Date((inv as any).reopened_at).getTime() > new Date((inv as any).submitted_at).getTime())
  if (inv.status === 'submitted' && !reopenedForEdit && !staffEntry) return json({ error: 'This RFP has already been submitted.' }, 409)

  // --- Upsert rfp_response ---
  const { data: existingResp } = await supabase
    .from('rfp_responses')
    .select('id')
    .eq('invitation_id', inv.id)
    .maybeSingle()

  const rf = responseFields ?? {}

  const responseRow = {
    completed_by_name:     rf.completed_by_name     ?? null,
    completed_date:        rf.completed_date         ?? null,
    best_king_rate:        rf.best_king_rate         ?? null,
    king_rate_notes:       rf.king_rate_notes        ?? null,
    current_selling_rate:  rf.current_selling_rate   ?? null,
    stay2_king_rate:       rf.stay2_king_rate        ?? null,
    stay2_suite_rate:      rf.stay2_suite_rate       ?? null,
    stay2_selling_rate:    rf.stay2_selling_rate     ?? null,
    best_suite_rate:       rf.best_suite_rate        ?? null,
    resort_fee:            rf.resort_fee             ?? null,
    occupancy_tax:         rf.occupancy_tax          ?? null,
    meeting_space_notes:   rf.meeting_space_notes    ?? null,
    meeting_space_type:    rf.meeting_space_type     ?? null,
    meeting_space_count:   rf.meeting_space_count    ?? null,
    scenario_rates:        rf.scenario_rates         ?? null,
    scenario_availability: rf.scenario_availability  ?? null,
    general_comments:      rf.general_comments       ?? null,
    menu_attachments:      rf.menu_attachments       ?? [],
  }

  let responseId: string

  if (existingResp) {
    await supabase
      .from('rfp_responses')
      .update(responseRow)
      .eq('id', existingResp.id)
    responseId = existingResp.id
  } else {
    const { data: newResp, error: insertErr } = await supabase
      .from('rfp_responses')
      .insert({ invitation_id: inv.id, ...responseRow })
      .select('id')
      .single()
    if (insertErr || !newResp) return json({ error: 'Failed to create response: ' + insertErr?.message }, 500)
    responseId = newResp.id
  }

  // --- Upsert concession answers ---
  if (Array.isArray(answers) && answers.length > 0) {
    const rows = answers.map((a: any) => ({
      response_id: responseId,
      concession_item_id: a.concession_item_id,
      answer_yes_no: a.answer_yes_no ?? null,
      answer_value: a.answer_value ?? null,
      comment: a.comment ?? null,
    }))
    const { error: upsertErr } = await supabase
      .from('concession_answers')
      .upsert(rows, { onConflict: 'response_id,concession_item_id' })
    if (upsertErr) return json({ error: 'Failed to save answers: ' + upsertErr.message }, 500)
  }

  // --- If submitting, mark invitation submitted + fire emails ---
  if (submit) {
    const submittedAt = new Date().toISOString()
    await supabase
      .from('rfp_invitations')
      .update({ status: 'submitted', submitted_at: submittedAt })
      .eq('id', inv.id)

    // Capture the hotel's ORIGINAL submission exactly once (first-ever submit),
    // so later reopened updates can be flagged against it. Never overwrite it —
    // the .is('original_bid', null) guard makes this idempotent even on retries.
    if (!(inv as any).submitted_at && !(inv as any).original_bid) {
      const answersMap: Record<string, unknown> = {}
      for (const a of (Array.isArray(answers) ? answers : [])) {
        answersMap[a.concession_item_id] = {
          answer_yes_no: a.answer_yes_no ?? null,
          answer_value: a.answer_value ?? null,
          comment: a.comment ?? null,
        }
      }
      await supabase
        .from('rfp_invitations')
        .update({ original_bid: { captured_at: submittedAt, response: responseRow, answers: answersMap } })
        .eq('id', inv.id)
        .is('original_bid', null)
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'KJ Sports Travel <noreply@kjsportstravel.com>'
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL')
    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')

    if (resendKey && !staffEntry) {
      const trip = inv.trips as any
      const client = (trip as any)?.clients as any
      // Hotel-facing confirmation: show the team name only (strip our internal
      // "— Sponsor Block" label). The staff notification below keeps the full label.
      const teamName = (client?.team_name ?? 'the team').replace(/\s*—\s*Sponsor Block\s*$/i, '')

      const clientIdForAssignment = trip?.client_id ?? null
      const assignedManagers = await getAssignedManagers(supabase, clientIdForAssignment)
      const fromAddress = assignedManagers[0]
        ? `${assignedManagers[0].name} <${assignedManagers[0].email}>`
        : fromEmail

      if (inv.hotel_contact_email) {
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
          .eq('response_id', responseId)

        const answersByItemId = new Map(
          (finalAnswers ?? []).map((a: any) => [a.concession_item_id, a])
        )
        const answerSectionsHtml = buildAnswerSectionsHtml((items ?? []) as any, answersByItemId as any)

        const html = confirmationHtml({
          hotelName: inv.hotel_name,
          contactName: inv.hotel_contact_name,
          teamName,
          opponentLabel: trip?.opponent_label ?? null,
          city: trip?.city ?? null,
          arrivalDate: trip?.arrival_date ?? null,
          departureDate: trip?.departure_date ?? null,
          rates: {
            bestKingRate: responseRow.best_king_rate,
            bestSuiteRate: responseRow.best_suite_rate,
            currentSellingRate: responseRow.current_selling_rate,
            occupancyTax: responseRow.occupancy_tax,
            resortFee: responseRow.resort_fee,
            stay2KingRate: responseRow.stay2_king_rate,
            stay2SuiteRate: responseRow.stay2_suite_rate,
          },
          meetingSpaceNotes: formatMeetingSpaceNotes(responseRow.meeting_space_notes),
          generalComments: responseRow.general_comments,
          answerSectionsHtml,
        })
        const subject = `RFP Submitted: ${teamName} – ${trip?.city ?? trip?.opponent_label ?? 'Road Trip'}`
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromAddress, to: [inv.hotel_contact_email], subject, html }),
        })
      }

      const notifyList = assignedManagers.map((m) => `${m.name} <${m.email}>`)
      if (!assignedManagers.some((m) => m.email === JON_EMAIL)) notifyList.push(`${JON_NAME} <${JON_EMAIL}>`)
      const staffRecipients = Array.from(new Set([notifyEmail, ...notifyList].filter(Boolean) as string[]))
      if (staffRecipients.length > 0) {
        const gridUrl = siteUrl ? `${siteUrl}/trips/${(inv.trips as any)?.id}/grid` : ''
        const html = staffNotificationHtml({
          hotelName: inv.hotel_name,
          teamName: (inv.trips as any)?.clients?.team_name ?? 'Unknown team',
          opponentLabel: (inv.trips as any)?.opponent_label ?? null,
          city: (inv.trips as any)?.city ?? null,
          submittedAt: new Date(submittedAt).toLocaleString('en-US', { timeZone: 'America/New_York' }),
          gridUrl,
        })
        const subject = `[KJST] RFP submitted: ${inv.hotel_name} – ${(inv.trips as any)?.clients?.team_name ?? ''} ${(inv.trips as any)?.city ?? (inv.trips as any)?.opponent_label ?? ''}`
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromAddress, to: staffRecipients, subject, html }),
        })
      }
    }
  }

  return json({ ok: true, response_id: responseId, submitted: !!submit })
})
