// The RFP journey as two tiers of stages, used by the Dashboard team-setup
// cards and the trip workspace timeline. "Done" state is auto-derived where the
// system can know it for sure, and stored manual overrides (clients.progress_steps
// / trips.progress_steps) can check or uncheck any stage.

export type StageKey =
  | 'review_template' | 'import_schedule'
  | 'send_rfps' | 'collect_bids' | 'compare_grid' | 'export_client' | 'award_winner' | 'contract'

export type StageDef = { key: StageKey; label: string; tip: string }

// Tier 1 — done once per team (lives on the client/Dashboard).
export const TEAM_STAGES: StageDef[] = [
  { key: 'review_template', label: 'Review template', tip: 'Open this team’s RFP Template and compare it to the Word RFP the client provided, to fact-check that hotels are asked exactly the right questions.' },
  { key: 'import_schedule', label: 'Import schedule', tip: 'On the team’s page, upload the season schedule (Excel, PDF, Word, or CSV) to create all the trips at once.' },
]

// Tier 2 — per trip (lives on the trip workspace).
export const TRIP_STAGES: StageDef[] = [
  { key: 'send_rfps', label: 'Send RFPs', tip: 'Add the hotels you want to bid, then email each one its secure link. Nothing sends until you hit send.' },
  { key: 'collect_bids', label: 'Collect bids', tip: 'Hotels fill out their link and submit. Send a reminder to anyone who hasn’t replied.' },
  { key: 'compare_grid', label: 'Compare grid', tip: 'Open Full grid to see every bid side by side: rates, taxes, concessions, and scores.' },
  { key: 'export_client', label: 'Export to client', tip: 'Export the grid or a proposal PDF and send it to your client rep. The client picks the winner.' },
  { key: 'award_winner', label: 'Award winner', tip: 'Once the client picks, award that hotel here. It closes the trip and passes the others.' },
  { key: 'contract', label: 'Contract', tip: 'Send the contract request; the hotel uploads the signed agreement into the Contracts tab.' },
]

type Overrides = Record<string, boolean> | null | undefined

// Resolve a stage's done state: an explicit manual override wins; otherwise the
// auto-derived value passed in.
export function resolveDone(key: StageKey, auto: boolean, overrides: Overrides): boolean {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return !!overrides[key]
  return auto
}

// Auto-derived done for the team tier. review_template can't be detected, so it
// stays manual (false here); import_schedule is done once the team has any trip.
export function teamAutoDone(hasTrips: boolean): Record<StageKey, boolean> {
  return {
    review_template: false,
    import_schedule: hasTrips,
    send_rfps: false, collect_bids: false, compare_grid: false,
    export_client: false, award_winner: false, contract: false,
  }
}

// Auto-derived done for a trip's per-trip tier, from its invitations + status.
export function tripAutoDone(args: {
  anySent: boolean; anySubmitted: boolean; anyAwarded: boolean; closed: boolean
}): Record<StageKey, boolean> {
  return {
    review_template: false, import_schedule: false,
    send_rfps: args.anySent,
    collect_bids: args.anySubmitted,
    compare_grid: false,
    export_client: false,
    award_winner: args.anyAwarded || args.closed,
    contract: false,
  }
}

// First stage in a tier that isn't done yet = the "current" one to highlight.
export function currentStage(stages: StageDef[], isDone: (k: StageKey) => boolean): StageKey | null {
  for (const s of stages) if (!isDone(s.key)) return s.key
  return null
}
