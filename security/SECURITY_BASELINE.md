# CYMBUL Backend Security Baseline

The standard every CYMBUL product must meet before a client's data lands in it.
KJST is the reference implementation: this file describes what KJST actually
does, so a new product inherits the same posture by copying these patterns (and
the `cymbul-app-starter`) rather than re-deciding security each time.

It is written to two yardsticks:
- **CVSS** — no open Critical or High vulnerability, and a process to score and
  fix new ones. (CVSS rates individual vulns; it is not a certification.)
- **NIST CSF** — controls mapped across the five functions: Identify, Protect,
  Detect, Respond, Recover. (A framework you map to, not a pass/fail exam.)

---

## 1. The baseline controls (must-have on every product)

| # | Control | How KJST does it |
|---|---------|------------------|
| 1 | **Tenant isolation** | Row-Level Security on every table; each tenant table scoped `organization_id = current_org_id()`, children scoped by joining up to it. No `using(true)` on tenant data. |
| 2 | **Isolation is tested, not assumed** | `src/lib/rls-isolation.test.ts` + `backend-security.test.ts` prove one token/tenant cannot read another, run in CI. |
| 3 | **Strong capability tokens** | Public links are 24 CSPRNG bytes (192-bit), url-safe, unique (`generateToken`), **rate-limited** and **expiring** (`expires_at`). |
| 4 | **No secrets in the client** | Only the publishable key ships; `.env` gitignored; grep the build (`sb_secret|re_|sk-ant`) before deploy. Service-role key lives only in edge-function secrets. |
| 5 | **Schema + RLS in source control** | `supabase/schema/` snapshot — reviewable, diffable, showable to a reviewer. |
| 6 | **Advisor to intentional-only** | Run the Supabase security advisor; 0 Critical/High; every remaining WARN either fixed or listed in Section 4. |
| 7 | **Backups + restore drill** | Nightly backup workflow; restore tested at least once. |
| 8 | **Monitoring** | Uptime check (every 2 min), client-error logging + daily digest, daily health heartbeat, `/status` page. |
| 9 | **Incident response** | One-page IR plan (rotate service key, revoke sessions, Attack Mode, take down) kept where on-call can find it. |
| 10 | **Least-privilege functions** | `SECURITY DEFINER` only where required; `EXECUTE` revoked from `authenticated`/`anon`/`public` on any function only the service role or a trigger uses. |
| 11 | **Public edge endpoints gated** | `verify_jwt=false` public functions are token-gated, rate-limited, and fail-open on the limiter. Staff-only actions verify a real staff session, never a trusted request flag. |
| 12 | **Leaked-password protection ON** | Supabase Auth → enable HaveIBeenPwned check. (Dashboard toggle; may require Pro.) |

---

## 2. NIST CSF mapping

- **Identify** — schema + RLS in source control; data classified (e.g., KJST holds
  athlete-travel + trade-secret pricing); vendor/subprocessor list + DPAs on file.
- **Protect** — controls 1, 3, 4, 10, 11, 12 above; encryption in transit/at rest
  (infra); staff MFA; role + org access gates.
- **Detect** — control 8 (uptime, errors, heartbeat) + regular advisor runs.
- **Respond** — control 9 (IR plan); know the breach-notification obligations for
  the states your users live in; run one 30-minute tabletop.
- **Recover** — control 7 (backups + tested restore); documented RTO/RPO; PITR if
  the data warrants seconds-level recovery.

---

## 3. Vulnerability (CVSS) process

1. Run the security advisor (Supabase MCP `get_advisors`, or the dashboard).
2. Any **Critical/High** is fixed before launch. **Medium/Low** is fixed or logged.
3. Re-run after any schema/DDL change (new tables/functions can reopen RLS gaps).
4. Record the run (date, findings, what was accepted) on the product's scorecard.

---

## 4. Accepted-by-design advisor findings (register)

These WARN-level items are understood and intentionally accepted on KJST. A future
audit should recognize them as decisions, not gaps:

- **`authenticated` can execute the RLS helper functions** (`current_org_id`,
  `is_admin`, `is_assigned_to_client`, `is_timeline_admin`, `is_viewer`) — required:
  RLS policies call these, so the querying role must be able to execute them.
  This is Supabase's recommended RLS pattern.
- **`authenticated` can execute `get_lifecycle_metrics` / `get_lifecycle_timeline`
  / `monitoring_scoreboard`** — called by the app; each gates internally
  (timeline-admin or owner-email check) and returns nothing to anyone else.
- **`mark_proposal_sent`** — writes only an org-scoped activity-log row for the
  caller; negligible impact.
- **`pg_net` in the public schema** — Supabase default; used by cron.

Everything a signed-in user does NOT need (`check_rate_limit`,
`snapshot_concession_items_for_trip`) has had `EXECUTE` revoked.

---

## 5. Per-product launch: run this every time

- [ ] Controls 1-11 in place (10 & 11 = least privilege + gated endpoints)
- [ ] Advisor at 0 Critical/High; remaining WARNs fixed or added to this register
- [ ] Cross-tenant isolation test passing in CI
- [ ] Backup taken and a restore tested once
- [ ] Monitoring live (uptime + errors + heartbeat)
- [ ] IR plan written; leaked-password protection enabled (control 12)
- [ ] NIST CSF mapping filled for the product
- [ ] Security scorecard stamped and filed (date, findings, coverage)

---

## 6. Verify quickly

```bash
# secrets not in the shipped bundle
npm run build && grep -rE "sb_secret|re_|sk-ant" dist/ || echo "clean"
# isolation + backend security tests
npx vitest run src/lib/rls-isolation.test.ts src/lib/backend-security.test.ts
# live commit check
curl -s https://rfp.kjsportstravel.com/version.json
```

Advisor: Supabase MCP `get_advisors` (type: security) or Dashboard → Advisors.
