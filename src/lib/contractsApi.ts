// Client helpers for the Contracts subsystem.
// Public (hotel, link-only) calls hit the token-gated edge functions with no
// auth, mirroring the RFP form. Staff calls use the authenticated Supabase
// client (RLS lets signed-in staff read/write contracts + the private bucket).
import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export type ContractStatus = 'requested' | 'uploaded' | 'in_review' | 'verified' | 'signed' | 'filed'

// ── Fact-check: the winning bid summarised, and the analysis result shape ──────

export type BidTerm = { label: string; value: string; note?: string | null }
export type BidSummary = {
  rates: BidTerm[]
  roomBlock: BidTerm[]
  dates: BidTerm[]
  concessions: BidTerm[]
  meetingSpaceNotes: string | null
  generalComments: string | null
}

// One line of the fact-check: what the bid said vs what the contract says.
export type ContractCheck = {
  label: string
  bid_value: string | null
  contract_value: string | null
  status: 'match' | 'mismatch' | 'missing' | 'extra'
  note?: string | null
}
// Stored in contracts.analysis (jsonb). The AI fact-check writes this; the UI
// renders it. Kept intentionally simple so a manual review can populate it too.
export type ContractAnalysis = {
  overall: 'match' | 'issues'
  summary: string
  checks: ContractCheck[]
  model?: string
}

const money = (v: unknown): string | null => {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isFinite(n) ? `$${n.toLocaleString()}` : String(v)
}
const asText = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null

