// Typed wrappers for the two hotel-facing Edge Functions.
// These are called by unauthenticated hotel users — no Supabase client needed.

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// ── Shape returned by rfp-get ─────────────────────────────────────────────────

export type RfpTrip = {
  id: string
  city: string | null
  opponent_label: string | null
  arrival_date: string | null
  departure_date: string | null
  nights: number | null
  game_date: string | null
  game_time: string | null
  // Second stay (separate visit, different dates)
  stay2_arrival_date: string | null
  stay2_departure_date: string | null
  stay2_game_date: string | null
  stay2_game_time: string | null
  king_rooms_requested: number | null
  double_rooms_requested: number | null
  suites_requested: number | null
  total_rooms_requested: number | null
  in_season_tournament_window: string | null
  postseason_window: string | null
  postseason_rooms_text: string | null
  response_deadline: string | null
  // Night scenarios — which night-count options to quote rates for (e.g. [1,2])
  night_scenarios: number[] | null
  // Date scenarios — up to 3 candidate date ranges when exact dates are TBD
  date_scenarios: import('./types').DateScenario[] | null
}

export type RfpClient = {
  id: string
  team_name: string
  league: string | null
  primary_contact_name: string | null
  primary_contact_title: string | null
  primary_contact_address: string | null
  primary_contact_phone: string | null
  primary_contact_email: string | null
  default_terms?: { default_meeting_spaces?: string } | null
}

export type RfpOrg = {
  id: string
  name: string | null
  iata_number: string | null
  contact_name: string | null
  contact_title: string | null
  contact_address: string | null
  contact_phone: string | null
  contact_email: string | null
  season_label: string | null
}

export type RfpInvitation = {
  id: string
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  status: string
  submitted_at: string | null
  trips: RfpTrip & { clients: RfpClient }
}

export type ConcessionItem = {
  id: string
  sort_order: number
  section: 'concessions' | 'facilities' | 'in_season_tournament' | 'postseason'
  label: string
  answer_type: 'yes_no' | 'percent' | 'quantity' | 'currency' | 'text'
  requested_value: string | null
  allow_comment: boolean
}

export type ScenarioRate = { rate: number | null; available: boolean }

export type ExistingResponse = {
  id: string
  completed_by_name: string | null
  completed_date: string | null
  best_king_rate: number | null
  king_rate_notes: string | null
  current_selling_rate: string | null
  best_suite_rate: number | null
  occupancy_tax: string | null
  meeting_space_notes: string | null
  meeting_space_type: string | null
  meeting_space_count: number | null
  general_comments: string | null
  // Second stay rates (separate visit)
  stay2_king_rate: number | null
  stay2_suite_rate: number | null
  stay2_selling_rate: string | null
  // Per-scenario rates: {"1": {rate: 199, available: true}, "2": {rate: 189, available: true}}
  scenario_rates: Record<string, ScenarioRate> | null
  // Date scenario availability: {"A": true, "B": false, "C": true}
  scenario_availability: Record<string, boolean> | null
  resort_fee: string | null
}

export type ExistingAnswer = {
  id: string
  concession_item_id: string
  answer_yes_no: boolean | null
  answer_value: string | null
  comment: string | null
}

export type RfpData = {
  invitation: RfpInvitation
  org: RfpOrg | null
  items: ConcessionItem[]
  response: ExistingResponse | null
  answers: ExistingAnswer[]
}

// ── Payloads sent to rfp-respond ──────────────────────────────────────────────

export type ResponseFields = {
  completed_by_name: string
  completed_date: string
  best_king_rate: number | null
  king_rate_notes: string
  current_selling_rate: string
  best_suite_rate: number | null
  occupancy_tax: string
  meeting_space_notes: string
  meeting_space_type: string | null
  meeting_space_count: number | null
  general_comments: string
  // Second stay rates (null when trip has only one stay)
  stay2_king_rate: number | null
  stay2_suite_rate: number | null
  stay2_selling_rate: string
  // Per-scenario rates (null when trip has only one night scenario)
  scenario_rates: Record<string, ScenarioRate> | null
  // Date scenario availability (null when trip has no date scenarios)
  scenario_availability: Record<string, boolean> | null
  resort_fee: string
}

export type AnswerPayload = {
  concession_item_id: string
  answer_yes_no: boolean | null
  answer_value: string | null
  comment: string | null
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getRfp(token: string): Promise<RfpData> {
  const res = await fetch(`${BASE}/rfp-get?token=${encodeURIComponent(token)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to load RFP')
  return data as RfpData
}

export async function respondRfp(args: {
  token: string
  response: ResponseFields
  answers: AnswerPayload[]
  submit: boolean
}): Promise<{ ok: boolean; response_id: string; submitted: boolean }> {
  const res = await fetch(`${BASE}/rfp-respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to save')
  return data
}

export async function declineRfp(args: {
  token: string
  decline_reason: string
  decline_notes?: string
}): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/rfp-decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to decline')
  return data
}
