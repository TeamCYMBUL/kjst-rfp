import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'KJ Sports Travel RFP Platform <noreply@kjsportstravel.com>'
const TICKET_RECIPIENT = 'info@cymbul.co'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type Attachment = { path: string; name: string; size?: number; type?: string }

// Only keep well-formed entries; cap the count as a guardrail.
function sanitizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return []
  const out: Attachment[] = []
  for (const a of raw) {
    if (a && typeof a === 'object' && typeof (a as any).path === 'string' && typeof (a as any).name === 'string') {
      out.push({
        path: (a as any).path,
        name: (a as any).name,
        size: typeof (a as any).size === 'number' ? (a as any).size : undefined,
        type: typeof (a as any).type === 'string' ? (a as any).type : undefined,
      })
    }
  }
  return out.slice(0, 20)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const title = (body?.title ?? '').trim()
  const description = (body?.description ?? '').trim()
  const pageUrl = (body?.page_url ?? '').trim() || null
  const attachments = sanitizeAttachments(body?.attachments)
  if (!title || !description) return json({ error: 'Title and description are required.' }, 400)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Identify the submitter from their JWT
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabase.auth.getUser(jwt)
  if (!user) return json({ error: 'Not authenticated' }, 401)

  const [{ data: profile }, { data: staffProfile }] = await Promise.all([
    supabase.from('profiles').select('organization_id').eq('id', user.id).single(),
    supabase.from('staff_profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ])
  if (!profile?.organization_id) return json({ error: 'Could not resolve your organization.' }, 400)

  const submitterName = staffProfile?.display_name || user.email || 'Unknown'
  const submitterEmail = user.email ?? null

  const { data: ticket, error: insertErr } = await supabase
    .from('tickets')
    .insert({
      organization_id: profile.organization_id,
      created_by: user.id,
      created_by_name: submitterName,
      created_by_email: submitterEmail,
      title,
      description,
      page_url: pageUrl,
      attachments,
    })
    .select('id, created_at')
    .single()

  if (insertErr || !ticket) return json({ error: 'Failed to save ticket: ' + insertErr?.message }, 500)

  if (RESEND_API_KEY) {
    // Attribute the notification to the ACTUAL submitter in the inbox: keep the
    // verified sending address, but set the From display name to who submitted
    // it. Otherwise every ticket email shows one constant sender name.
    const fromAddr = FROM_EMAIL.match(/<([^>]+)>/)?.[1] ?? FROM_EMAIL
    const fromName = (submitterName || 'KJST RFP').replace(/[<>"\r\n,]/g, ' ').trim() || 'KJST RFP'
    const fromHeader = `${fromName} via KJST RFP <${fromAddr}>`

    const attachmentsHtml = attachments.length > 0
      ? `<p style="margin:20px 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Attachments (${attachments.length})</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;color:#374151;line-height:1.7;">
          ${attachments.map((a) => `<li>${esc(a.name)}</li>`).join('')}
        </ul>
        <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Open the ticket in the platform to view the files.</p>`
      : ''

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New Platform Ticket</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
      <tr><td style="background:#1C1008;padding:24px 32px;">
        <p style="margin:0;color:#d6c6b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJST RFP Platform</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">🎫 New Ticket Submitted</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td style="padding:4px 0;font-size:13px;color:#64748b;width:110px;">Submitted by</td><td style="padding:4px 0;font-size:13px;color:#111827;font-weight:600;">${esc(submitterName)}${submitterEmail ? ` (${esc(submitterEmail)})` : ''}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Submitted</td><td style="padding:4px 0;font-size:13px;color:#111827;">${new Date(ticket.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</td></tr>
          ${pageUrl ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Page</td><td style="padding:4px 0;font-size:13px;"><a href="${esc(pageUrl)}" style="color:#1C1008;">${esc(pageUrl)}</a></td></tr>` : ''}
        </table>
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Title</p>
        <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#111827;">${esc(title)}</p>
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Description</p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;white-space:pre-line;">${esc(description)}</p>
        ${attachmentsHtml}
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">Reply to this email to reach ${esc(submitterName)} directly.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromHeader,
        to: [TICKET_RECIPIENT],
        reply_to: submitterEmail || undefined,
        subject: `[Ticket] ${title}`,
        html,
      }),
    })
  }

  return json({ ok: true, ticket_id: ticket.id })
})
