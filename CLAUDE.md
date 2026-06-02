# CLAUDE.md — KJST RFP Platform

> Project-memory file for Claude Code. Place this in the root of the `kjst-rfp` project folder
> (next to `package.json` and `SPEC.md`). Claude reads it automatically at the start of every session.

## What we're building
The **KJST RFP Platform** for KJ Sports Travel — a hosted web app that replaces a manual, error-prone
Word-document RFP process. KJST sends hotel RFPs on behalf of professional sports teams; hotels bid;
the team reviews all bids side by side. Built for **every KJST client**, not just one team.

The three problems this solves:
1. Manual re-typing of returned bids into Excel (slow, error-prone).
2. Counteroffers getting orphaned on a final comments page, disconnected from their line item.
3. No automatic, live side-by-side comparison of bids.

## Source of truth
**The complete spec is in `@SPEC.md` and must be consulted before building any feature.** If a
requirement is unclear, ask before guessing. If we change how something should work, update SPEC.md
first, then implement to match.

## Stack
- Frontend: React + Vite, Tailwind CSS. Clean, modern, mobile-friendly.
- Backend: Supabase — Postgres database, Supabase Auth (email/password for KJST staff),
  Supabase Storage (PDF receipts), Edge Functions (emails, PDF generation).
- Excel export: SheetJS (xlsx).
- Deploy: Vercel (frontend) + Supabase (hosted DB, managed separately).
- Use the Supabase MCP server to create tables, run migrations, and deploy Edge Functions directly.

## Two user types
1. **KJST staff** — authenticated. Create clients/teams, create trips, invite hotels, view the live
   comparison grid, export to Excel.
2. **Hotels** — unauthenticated, link-only via a unique token at `/rfp/{token}`. They fill one form
   and submit. They never see a dashboard or any other hotel's data.

## NON-NEGOTIABLE GUARDRAIL — data isolation
Confidential hotel pricing must be protected with Supabase Row-Level Security on every table:
- One hotel must NEVER be able to read another hotel's bid.
- Each client's data is isolated from other clients.
- A hotel's link/token grants access to exactly one response and its answers — nothing else.
Stage 8 includes an explicit test proving a hotel token cannot read another token's data or any KJST
staff data. Do not consider the build done until that test passes.

## Build in stages (one at a time — confirm each before moving on)
1. Supabase schema + RLS (all tables in SPEC.md) and seed `concession_items` from the SPEC appendix.
2. KJST staff auth + protected dashboard shell (nav: Clients, Trips, RFPs, Dashboard, Settings).
3. Clients & Trips management (with season defaults that pre-fill new trips).
4. The hotel-facing RFP form at `/rfp/{token}` — Yes/No + percent/qty/currency/text answers, with the
   inline "Reason or counteroffer" box that appears on any "No" (fixes the orphaned-comments problem).
   Save-and-resume; submit writes response + answers; PDF receipt + staff notification.
5. Comparison grid (live, reads from Supabase) + Excel export matching KJST's current sheet layout.
6. Email invitations, submission confirmations, deadline reminders (Edge Functions).
7. Reusable/editable RFP template + per-client term overrides; version it.
8. Polish, empty/loading/error states, mobile, accessibility, and the RLS security test.

## Conventions
- Keep components small and readable; prefer clarity over cleverness (a non-developer maintains this).
- Never hardcode secrets. Supabase URL/anon key come from environment variables (`.env`, and Vercel
  env vars in production). Never commit `.env`.
- Mirror the field names and wording in SPEC.md exactly — especially the concession list (lossless).
- The Excel export columns must match: OPPONENT | ARR DATE | DEP DATE | GAME DATE | HOTEL NAME | RATE |
  TAXES & FEES | TOTAL | COMP SUITES | SUITE UPG | # KINGS/SUITES | TOTAL ROOMS, then concession rows.

## Commands
- `npm run dev` — run locally to preview.
- `npm run build` — production build.
- Supabase changes go through the Supabase MCP (tables, policies, Edge Functions).

## Working style for this repo
- Default to Plan Mode for anything non-trivial; show the plan before writing code.
- After each stage, stop so I can preview in the browser before continuing.
