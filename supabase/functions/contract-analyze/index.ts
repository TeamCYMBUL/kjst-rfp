import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { ZipReader, Uint8ArrayReader, TextWriter } from 'jsr:@zip-js/zip-js@2.7.57'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const num = (v: unknown): string | null => {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isFinite(n) ? `$${n.toLocaleString()}` : String(v)
}
const asText = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null

// Extract readable text from a .docx (a zip; the body lives in word/document.xml).
// Hotel agreements come in wildly different templates and every one puts the room
// block, rates, and function agenda in a TABLE. A flat tag-strip collapses those
// tables into a meaningless run of numbers ("44 44 88 39,600"), which is the main
// thing that makes the AI misread counts and rates. So this walks the document in
// order and preserves structure: table cells become " | "-separated columns, table
// rows and paragraphs become their own lines. The model then sees real rows like
//   King Rooms (395-512 sq ft) | $450.00 | 44 | 44 | 88 | $39,600.00
// regardless of which hotel's template it came from.
const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")

function xmlToStructuredText(xml: string): string {
  let out = ''
  let cellDepth = 0 // >0 while inside a table cell (paragraph breaks become spaces there)
  // One pass over text runs and the structural tags that carry layout.
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:tc\b[^>]*>|<\/w:tc>|<\/w:tr>|<\/w:p>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const tok = m[0]
    if (m[1] !== undefined) out += decodeXml(m[1])            // visible text run
    else if (tok.startsWith('<w:tab')) out += ' '
    else if (tok.startsWith('<w:br')) out += '\n'
    else if (tok.startsWith('<w:tc')) cellDepth++             // enter a table cell
    else if (tok === '</w:tc>') { cellDepth = Math.max(0, cellDepth - 1); out += ' | ' }
    else if (tok === '</w:tr>') out += '\n'                   // end of a table row
    else if (tok === '</w:p>') out += cellDepth > 0 ? ' ' : '\n' // para: space in cell, else newline
  }
  // Tidy: normalize each line, drop the trailing cell separator, collapse blanks.
  const lines = out.split('\n').map((l) =>
    l.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*/g, ' | ').replace(/\s*\|\s*$/, '').trim(),
  )
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n').trim()
}

async function docxToText(bytes: Uint8Array): Promise<string> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  try {
    const entries = await reader.getEntries()
    const doc = entries.find((e: any) => e.filename === 'word/document.xml')
    if (!doc?.getData) return ''
    const xml: string = await doc.getData(new TextWriter())
    return xmlToStructuredText(xml)
  } finally {
    await reader.close()
  }
}

