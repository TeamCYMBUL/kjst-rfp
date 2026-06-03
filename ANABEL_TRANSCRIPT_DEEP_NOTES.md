# Anabel Transcript — Deep Operational Notes
*Every granular detail extracted for building the RFP system correctly*

---

## 1. THE RFP FORM — How It Works Today

- **Format:** Locked Word document. Hotels can only fill in specific fields.
- **Response type:** Yes/No on almost everything.
- **Only 2 numeric fields:** (1) Commission % and (2) Suite concessions quantity.
- **Comments:** One "blast page" at the END of the doc — the only place for comments. Hotels are abusing this now, writing paragraphs instead of yes/no. Some hotels stopped selecting yes/no entirely.
- **Result:** A returned RFP is now 5–6 pages that has to be read entirely.
- **After receipt:** Manually transfer all data into an Excel grid. This is where errors happen.
- **Confidentiality:** Teams can't know which other teams' RFPs were sent. Competitor Pivot is literally using KJST's Word doc (a hotel sales manager unlocked it for them).

---

## 2. THE GRID SENT TO TEAMS — Exact Columns

**This is NOT all the yes/no answers. It is a very simple version.**

| Column | Notes |
|---|---|
| City | |
| Check-in date | |
| Check-out date | |
| Standard KING rate only | Not suite rate, not double rate — king only |
| Tax for that city | |
| # Comp suites (FREE) | |
| # Suite upgrades at king rate | Zero if ANY extra charge, even $1 |
| Playoff clause | Yes/No |
| Notes | ONLY exceptions — things that would alarm the team or cost money |

