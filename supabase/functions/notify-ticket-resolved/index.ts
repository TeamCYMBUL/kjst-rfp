import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'KJ Sports Travel RFP Platform <noreply@kjsportstravel.com>'
// Where replies from the submitter should land (the team inbox).
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const ticketId = (body?.ticket_id ?? '').trim()
  const note = (body?.note ?? '').trim()
  if (!ticketId) return json({ error: 'ticket_id is required' }, 400)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Only authenticated KJST staff can trigger this.
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabase.auth.getUser(jwt)
  if (!user) return json({ error: 'Not authenticated' }, 401)

  const { data: ticket, error: tErr } = await supabase
    .from('tickets')
    .select('id, title, description, created_by_name, created_by_email, page_url, created_at, resolved_at')
    .eq('id', ticketId)
    .single()

  if (tErr || !ticket) return json({ error: 'Ticket not found' }, 404)

  // Nothing to send if we never captured who submitted it.
  if (!ticket.created_by_email) return json({ ok: true, skipped: 'no_submitter_email' })
  if (!RESEND_API_KEY) return json({ ok: true, skipped: 'no_resend_key' })

  const name = (ticket.created_by_name || '').trim()
  const greeting = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi,'

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Your ticket has been resolved</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
      <tr><td style="background:#1C1008;padding:24px 32px;">
        <p style="margin:0;color:#d6c6b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJST RFP Platform</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">Your ticket has been resolved</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px;font-size:15px;color:#111827;">${greeting}</p>
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
          Good news — the ticket you submitted has been marked <strong style="color:#047857;">resolved</strong>.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:20px;">
          <tr><td style="padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#16a34a;">Ticket</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${esc(ticket.title)}</p>
          </td></tr>
        </table>
        ${note ? `<p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Note from the team</p>
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-line;">${esc(note)}</p>` : ''}
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">
          If it's not fully sorted or you spot anything else, just reply to this email and we'll take another look.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">Thanks for helping us make the platform better. — KJ Sports Travel</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ticket.created_by_email],
      reply_to: TICKET_RECIPIENT,
      subject: `[Resolved] ${ticket.title}`,
      html,
    }),
  })

  if (!resendRes.ok) {
    const errText = await resendRes.text()
    return json({ error: `Resend API error: ${errText}` }, 500)
  }

  return json({ ok: true, sent_to: ticket.created_by_email })
})
