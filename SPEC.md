# KJST RFP Platform — Lovable Build Script

**What this is:** A complete, paste-ready brief to give Lovable (with Supabase) so it builds the KJ Sports Travel RFP platform correctly the first time. Read the "How to use this" section, then paste the prompt blocks in order.

---

## How to use this document

1. Create a new project in Lovable and **connect Supabase** (Lovable → Settings → Integrations → Supabase). Do this first so the database, auth, and storage are available as it builds.
2. Paste **PROMPT 1** (the master brief) as your very first message. Let it scaffold.
3. Then paste **PROMPTS 2–8** one at a time, in order, reviewing what it builds after each. Building in stages produces far better results than one giant message.
4. The **Appendix** holds the exact, lossless field list pulled from the real Cavaliers RFP — paste it when PROMPT 4 asks for it.

A note on scope: this is built for **every KJST client**, not just the Cavaliers. The Cavaliers RFP is the reference template; the data model below is multi-team and multi-client from day one.

---

## Context to paste at the top of PROMPT 1 — the email that started this

> Include this verbatim so Lovable understands the real-world problem it's solving.

```
CONTEXT — This is the email from the President of KJ Sports Travel (KJST) describing the
current process and the pain we are solving. Build the product to eliminate this pain.

"I hope you're both doing well. I'm excited to start brainstorming together and really begin
building what's next for all of us. There's a lot of opportunity ahead and we're looking forward
to collaborating, exchanging ideas, and continuing to grow the business together. Aaron, looking
ahead to the call with Michael, one of the first areas that comes to mind where we'd really value
your expertise and suggestions is our RFP (Request for Proposal) process. At the moment, we use a
restricted Word document format that only allows hotels to click into certain sections, with many
responses limited to yes/no answers. The hotels then complete the form and send it back to us. If
there are sections they need to renegotiate or additional details they want to include that aren't
covered in the questionnaire, they typically add those notes/comments on the final page, which is
currently the only free space for commentary. Once we receive the completed bids, our team manually
transfers the key information, like rates, dates, suite comps/upgrades, postseason guarantees, and
additional comments into an Excel comparison sheet so the Team can review all offers side by side.
What we'd really love help brainstorming is a more efficient process, particularly when it comes to
capturing and organizing the basic yes/no responses into a grid or comparison format automatically.
Right now, the manual transfer process leaves a lot of room for human error and also requires a
significant amount of time from our team. For reference, I've included a few attachments: the blank
RFP form that was sent to the Atlanta hotels (Unlocked version), the completed response from the
Four Seasons Atlanta, the completed response from the Ritz-Carlton Dallas (since they provided
additional commentary/notes that ended up being important to reflect on the comparison grid), and
the Excel comparison sheet that consolidates all of the hotel offers side by side. Hoping these
examples help provide a clearer picture of the current workflow and where we think there may be
opportunities to improve efficiency and automation. Really looking forward to collaborating
together and excited for everything ahead."

THE THREE PROBLEMS TO SOLVE:
1. Manual transcription of returned bids into Excel — slow and error-prone.
2. Free-text counteroffers get orphaned on a final "comments" page, disconnected from the line
   item they relate to (e.g., the Ritz-Carlton Dallas notes that "ended up being important").
3. No automatic, live side-by-side comparison of all hotel bids for a given trip.
```

---

## PROMPT 1 — Master brief (paste first)

