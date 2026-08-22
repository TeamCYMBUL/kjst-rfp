// Daily error digest. Called once a day by pg_cron; emails the team a grouped
// summary of any new (unseen) errors from error_logs, then marks them seen so
// each error is reported once. Sends nothing on a clean day. Secret-gated,
// deployed verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const FROM = "KJ Sports Travel Monitor <noreply@kjsportstravel.com>"
const ALERT_TO = ["info@cymbul.co", "team@cymbul.co"]

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}
function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("x-cron-secret") ?? ""
  if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: "unauthorized" }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data: rows, error } = await supabase
    .from("error_logs")
    .select("id, created_at, kind, message, url, app_version")
    .eq("seen", false)
    .order("created_at", { ascending: false })
    .limit(1000)
  if (error) return json({ error: error.message }, 500)
  if (!rows || rows.length === 0) return json({ ok: true, count: 0 })

  // Group identical messages so a repeated error reads as one line with a count.
  const groups = new Map<string, { count: number; kind: string; url: string | null; last: string }>()
  for (const r of rows) {
    const key = r.message
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { count: 1, kind: r.kind, url: r.url, last: r.created_at })
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].count - a[1].count)

  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", timeStyle: "short", dateStyle: "medium" }) + " ET"

  const rowsHtml = ordered.slice(0, 40).map(([msg, g]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:12px;color:#111827;">${esc(msg)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">${esc(g.kind)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">${esc(g.url ?? "")}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:right;">${g.count}</td>
    </tr>`).join("")

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
      <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-width:100%;">
        <tr><td style="background:#1C1008;padding:20px 28px;">
          <p style="margin:0;color:#d6c6b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">KJST RFP Platform</p>
          <h1 style="margin:6px 0 0;color:#fff;font-size:19px;font-weight:700;">${rows.length} new error${rows.length === 1 ? "" : "s"} in the last day</h1>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <p style="margin:0 0 14px;font-size:13px;color:#475569;">Grouped by message (${ordered.length} unique). Full detail with stack traces is in the error_logs table.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;">
            <tr style="background:#f8fafc;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Message</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Kind</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Page</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;">Count</th>
            </tr>
            ${rowsHtml}
          </table>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`

  let emailed: unknown = { skipped: "no_resend_key" }
  if (RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: ALERT_TO, subject: `KJST portal: ${rows.length} new error${rows.length === 1 ? "" : "s"} in the last day`, html }),
    })
    emailed = res.ok ? { ok: true } : { error: `resend ${res.status}` }
  }

  // Mark these specific rows seen so they aren't reported again.
  const ids = rows.map((r) => r.id)
  await supabase.from("error_logs").update({ seen: true }).in("id", ids)

  return json({ ok: true, count: rows.length, unique: ordered.length, emailed })
})
