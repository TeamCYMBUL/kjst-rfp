import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // --- 1. Look up invitation + trip + client ---
  const { data: inv, error: invErr } = await supabase
    .from('rfp_invitations')
    .select(`
      id, hotel_name, hotel_contact_name, hotel_contact_email,
      status, revoked_at, sent_at, opened_at, submitted_at, reopened_at, visit_scope,
      visit1_declined, visit1_decline_reason, visit1_decline_notes,
      visit2_declined, visit2_decline_reason, visit2_decline_notes,
      trips (
        id, city, opponent_label,
        arrival_date, departure_date, nights,
        game_date, game_dates, game_time,
        stay2_arrival_date, stay2_departure_date, stay2_game_date, stay2_game_dates, stay2_game_time,
        king_rooms_requested, suites_requested, double_rooms_requested, total_rooms_requested,
        in_season_tournament_window, postseason_window, postseason_rooms_text,
        response_deadline, night_scenarios, date_scenarios,
        clients (
          id, team_name, league, organization_id,
          primary_contact_name, primary_contact_title,
          primary_contact_address, primary_contact_phone, primary_contact_email,
          default_terms, sample_menus
        )
      )
    `)
    .eq('token', token)
    .single()

  if (invErr || !inv) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired link. Please contact KJST for a new link.' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
  // A revoked link is deactivated by staff — stop it working without deleting the record.
  if ((inv as any).revoked_at) {
    return new Response(
      JSON.stringify({ error: 'This link has been deactivated. Please contact KJST for a new one.' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  // --- 2. Mark opened on first visit ---
  if (inv.status === 'sent') {
    await supabase
      .from('rfp_invitations')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', inv.id)
    inv.status = 'opened'
  }

  // --- 3. Fetch org (KJST contact info for the RFP header) ---
  const orgId = (inv.trips as any).clients.organization_id
  const clientId = (inv.trips as any).clients.id
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, iata_number, contact_name, contact_title, contact_address, contact_phone, contact_email, season_label')
    .eq('id', orgId)
    .single()

  // --- 4. Get concession items: trip snapshot first, fallback to live org+client items ---
  const tripId = (inv.trips as any).id

  const { data: snapItems } = await supabase
    .from('trip_concession_items')
    .select('source_item_id, sort_order, section, label, answer_type, requested_value, allow_comment, optional')
    .eq('trip_id', tripId)
    .order('sort_order')

  let items: unknown[]
  if (snapItems && snapItems.length > 0) {
    items = snapItems.map((s: any) => ({
      id: s.source_item_id,
      sort_order: s.sort_order,
      section: s.section,
      label: s.label,
      answer_type: s.answer_type,
      requested_value: s.requested_value,
      allow_comment: s.allow_comment,
      optional: s.optional ?? false,
    }))
  } else {
    // Live fallback: master items + client-specific items
    const { data: liveItems } = await supabase
      .from('concession_items')
      .select('id, sort_order, section, label, answer_type, requested_value, allow_comment, optional')
      .eq('organization_id', orgId)
      .or(`client_id.is.null,client_id.eq.${clientId}`)
      .eq('archived', false)
      .order('sort_order')
    items = liveItems ?? []
  }

  // --- 5. Get existing response + answers (save-and-resume) ---
  const { data: response } = await supabase
    .from('rfp_responses')
    .select('*')
    .eq('invitation_id', inv.id)
    .maybeSingle()

  let answers: unknown[] = []
  if (response) {
    const { data } = await supabase
      .from('concession_answers')
      .select('id, concession_item_id, answer_yes_no, answer_value, comment')
      .eq('response_id', response.id)
    answers = data ?? []
  }

  return new Response(
    JSON.stringify({ invitation: inv, org: org ?? null, items, response, answers }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
  )
})