```
Build a web application called the "KJST RFP Platform" for KJ Sports Travel (KJST), a sports
travel agency that sends hotel RFPs (Requests for Proposal) on behalf of professional sports
teams and negotiates group room blocks for team road trips.

[PASTE THE CONTEXT EMAIL BLOCK FROM ABOVE HERE]

GOAL
Replace a manual, error-prone Word-document RFP process with a hosted web platform where:
- KJST staff create and send personalized RFP links to hotels.
- Hotels fill out a clean, guided web form (no software, no login required for hotels).
- Every response flows automatically into a structured database.
- KJST sees a live side-by-side comparison grid of all bids per trip and exports it to Excel.

TECH STACK
- Frontend: React + Tailwind, clean and modern, mobile-friendly.
- Backend/Database: Supabase (PostgreSQL), Supabase Auth for KJST staff, Supabase Storage for
  any uploaded files/PDF receipts, Supabase Edge Functions for emails and PDF generation.
- Use Supabase Row-Level Security (RLS) on every table. Confidential hotel pricing must be
  protected: one hotel must NEVER be able to see another hotel's bid, and client data must be
  isolated per client.

TWO TYPES OF USERS
1. KJST staff (authenticated): create clients/teams, create trips, generate per-hotel RFP links,
   monitor responses, view the comparison grid, export to Excel.
2. Hotels (unauthenticated, link-only): open their unique link, fill the RFP, submit. They never
   see a dashboard or any other hotel's data. The link is their access token.

BUILD THIS IN STAGES. For now, just scaffold the project, connect Supabase, set up Supabase Auth
(email/password) for KJST staff with a login page and a protected dashboard shell with a left nav:
Clients, Trips, RFPs, Dashboard, Settings. Confirm Supabase is connected and the auth flow works
before we add the data model. Do not build the forms yet — we will define the schema next.
```

---

## PROMPT 2 — Data model (paste second)

```
Now create the Supabase database schema. Use these tables and relationships. Enable RLS on all
of them. KJST staff can read/write rows belonging to their organization; hotels can only
read/write the single rfp_response row tied to their unique invite token.

TABLES

organizations
- id (uuid, pk)
- name (text)            // "KJ Sports Travel"
- iata_number (text)     // e.g. "05732731"
- created_at (timestamptz, default now())

users (extends Supabase auth.users via a profiles table)
- id (uuid, pk, = auth uid)
- organization_id (uuid, fk -> organizations)
- full_name (text)
- email (text)
- role (text: 'admin' | 'manager')

clients   // the sports teams KJST represents — built for EVERY client, not just one
- id (uuid, pk)
- organization_id (uuid, fk)
- team_name (text)               // "Cleveland Cavaliers"
- legal_entity (text)            // "Cavaliers Operating Company, LLC."
- league (text)                  // "NBA"
- primary_contact_name (text)    // "Mark Cashman"
- primary_contact_title (text)   // "Director of Team Operations"
- primary_contact_address (text)
- primary_contact_phone (text)
- primary_contact_email (text)
- season (text)                  // "2025-2026"
- default_terms (jsonb)          // season defaults: commission %, attrition %, guarantees, etc.
- created_at (timestamptz)

trips   // one road-trip / city stay an RFP is being run for
- id (uuid, pk)
- client_id (uuid, fk)
- city (text)                    // "Atlanta"
- opponent_label (text)          // "Atlanta #1"
- arrival_date (date)
- departure_date (date)
- nights (int)
- game_date (date)
- game_time (text)               // "7:30pm"
- king_rooms_requested (int)     // 62
- suites_requested (int)         // 10
- total_rooms_requested (int)    // 72
- in_season_tournament_window (text)  // "December 8-16, 2025" (nullable)
- postseason_window (text)            // "April 13, 2026 - May 31, 2026" (nullable)
- postseason_rooms_text (text)        // "75 rooms (10 Suites & 65 King Rooms)..."
- status (text: 'draft' | 'sent' | 'collecting' | 'closed')
- response_deadline (date)
- created_at (timestamptz)

rfp_invitations   // one per hotel invited to bid on a trip
- id (uuid, pk)
- trip_id (uuid, fk)
- hotel_name (text)              // "Four Seasons Atlanta"
- hotel_contact_name (text)
- hotel_contact_email (text)
- token (text, unique)           // random, used in the hotel's URL
- status (text: 'sent' | 'opened' | 'submitted' | 'declined')
- sent_at (timestamptz)
- opened_at (timestamptz)
- submitted_at (timestamptz)

rfp_responses   // the hotel's submitted bid (1:1 with an invitation)
- id (uuid, pk)
- invitation_id (uuid, fk, unique)
- completed_by_name (text)       // "Ali DeBerry"
- completed_date (date)
- best_king_rate (numeric)
- king_rate_notes (text)         // supports multiple stays, e.g. "$299 (Stay #1), $450 (Stay #2)"
- current_selling_rate (text)
- best_suite_rate (numeric)
- occupancy_tax (text)           // "16.9% + $5 per night hotel tax"
- meeting_space_notes (text)     // names + sq ft of meeting rooms offered
- general_comments (text)
- guarantees_in_season_tournament (boolean)
- guarantees_postseason (boolean)
- distance_to_arena (text)
- standard_checkin_time (text)
- baggage_fee_per_bag (numeric)
- room_service_24h (boolean)
- room_service_hours (text)
- created_at (timestamptz)

concession_items   // the master list of RFP line items (the ~50 questions). Seeded once,
                   // reusable across trips. Each trip's RFP renders these in order.
- id (uuid, pk)
- organization_id (uuid, fk)
- sort_order (int)
- section (text: 'rates' | 'concessions' | 'facilities' | 'in_season_tournament' | 'postseason')
- label (text)                   // full question text
- answer_type (text: 'yes_no' | 'percent' | 'quantity' | 'currency' | 'text')
- requested_value (text)         // what KJST is asking for, e.g. "10%", "QTY: per request"
- allow_comment (boolean, default true)

concession_answers   // a hotel's answer to one concession_item on one response
- id (uuid, pk)
- response_id (uuid, fk)
- concession_item_id (uuid, fk)
- answer_yes_no (boolean)        // for yes_no items
- answer_value (text)            // for percent/quantity/currency/text items
- comment (text)                 // the counteroffer / reason, attached to THIS line item
- created_at (timestamptz)

KEY RLS RULES
- KJST staff: full access to rows whose organization_id matches their profile's organization_id
  (directly or via the fk chain client -> trip -> invitation -> response -> answers).
- Hotels (anon): a Supabase Edge Function (or RLS policy keyed on the token passed in the URL)
  allows reading the trip + invitation + concession_items for their token, and inserting/updating
  exactly one rfp_response and its concession_answers. No access to any other token's data.
```

