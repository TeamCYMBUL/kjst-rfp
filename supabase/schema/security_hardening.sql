-- Security baseline hardening (applied via MCP; kept here for review).
-- See security/SECURITY_BASELINE.md for the full standard.

-- Least privilege: revoke EXECUTE from client roles on SECURITY DEFINER functions
-- that only the service role (edge functions) or a SECURITY DEFINER trigger uses.
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function public.snapshot_concession_items_for_trip(uuid) from public, anon, authenticated;

-- Make the service-role-only intent on rate_limits explicit (and clear the
-- "RLS enabled, no policy" advisor). Deny all client access; the rate limiter
-- writes via the service role, which bypasses RLS.
drop policy if exists rate_limits_service_role_only on public.rate_limits;
create policy rate_limits_service_role_only on public.rate_limits
  for all to public using (false) with check (false);

-- NOTE (accepted by design): the RLS helper functions (current_org_id, is_admin,
-- is_assigned_to_client, is_timeline_admin, is_viewer) keep EXECUTE for
-- authenticated because RLS policies call them. get_lifecycle_metrics/timeline
-- and monitoring_scoreboard keep it because the app calls them and they gate
-- internally. See the register in SECURITY_BASELINE.md.
