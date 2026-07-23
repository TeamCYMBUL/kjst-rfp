import { Link } from 'react-router-dom'

// The Playbook: an always-available reference that shows a travel manager the
// full capabilities of the platform and how to run an RFP end to end, plus the
// curveballs that would otherwise stall them. Static, scannable, no state.

type Stage = {
  n: number
  title: string
  body: string
  where?: { label: string; to: string }
}

const STAGES: Stage[] = [
  {
    n: 1,
    title: 'Set up the team',
    body: "Add each team you work for as a client, with its season room-block defaults (kings, suites, doubles). Every new trip for that team pre-fills from these, so you set them once.",
    where: { label: 'Clients', to: '/clients' },
  },
  {
    n: 2,
    title: "Set the team's RFP questions",
    body: 'Each team has its own template of concession line items and the answer type for each (yes/no, quantity, currency, percent). Adjust it so hotels are asked exactly what this team cares about.',
    where: { label: 'RFP Template', to: '/template' },
  },
  {
    n: 3,
    title: 'Create a trip',
    body: 'Every away game that needs a room block is a trip. Make one at a time, or import a whole schedule at once. Same city twice in a season is one trip with two visits, never two separate trips.',
    where: { label: 'Trips', to: '/trips' },
  },
  {
    n: 4,
    title: 'Invite hotels',
    body: "Open the trip and add the hotels you want to bid. Each gets its own secure link and only ever sees its own numbers. Nothing is emailed until you send it, so you can build the list first.",
    where: { label: 'Hotels directory', to: '/hotels' },
  },
  {
    n: 5,
    title: 'Collect the bids',
    body: "Hotels fill out their link and submit. The trip's Next step guide always tells you where things stand: who's in, who's quiet. Nudge the ones who haven't replied with a reminder.",
  },
  {
    n: 6,
    title: 'Compare the bids',
    body: 'Once bids are in, open the comparison grid: rates, taxes, and every concession side by side, with automatic scoring, dealbreaker flags, and an F&B forecast for meal pricing.',
  },
  {
    n: 7,
    title: 'Send the options to the client',
    body: 'Export the bids as a client-ready grid or a clean proposal PDF and send them to your client rep. They review and tell you which hotel they want. The client makes the pick, not you.',
  },
  {
    n: 8,
    title: "Award the client's choice",
    body: 'Once the client approves a hotel, come back and award it. Awarding marks the winner, passes the other bids, and closes the trip. You can undo it any time if plans change.',
  },
  {
    n: 9,
    title: 'Send the contract request',
    body: 'Send the awarded hotel their contract request to lock it in. That closes the loop on the trip, from a blank RFP to a signed hotel.',
  },
]

type WhatIf = { q: string; a: string }

const WHAT_IFS: WhatIf[] = [
  {
    q: "A hotel can't do the dates",
    a: 'They can decline the whole trip or just one visit. It shows as Declined and never blocks you from moving on with the others.',
  },
  {
    q: "A hotel just won't respond",
    a: "Send a reminder to nudge them. If they're clearly out, mark them Not available so they drop out of the running but stay on record.",
  },
  {
    q: 'You closed a deal off the platform',
    a: 'Signed a hotel by phone or email with no bid on file? Open that hotel and use Enter bid for them to record the agreed terms, then award. You can also start this from Log an award on the dashboard.',
  },
  {
    q: 'The dates change after a hotel bid',
    a: "Use Reopen on that hotel so they can revise their existing bid instead of starting over. Hotels that had passed as unavailable can be re-invited with the new dates.",
  },
  {
    q: 'Same city, twice in a season',
    a: 'Keep it as one trip with Visit 1 and Visit 2 (it shows a "2 visits" badge). One RFP covers both stays, so hotels bid on the whole picture.',
  },
  {
    q: 'You need help or something looks off',
    a: 'Submit a ticket with a screenshot or document attached. Check the Timeline to see everything that has happened on a client or trip.',
  },
]

function Chip({ label, to }: { label: string; to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
    >
      {label}
      <span aria-hidden>→</span>
    </Link>
  )
}

export default function Playbook() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 pb-12">
      {/* Intro */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Playbook</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Everything this platform does, and how to run an RFP from a blank trip to a signed hotel without losing your
          place. Follow the flow top to bottom; the curveballs at the end cover what to do when a hotel goes quiet, a
          deal happens off-platform, or the dates change. Every trip also shows a live <strong>Next step</strong> guide,
          so you always know the one thing to do next.
        </p>
      </div>

      {/* The flow */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          The flow, start to finish
        </h2>
        <ol className="space-y-3">
          {STAGES.map((s) => (
            <li
              key={s.n}
              className="flex gap-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1C1008] text-sm font-bold text-white">
                {s.n}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.title}</h3>
                  {s.where && <Chip label={s.where.label} to={s.where.to} />}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* What if */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          What if... the curveballs
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {WHAT_IFS.map((w) => (
            <div
              key={w.q}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4"
            >
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{w.q}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{w.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Close */}
      <div className="rounded-xl border border-[#1C1008]/20 bg-[#1C1008]/[0.04] dark:border-amber-800/40 dark:bg-amber-900/10 px-5 py-4">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          Ready to go? Start a trip from <Link to="/trips/new" className="font-semibold text-[#1C1008] dark:text-amber-400 hover:underline">+ New trip</Link>, or
          add a team first from <Link to="/clients/new" className="font-semibold text-[#1C1008] dark:text-amber-400 hover:underline">+ New client</Link>.
          Every trip will guide you the rest of the way.
        </p>
      </div>
    </div>
  )
}
