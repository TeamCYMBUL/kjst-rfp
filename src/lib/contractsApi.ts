// Client helpers for the Contracts subsystem.
// Public (hotel, link-only) calls hit the token-gated edge functions with no
// auth, mirroring the RFP form. Staff calls use the authenticated Supabase
// client (RLS lets signed-in staff read/write contracts + the private bucket).
import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export type ContractStatus = 'requested' | 'uploaded' | 'in_review' | 'verified' | 'signed' | 'filed'

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
  analysis: unknown | null
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

// A short-lived signed URL to view/download a private contract file.
export async function contractFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('contracts').createSignedUrl(path, 60 * 10)
  if (error) return null
  return data?.signedUrl ?? null
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
