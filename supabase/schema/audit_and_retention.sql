-- Audit trail + log retention (applied via MCP; kept here for review).

-- Append-only audit log of security-sensitive changes, captured by DB triggers
-- (no app changes, can't be bypassed). The trigger swallows its own errors, so
-- auditing can never break the underlying operation. Read: timeline admins only;
-- no insert policy (only the SECURITY DEFINER trigger writes it).
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid, actor_email text,
  table_name text not null, op text not null, row_id uuid, detail jsonb
);
alter table public.audit_log enable row level security;
create policy audit_log_admin_read on public.audit_log for select to authenticated using (is_timeline_admin());
-- audit_capture(): AFTER trigger fn (see migration audit_log). Logs rfp_invitations
--   status/award/revoke/reopen changes + deletes, and trips/clients deletes.
-- Triggers: audit_rfp_invitations (update/delete), audit_trips_delete, audit_clients_delete.

-- Retention (cron 'prune-logs', daily 4:30 UTC): error logs 180d, activity + audit 2y.
-- select cron.schedule('prune-logs','30 4 * * *', $$
--   delete from public.error_logs where created_at < now() - interval '180 days';
--   delete from public.activity_events where at < now() - interval '2 years';
--   delete from public.audit_log where at < now() - interval '2 years';
-- $$);
