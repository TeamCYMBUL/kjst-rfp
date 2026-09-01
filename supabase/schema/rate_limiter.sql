-- Rate limiter for the public token-gated edge functions (Track A #1).
-- Applied to the live DB via the Supabase MCP; kept here for review/reproducibility.
-- The edge helper is supabase/functions/_shared/rateLimit.ts.

create table if not exists public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limits enable row level security;
-- No policies: only the service role (edge functions) touches it, via the function below.

create or replace function public.check_rate_limit(p_bucket text, p_max int, p_window_secs int)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  w timestamptz;
  c int;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);
  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, w, 1)
  on conflict (bucket, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into c;
  return c <= p_max;  -- true = under the limit (allow), false = over (reject)
end;
$$;

revoke all on function public.check_rate_limit(text,int,int) from public;
revoke all on function public.check_rate_limit(text,int,int) from anon;
grant execute on function public.check_rate_limit(text,int,int) to service_role;

-- Per-endpoint limits (requests / 60s / IP), set generously so a real hotel is never hit:
--   rfp-get 120 · rfp-respond 180 · rfp-prefill 60 · rfp-decline 30
--   contract-get 60 · contract-upload 30 · log-error 90

-- Housekeeping: windows are seconds long, so 2h retention is plenty.
-- select cron.schedule('prune-rate-limits', '20 4 * * *',
--   $prune$ delete from public.rate_limits where window_start < now() - interval '2 hours'; $prune$);
