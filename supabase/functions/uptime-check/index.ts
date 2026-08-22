// Uptime monitor for the public RFP portal.
//
// Called every 2 minutes by pg_cron (see the schedule_uptime_cron migration).
// It pings the live site, retries a few times to avoid false alarms from a
// single blip, records the result, and emails the team ONLY when the state
// changes (site goes down, or recovers). Protected by a shared secret header
// so random callers can't trigger it — it is deployed with verify_jwt=false.
//
// Env (all already present on this project except CRON_SECRET, set via CLI):
//   CRON_SECRET                 - shared secret; must match the x-cron-secret header
//   RESEND_API_KEY              - existing Resend send key
//   SUPABASE_URL                - auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   - auto-injected (bypasses RLS to write checks)
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

// What we monitor. version.json is served no-store and returns a small JSON
// body, so a 200 here means the site is genuinely up and serving the app.
const TARGET_URL = "https://rfp.kjsportstravel.com/version.json"
const FROM = "KJ Sports Travel Monitor <noreply@kjsportstravel.com>"
const ALERT_TO = ["info@cymbul.co", "team@cymbul.co"]
const ATTEMPTS = 3          // retries within one run before declaring "down"
const TIMEOUT_MS = 10_000   // per-attempt timeout

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function sendEmail(subject: string, html: string) {
  if (!RESEND_API_KEY) return { skipped: "no_resend_key" }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: ALERT_TO, subject, html }),
  })
  if (!res.ok) return { error: `resend ${res.status}: ${await res.text()}` }
  return { ok: true }
}

// One HTTP attempt with a hard timeout. Returns status + latency, or an error.
async function probe(): Promise<{ ok: boolean; status?: number; latency_ms: number; error?: string }> {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(TARGET_URL, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "user-agent": "kjst-uptime-monitor" },
    })
    return { ok: res.status === 200, status: res.status, latency_ms: Date.now() - started }
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - started, error: String((e as Error)?.message ?? e) }
  } finally {
    clearTimeout(timer)
  }
}

function fmt(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: "America/New_York", timeStyle: "short", dateStyle: "medium" }) + " ET"
}

Deno.serve(async (req: Request) => {
  // Auth: shared-secret header (this function is public / verify_jwt=false).
  const secret = req.headers.get("x-cron-secret") ?? ""
  if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: "unauthorized" }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Optional test mode: sends a sample alert email to confirm the pipeline,
  // without touching real state or recording a check. Call with {"test":true}.
  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  if (body?.test) {
    const r = await sendEmail(
      "[TEST] KJST portal monitor is working",
      `<p>This is a test alert from the KJST uptime monitor. If you received this, outage and recovery alerts will reach you here.</p><p style="color:#64748b;font-size:12px">Sent ${fmt(new Date())}. No action needed.</p>`,
    )
    return json({ test: true, email: r })
  }

  // Probe with retries — only a run where every attempt fails counts as down.
  let result = await probe()
  for (let i = 1; i < ATTEMPTS && !result.ok; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    result = await probe()
  }

  await supabase.from("uptime_checks").insert({
    url: TARGET_URL,
    ok: result.ok,
    status_code: result.status ?? null,
    latency_ms: result.latency_ms,
    error: result.error ?? null,
  })

  const { data: state } = await supabase
    .from("uptime_state").select("*").eq("id", 1).single()
  const wasDown = !!state?.is_down
  const now = new Date()

  let emailed: unknown = null
  if (!result.ok && !wasDown) {
    // Transition: UP -> DOWN
    await supabase.from("uptime_state").update({
      is_down: true, since: now.toISOString(), last_alert_at: now.toISOString(),
    }).eq("id", 1)
    emailed = await sendEmail(
      "ALERT: KJST portal appears DOWN",
      `<h2 style="color:#b91c1c;margin:0 0 8px">The KJST portal is not responding</h2>
       <p>${TARGET_URL.replace("/version.json", "")} failed ${ATTEMPTS} checks in a row as of <strong>${fmt(now)}</strong>.</p>
       <p>Last error: <code>${result.error ?? `HTTP ${result.status}`}</code></p>
       <p style="color:#64748b;font-size:12px">You'll get a follow-up email automatically when it recovers.</p>`,
    )
  } else if (result.ok && wasDown) {
    // Transition: DOWN -> UP
    const downSince = state?.since ? new Date(state.since) : null
    const mins = downSince ? Math.round((now.getTime() - downSince.getTime()) / 60000) : null
    await supabase.from("uptime_state").update({
      is_down: false, since: null, last_alert_at: now.toISOString(),
    }).eq("id", 1)
    emailed = await sendEmail(
      "RESOLVED: KJST portal is back up",
      `<h2 style="color:#047857;margin:0 0 8px">The KJST portal has recovered</h2>
       <p>It is responding normally again as of <strong>${fmt(now)}</strong>${mins != null ? ` (down for about ${mins} minute${mins === 1 ? "" : "s"})` : ""}.</p>`,
    )
  }

  return json({ ok: result.ok, status: result.status ?? null, latency_ms: result.latency_ms, transition_emailed: emailed })
})
