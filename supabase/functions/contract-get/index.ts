// Public, token-gated: returns the context a hotel needs on the contract-upload
// page (/contract/:token). Reveals ONLY this contract's own trip/hotel info and
// upload status — never any other hotel's or client's data. Reads with the
// service role behind the token check. verify_jwt = false (link-only, like RFP).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return json({ error: 'Missing token' }, 400)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: contract, error } = await sb
    .from('contracts')
    .select(`
      id, status, file_name, uploaded_at,
      rfp_invitations!inner ( hotel_name, hotel_contact_name,
        trips ( city, opponent_label, arrival_date, departure_date, stay2_arrival_date,
          clients ( team_name ) ) )
    `)
    .eq('token', token)
    .maybeSingle()

  if (error || !contract) return json({ error: 'This upload link is invalid or has expired.' }, 404)

  const inv = (contract as any).rfp_invitations
  const trip = inv?.trips
  const client = trip?.clients

  return json({
    hotel_name: inv?.hotel_name ?? null,
    contact_name: inv?.hotel_contact_name ?? null,
    team_name: client?.team_name ?? null,
    city: trip?.city ?? null,
    opponent_label: trip?.opponent_label ?? null,
    arrival_date: trip?.arrival_date ?? null,
    departure_date: trip?.departure_date ?? null,
    stay2_arrival_date: trip?.stay2_arrival_date ?? null,
    status: contract.status,
    file_name: contract.file_name,
    uploaded_at: contract.uploaded_at,
  })
})