**What is NOT on the team grid:**
- Commission % (internal — KJST's money, not the team's concern)
- Flexible cancellation (KJST's concern, not team's)
- Meeting space details (unless there's a PROBLEM)
- All the other yes/no concession answers

**When a note IS added to the grid:**
- "No traditional meeting space — restaurant only"
- "Only 30 queens available, no kings"
- "Not available for second stay"
- Anything that would make them say "we can't stay here"

**What is NEVER added to notes unless it's an exception:**
- Meeting space (if they have it, nothing is said — only mentioned if it's a problem)
- Meals
- Receipts
- Satellite check-in

---

## 3. PRIORITY ORDER OF THE RFP (Anabel stated explicitly)

The Word document is already ordered top-down by importance. The system should reflect this exact order:

### **#1 — Flexible Cancellation Policy**
- Absolute #1. Non-negotiable since COVID.
- Hotels tried to charge despite force majeure clauses during COVID shutdown.
- If the answer is NO → flag immediately, red alert.
- This is a KJST dealbreaker, not just a team dealbreaker.

### **#2 — Commission %**
- If hotel pays zero commission → KJST will not even show them to the team. They're marked "unavailable."
- "We're just going to tell them you're not available."
- This is purely KJST's livelihood — the team never sees this.

### **#3 — Meeting Space**
- Falls in the "middle" of the RFP because it's detailed — varies by team.
- **MUST be traditional function room. No exceptions.**
  - ❌ Restaurant = NO
  - ❌ Suite with bed removed = NO (not enough space)
  - ✅ Empty ballroom or function room with no F&B requirement
- Teams use it for: massage tables, inflatable recovery tubs, trainer setup.
- Some teams need 1, some need 2, some need 3 spaces.
- Some need a suite PLUS a function room.
- If no traditional meeting space: hotel is listed on grid with red note, won't be selected.
- Before season: KJST emails each team "last year you had X rooms and Y meeting spaces — do you need the same?"

### **#4 — Suite Concessions (TWO separate line items)**

**4a. Comp suites (completely free)**
- Number of suites given at $0 additional cost.

**4b. Suite upgrades at king rate**
- Suites available at the same rate as a standard king room.
- **ZERO means ZERO.** Even $1 above king rate = zero suite upgrades. Even "$50 more, it's our best suite" = zero.
- "They'll say it's only $100 more, that's still a no."
- Anything requiring payroll deduction needs an explanation note.

**Why this matters (Cavaliers example):**
- Cavs need 6–7 suites per stay.
- Chain of command for who can pay overages: head coach (must be free or group rate), athletic trainer (must be free or group rate), GM + star players (have approval to pay overage), Mark (no approval for ANY overage).
- If only 1 comp + 1 upgrade: Anabel calls hotel and fights for a 2nd upgrade specifically so Mark isn't stuck.
- The travel manager's contact (Mark) doesn't know any of this — Anabel silently manages it when sending rooming lists.
- Suite payroll deduction scandal: one team's contact was letting suite costs run through invoice instead of player payroll, likely pocketing money. Teams now being educated that suites above group rate = payroll deduction.

### **#5 — Playoff Clause**
- Not every team or every city needs it.
- Budget-conscious teams: "When we get there, that's your problem." Don't care about postseason.
- Playoff-focused teams (like Cavs): will stay at a MORE expensive hotel just to get a playoff clause.
- Cavaliers had 3 different hotels in NYC this year: Four Seasons (vs. Knicks), Ritz-Carlton, Pendry — each for playoff scenario in different borough.
- Nobody needs a playoff clause for Brooklyn (Nets).
- Can vary by opponent within the same city.

### **#6 — Everything Else (Secondary)**
- Meals
- Satellite check-in table
- Itemized receipts (hotels are now pushing back, asking to only provide if disputed — KJST says no)
- Pre/post game meals
- "Some items are important for the team, some are really just important for us."
- These are on every RFP for EVERY team even if a team doesn't need it — so hotels can't ask "why does the Cavs have this but not you?"

---

## 4. STAY SCENARIOS — Critical Multi-Night Logic

**The RFP must handle multiple stay scenarios:**
- When the game schedule releases (mid-August), head coaches haven't decided travel dates yet (takes ~1 more week).
- KJST sends RFPs immediately with: **"This is a possible 2 or 3 night stay. Please give us rates for ALL scenarios."**
- If hotel can't accommodate a specific night → they must say so NOW upfront.
- If hotel only lists one rate but it only applies to one night (availability issue for night 2): this is a known error trap — the system needs to handle per-night availability and per-night rates.
- **Back-to-back game stays:** Some trips are definitively 1 night (playing City A one night, City B the next). No ambiguity.
- **NBA rule:** Teams cannot travel to a city on game day. They must be there the night before, even if under 24 hours.
- **Late checkout:** If hotel won't give late checkout on a 1-night stay, team may have to pay for 2 nights anyway — this must be shown on the grid.

**Two separate stays in one city:**
- Can happen. Different dates, possibly different hotels.
- Each stay is its own RFP row.

---

## 5. THE GRID UPDATE PROCESS — Version Control

- Grid is sent to team as Excel.
- Team makes some selections immediately, leaves some cities pending.
- KJST updates the grid daily for ~2 weeks.
- Each update = new file name: "Updated [Date]"
- Selected hotels get highlighted in the new version.
- Pending cities keep all original bids visible.
- **NEVER delete any data from original grid** — needed to revert if contract has errors.
- If a selected hotel reneges on contract ("we don't actually have that meeting space"): go back to original Excel, find next-best hotel in that city, ask team if they want to switch.
- Final grid sent after ALL contracts signed — this is what teams use for rooming lists and budget tracking.
- Some teams are so detailed they'll say "I know I have 1 comp and 3 upgrades based on my final grid" when submitting rooming list.

---

## 6. THE CONTRACT PROCESS (future build target)

- Team selects hotel via email ("In Philadelphia, we're going to the Four Seasons").
- KJST emails winning hotel: "You've won the bid, please send agreement. Even if you don't hear from us for 3 weeks, we are working through all contracts in date order."
- Contract can sit in inbox 1.5–2 weeks before KJST gets to it.
- When reviewing: pull the completed RFP, go line by line — highlight every promise, verify it's in the contract.
- Hotels frequently send wrong contracts (copy-paste from last client, wrong team name, wrong dates).
- Contracts have active track changes.
- Contracts vary from 3 to 20 pages depending on hotel brand.
- **Four Seasons**: semi-standardized template (took years to negotiate). Same layout, concessions in same location.
- **Ritz-Carlton**: NO standard template. Still brand-specific.
- **All others**: completely bespoke.
- Key error: rate in contract doesn't match rate on grid → discovered weeks after selection.
- Hotel bait: says yes to everything on RFP to win business, then reneges on contract ("that's not what we meant by meeting space").
- Resolution: if hotel won't honor promise → go back to original Excel, find next city option, get team approval to switch.

---

## 7. EMERGENCY / LAST-MINUTE CHANGES

- Airport closures, mechanical failures, weather → team stranded.
- **Process:** Group text among travel managers → all call hotels simultaneously.
- Can split team: 30 players hotel A + 30 coaches hotel B.
- If going back to same-night hotel:
  - Best case: same dirty rooms, keys reassigned, no cleaning needed. Team loves this.
  - Worst case: rooms stripped, no housekeeping, no availability → find new hotel.
- **Commission angle:** Emergency stay = additional room night = more commission. Good outcome for KJST.
- **The billing fight:** When stuck in current city, next city's hotel still charges for held rooms AND pre-ordered meals.
  - Fight: food that can be reused (eggs, bacon, toast) → charge at cost, not with F&B markup.
  - Food ordered specially for the team → they should pay.
  - Labor fees for unmanned meal service → fight those.
  - Depends on relationship: top hotel brands waive it for NBA clients.
  - WNBA: Washington Mystics/Seattle situation — hotel insisted on charging for rooms AND breakfast, was a big fight.
- Rule of thumb: "We know when to push."

---

## 8. TEAM STRUCTURE AT KJST (for user management design)

- ~10–12 total employees.
- John (owner/principal) — top level.
- Anabel (president) — operations, RFP oversight.
- 1 billing person — not a travel manager.
- 1 VIP individual reservations person — not a travel manager.
- **6 travel managers:**
  - NBA = heaviest workload (meals, CEOs, meeting space complexity).
  - Each NBA travel manager handles 2 teams.
  - Exception: Joseph has 3 teams (all easier — budget-conscious, more organized, fewer meals).
  - 1 person handles ALL baseball teams (same process, different season).
  - WNBA and baseball are same process, opposite season from NBA.

---

## 9. RATE / BUDGET LOGIC

- Formula teams use: King rate × rooms per night × nights = per-city total.
- Teams compare across all cities to set annual budget.
- "We'll save in Memphis and Detroit so we can afford NYC or LA."
- Postseason: Detroit charged nearly $1,000/room (owned by Cavs owner — he wanted the money back).
- San Antonio playoff rate: $249 (owner was being a good partner, didn't price-gouge).
- Some teams vastly overspend (Cavs — "we're way over budget, don't tell anybody").
- Some teams: 58% below budget is a win (Timberwolves).
- Commission structure: KJST earns a % of the room revenue. More spend = more commission. "Saving them too much money is almost a problem."
- Hotels sometimes try to charge for suite upgrades through invoice instead of player payroll — teams need to be educated on payroll deduction process.

---

## 10. THE "SHOPPING" DYNAMIC (Why Multiple Hotels Per City)

- Even when team says "we're going to the Four Seasons, nothing's wrong," KJST still sends RFPs to 3–4 other hotels in that city.
- Reason 1: If first-choice is sold out on a date, they need backup immediately — no time to start over.
- Reason 2: Good partnership with hotel brands (they want the opportunity to bid).
- Reality: many of those competing bids never even make it to the grid — team already chose.
- Some teams: "Why are you showing me everyone else if my first choice is available? Stop putting this on the grid."
- Some teams don't want the grid to show they picked the most expensive hotel.

---

## 11. PRE-SEASON OUTREACH PROCESS

- ~2 weeks before schedule release: email sent to each team.
- Content: "Here's where you stayed last year in every city. Here's your room count from last year. Here's your meeting space from last year. Any changes? New hotels to shop? Same preferences?"
- Team responds with any changes.
- This input builds the city-by-city RFP parameters for that team's season.
- This is when KJST learns: "In Detroit, there's a new hotel we want to shop — is that okay?"

---

## 12. WHAT THE SYSTEM MUST HANDLE (derived from transcript)

### RFP Form (hotel-facing):
- Yes/No per concession item
- Inline reason/counteroffer box for any "No" answer (not a blast page at end)
- Exactly 2 numeric inputs: commission % and suite quantities (comps AND king-rate upgrades — TWO separate fields)
- Multi-night stay scenarios: per-night rate AND per-night availability
- Rate input: only standard king rate (not suites, not doubles)
- Tax field
- Playoff clause yes/no
- Meeting space: type of space available (function room vs. restaurant — must distinguish)
- Commission field: if zero, system flags as "not submittable to team"

### Internal Grid (KJST staff view):
- Shows ALL fields including commission, flex cancel, full concession answers
- Compact view: show the 5 key items prominently (rate, comp suites, suite upgrades at king rate, playoff clause, commission)
- Dealbreaker flags: No flex cancel, No commission, No meeting space
- Notes field (per hotel per city): only populated when there's an exception
- Score: based on the 5 priorities

### Team-facing Grid (export):
- Stripped down: city, dates, king rate, tax, comp suites, suite upgrades at king rate, playoff clause, notes (exceptions only)
- NO commission, NO flex cancel, NO full concession list
- Version control: save every version, date-stamped

### Multi-stay per city:
- System must support: same city, 2+ stays at different hotels (for playoff clause coverage)
- Each stay is its own record
- RFPs sent with "scenario A (1 night) and scenario B (2 nights)" — hotel must answer both

### Alert logic:
- Flag immediately if: No flex cancel, No commission, No meeting space (these disqualify)
- Flag if: suite upgrade answer says "only $X more" — that counts as zero
- Flag if: contract rate ≠ RFP rate
- Flag if: hotel only answered one scenario but two were requested

### Version-controlled grid workflow:
- Initial grid → selected → updated (daily) → final
- Never delete any bid data
- Pending cities always retain all bids
- Final grid = only selected hotel per city

---

## 13. BASEBALL (Coming in ~1 Month — First Real Test)

- 2 teams confirmed, possibly 3 (Colorado likely).
- ~20–22 stays per season.
- Longer stays per city than NBA.
- Exact same RFP/grid/contract process as NBA.
- Opposite season from NBA (no off-season overlap conflict).
- This is the **first live use case** — must be ready.

---

## 14. COMPETITOR INTEL

- **Pivot**: main competitor. Offered teams $500K in marketing funds over 5 years.
- Teams that switched: travel spending went UP by $2M in year 1. Marketing money is not real dollars.
- Pivot has no real process — they're literally using KJST's locked Word document (a hotel gave them a copy).
- Key vulnerability: new team contacts (interns, younger hires replacing veterans) have no loyalty to KJST.
- Retention tool that worked: detailed savings reports (Timberwolves signed for another year after seeing their report).
- Prior-year spend data from teams that left Pivot could build competitive comparison marketing materials.
