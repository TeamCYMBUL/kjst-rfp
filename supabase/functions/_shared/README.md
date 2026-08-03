# Edge function notes

`sendResend()` (defined inline in send-invitation and send-reminders) retries a
Resend send ONLY on HTTP 429 (rate limited = the email was never accepted), so
there is no double-send risk. It honors the `Retry-After` header, otherwise uses
capped exponential backoff with jitter (max ~2s, up to 4 attempts). Any non-429
status returns immediately, so success and real errors behave exactly as before.

This exists because the staff "Send email" bulk action can dispatch many sends
close together; combined with the frontend concurrency pool it keeps mass
proposal sends under Resend's per-second rate limit during launch bursts.
