// Backup health monitor. Three secret-gated events:
//   success  - the nightly backup (after its validity gate) records a heartbeat
//   failure  - a backup run errored; email the team immediately
//   check    - daily pg_cron: if no successful backup in ~26h, email the team
// Additive/bolt-on: reads/writes only the backup_status table, emails via Resend.
// Deployed verify_jwt=false; protected by the x-cron-secret shared secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const FROM = "KJ Sports Travel Monitor <noreply@kjsportstravel.com>"
const ALERT_TO = ["info@cymbul.co", "team@cymbul.co"]
const STALE_HOURS = 26

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}
function fmt(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: "America/New_York", timeStyle: "short", dateStyle: "medium" }) + " ET"
}
async function email(subject: string, html: string) {
  if (!RESEND_API_KEY) return { skipped: "no_resend_key" }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: ALERT_TO, subject, html }),
  })
  return res.ok ? { ok: true } : { error: `resend ${res.status}` }
}

Deno.serve(async (req: Request) => {
  if ((req.headers.get("x-cron-secret") ?? "") !== CRON_SECRET || !CRON_SECRET) {
    return json({ error: "unauthorized" }, 401)
  }
  let body: any = {}
  try { body = await req.json() } catch { /* empty ok */ }
  const event = String(body?.event ?? "")
  const detail = typeof body?.detail === "string" ? body.detail.slice(0, 500) : null
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const now = new Date()

  if (event === "success") {
    await sb.from("backup_status").update({
      last_success_at: now.toISOString(), last_detail: detail, updated_at: now.toISOString(),
    }).eq("id", 1)
    return json({ ok: true, recorded: now.toISOString() })
  }

  if (event === "failure") {
    const r = await email(
      "ALERT: KJST nightly backup FAILED",
      `<h2 style="color:#b91c1c;margin:0 0 8px">The nightly backup did not complete</h2>
       <p>As of <strong>${fmt(now)}</strong>. ${detail ? "Detail: <code>" + detail + "</code>" : ""}</p>
       <p style="color:#64748b;font-size:12px">Check the kjst-rfp-backups GitHub Actions run.</p>`,
    )
    return json({ ok: true, emailed: r })
  }

  if (event === "check") {
    const { data: st } = await sb.from("backup_status").select("*").eq("id", 1).single()
    const last = st?.last_success_at ? new Date(st.last_success_at) : null
    const stale = !last || (now.getTime() - last.getTime()) > STALE_HOURS * 3600_000
    let emailed: unknown = null
    if (stale) {
      emailed = await email(
        "ALERT: KJST backup may not be running",
        `<h2 style="color:#b91c1c;margin:0 0 8px">No successful backup in the last ${STALE_HOURS} hours</h2>
         <p>Last recorded successful backup: <strong>${last ? fmt(last) : "never"}</strong> (as of ${fmt(now)}).</p>
         <p>The nightly backup may have failed or stopped running. Check the kjst-rfp-backups repo's Actions tab.</p>`,
      )
      await sb.from("backup_status").update({ last_alert_at: now.toISOString() }).eq("id", 1)
    }
    return json({ ok: true, stale, last_success_at: st?.last_success_at ?? null, emailed })
  }

  return json({ error: "unknown event (use success | failure | check)" }, 400)
})
