// Post an alert to a Slack channel via an Incoming Webhook, in addition to email.
// The webhook URL lives in the SLACK_WEBHOOK_URL secret. If it's not set this is a
// no-op, so the monitoring functions are safe to deploy before Slack is configured.
// Best-effort and never throws — a Slack outage must not break monitoring/email.
//
// Setup (one time): in Slack, create an app -> Incoming Webhooks -> add a webhook to
// the channel you want -> copy the https://hooks.slack.com/services/... URL, then
//   supabase secrets set SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
export async function notifySlack(text: string, opts?: { emoji?: string }): Promise<void> {
  try {
    const url = Deno.env.get('SLACK_WEBHOOK_URL')
    if (!url) return
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8000)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${opts?.emoji ? opts.emoji + ' ' : ''}${text}` }),
        signal: ac.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Best-effort only.
  }
}
