// Public, token-gated. Given a hotel's RFP link, returns the "profile" of what
// this same hotel entered on its PRIOR RFPs so the form can prefill the stable
// bits (occupancy tax / resort fee), offer the rooms it has used before, and
// suggest its previous counteroffer/note per line item. Matched on the hotel's
// own contact email (falling back to hotel name), so it only ever surfaces this
// hotel's OWN past answers — never another hotel's. verify_jwt = false.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const clean = (v: unknown): string => (v == null ? '' : String(v)).trim()

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { token?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const token = clean(body.token)
  if (!token) return json({ error: 'Missing token' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Current invitation (identity for matching).
  const { data: cur } = await sb
    .from('rfp_invitations')
    .select('id, hotel_name, hotel_contact_email')
    .eq('token', token)
    .maybeSingle()
  if (!cur) return json({ found: false })

  const email = clean((cur as any).hotel_contact_email).toLowerCase()
  const name = clean((cur as any).hotel_name).toLowerCase()
  if (!email && !name) return json({ found: false })

  // Prior COMPLETED bids from the same hotel — email first (the reliable key),
  // falling back to an exact hotel-name match only if the email finds nothing.
  // Use the query builder (not an .or() string): hotel names contain commas,
  // which .or() would misread as clause separators.
  const SELECT = `id, hotel_name, hotel_contact_email, status,
      rfp_responses ( id, occupancy_tax, resort_fee, standard_checkin_time, meeting_space_notes, completed_date, created_at )`
  let invs: any[] = []
  let emailMatched = false // true only when the priors came from an exact email match
  if (email) {
    const { data } = await sb.from('rfp_invitations').select(SELECT)
      .ilike('hotel_contact_email', email).in('status', ['submitted', 'awarded']).neq('id', (cur as any).id)
    invs = data ?? []
    emailMatched = invs.length > 0
  }
  if (invs.length === 0 && name) {
    const { data } = await sb.from('rfp_invitations').select(SELECT)
      .ilike('hotel_name', name).in('status', ['submitted', 'awarded']).neq('id', (cur as any).id)
    invs = data ?? []
  }

  type Resp = { id: string; occupancy_tax: string | null; resort_fee: string | null; standard_checkin_time: string | null; meeting_space_notes: string | null; completed_date: string | null; created_at: string | null }
  const priors: Resp[] = []
  for (const inv of (invs ?? []) as any[]) {
    const r = Array.isArray(inv.rfp_responses) ? inv.rfp_responses[0] : inv.rfp_responses
    if (r) priors.push(r as Resp)
  }
  if (priors.length === 0) return json({ found: false })

  // Newest first, so "most recent non-empty" wins for the single-value fields.
  const when = (r: Resp) => r.completed_date || r.created_at || ''
  priors.sort((a, b) => (when(a) < when(b) ? 1 : -1))

  const firstNonEmpty = (pick: (r: Resp) => string | null) => {
    for (const r of priors) { const v = clean(pick(r)); if (v) return v }
    return ''
  }
  const occupancyTax = firstNonEmpty((r) => r.occupancy_tax)
  const resortFee = firstNonEmpty((r) => r.resort_fee)
  const checkinTime = firstNonEmpty((r) => r.standard_checkin_time)

  // Rooms used before (from every prior meeting_space_notes JSON), deduped.
  const roomMap = new Map<string, { name: string; dimensions: string; space_type: string }>()
  for (const r of priors) {
    if (!r.meeting_space_notes) continue
    try {
      const parsed = JSON.parse(r.meeting_space_notes)
      const buckets: any[] = []
      if (parsed?.__details) buckets.push(...Object.values(parsed.__details))
      if (Array.isArray(parsed?.__additional)) buckets.push(...parsed.__additional)
      if (parsed?.__named) for (const m of Object.values(parsed.__named)) buckets.push(...Object.values(m as any))
      for (const s of buckets) {
        const nm = clean(s?.name)
        if (!nm) continue
        const key = nm.toLowerCase()
        if (!roomMap.has(key)) roomMap.set(key, { name: nm, dimensions: clean(s?.dimensions), space_type: clean(s?.space_type) })
      }
    } catch { /* legacy plain text — skip */ }
  }
  const rooms = [...roomMap.values()].sort((a, b) => a.name.localeCompare(b.name))

  // Prior counteroffer/note per concession item (most recent non-empty).
  // ISOLATION: notes are free-text specific to a person's negotiation, so they are
  // ONLY ever taken from an EXACT contact-email match — never the hotel-name
  // fallback. A rep never sees another rep's counteroffers, even at the same hotel.
  const respIds = emailMatched ? priors.map((r) => r.id) : []
  const notes: Record<string, string> = {}
  // Prior Yes/No (and value) per item — the form uses these to prefill the
  // in-season and postseason clauses, which hotels answer the same way each time.
  const answers: Record<string, { yesNo: boolean | null; value: string }> = {}
  if (respIds.length) {
    const { data: ans } = await sb
      .from('concession_answers')
      .select('concession_item_id, comment, answer_yes_no, answer_value, response_id')
      .in('response_id', respIds)
    // priors is newest-first; respIds preserves that order, so keep the first seen.
    const order = new Map(respIds.map((id, i) => [id, i]))
    const bestNote: Record<string, number> = {}
    const bestAns: Record<string, number> = {}
    for (const a of (ans ?? []) as any[]) {
      const rank = order.get(a.response_id) ?? 999
      const c = clean(a.comment)
      if (c && (bestNote[a.concession_item_id] == null || rank < bestNote[a.concession_item_id])) {
        bestNote[a.concession_item_id] = rank
        notes[a.concession_item_id] = c
      }
      const hasAns = a.answer_yes_no != null || clean(a.answer_value) !== ''
      if (hasAns && (bestAns[a.concession_item_id] == null || rank < bestAns[a.concession_item_id])) {
        bestAns[a.concession_item_id] = rank
        answers[a.concession_item_id] = { yesNo: a.answer_yes_no ?? null, value: clean(a.answer_value) }
      }
    }
  }

  return json({
    found: true,
    hotelName: clean((cur as any).hotel_name),
    lastDate: when(priors[0]) || null,
    occupancyTax, resortFee, checkinTime,
    rooms,
    notes,
    answers,
  })
})