// The winning bid, as a plain-text brief for the model to check the contract against.
async function buildBidBrief(sb: ReturnType<typeof createClient>, invitationId: string): Promise<string> {
  const { data: inv } = await sb
    .from('rfp_invitations')
    .select(`hotel_name,
      trips ( city, arrival_date, departure_date, stay2_arrival_date, stay2_departure_date,
               king_rooms_requested, double_rooms_requested, suites_requested, total_rooms_requested, clients ( team_name ) ),
      rfp_responses ( id, best_king_rate, best_suite_rate, current_selling_rate, occupancy_tax, resort_fee,
                       stay2_king_rate, stay2_suite_rate, meeting_space_notes, general_comments )`)
    .eq('id', invitationId)
    .single()

  const t = (Array.isArray((inv as any)?.trips) ? (inv as any).trips[0] : (inv as any)?.trips) ?? {}
  const r = (Array.isArray((inv as any)?.rfp_responses) ? (inv as any).rfp_responses[0] : (inv as any)?.rfp_responses) ?? {}
  const client = t?.clients ? (Array.isArray(t.clients) ? t.clients[0] : t.clients) : null
  const twoVisit = !!t.stay2_arrival_date

  const lines: string[] = []
  const add = (label: string, v: string | null) => { if (v != null) lines.push(`- ${label}: ${v}`) }

  lines.push(`HOTEL: ${(inv as any)?.hotel_name ?? '—'}`)
  lines.push(`TEAM / CITY: ${client?.team_name ?? '—'} · ${t.city ?? '—'}`)
  lines.push('', 'RATES:')
  add('King rate', num(r.best_king_rate))
  add('Suite rate', num(r.best_suite_rate))
  add('Selling rate', num(r.current_selling_rate))
  add('Occupancy tax', asText(r.occupancy_tax))
  add('Resort fee', asText(r.resort_fee))
  if (twoVisit) { add('King rate (Stay 2)', num(r.stay2_king_rate)); add('Suite rate (Stay 2)', num(r.stay2_suite_rate)) }
  lines.push('', 'ROOM BLOCK:')
  add('King rooms', asText(t.king_rooms_requested))
  add('Double rooms', asText(t.double_rooms_requested))
  add('Suites', asText(t.suites_requested))
  add('Total rooms', asText(t.total_rooms_requested))
  lines.push('', 'DATES:')
  add('Arrival', fmtDate(t.arrival_date)); add('Departure', fmtDate(t.departure_date))
  if (twoVisit) { add('Arrival (Stay 2)', fmtDate(t.stay2_arrival_date)); add('Departure (Stay 2)', fmtDate(t.stay2_departure_date)) }

  if (r.id) {
    const { data: ans } = await sb
      .from('concession_answers')
      .select('answer_yes_no, answer_value, comment, concession_items ( label, sort_order )')
      .eq('response_id', r.id)
    const items = (ans ?? [])
      .map((a: any) => {
        const item = Array.isArray(a.concession_items) ? a.concession_items[0] : a.concession_items
        const value = a.answer_yes_no === true ? 'Yes' : a.answer_yes_no === false ? 'No' : asText(a.answer_value)
        if (!item?.label || value == null) return null
        return { label: item.label, value, note: a.comment, sort: item.sort_order ?? 0 }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.sort - b.sort)
    if (items.length) {
      lines.push('', 'CONCESSIONS THE HOTEL AGREED TO:')
      for (const i of items as any[]) lines.push(`- ${i.label}: ${i.value}${i.note ? ` (note: ${i.note})` : ''}`)
    }
  }
  if (asText(r.meeting_space_notes)) lines.push('', `MEETING SPACE NOTES: ${r.meeting_space_notes}`)
  if (asText(r.general_comments)) lines.push('', `GENERAL COMMENTS: ${r.general_comments}`)
  return lines.join('\n')
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overall', 'summary', 'checks'],
  properties: {
    overall: { type: 'string', enum: ['match', 'issues'] },
    summary: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'bid_value', 'contract_value', 'status', 'note'],
        properties: {
          label: { type: 'string' },
          bid_value: { type: 'string' },
          contract_value: { type: 'string' },
          status: { type: 'string', enum: ['match', 'mismatch', 'missing', 'extra'] },
          note: { type: 'string' },
        },
      },
    },
  },
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'AI fact-check is not enabled yet: ANTHROPIC_API_KEY is not set on the platform.' }, 503)

  let body: { contract_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!body.contract_id) return json({ error: 'Missing contract_id' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: contract, error: cErr } = await sb
    .from('contracts')
    .select('id, invitation_id, file_path, file_name')
    .eq('id', body.contract_id)
    .single()
  if (cErr || !contract) return json({ error: 'Contract not found' }, 404)
  if (!contract.file_path) return json({ error: 'No uploaded agreement to analyze yet.' }, 400)

  // Download the uploaded agreement.
  const { data: file, error: dErr } = await sb.storage.from('contracts').download(contract.file_path)
  if (dErr || !file) return json({ error: 'Could not read the contract file.' }, 500)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = (contract.file_name || contract.file_path).toLowerCase()

  // Build the model input: bid brief + the contract (PDF natively, Word as text).
  const brief = await buildBidBrief(sb, contract.invitation_id)
  const content: any[] = []
  if (name.endsWith('.pdf')) {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) } })
  } else if (name.endsWith('.docx')) {
    const text = await docxToText(bytes)
    if (!text) return json({ error: 'Could not read the Word document text.' }, 422)
    content.push({ type: 'text', text: `CONTRACT (extracted from Word document):\n\n${text}` })
  } else {
    return json({ error: 'Only PDF and Word (.docx) contracts can be analyzed.' }, 415)
  }
  content.push({
    type: 'text',
    text: `WINNING BID TERMS (source of truth):\n\n${brief}\n\nCompare the uploaded contract above against these bid terms and return your structured findings.`,
  })

  const system =
    "You are a contracts auditor for KJ Sports Travel. Compare a hotel's uploaded room agreement against the terms the hotel committed to in its winning bid. " +
    'For each material term (king/suite/selling rates, occupancy tax and resort/other fees, room block counts, arrival/departure dates, and every concession the hotel agreed to), ' +
    'decide whether the contract MATCHES the bid, MISMATCHES it (a conflicting value), is MISSING (the bid term is not addressed in the contract), or is EXTRA (a term the contract adds that was not in the bid). ' +
    'Base contract_value only on what the document actually states; if a term is not addressed, use "—" and status "missing". Use the exact bid value for bid_value (or "—" if none). ' +
    'The contract text is extracted from a Word document and TABLES are rendered as rows whose cells are separated by " | " (e.g. a room-block or rate table). Read those tables carefully to pull exact room counts, room types, and per-night rates. ' +
    'Treat values that are economically equivalent as a MATCH even if phrased differently: e.g. a contract tax broken into "15% + 2% + $0.86" equals a bid "17% and .86"; suites given "at the contracted room rate" equal "at the king rate" when those rates are the same; a per-night rate stated with cents ("$450.00") equals the bid\'s "$450". Only call a MISMATCH when the actual value genuinely conflicts. ' +
    'Keep note short (one clause) and only when it helps. Set overall to "issues" if any check is mismatch/missing/extra that a person should review, else "match". Write a one-sentence summary.'

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
      messages: [{ role: 'user', content }],
    }),
  })
  if (!aiRes.ok) {
    const errText = await aiRes.text()
    return json({ error: `AI request failed: ${errText.slice(0, 300)}` }, 502)
  }
  const ai = await aiRes.json()
  if (ai.stop_reason === 'refusal') return json({ error: 'The AI declined to analyze this document.' }, 422)
  const textBlock = (ai.content ?? []).find((b: any) => b.type === 'text')
  if (!textBlock?.text) return json({ error: 'The AI returned no analysis.' }, 502)

  let analysis: any
  try { analysis = JSON.parse(textBlock.text) } catch { return json({ error: 'Could not parse the AI analysis.' }, 502) }
  analysis.model = 'claude-opus-5'

  const { error: uErr } = await sb
    .from('contracts')
    .update({ analysis, analyzed_at: new Date().toISOString(), status: 'in_review', updated_at: new Date().toISOString() })
    .eq('id', contract.id)
  if (uErr) return json({ error: 'Analysis done but failed to save: ' + uErr.message }, 500)

  return json({ ok: true, analysis })
})
