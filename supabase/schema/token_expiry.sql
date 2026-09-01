-- Track A #3: invite links expire (applied via MCP; kept here for review).
-- 180-day window is far longer than any RFP cycle, so no active/reopened link
-- breaks. New links get it via the default; existing links were set to now()+180d
-- by ADD COLUMN. Enforced in rfp-get / rfp-respond / rfp-decline alongside the
-- revoked_at check (403 "This link has expired"). Nullable => a link can be made
-- permanent by setting expires_at = null.

alter table public.rfp_invitations
  add column if not exists expires_at timestamptz default (now() + interval '180 days');
