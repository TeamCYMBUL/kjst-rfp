// Post an alert to a Slack channel via an Incoming Webhook, in addition to email.
// The webhook URL lives in the SLACK_WEBHOOK_URL secret. If it's not set this is a
// no-op, so the monitoring functions are safe to deploy before Slack is configured.
// Best-effort and never throws — a Slack outage must not break monitoring/email.
//
// Setup (one time): in Slack, create an app -> Incoming Webhooks -> add a webhook to
// the channel you want -> copy the https://hooks.slack.com/services/... URL, then
//   supabase secrets set SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
// Returns a small status so a test endpoint can confirm delivery. Callers that
// don't care can ignore it. Never throws.
export async function notifySlack(text: string, opts?: { emoji?: string }): Promise<{ sent: boolean; status?: number; reason?: string }> {
  try {
    const url = Deno.env.get('SLACK_WEBHOOK_URL')
    if (!url) return { sent: false, reason: 'no_webhook_url' }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${opts?.emoji ? opts.emoji + ' ' : ''}${text}` }),
        signal: ac.signal,
      })
      return { sent: res.ok, status: res.status, reason: res.ok ? undefined : (await res.text()).slice(0, 200) }
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    return { sent: false, reason: String((e as Error)?.message ?? e).slice(0, 200) }
  }
}
