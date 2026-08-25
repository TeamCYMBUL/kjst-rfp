import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify caller is an admin staff member
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: { user: caller } } = await sb.auth.getUser(jwt)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })

  const { data: callerProfile } = await sb
    .from('staff_profiles')
    .select('role')
    .eq('id', caller.id)
    .single()
  if (callerProfile?.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403, headers: CORS })
  }

  let body: { email: string; display_name: string; role: 'admin' | 'manager'; client_ids?: string[] }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS }) }

  const { email, display_name, role, client_ids = [] } = body
  if (!email || !display_name || !role) {
    return Response.json({ error: 'email, display_name, and role are required' }, { status: 400, headers: CORS })
  }

  // Send Supabase invite email (sets a magic link; user sets their password on first login)
  const { data: inviteData, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
    data: { display_name, role },
  })
  if (inviteErr) return Response.json({ error: inviteErr.message }, { status: 400, headers: CORS })

  const userId = inviteData.user.id

  // Create staff_profiles row immediately (trigger only handles profiles table)
  const { error: profileErr } = await sb
    .from('staff_profiles')
    .upsert({ id: userId, display_name, role }, { onConflict: 'id' })
  if (profileErr) return Response.json({ error: profileErr.message }, { status: 500, headers: CORS })

  // Assign clients for managers
  if (role === 'manager' && client_ids.length > 0) {
    const assignments = client_ids.map((cid: string) => ({
      staff_user_id: userId,
      client_id: cid,
      assigned_by: caller.id,
    }))
    await sb.from('client_assignments').insert(assignments)
  }

  return Response.json({ ok: true, user_id: userId, email, display_name, role }, { headers: CORS })
})
