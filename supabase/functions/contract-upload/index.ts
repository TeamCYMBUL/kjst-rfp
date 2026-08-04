// Public, token-gated: a hotel uploads its signed room agreement from
// /contract/:token. Validates the token, stores the file in the private
// `contracts` bucket via the service role, and flips the contract to
// 'uploaded'. A token only ever writes to its OWN contract. verify_jwt = false.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB
const ALLOWED = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function safeName(name: string): string {
  return (name || 'contract').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let form: FormData
  try { form = await req.formData() } catch { return json({ error: 'Expected multipart form data' }, 400) }

  const token = String(form.get('token') ?? '')
  const file = form.get('file')
  if (!token) return json({ error: 'Missing token' }, 400)
  if (!(file instanceof File)) return json({ error: 'No file provided' }, 400)
  if (file.size === 0) return json({ error: 'The file is empty' }, 400)
  if (file.size > MAX_BYTES) return json({ error: 'File is too large (max 20 MB).' }, 400)
  if (file.type && !ALLOWED.includes(file.type)) {
    return json({ error: 'Please upload a PDF or Word document (.pdf, .doc, .docx).' }, 400)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: contract, error: cErr } = await sb
    .from('contracts')
    .select('id')
    .eq('token', token)
    .maybeSingle()
  if (cErr || !contract) return json({ error: 'This upload link is invalid or has expired.' }, 404)

  const fname = safeName(file.name)
  const path = `${contract.id}/${crypto.randomUUID()}-${fname}`

  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await sb.storage
    .from('contracts')
    .upload(path, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return json({ error: 'Upload failed: ' + upErr.message }, 500)

  const { error: updErr } = await sb
    .from('contracts')
    .update({
      file_path: path,
      file_name: fname,
      uploaded_at: new Date().toISOString(),
      status: 'uploaded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contract.id)
  if (updErr) return json({ error: 'Saved the file but failed to update the record: ' + updErr.message }, 500)

  return json({ ok: true, file_name: fname })
})
