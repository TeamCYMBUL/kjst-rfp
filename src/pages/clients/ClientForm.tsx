import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Client, DefaultTerms } from '../../lib/types'
import {
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  Select,
  TextField,
} from '../../components/ui'

// Empty shape for a brand-new client. organization_id is filled by the DB
// default (current_org_id) so we never send it from the client.
const blank = {
  team_name: '',
  legal_entity: '',
  league: '',
  season: '',
  primary_contact_name: '',
  primary_contact_title: '',
  primary_contact_address: '',
  primary_contact_phone: '',
  primary_contact_email: '',
  assigned_to: '' as string, // profile id or ''
}

type StaffProfile = { id: string; full_name: string | null; email: string | null }

// Season defaults live in a jsonb column. We keep numbers as strings in the form
// and coerce on save so empty inputs become null rather than 0.
const blankTerms: DefaultTerms = {
  agreement_status: '',
  default_king_rooms: null,
  default_double_rooms: null,
  default_suites: null,
  default_total_rooms: null,
  in_season_tournament_window: '',
  postseason_window: '',
  postseason_rooms_text: '',
  default_meeting_spaces: '',
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Sample menus KJST shares WITH hotels (public bucket). Stored on clients.sample_menus.
type SampleMenu = { path: string; name: string; size?: number; type?: string }
const SAMPLE_MENU_BUCKET = 'client-sample-menus'
const MAX_SAMPLE_MENU_BYTES = 25 * 1024 * 1024
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
function sampleMenuUrl(path: string): string {
  return supabase.storage.from(SAMPLE_MENU_BUCKET).getPublicUrl(path).data.publicUrl
}

export default function ClientForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()

  const [fields, setFields] = useState(blank)
  const [terms, setTerms] = useState<DefaultTerms>(blankTerms)
  const [alwaysCc, setAlwaysCc] = useState({ enabled: false, name: '', email: '' })
  const [showTerms, setShowTerms] = useState(editing)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [sampleMenus, setSampleMenus] = useState<SampleMenu[]>([])
  const [menuUploading, setMenuUploading] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(editing)
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Load all staff profiles for the assignment dropdown
    supabase.from('profiles').select('id, full_name, email').order('full_name')
      .then(({ data }) => { if (data) setStaffProfiles(data as StaffProfile[]) })
  }, [])

  useEffect(() => {
    if (!editing) return
    supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
        } else if (data) {
          const c = data as Client & { assigned_to?: string | null }
          setFields({
            team_name: c.team_name ?? '',
            legal_entity: c.legal_entity ?? '',
            league: c.league ?? '',
            season: c.season ?? '',
            primary_contact_name: c.primary_contact_name ?? '',
            primary_contact_title: c.primary_contact_title ?? '',
            primary_contact_address: c.primary_contact_address ?? '',
            primary_contact_phone: c.primary_contact_phone ?? '',
            primary_contact_email: c.primary_contact_email ?? '',
            assigned_to: c.assigned_to ?? '',
          })
          setLogoUrl(c.logo_url ?? null)
          setSampleMenus(Array.isArray((c as any).sample_menus) ? (c as any).sample_menus : [])
          setTerms({ ...blankTerms, ...(c.default_terms ?? {}) })
          setAlwaysCc({
            enabled: c.always_cc_enabled ?? false,
            name: c.always_cc_name ?? '',
            email: c.always_cc_email ?? '',
          })
        }
        setLoading(false)
      })
  }, [editing, id])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    const ext = file.name.split('.').pop() ?? 'png'
    const fileName = `${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('team-logos')
      .upload(fileName, file, { upsert: true })
    if (uploadError) {
      setError(`Logo upload failed: ${uploadError.message}`)
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('team-logos').getPublicUrl(fileName)
    setLogoUrl(data.publicUrl)
    setUploading(false)
    // reset the input so the same file can be re-selected if needed
    e.target.value = ''
  }

  const handleSampleMenuUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setMenuError(null)
    setMenuUploading(true)
    try {
      const added: SampleMenu[] = []
      for (const file of Array.from(files)) {
        if (file.size > MAX_SAMPLE_MENU_BYTES) {
          setMenuError(`"${file.name}" is larger than 25 MB — please upload a smaller file.`)
          continue
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
        const path = `${id ?? 'new'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
        const { error: upErr } = await supabase.storage
          .from(SAMPLE_MENU_BUCKET)
          .upload(path, file, { contentType: file.type || undefined, upsert: false })
        if (upErr) { setMenuError(`Could not upload "${file.name}": ${upErr.message}`); continue }
        added.push({ path, name: file.name, size: file.size, type: file.type || undefined })
      }
      if (added.length > 0) {
        const next = [...sampleMenus, ...added]
        setSampleMenus(next)
        // On an existing team, persist right away so the upload sticks even if
        // the user never clicks "Save changes" (a new team saves on create).
        if (editing && id) await supabase.from('clients').update({ sample_menus: next }).eq('id', id)
      }
    } finally {
      setMenuUploading(false)
      e.target.value = ''
    }
  }

  const removeSampleMenu = async (path: string) => {
    const next = sampleMenus.filter((m) => m.path !== path)
    setSampleMenus(next)
    if (editing && id) await supabase.from('clients').update({ sample_menus: next }).eq('id', id)
  }

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }))

  const setTerm =
    (k: keyof DefaultTerms) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setTerms((t) => ({ ...t, [k]: e.target.value }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    // Trim text fields; convert empty strings to null so the DB stays clean.
    const clean = (v: string) => (v.trim() === '' ? null : v.trim())
    const payload = {
      team_name: fields.team_name.trim(),
      legal_entity: clean(fields.legal_entity),
      league: clean(fields.league),
      season: clean(fields.season),
      primary_contact_name: clean(fields.primary_contact_name),
      primary_contact_title: clean(fields.primary_contact_title),
      primary_contact_address: clean(fields.primary_contact_address),
      primary_contact_phone: clean(fields.primary_contact_phone),
      primary_contact_email: clean(fields.primary_contact_email),
      logo_url: logoUrl ?? null,
      sample_menus: sampleMenus,
      assigned_to: fields.assigned_to || null,
      always_cc_enabled: alwaysCc.enabled,
      always_cc_name: clean(alwaysCc.name) ?? null,
      always_cc_email: clean(alwaysCc.email) ?? null,
      default_terms: {
        agreement_status: clean(terms.agreement_status ?? '') ?? undefined,
        default_king_rooms: numOrNull(String(terms.default_king_rooms ?? '')),
        default_double_rooms: numOrNull(String(terms.default_double_rooms ?? '')),
        default_suites: numOrNull(String(terms.default_suites ?? '')),
        default_total_rooms: numOrNull(String(terms.default_total_rooms ?? '')),
        in_season_tournament_window: clean(terms.in_season_tournament_window ?? '') ?? undefined,
        postseason_window: clean(terms.postseason_window ?? '') ?? undefined,
        postseason_rooms_text: clean(terms.postseason_rooms_text ?? '') ?? undefined,
        default_meeting_spaces: clean(terms.default_meeting_spaces ?? '') ?? undefined,
      },
    }

    if (editing) {
      const { data: updated, error } = await supabase
        .from('clients')
        .update(payload)
        .eq('id', id)
        .select('id')
      if (error) {
        setError(error.message)
        setSaving(false)
        return
      }
      if (!updated || updated.length === 0) {
        setError("You don't have permission to edit this team. Only assigned managers and admins can make changes.")
        setSaving(false)
        return
      }
      navigate(`/clients/${id}`)
    } else {
      const { data, error } = await supabase
        .from('clients')
        .insert(payload)
        .select('id')
        .single()
      if (error) {
        setError(error.message)
        setSaving(false)
        return
      }
      navigate(`/clients/${data!.id}`)
    }
  }

  if (loading) return <Loading />

  return (
    <div>
      <PageHeader
        title={editing ? 'Edit Client' : 'New Client'}
        subtitle="A sports team KJST runs hotel RFPs for."
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <form onSubmit={save} className="space-y-6">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Team
          </h2>

          {/* Logo upload */}
          <div className="mb-5 flex items-center gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700">
              {logoUrl ? (
                <img src={logoUrl} alt="Team logo" className="h-full w-full object-contain p-1" />
              ) : (
                <span className="text-2xl">🏀</span>
              )}
            </div>
            <div>
              <label className={`cursor-pointer rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                  disabled={uploading}
                />
              </label>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl(null)}
                  className="ml-2 text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  Remove
                </button>
              )}
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                PNG, SVG, or JPG · Shows in the client list instead of initials
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Team name"
              value={fields.team_name}
              onChange={set('team_name')}
              required
            />
            <TextField
              label="Legal entity"
              hint="Full legal name used on contracts."
              value={fields.legal_entity}
              onChange={set('legal_entity')}
            />
            <Select
              label="League"
              value={fields.league}
              onChange={(e) => setFields((f) => ({ ...f, league: e.target.value }))}
            >
              <option value="">—</option>
              <option value="NBA">NBA</option>
              <option value="MLB">MLB</option>
              <option value="NFL">NFL</option>
              <option value="NHL">NHL</option>
              <option value="MLS">MLS</option>
              <option value="WNBA">WNBA</option>
              <option value="NCAA Basketball">NCAA Basketball</option>
              <option value="NCAA Football">NCAA Football</option>
              <option value="Other">Other</option>
            </Select>
            <TextField
              label="Season"
              hint="e.g. 2025-2026"
              value={fields.season}
              onChange={set('season')}
            />
            <Select
              label="Agreement status"
              value={terms.agreement_status ?? ''}
              onChange={setTerm('agreement_status')}
            >
              <option value="">—</option>
              <option value="Signed">Signed</option>
              <option value="Pending">Pending</option>
              <option value="Expired">Expired</option>
              <option value="None">None</option>
            </Select>
            <Select
              label="Travel manager"
              value={fields.assigned_to}
              onChange={(e) => setFields((f) => ({ ...f, assigned_to: e.target.value }))}
            >
              <option value="">Unassigned</option>
              {staffProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email || p.id}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Primary contact
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Name"
              value={fields.primary_contact_name}
              onChange={set('primary_contact_name')}
            />
            <TextField
              label="Title"
              value={fields.primary_contact_title}
              onChange={set('primary_contact_title')}
            />
            <TextField
              label="Email"
              type="email"
              value={fields.primary_contact_email}
              onChange={set('primary_contact_email')}
            />
            <TextField
              label="Phone"
              value={fields.primary_contact_phone}
              onChange={set('primary_contact_phone')}
            />
            <div className="sm:col-span-2">
              <TextField
                label="Address"
                value={fields.primary_contact_address}
                onChange={set('primary_contact_address')}
              />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <button
            type="button"
            onClick={() => setShowTerms(v => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Season defaults</h2>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                Pre-fills room counts and windows on every new trip for this team
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500 ml-4">
              {showTerms ? '▲ Hide' : '▼ Set up (optional)'}
            </span>
          </button>
          {showTerms && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField
                label="Default king rooms"
                type="number"
                hint="How many king rooms this team typically needs per stay"
                value={terms.default_king_rooms ?? ''}
                onChange={setTerm('default_king_rooms')}
              />
              <TextField
                label="Default double rooms"
                type="number"
                hint="Double-bedded rooms needed per stay"
                value={terms.default_double_rooms ?? ''}
                onChange={setTerm('default_double_rooms')}
              />
              <TextField
                label="Default suites"
                type="number"
                hint="Suites needed per stay (coaches, star players, etc.)"
                value={terms.default_suites ?? ''}
                onChange={setTerm('default_suites')}
              />
              <TextField
                label="Default total rooms"
                type="number"
                hint="Kings + doubles + suites combined"
                value={terms.default_total_rooms ?? ''}
                onChange={setTerm('default_total_rooms')}
              />
              <TextField
                label="In-season tournament window"
                hint="e.g. Nov 12 – Dec 14, 2025"
                value={terms.in_season_tournament_window ?? ''}
                onChange={setTerm('in_season_tournament_window')}
              />
              <TextField
                label="Postseason window"
                hint="e.g. Apr 19 – Jun 22, 2026"
                value={terms.postseason_window ?? ''}
                onChange={setTerm('postseason_window')}
              />
              <TextField
                label="Postseason room count"
                hint="Leave blank to use the same block as the regular stay"
                value={terms.postseason_rooms_text ?? ''}
                onChange={setTerm('postseason_rooms_text')}
              />
              <TextField
                label="Default meeting spaces required"
                hint="e.g. 3–4 or 5–6 — auto-populates on RFPs for this client"
                value={terms.default_meeting_spaces ?? ''}
                onChange={setTerm('default_meeting_spaces')}
              />
            </div>
          )}
        </Card>

        {/* Always CC */}
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Always CC on Emails
          </h2>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            When enabled, this contact is automatically CC'd on every RFP invitation and reminder sent for this client.
          </p>
          <label className="mb-4 flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
              checked={alwaysCc.enabled}
              onChange={(e) => setAlwaysCc((a) => ({ ...a, enabled: e.target.checked }))}
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Always CC a client contact on all emails for this team
            </span>
          </label>
          {alwaysCc.enabled && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="CC contact name"
                placeholder="e.g. John Smith"
                value={alwaysCc.name}
                onChange={(e) => setAlwaysCc((a) => ({ ...a, name: e.target.value }))}
              />
              <TextField
                label="CC contact email"
                type="email"
                placeholder="e.g. jsmith@nationals.com"
                value={alwaysCc.email}
                onChange={(e) => setAlwaysCc((a) => ({ ...a, email: e.target.value }))}
              />
            </div>
          )}
        </Card>

        {/* Sample menus KJST shares with hotels (F&B teams) */}
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Sample Menus for Hotels
          </h2>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            Upload your example menus / F&amp;B pricing sheets for this team. Hotels see them on the RFP form and in the invitation email, so they know the format you expect. Leave empty for teams that don't need F&amp;B.
          </p>

          {sampleMenus.length > 0 && (
            <ul className="mb-3 space-y-2">
              {sampleMenus.map((m) => (
                <li
                  key={m.path}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 px-3 py-2"
                >
                  <a
                    href={sampleMenuUrl(m.path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200 hover:underline"
                  >
                    📎 {m.name}{m.size ? ` · ${formatBytes(m.size)}` : ''}
                  </a>
                  <button
                    type="button"
                    onClick={() => removeSampleMenu(m.path)}
                    className="shrink-0 text-xs font-medium text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 ${menuUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {menuUploading ? 'Uploading…' : '+ Add sample menu'}
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/*"
              className="hidden"
              onChange={handleSampleMenuUpload}
              disabled={menuUploading}
            />
          </label>
          {menuError && <p className="mt-2 text-sm text-red-600">{menuError}</p>}
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving || menuUploading}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create client'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(editing ? `/clients/${id}` : '/clients')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
