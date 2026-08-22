// Public error-logging endpoint. The web app posts client-side errors here
// (React error boundary, window errors, unhandled promise rejections); edge
// functions can post server errors with kind:"server". Deployed verify_jwt=false
// because unauthenticated hotel users on the public RFP form must be able to
// report errors too. Writes go in via the service role; fields are capped so a
// misbehaving or malicious client can't bloat the table.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const KINDS = new Set(["react-boundary", "window-error", "unhandled-rejection", "server"])
const cap = (v: unknown, n: number): string | null => {
  if (v == null) return null
  const s = String(v)
  return s.length > n ? s.slice(0, n) : s
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  // Reject oversized bodies outright (a stack trace should never be this big).
  const len = Number(req.headers.get("content-length") ?? "0")
  if (len > 64_000) return json({ error: "too large" }, 413)

  let body: any
  try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }

  const kind = KINDS.has(body?.kind) ? body.kind : "window-error"
  const message = cap(body?.message, 2000)
  if (!message) return json({ ok: true, skipped: "empty" }) // nothing useful to store

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { error } = await supabase.from("error_logs").insert({
    kind,
    message,
    stack: cap(body?.stack, 8000),
    component_stack: cap(body?.component_stack, 8000),
    url: cap(body?.url, 500),
    user_agent: cap(req.headers.get("user-agent") ?? body?.user_agent, 500),
    app_version: cap(body?.app_version, 100),
    context: body?.context && typeof body.context === "object" ? body.context : null,
  })

  // Never surface a logging failure to the client app — it must not cascade.
  if (error) return json({ ok: false }, 200)
  return json({ ok: true })
})
