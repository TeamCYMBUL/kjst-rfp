// Row shapes for the tables we read/write in the staff app.
// Mirrors the Supabase schema (see SPEC.md PROMPT 2).

export type TripStatus = 'draft' | 'sent' | 'collecting' | 'closed'
export type InvitationStatus = 'sent' | 'opened' | 'submitted' | 'declined' | 'awarded' | 'passed' | 'unavailable'

// Season defaults stored on clients.default_terms (jsonb). All optional —
// they pre-fill new trips so staff usually only edit city/opponent/dates.
export type DefaultTerms = {
  agreement_status?: string
  default_king_rooms?: number | null
  default_suites?: number | null
  default_total_rooms?: number | null
  in_season_tournament_window?: string
  postseason_window?: string
  postseason_rooms_text?: string
}

export type Client = {
  id: string
  organization_id: string
  team_name: string
  legal_entity: string | null
  league: string | null
  logo_url: string | null
  primary_contact_name: string | null
  primary_contact_title: string | null
  primary_contact_address: string | null
  primary_contact_phone: string | null
  primary_contact_email: string | null
  season: string | null
  default_terms: DefaultTerms
  created_at: string
}

export type Trip = {
  id: string
  client_id: string
  city: string | null
  opponent_label: string | null
  arrival_date: string | null
  departure_date: string | null
  nights: number | null
  game_date: string | null
  game_time: string | null
  // Second stay (same city, different dates — one RFP covers both)
  stay2_arrival_date: string | null
  stay2_departure_date: string | null
  stay2_game_date: string | null
  stay2_game_time: string | null
  king_rooms_requested: number | null
  suites_requested: number | null
  total_rooms_requested: number | null
  in_season_tournament_window: string | null
  postseason_window: string | null
  postseason_rooms_text: string | null
  status: TripStatus
  response_deadline: string | null
  created_at: string
}

export type Invitation = {
  id: string
  trip_id: string
  hotel_name: string
  hotel_contact_name: string | null
  hotel_contact_email: string | null
  token: string
  status: InvitationStatus
  sent_at: string | null
  opened_at: string | null
  submitted_at: string | null
  staff_notes: string | null
  created_at: string
}