// Everything the awarded hotel actually agreed to in its winning bid — the
// source of truth the uploaded contract is checked against.
export async function fetchBidSummary(invitationId: string): Promise<BidSummary> {
  const { data: inv } = await supabase
    .from('rfp_invitations')
    .select(`
      id, awarded_stay1, awarded_stay2,
      trips ( city, arrival_date, departure_date, stay2_arrival_date, stay2_departure_date,
               king_rooms_requested, double_rooms_requested, suites_requested, total_rooms_requested ),
      rfp_responses ( id, best_king_rate, best_suite_rate, current_selling_rate, occupancy_tax, resort_fee,
                       stay2_king_rate, stay2_suite_rate, meeting_space_notes, general_comments )
    `)
    .eq('id', invitationId)
    .single()

  const t = (Array.isArray((inv as any)?.trips) ? (inv as any).trips[0] : (inv as any)?.trips) ?? {}
  const r = (Array.isArray((inv as any)?.rfp_responses) ? (inv as any).rfp_responses[0] : (inv as any)?.rfp_responses) ?? {}
  const twoVisit = !!t.stay2_arrival_date

  const rates: BidTerm[] = [
    { label: 'King rate', value: money(r.best_king_rate) ?? '—' },
    { label: 'Suite rate', value: money(r.best_suite_rate) ?? '—' },
    { label: 'Selling rate', value: money(r.current_selling_rate) ?? '—' },
    { label: 'Occupancy tax', value: asText(r.occupancy_tax) ?? '—' },
    { label: 'Resort fee', value: asText(r.resort_fee) ?? '—' },
    ...(twoVisit ? [
      { label: 'King rate — Stay 2', value: money(r.stay2_king_rate) ?? '—' },
      { label: 'Suite rate — Stay 2', value: money(r.stay2_suite_rate) ?? '—' },
    ] : []),
  ].filter((x) => x.value !== '—')

  const roomBlock: BidTerm[] = [
    { label: 'King rooms', value: asText(t.king_rooms_requested) ?? '—' },
    { label: 'Double rooms', value: asText(t.double_rooms_requested) ?? '—' },
    { label: 'Suites', value: asText(t.suites_requested) ?? '—' },
    { label: 'Total rooms', value: asText(t.total_rooms_requested) ?? '—' },
  ].filter((x) => x.value !== '—')

  const dates: BidTerm[] = [
    { label: 'Arrival', value: fmtDate(t.arrival_date) ?? '—' },
    { label: 'Departure', value: fmtDate(t.departure_date) ?? '—' },
    ...(twoVisit ? [
      { label: 'Arrival — Stay 2', value: fmtDate(t.stay2_arrival_date) ?? '—' },
      { label: 'Departure — Stay 2', value: fmtDate(t.stay2_departure_date) ?? '—' },
    ] : []),
  ].filter((x) => x.value !== '—')

  // Concession answers the hotel gave (Yes/No or a value), so the contract can
  // be checked against each committed term.
  let concessions: BidTerm[] = []
  if (r.id) {
    const { data: ans } = await supabase
      .from('concession_answers')
      .select('answer_yes_no, answer_value, comment, concession_items ( label, sort_order )')
      .eq('response_id', r.id)
    concessions = (ans ?? [])
      .map((a: any) => {
        const item = Array.isArray(a.concession_items) ? a.concession_items[0] : a.concession_items
        const value = a.answer_yes_no === true ? 'Yes' : a.answer_yes_no === false ? 'No' : asText(a.answer_value)
        if (!item?.label || value == null) return null
        return { label: item.label as string, value, note: a.comment ?? null, _sort: item.sort_order ?? 0 }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a._sort - b._sort)
      .map(({ label, value, note }: any) => ({ label, value, note })) as BidTerm[]
  }

  return {
    rates,
    roomBlock,
    dates,
    concessions,
    meetingSpaceNotes: asText(r.meeting_space_notes),
    generalComments: asText(r.general_comments),
  }
}

// ── Public (hotel upload page) ────────────────────────────────────────────────

export type ContractContext = {
  hotel_name: string | null
  contact_name: string | null
  team_name: string | null
  city: string | null
  opponent_label: string | null
  arrival_date: string | null
  departure_date: string | null
  stay2_arrival_date: string | null
  status: ContractStatus
  file_name: string | null
  uploaded_at: string | null
}

export async function getContract(token: string): Promise<ContractContext> {
  const res = await fetch(`${BASE}/contract-get?token=${encodeURIComponent(token)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to load')
  return data as ContractContext
}

export async function uploadContract(token: string, file: File): Promise<{ ok: true; file_name: string }> {
  const form = new FormData()
  form.append('token', token)
  form.append('file', file)
  const res = await fetch(`${BASE}/contract-upload`, { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Upload failed')
  return data
}

// ── Staff (Contracts page) ────────────────────────────────────────────────────

export type ContractRow = {
  id: string
  status: ContractStatus
  file_path: string | null
  file_name: string | null
  uploaded_at: string | null
  signed_file_path: string | null
  signed_file_name: string | null
  signed_at: string | null
  analysis: ContractAnalysis | null
  analyzed_at: string | null
  staff_notes: string | null
}

// Every awarded hotel, with its contract record (if the request has been sent).
export type AwardedContract = {
  invitation_id: string
  hotel_name: string
  hotel_contact_email: string | null
  awarded_stay1: boolean
  awarded_stay2: boolean
  trip: { id: string; city: string | null; opponent_label: string | null; stay2_arrival_date: string | null } | null
  client: { id: string; team_name: string } | null
  contract: ContractRow | null
}

export async function listAwardedContracts(): Promise<AwardedContract[]> {
  const { data, error } = await supabase
    .from('rfp_invitations')
    .select(`
      id, hotel_name, hotel_contact_email, awarded_stay1, awarded_stay2,
      trips!inner ( id, city, opponent_label, stay2_arrival_date, clients ( id, team_name ) ),
      contracts ( id, status, file_path, file_name, uploaded_at, signed_file_path, signed_file_name, signed_at, analysis, analyzed_at, staff_notes )
    `)
    .eq('status', 'awarded')
    .order('hotel_name')
  if (error) throw error

  return (data ?? []).map((i: any) => {
    const trip = Array.isArray(i.trips) ? i.trips[0] : i.trips
    const client = trip?.clients ? (Array.isArray(trip.clients) ? trip.clients[0] : trip.clients) : null
    const contract = Array.isArray(i.contracts) ? (i.contracts[0] ?? null) : (i.contracts ?? null)
    return {
      invitation_id: i.id,
      hotel_name: i.hotel_name,
      hotel_contact_email: i.hotel_contact_email ?? null,
      awarded_stay1: !!i.awarded_stay1,
      awarded_stay2: !!i.awarded_stay2,
      trip: trip ? { id: trip.id, city: trip.city, opponent_label: trip.opponent_label, stay2_arrival_date: trip.stay2_arrival_date } : null,
      client: client ? { id: client.id, team_name: client.team_name } : null,
      contract,
    }
  })
}

// Run the AI fact-check: sends the uploaded contract + the bid to Claude and
// stores the structured comparison on the contract row.
export async function analyzeContract(contractId: string): Promise<ContractAnalysis> {
  const { data, error } = await supabase.functions.invoke('contract-analyze', { body: { contract_id: contractId } })
  if (error) {
    let msg = error.message
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error } catch { /* ignore */ }
    throw new Error(msg ?? 'Fact-check failed')
  }
  return (data as any).analysis as ContractAnalysis
}

// A short-lived signed URL to view/download a private contract file.
export async function contractFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('contracts').createSignedUrl(path, 60 * 10)
  if (error) return null
  return data?.signedUrl ?? null
}

// Raw bytes of a private contract file (for in-app rendering, e.g. Word docs).
// Goes through the authenticated storage client so there's no cross-origin fetch.
export async function contractFileBytes(path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await supabase.storage.from('contracts').download(path)
  if (error || !data) return null
  return await data.arrayBuffer()
}

export async function updateContractStatus(id: string, status: ContractStatus): Promise<void> {
  const { error } = await supabase
    .from('contracts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function saveContractNotes(id: string, staff_notes: string): Promise<void> {
  const { error } = await supabase
    .from('contracts')
    .update({ staff_notes, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Staff uploads the hotel's agreement themselves — for when the contract was
// handled over email rather than through the hotel's upload link. Creates the
// contract record first if the request was never sent through the platform.
export async function uploadContractStaff(
  args: { invitationId: string; tripId: string | null; clientId: string | null },
  file: File,
): Promise<void> {
  let { data: c } = await supabase
    .from('contracts')
    .select('id')
    .eq('invitation_id', args.invitationId)
    .maybeSingle()
  if (!c) {
    const { data: created, error: insErr } = await supabase
      .from('contracts')
      .insert({ invitation_id: args.invitationId, trip_id: args.tripId, client_id: args.clientId, status: 'requested' })
      .select('id')
      .single()
    if (insErr || !created) throw insErr ?? new Error('Failed to create contract record')
    c = created
  }
  const safe = (file.name || 'contract').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
  const path = `${c.id}/staff-${Date.now()}-${safe}`
  const { error: upErr } = await supabase.storage.from('contracts').upload(path, file, { upsert: false })
  if (upErr) throw upErr
  const { error } = await supabase
    .from('contracts')
    .update({
      file_path: path,
      file_name: safe,
      uploaded_at: new Date().toISOString(),
      status: 'uploaded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', c.id)
  if (error) throw error
}

// Staff uploads the final signed copy directly to the private bucket, then marks
// the contract signed. (Authenticated staff have write access to the bucket.)
export async function uploadSignedCopy(contractId: string, file: File): Promise<void> {
  const safe = (file.name || 'signed').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
  const path = `${contractId}/signed-${Date.now()}-${safe}`
  const { error: upErr } = await supabase.storage.from('contracts').upload(path, file, { upsert: false })
  if (upErr) throw upErr
  const { error } = await supabase
    .from('contracts')
    .update({
      signed_file_path: path,
      signed_file_name: safe,
      signed_at: new Date().toISOString(),
      status: 'signed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractId)
  if (error) throw error
}

// ── Fact-check rules (owner-editable; the analyzer reads the active ones) ───────
export type ContractCheckRule = {
  id: string
  rule_text: string
  active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function listContractRules(): Promise<ContractCheckRule[]> {
  const { data, error } = await supabase
    .from('contract_check_rules')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ContractCheckRule[]
}

export async function addContractRule(rule_text: string, created_by: string | null): Promise<void> {
  // Place new rules at the end.
  const { data: last } = await supabase
    .from('contract_check_rules')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sort_order = ((last as any)?.sort_order ?? 0) + 1
  const { error } = await supabase
    .from('contract_check_rules')
    .insert({ rule_text, sort_order, created_by })
  if (error) throw error
}

export async function updateContractRule(
  id: string,
  patch: Partial<Pick<ContractCheckRule, 'rule_text' | 'active'>>,
): Promise<void> {
  const { error } = await supabase
    .from('contract_check_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteContractRule(id: string): Promise<void> {
  const { error } = await supabase.from('contract_check_rules').delete().eq('id', id)
  if (error) throw error
}
