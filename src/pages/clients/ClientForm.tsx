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
  TextArea,
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

// Default Terms live in a jsonb column. We keep numbers as strings in the form
// and coerce on save so empty inputs become null rather than 0.
const blankTerms: DefaultTerms = {
  agreement_status: '',
  commission_pct: '',
  attrition_pct: '',
  guarantee_language: '',
  default_king_rooms: null,
  default_suites: null,
  default_total_rooms: null,
  in_season_tournament_window: '',
  postseason_window: '',
  postseason_rooms_text: '',
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function ClientForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()

  const [fields, setFields] = useState(blank)
  const [terms, setTerms] = useState<DefaultTerms>(blankTerms)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
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
          setTerms({ ...blankTerms, ...(c.default_terms ?? {}) })
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
      assigned_to: fields.assigned_to || null,
      default_terms: {
        agreement_status: clean(terms.agreement_status ?? '') ?? undefined,
        attrition_pct: clean(terms.attrition_pct ?? '') ?? undefined,
        guarantee_language: clean(terms.guarantee_language ?? '') ?? undefined,
        default_king_rooms: numOrNull(String(terms.default_king_rooms ?? '')),
        default_suites: numOrNull(String(terms.default_suites ?? '')),
        default_total_rooms: numOrNull(String(terms.default_total_rooms ?? '')),
        in_season_tournament_window: clean(terms.in_season_tournament_window ?? '') ?? undefined,
        postseason_window: clean(terms.postseason_window ?? '') ?? undefined,
        postseason_rooms_text: clean(terms.postseason_rooms_text ?? '') ?? undefined,
      },
    }

    if (editing) {
      const { error } = await supabase.from('clients').update(payload).eq('id', id)
      if (error) {
        setError(error.message)
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
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Team
          </h2>

          {/* Logo upload */}
          <div className="mb-5 flex items-center gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-slate-50">
              {logoUrl ? (
                <img src={logoUrl} alt="Team logo" className="h-full w-full object-contain p-1" />
              ) : (
                <span className="text-2xl">🏀</span>
              )}
            </div>
            <div>
              <label className={`cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
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
              <p className="mt-1.5 text-xs text-slate-400">
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
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
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
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Default terms
          </h2>
          <p className="mb-4 text-xs text-slate-400">
            These pre-fill every new trip for this client, so staff usually only edit
            city/opponent/dates.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Attrition %"
              value={terms.attrition_pct ?? ''}
              onChange={setTerm('attrition_pct')}
            />
            <TextField
              label="Default king rooms"
              type="number"
              value={terms.default_king_rooms ?? ''}
              onChange={setTerm('default_king_rooms')}
            />
            <TextField
              label="Default suites"
              type="number"
              value={terms.default_suites ?? ''}
              onChange={setTerm('default_suites')}
            />
            <TextField
              label="Default total rooms"
              type="number"
              value={terms.default_total_rooms ?? ''}
              onChange={setTerm('default_total_rooms')}
            />
            <TextField
              label="In-season tournament window"
              value={terms.in_season_tournament_window ?? ''}
              onChange={setTerm('in_season_tournament_window')}
            />
            <TextField
              label="Postseason window"
              value={terms.postseason_window ?? ''}
              onChange={setTerm('postseason_window')}
            />
            <TextField
              label="Postseason rooms"
              value={terms.postseason_rooms_text ?? ''}
              onChange={setTerm('postseason_rooms_text')}
            />
            <div className="sm:col-span-2">
              <TextArea
                label="Guarantee language"
                rows={3}
                value={terms.guarantee_language ?? ''}
                onChange={setTerm('guarantee_language')}
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
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