---

## PROMPT 3 — KJST staff: clients & trips (paste third)

```
Build the authenticated KJST staff side.

CLIENTS PAGE
- List all clients (teams) for the org with team_name, league, season, # of active trips.
- "Add Client" form capturing every clients field above, including a "Default Terms" section
  (commission %, attrition %, standard guarantee language) saved to default_terms jsonb so they
  auto-fill future trips.
- Edit client.

TRIPS PAGE (per client)
- List trips for a client: city, opponent_label, dates, status, # invited, # responded.
- "New Trip" form: city, opponent_label, arrival/departure dates (auto-calc nights), game date/time,
  king/suite/total rooms requested, in-season tournament window, postseason window + rooms text,
  response_deadline. Pre-fill from the client's default_terms wherever possible so the user usually
  only edits city, opponent, dates, and room counts.
- Trip detail page shows: trip summary, the list of invited hotels with their status badges
  (sent / opened / submitted / declined), and buttons to "Invite Hotel" and "View Comparison Grid".

INVITE HOTEL
- Form: hotel_name, hotel_contact_name, hotel_contact_email.
- On save, generate a unique random token and a shareable URL of the form
  /rfp/{token}. Show a "Copy link" button and a "Send email" button (email via Supabase Edge
  Function) that emails the hotel a branded invitation containing the link and the deadline.
- One token = one hotel = one bid. Responses auto-tag to the correct hotel and client.
```

---

## PROMPT 4 — The hotel-facing RFP form (paste fourth — the heart of the product)

