# CYMBUL Backend Security Baseline

The security standard for every CYMBUL product. KJST is the reference build; a new
product copies these patterns (and the `cymbul-app-starter`) rather than
re-deciding security. Measured against two yardsticks:

- **CVSS** — no open Critical/High vulnerability + a process to score and fix new ones.
- **NIST CSF** — controls mapped across Identify, Protect, Detect, Respond, Recover.

Aligned to SOC 2 Trust Services and ISO 27001 Annex A so it reads as a real
program, right-sized: at a small scale many controls are a one-page policy or
"N/A until we hire," and that is a legitimate, defensible posture.

**Status legend:** `IN PLACE` implemented & verified · `PARTIAL` partly done ·
`DOC` a short policy/decision (little to build) · `PLANNED` open · `PAID` needs
spend · `N/A` right-sized out at current scale.

---

## Control matrix

### 1. Governance & risk
| Control | Status | Note |
|---|---|---|
| Security baseline standard | IN PLACE | This document |
| Named security owner | DOC | CYMBUL principal; state it in writing |
| Asset & data inventory | IN PLACE | Schema snapshot + subprocessor list; refresh on change |
| Data classification | DOC | Athlete-travel (safety) + trade-secret pricing identified |
| Annual risk assessment | PLANNED | One-page risk register |
| InfoSec / acceptable-use policy set | PLANNED | Policy pack |
| Vendor / subprocessor management + DPAs | PARTIAL | Subprocessor list live (/trust); accept + file the DPAs |

### 2. Access & identity
| Control | Status | Note |
|---|---|---|
| RBAC / least privilege | IN PLACE | Roles + per-org scoping; least-privilege DB functions |
| MFA available for staff | IN PLACE | Opt-in TOTP in Settings |
| MFA enforced | PLANNED | Flip only after staff enroll (avoid lockout) |
| Unique accounts, no shared logins | DOC | Standard practice |
| Strong password policy | PARTIAL | Min length set; leaked-password check = dashboard toggle |
| Session management | PARTIAL | Supabase defaults; tighter timeout via Pro |
| Access reviews (periodic) | PLANNED | Quarterly review of who has access |
| Offboarding / deprovisioning | PLANNED | Checklist + revoke on staff exit |

### 3. Data protection
| Control | Status | Note |
|---|---|---|
| Tenant isolation (RLS) | IN PLACE | RLS on all tables; cross-tenant test in CI |
| Encryption in transit | IN PLACE | TLS 1.2+ |
| Encryption at rest | IN PLACE | AES-256 (infra) |
| Secrets management | IN PLACE | Env only; no keys in bundle; scanned |
| Log retention | IN PLACE | error 180d, activity + audit 2y |
| Client-data deletion on termination | IN PLACE | Delete path + documented in /trust |
| Backups + tested restore | IN PLACE | Nightly; restore drilled |
| Point-in-time recovery | PAID | Optional; seconds-level RPO |
| Regulated-data handling | DOC | AUP forbids PHI/PCI/biometric/children without agreement |

### 4. Application security
| Control | Status | Note |
|---|---|---|
| Secure SDLC / change control | IN PLACE | Migrations + schema in source control, PR-based |
| Dependency management | IN PLACE | Dependabot (weekly) |
| Secret scanning | IN PLACE | gitleaks in CI (pre-commit hook = nice-to-have) |
| Vulnerability scanning | IN PLACE | Supabase advisor + npm audit |
| SBOM | IN PLACE | CycloneDX generated in CI |
| Security testing | IN PLACE | Cross-tenant + backend-security tests in CI |
| Rate limiting / abuse protection | IN PLACE | Per-IP on public endpoints |
| Input validation | IN PLACE | Form + edge-function validation |
| Security headers / CSP | IN PLACE | CSP, HSTS, nosniff, frame-deny, referrer, permissions |

### 5. Infrastructure & network
| Control | Status | Note |
|---|---|---|
| Environment separation (prod/preview) | IN PLACE | Separate deploys |
| Hardened config / no public secrets | IN PLACE | Verified clean bundle |
| WAF / DDoS | PARTIAL | Vercel free WAF available; enable in dashboard |
| Deployment protection | PLANNED | Vercel toggle for preview URLs |
| Infra event logging | PARTIAL | Vercel + Supabase logs (short retention on lower tiers) |

