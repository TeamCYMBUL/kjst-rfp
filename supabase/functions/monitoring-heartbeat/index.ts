// Daily monitoring heartbeat. Called once a day by pg_cron; ALWAYS emails the
// team a full health scoreboard (uptime, backup, errors, cron jobs) whether or
// not anything is wrong. This is positive confirmation: a green email each
// morning means monitoring ran and everything is healthy; a red email means act;
// and NO email at all is itself the alarm (the watchdog stopped). The scoreboard
// comes from the public.monitoring_scoreboard() SQL function, which is the single
// source of truth shared with the in-app /status page. Secret-gated, verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const FROM = "KJ Sports Travel Monitor <noreply@kjsportstravel.com>"
const ALERT_TO = ["info@cymbul.co", "team@cymbul.co"]

type Check = { key: string; label: string; ok: boolean; value: string; detail: string }
type Scoreboard = { generated_at: string; overall_ok: boolean; checks: Check[] }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}
function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function renderHtml(sb: Scoreboard): string {
  const failing = sb.checks.filter((c) => !c.ok)
  const genEt = new Date(sb.generated_at).toLocaleString("en-US", {
    timeZone: "America/New_York", timeStyle: "short", dateStyle: "medium",
  }) + " ET"
  const headline = sb.overall_ok
    ? "All systems normal"
    : `${failing.length} check${failing.length === 1 ? "" : "s"} need${failing.length === 1 ? "s" : ""} attention`
  const banner = sb.overall_ok ? "#047857" : "#b91c1c"

  const rowsHtml = sb.checks.map((c) => {
    const dot = c.ok ? "#10b981" : "#ef4444"
    const statusWord = c.ok ? "OK" : "CHECK"
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot};margin-right:8px;"></span>
          <span style="font-size:13px;color:#111827;font-weight:600;">${esc(c.label)}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#111827;font-weight:600;">${esc(c.value)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">${esc(c.detail)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;text-align:right;color:${dot};">${statusWord}</td>
      </tr>`
  }).join("")

  return `<!DOCTYPE html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
      <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
        <tr><td style="background:#1C1008;padding:20px 28px;">
          <p style="margin:0;color:#d6c6b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJST RFP Platform</p>
          <h1 style="margin:6px 0 0;color:#fff;font-size:19px;font-weight:700;">Daily monitoring heartbeat</h1>
        </td></tr>
        <tr><td style="padding:18px 28px 0;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="background:${banner};border-radius:8px;padding:12px 16px;color:#fff;font-size:15px;font-weight:700;">${esc(headline)}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Check</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Value</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Detail</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;">Status</th>
            </tr>
            ${rowsHtml}
          </table>
          <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">Generated ${esc(genEt)}. Live view: rfp.kjsportstravel.com/status. If you did not receive this email one morning, the monitoring itself may be down — that absence is the alarm.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`
}

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("x-cron-secret") ?? ""
  if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: "unauthorized" }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data, error } = await supabase.rpc("monitoring_scoreboard")
  if (error) return json({ error: "scoreboard failed: " + error.message }, 500)
  const sb = data as Scoreboard

  const failing = sb.checks.filter((c) => !c.ok)
  const subject = sb.overall_ok
    ? "KJST monitoring: all clear"
    : `KJST monitoring: ${failing.length} issue${failing.length === 1 ? "" : "s"} need attention`

  let emailed: unknown = { skipped: "no_resend_key" }
  if (RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: ALERT_TO, subject, html: renderHtml(sb) }),
    })
    emailed = res.ok ? { ok: true } : { error: `resend ${res.status}` }
  }

  return json({ ok: true, overall_ok: sb.overall_ok, failing: failing.map((c) => c.key), emailed })
})