```
Build the public, unauthenticated hotel RFP form at /rfp/{token}.

LOADING
- Look up the invitation by token. If invalid/expired, show a friendly error.
- On first open, set invitation.status='opened' and opened_at. Show the trip pre-filled and
  read-only at the top so the hotel knows exactly what they're bidding on:
  team name, hotel name (their own), city, the opponent + dates table, room block requested,
  response deadline.

FORM SECTIONS (render in this order)
1. Header confirmation: hotel name & city (pre-filled, editable hotel name only), "RFP completed
   by (name)" and date.
2. Room Block & Dates: show requested king/suite/total and the opponent date rows (read-only).
3. Rates: best available king/double rate(s), current selling rate (for comparison), best suite
   rate, occupancy tax. Allow a free-text note on rates for multi-stay pricing (e.g. different
   rate for Stay #1 vs Stay #2).
4. Concessions & Facilities: render every concession_item in order. Answer control depends on
   answer_type:
   - yes_no  -> a clear Yes/No toggle or dropdown.
   - percent -> number input with % (default shows what KJST requested).
   - quantity-> number input ("QTY").
   - currency-> number input with $.
   - text    -> short text input.
   CRITICAL UX RULE: when a hotel answers "No" (or proposes anything other than exactly what was
   requested), reveal an inline comment box right under that item labeled "Reason or counteroffer".
   This is how we fix the orphaned-comments problem — every counteroffer stays attached to its own
   line item instead of being dumped at the end.
5. In-Season Tournament Guarantee: yes/no guarantee + comment.
6. Postseason / Playoff Guarantee: yes/no guarantee + comment.
7. Meeting space names + sq ft (free text). General comments (free text, optional).

BEHAVIOR
- Save-and-resume: autosave to the same response row so a hotel can leave and come back via the
  same link to finish (important — hotels often need internal sign-off before submitting).
- Validation: required fields (rates, completed_by) must be filled before submit. Yes/No items
  default to unanswered (do not pre-check), so a blank answer is visibly incomplete.
- On Submit: write rfp_response + all concession_answers, set invitation.status='submitted' and
  submitted_at, show a thank-you screen, and (via Edge Function) email the hotel a PDF receipt of
  exactly what they submitted and notify the KJST manager that a bid arrived.
- Branding: clean, professional, KJST logo placeholder, the represented team's name shown clearly.

I will paste the full master list of concession_items to seed (label, section, answer_type,
requested_value, sort_order) in the next message — use it exactly, preserving wording and order.
```

> After Lovable acknowledges PROMPT 4, paste the **Appendix concession seed list** below as your next message.

---

## PROMPT 5 — The comparison grid / dashboard (paste fifth)

```
Build the "Comparison Grid" for a trip — this replaces the manual Excel transfer.

LAYOUT
- One column per hotel that has a response (sorted by best total cost by default).
- Rows, grouped by section:
  * Economics: best king rate, taxes & fees, total nightly cost, current selling rate, best suite
    rate, occupancy tax, comp suites (qty), suite upgrades (qty), # kings/suites, total rooms.
  * Every concession line item: show Yes/No as a green check / red X; show percent/qty/currency/
    text answers as their value. If the hotel left a comment/counteroffer on that item, show a
    small note icon that expands the comment inline (right next to the item — never separated).
  * In-season tournament guarantee (Yes/No), postseason guarantee (Yes/No).
  * General comments and meeting space notes at the bottom.
- Highlight: cheapest total cost in green; any "No" on a high-priority concession in red; missing
  answers in gray. Add a top summary bar: # hotels invited, # responded, # outstanding, deadline.

LIVE
- The grid reads straight from Supabase and updates as new bids submit (Supabase realtime).

EXPORT
- "Export to Excel" button that produces an .xlsx matching KJST's current sheet layout: columns
  per hotel, grouped rows, with city/opponent/dates header. Use a library like SheetJS. Also offer
  "Export to PDF" of the grid.

PORTFOLIO DASHBOARD (landing page after login)
- Cards: active trips by status, hotels outstanding vs responded across all trips, upcoming
  deadlines, recent submissions feed.
```

---

## PROMPT 6 — Notifications & reminders (paste sixth)

```
Add automated communications via Supabase Edge Functions + scheduled functions:
- Invitation email to a hotel (link + deadline + represented team).
- Submission confirmation: PDF receipt to the hotel, alert to the assigned KJST manager.
- Reminder emails: automatically email hotels whose status is 'sent' or 'opened' (not submitted)
  X days before the deadline, and on the deadline day. Make the cadence configurable per trip.
- After the deadline, mark the trip 'closed' and stop accepting submissions (configurable).
Keep all email copy professional and on-brand; include KJST contact info and IATA number.
```

---

## PROMPT 7 — Templates & multi-client reusability (paste seventh)

```
Make the concession list reusable and editable so this works for every client, not just one:
- A "RFP Template" editor under Settings where KJST admins manage the master concession_items
  (add/edit/reorder/remove line items, set answer_type and requested_value). Changes apply to
  future trips; existing sent RFPs keep the items they were sent with (snapshot per trip).
- Allow per-client overrides of requested values (e.g., a different commission % or guarantee
  language) pulled from client.default_terms.
- Version the template so updating it once means every new RFP uses the latest terms — no stale
  documents floating around.
```

---