### 6. Logging & monitoring
| Control | Status | Note |
|---|---|---|
| Uptime monitoring | IN PLACE | Every 2 min |
| Error logging + digest | IN PLACE | Daily grouped email |
| Audit trail (who did what) | IN PLACE | DB-trigger audit_log; admin-read |
| Alerting | IN PLACE | Down/recovery + daily heartbeat |
| Log retention | IN PLACE | See Data protection |

### 7. Incident response & resilience
| Control | Status | Note |
|---|---|---|
| Incident response plan | IN PLACE | One-page runbook |
| Status page / comms | IN PLACE | Internal /status + public /trust |
| Breach-notification process | PLANNED | Per-state quick-reference + template |
| Tabletop exercise | PLANNED | One 30-minute run |
| Business continuity / DR | PARTIAL | Backups + restore drill; document RTO/RPO |

### 8. Compliance & legal
| Control | Status | Note |
|---|---|---|
| Claims substantiation | IN PLACE | Substantiation record per marketing/AI claim |
| Trust Center | IN PLACE | Public /trust |
| Terms + liability cap | DOC | Drafted; needs signing |
| Privacy policy matching practice | PLANNED | Rewrite to reality |
| DPAs / subprocessor list | PARTIAL | List live; accept + file vendor DPAs |
| Applicable-law tracking | PLANNED | State-privacy thresholds monitor |
| SOC 2 | N/A | Defer until a deal is blocked on it; inherit infra SOC 2 |

### 9. People / operational
| Control | Status | Note |
|---|---|---|
| Security awareness | PLANNED | One-pager; formalizes on hire |
| Confidentiality agreements | PLANNED | Template for contractors/staff |
| Background checks | N/A | Hiring-dependent |

---

## NIST CSF mapping
- **Identify** — asset/data inventory, data classification, subprocessor list, risk register (planned).
- **Protect** — RLS, encryption, RBAC + MFA, secrets mgmt, rate limiting, security headers, AUP.
- **Detect** — uptime, error logging, audit trail, alerting, advisor/scans.
- **Respond** — IR plan, breach-notification process (planned), tabletop (planned), status/trust pages.
- **Recover** — nightly backups + tested restore, documented RTO/RPO (planned), optional PITR.

## Vulnerability (CVSS) process
1. Run the security advisor (Supabase MCP `get_advisors`, or the dashboard).
2. Critical/High fixed before launch; Medium/Low fixed or logged.
3. Re-run after any schema/DDL change.
4. Record the run (date, findings, accepted items) on the product scorecard.

## Accepted-by-design advisor findings (register)
- `authenticated` may execute the RLS helper functions (`current_org_id`,
  `is_admin`, `is_assigned_to_client`, `is_timeline_admin`, `is_viewer`) — required;
  RLS policies call them.
- `authenticated` may execute `get_lifecycle_metrics` / `get_lifecycle_timeline` /
  `monitoring_scoreboard` — app-called; each gates internally.
- `mark_proposal_sent` — writes only an org-scoped activity row.
- `pg_net` in the public schema — Supabase default (cron).
Anything a signed-in user does not need has had `EXECUTE` revoked.

## Per-product launch checklist
- [ ] Domains 2-6 core controls IN PLACE (isolation + test, tokens, headers, scanning, monitoring, backups)
- [ ] Advisor 0 Critical/High; remaining WARNs fixed or in the register
- [ ] Cross-tenant isolation test passing in CI
- [ ] Backup taken + one restore tested
- [ ] Signed agreement with liability cap + data-responsibility (Compliance domain)
- [ ] Privacy policy + Trust Center published; DPAs filed
- [ ] Claims substantiation on file for any published number/AI claim
- [ ] NIST CSF mapping filled; scorecard stamped (date, findings, coverage)

## Verify quickly
```bash
npm run build && grep -rE "sb_secret|re_|sk-ant" dist/ || echo "clean"
npx vitest run src/lib/rls-isolation.test.ts src/lib/backend-security.test.ts
curl -s https://rfp.kjsportstravel.com/version.json
```
Advisor: Supabase MCP `get_advisors` (type: security) or Dashboard → Advisors.