## PROMPT 8 — Polish & guardrails (paste last)

```
Final pass:
- Double-check RLS: write a test that confirms one hotel token cannot read another token's
  response or any KJST staff data. This is the most important security property — confidential
  rates must be isolated.
- Empty states, loading states, and clear error messages everywhere.
- Mobile layout for the hotel form (sales managers often fill these on a phone).
- Accessibility: labeled inputs, keyboard navigation, sufficient contrast.
- A short in-app "How it works" for KJST staff: create client -> create trip -> invite hotels ->
  watch the grid fill -> export.
- Seed one demo client (Cleveland Cavaliers) and one demo trip (Atlanta) using the appendix data
  so the team can click through a realistic example immediately.
```

---

## Appendix — Concession seed list (paste when PROMPT 4 asks)

> This is the exact, lossless list pulled from the real Cavaliers RFP. Order and wording preserved. `requested_value` is what KJST asks the hotel to meet.

```
Seed the concession_items table with these rows (sort_order, section, answer_type, requested_value, label):

RATES SECTION (entered in the dedicated Rates fields, not as concession rows):
- Best Available King/Double Rate(s) [currency]  vs. Current Selling Rate [text]
- Best Available Suite Rate(s) [currency]
- Occupancy Tax [text]

CONCESSIONS & FACILITIES (concession_items):
1   concessions  yes_no     —        Flexible cancellation: The Cleveland Cavaliers will not be charged for any cancelled or rescheduled stays relating to NBA cancellations, postponements or rescheduling of games. Hotel agrees to honor room count, concessions, and meeting space from original stay if the game is rescheduled (based on availability).
2   concessions  percent    10%      Commissionable to KJ Sports Travel Inc., IATA#: 05732731
3   concessions  yes_no     —        20% allowable attrition upon completion of program
4   concessions  yes_no     —        Double reward points (if applicable)
5   concessions  yes_no     —        No Walk Clause – No guest within the Team block may be relocated for accommodations
6   concessions  yes_no     —        Complimentary Late Checkout (2 hours prior to game tip-off or 2pm on non-game days)
7   concessions  yes_no     —        Complimentary Internet Access in guest rooms (all tiers, unlimited devices)
8   concessions  yes_no     —        Complimentary Internet Access in meeting rooms
9   concessions  quantity   QTY      Complimentary One Bedroom Suites (950 – 1,000 sq. feet minimum, must have separate living area)
10  concessions  quantity   QTY      One Bedroom Suite Upgrades at the group/King rate (950 – 1,000 sq. feet minimum, must have separate living area)
11  concessions  currency   $100 over group rate   Additional suites at $100.00 over the contracted group rate
12  concessions  yes_no     —        (3) Complimentary Club Level Access Passes (if applicable)
13  concessions  yes_no     —        Hotel agrees to not exceed a 3% increase in F&B over 2024-2025 season's pricing
14  concessions  yes_no     —        (5) Complimentary Welcome Amenities in guestrooms – Team's choice, subject to Hotel approval
15  concessions  yes_no     —        6 ft. Skirted check-in table for Team's major arrival (away from the Front Desk)
16  concessions  yes_no     —        Complimentary Energy/Protein Bars for the traveling party on arrival
17  concessions  yes_no     —        Complimentary Whole Fruit for the traveling party on arrival
18  concessions  yes_no     —        Complimentary Bottled Waters for the traveling party on arrival
19  concessions  yes_no     —        All rooms pre-keyed prior to arrival, each welcome envelope to include a key packet list
20  concessions  yes_no     —        Hotel will honor the Team's specified room placement as noted on the rooming list.
21  concessions  yes_no     —        Complimentary Meeting space (3,000 sq. ft. requested) for meals/meetings, for duration of stay / No restaurants (larger space or additional 1,500 sq. ft. min room may be needed for walkthrough + meal on game day)
22  concessions  yes_no     —        Complimentary Meeting space (800-1,000 sq. ft. requested) for Coaches Meeting Room, for duration of stay
23  concessions  yes_no     —        Complimentary Meeting space (800 sq. ft. requested) for Storage Room, for duration of stay
24  concessions  yes_no     —        Complimentary Meeting space (1,000-1,200 sq. ft. requested) for Massage Room, for duration of stay
25  concessions  yes_no     —        Place the following items in the Team Massage Room (room cannot be on a special-access floor unless all Players & Staff have access): 10 Large Towels, 10 Hand Towels, 10 Face Towels; 4 Flat bed sheets, 4 pillows, 4 blankets; trash can + hand sanitizer
26  concessions  yes_no     —        No F&B Minimum at time of contracting
27  concessions  yes_no     —        Waived Chef's Fee per meal (2-hour shifts)
28  concessions  yes_no     —        (2) Two Complimentary Freestanding 50" Cable Ready TV's for duration of stay
29  concessions  yes_no     —        (2) Two Complimentary White boards or flip charts & Markers, for duration of stay
30  concessions  yes_no     —        Hotel agrees to ensure enough available space for up to (3) buses to be staged upon Team's arrival and departure
31  concessions  yes_no     —        Complimentary Parking Vouchers for (5) vehicles for the duration of stay
32  concessions  currency   up to $150   Complimentary Printing/Photocopy, up to $150.00
33  concessions  yes_no     —        Complimentary access to Fitness Center
34  concessions  yes_no     —        (2) Two Complimentary Rollaway Beds for the duration of the stay (if needed)
35  concessions  yes_no     —        Access to utilize the lobby for grab & go breakfasts, if needed
36  concessions  yes_no     —        KJ Sports Travel will have a dedicated Conference Services or Front Office Manager upon arrival/departure (available via mobile phone)
37  concessions  yes_no     —        Group rate is available (2) days pre and post contracted dates
38  concessions  yes_no     —        Hotel agrees to provide itemized receipts for all incidental charges posted to the master account
39  facilities   yes_no     —        (4) Bellmen to be present upon arrival & departure
40  facilities   currency   —        Baggage handling fees (per bag, each way): Cost $___ each way, per bag
41  facilities   yes_no     —        Are your guest floors key access only?
42  facilities   yes_no     —        If so, can keys be programmed to access all floors if needed?
43  facilities   text       24-hour  Hotel agrees to provide 24-Hour room service. If no, list the room service hours in comments
44  facilities   yes_no     —        Does the hotel have a swimming pool?
45  facilities   text       —        Hotel's distance to arena
46  facilities   text       —        Standard check-in time

IN-SEASON TOURNAMENT GUARANTEE (in_season_tournament):
47  in_season_tournament  yes_no  —  Does the Hotel guarantee In-Season Tournament availability as requested? (Stay dates TBD, between Dec 8-16, 2025. Rates set at contracting; at least 20% off best available rates; additional rooms if available.)

POSTSEASON GUARANTEE (postseason):
48  postseason  yes_no  —  Does the Hotel guarantee Postseason availability? Playoff Guarantee: if the team competes in your city during the NBA Playoffs incl. Play-In (projected Apr 13 – May 31, 2026), guarantee 75 rooms (10 Suites & 65 King Rooms) + (2) separate meeting rooms (2,000 sq. ft. and 1,000 sq. ft. min, no pillars, no restaurants). Rates set at contracting; at least 20% off best available; additional rooms if available.
```

---

## Comparison grid columns (so the Excel export matches KJST's current sheet)

The exported .xlsx should reproduce KJST's existing layout, then add the concession rows underneath:
`OPPONENT | ARR DATE | DEP DATE | GAME DATE | HOTEL NAME | RATE | TAXES & FEES | TOTAL | COMP SUITES | SUITE UPG | # KINGS/SUITES | TOTAL ROOMS` — followed by one row per concession line item with each hotel's answer, and comment/counteroffer notes attached inline.

---

## Quick FAQ for the build call

- **Will hotels need an account?** No. Hotels use a unique link only — lowest possible friction.
- **Can one hotel see another's rates?** No. RLS + per-hotel tokens isolate every bid; this is explicitly tested in PROMPT 8.
- **Does it work for clients beyond the Cavaliers?** Yes — multi-client from day one. The Cavs RFP is just the seed template; the concession list is editable per organization and overridable per client.
- **What about the orphaned-comments problem?** Solved by the inline "Reason or counteroffer" box that appears under any item a hotel can't fully meet, so every note stays attached to its line item.
- **Rough running cost?** Budget ~$50/month+ once live (Lovable plan + Supabase paid tier), more while actively iterating.
```
