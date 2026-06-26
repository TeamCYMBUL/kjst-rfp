import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { useProfile } from '../../hooks/useProfile'
import { ErrorNote, Loading } from '../../components/ui'

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callInviteStaff(body: {
  email: string
  display_name: string
  role: 'admin' | 'manager'
  client_ids?: string[]
}): Promise<{ ok: true } | { error: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${FN_BASE}/invite-staff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

// ── Types ──────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string
  display_name: string
  role: 'admin' | 'manager'
}

type ClientRow = {
  id: string
  team_name: string
  league: string | null
}

type Assignment = {
  staff_user_id: string
  client_id: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#1C1008] font-bold text-white ${sizes[size]}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

function RoleBadge({ role }: { role: 'admin' | 'manager' }) {
  return role === 'admin' ? (
    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      ⭐ Admin
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      Manager
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type InviteForm = {
  email: string
  display_name: string
  role: 'admin' | 'manager'
  client_ids: string[]
}

export default function TeamPage() {
  const { user } = useAuth()
  const { isAdmin, loading: profileLoading } = useProfile()

  const [staff, setStaff] = useState<StaffMember[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [selected, setSelected] = useState<StaffMember | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteForm>({ email: '', display_name: '', role: 'manager', client_ids: [] })
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const load = async () => {
    const [staffRes, clientsRes, assignRes] = await Promise.all([
      supabase
        .from('staff_profiles')
        .select('id, display_name, role')
        .order('display_name'),
      supabase
        .from('clients')
        .select('id, team_name, league')
        .order('team_name'),
      supabase
        .from('client_assignments')
        .select('staff_user_id, client_id'),
    ])

    if (staffRes.error) { setError(staffRes.error.message); setLoading(false); return }
    if (clientsRes.error) { setError(clientsRes.error.message); setLoading(false); return }

    const staffData = (staffRes.data ?? []) as StaffMember[]
    setStaff(staffData)
    setClients((clientsRes.data ?? []) as ClientRow[])
    setAssignments((assignRes.data ?? []) as Assignment[])
    if (staffData.length > 0 && !selected) setSelected(staffData[0])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const toggleAssignment = async (clientId: string) => {
    if (!selected || selected.role === 'admin') return
    const exists = assignments.some(
      (a) => a.staff_user_id === selected.id && a.client_id === clientId,
    )
    setSaving(true)

    if (exists) {
      const { error } = await supabase
        .from('client_assignments')
        .delete()
        .eq('staff_user_id', selected.id)
        .eq('client_id', clientId)
      if (!error) {
        setAssignments((prev) =>
          prev.filter((a) => !(a.staff_user_id === selected.id && a.client_id === clientId)),
        )
      }
    } else {
      const { data, error } = await supabase
        .from('client_assignments')
        .insert({ staff_user_id: selected.id, client_id: clientId, assigned_by: user?.id })
        .select('staff_user_id, client_id')
        .single()
      if (!error && data) setAssignments((prev) => [...prev, data as Assignment])
    }

    setSaving(false)
  }

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)
    const result = await callInviteStaff({
      email: inviteForm.email.trim(),
      display_name: inviteForm.display_name.trim(),
      role: inviteForm.role,
      client_ids: inviteForm.role === 'manager' ? inviteForm.client_ids : [],
    })
    setInviting(false)
    if ('error' in result) {
      setInviteError(result.error)
    } else {
      setInviteSuccess(`Invite sent to ${inviteForm.email}. They'll receive a link to set their password.`)
      setInviteForm({ email: '', display_name: '', role: 'manager', client_ids: [] })
      // Reload staff list to show the new member
      load()
    }
  }

  if (profileLoading || loading) return <Loading />
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-16 text-center dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-3 text-4xl">🔒</div>
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-200">Admin access only</h2>
        <p className="mt-1 text-sm text-slate-400">Only admins can manage team members.</p>
      </div>
    )
  }
  if (error) return <ErrorNote message={error} />

  const selectedAssignedClientIds = assignments
    .filter((a) => a.staff_user_id === selected?.id)
    .map((a) => a.client_id)

  const managers = staff.filter((s) => s.role === 'manager')
  const admins = staff.filter((s) => s.role === 'admin')

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Team</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {staff.length} member{staff.length !== 1 ? 's' : ''} ·{' '}
            {managers.length} manager{managers.length !== 1 ? 's' : ''} ·{' '}
            {admins.length} admin{admins.length !== 1 ? 's' : ''}
          </p>
        </div>

        <button
          onClick={() => { setInviteOpen(true); setInviteError(null); setInviteSuccess(null) }}
          className="rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d1e0e] transition-colors"
        >
          + Invite staff member
        </button>
      </div>

      {staff.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-16 text-center dark:border-slate-600 dark:bg-slate-800">
          <div className="mb-3 text-4xl">👥</div>
          <p className="text-sm text-slate-400">No team members yet. Invite someone to get started.</p>
        </div>
      ) : (
        <div
          className="flex overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
          style={{ minHeight: 500 }}
        >
          {/* ── Left: staff list ── */}
          <div className="flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Team members
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {staff.map((member) => {
                const isSelected = selected?.id === member.id
                const assignCount = assignments.filter(
                  (a) => a.staff_user_id === member.id,
                ).length
                return (
                  <button
                    key={member.id}
                    onClick={() => setSelected(member)}
                    className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition-colors last:border-0 dark:border-slate-700 ${
                      isSelected
                        ? 'bg-[#1C1008]/5 dark:bg-amber-400/5'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Avatar name={member.display_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm font-semibold ${
                          isSelected
                            ? 'text-[#1C1008] dark:text-amber-400'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {member.display_name}
                        {member.id === user?.id && (
                          <span className="ml-1 text-xs font-normal text-slate-400"> (you)</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span
                          className={`text-xs font-medium ${
                            member.role === 'admin' ? 'text-amber-600' : 'text-slate-400'
                          }`}
                        >
                          {member.role === 'admin' ? '⭐ Admin' : 'Manager'}
                        </span>
                        {member.role === 'manager' && assignCount > 0 && (
                          <span className="text-xs text-slate-400">
                            {assignCount} client{assignCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Right: detail panel ── */}
          {selected ? (
            <div className="flex-1 overflow-y-auto">
              {/* Person header */}
              <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <Avatar name={selected.display_name} size="lg" />
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                        {selected.display_name}
                        {selected.id === user?.id && (
                          <span className="ml-2 text-sm font-normal text-slate-400">(you)</span>
                        )}
                      </h2>
                      <div className="mt-1">
                        <RoleBadge role={selected.role} />
                      </div>
                    </div>
                  </div>
                </div>

                {selected.role === 'admin' && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/20">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      Admins have unrestricted access to all clients, trips, and data. No per-client assignment is needed.
                    </p>
                  </div>
                )}
              </div>

              {/* Client assignments — managers only */}
              {selected.role === 'manager' && (
                <div className="px-6 py-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Client assignments
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {selected.display_name} can only see and work on checked clients.
                      </p>
                    </div>
                    {saving && (
                      <span className="text-xs text-slate-400">Saving…</span>
                    )}
                  </div>

                  {clients.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center dark:border-slate-600">
                      <p className="text-sm text-slate-400">
                        No clients in the system yet. Add clients first, then assign them here.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Summary chips */}
                      {selectedAssignedClientIds.length > 0 && (
                        <div className="mb-4 flex flex-wrap gap-2">
                          {selectedAssignedClientIds.map((cid) => {
                            const c = clients.find((cl) => cl.id === cid)
                            if (!c) return null
                            return (
                              <span
                                key={cid}
                                className="rounded-full bg-[#1C1008]/10 px-3 py-1 text-xs font-semibold text-[#1C1008] dark:bg-amber-400/10 dark:text-amber-300"
                              >
                                {c.team_name}
                              </span>
                            )
                          })}
                        </div>
                      )}

                      {/* Toggle list */}
                      <div className="space-y-2">
                        {clients.map((client) => {
                          const assigned = selectedAssignedClientIds.includes(client.id)
                          return (
                            <button
                              key={client.id}
                              onClick={() => toggleAssignment(client.id)}
                              disabled={saving}
                              className={`flex w-full items-center gap-4 rounded-lg border px-4 py-3 text-left transition-all disabled:opacity-60 ${
                                assigned
                                  ? 'border-[#1C1008]/25 bg-[#1C1008]/5 dark:border-amber-400/25 dark:bg-amber-400/5'
                                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500'
                              }`}
                            >
                              {/* Checkbox ring */}
                              <div
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                  assigned
                                    ? 'border-[#1C1008] bg-[#1C1008] dark:border-amber-400 dark:bg-amber-400'
                                    : 'border-slate-300 dark:border-slate-500'
                                }`}
                              >
                                {assigned && (
                                  <svg
                                    className="h-3 w-3 text-white dark:text-slate-900"
                                    viewBox="0 0 12 12"
                                    fill="none"
                                  >
                                    <path
                                      d="M2 6l3 3 5-5"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </div>

                              <div className="flex-1">
                                <span
                                  className={`text-sm font-medium ${
                                    assigned
                                      ? 'text-[#1C1008] dark:text-amber-300'
                                      : 'text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {client.team_name}
                                </span>
                                {client.league && (
                                  <span className="ml-2 text-xs text-slate-400">
                                    {client.league}
                                  </span>
                                )}
                              </div>

                              <span
                                className={`shrink-0 text-xs font-medium ${
                                  assigned ? 'text-[#1C1008] dark:text-amber-400' : 'text-slate-400'
                                }`}
                              >
                                {assigned ? '✓ Assigned' : 'Not assigned'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Select a team member to manage their access.
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-300">How access control works</p>
        <ul className="mt-2 space-y-1 text-xs">
          <li>· <strong>Admins</strong> see all clients, trips, and data across the platform.</li>
          <li>· <strong>Managers</strong> only see the clients you assign to them — nothing else is visible, even if they know a URL.</li>
          <li>· Assignments take effect instantly and are enforced at the database level.</li>
          <li>· New staff receive an email invite with a link to set their password.</li>
        </ul>
      </div>

      {/* ── Invite modal ── */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Invite staff member</h2>
              <button onClick={() => setInviteOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {inviteSuccess ? (
              <div className="px-6 py-8 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-sm text-slate-700 dark:text-slate-200">{inviteSuccess}</p>
                <button
                  onClick={() => { setInviteOpen(false); setInviteSuccess(null) }}
                  className="mt-5 rounded-lg bg-[#1C1008] px-5 py-2 text-sm font-semibold text-white hover:bg-[#2d1e0e]"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submitInvite} className="px-6 py-5 space-y-4">
                {inviteError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{inviteError}</div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">Full name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Tammy Lopez"
                    value={inviteForm.display_name}
                    onChange={(e) => setInviteForm((f) => ({ ...f, display_name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">Work email *</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. tammy@kjsportstravel.com"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">Role *</label>
                  <div className="flex gap-3">
                    {(['manager', 'admin'] as const).map((r) => (
                      <label key={r} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${inviteForm.role === r ? 'border-[#1C1008] bg-[#1C1008]/5 text-[#1C1008] dark:border-amber-400 dark:text-amber-300' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400'}`}>
                        <input type="radio" className="sr-only" checked={inviteForm.role === r} onChange={() => setInviteForm((f) => ({ ...f, role: r, client_ids: [] }))} />
                        <span>{r === 'admin' ? '⭐ Admin' : 'Manager'}</span>
                      </label>
                    ))}
                  </div>
                  {inviteForm.role === 'admin' && (
                    <p className="mt-1.5 text-xs text-amber-600">Admins have full access to all clients and data.</p>
                  )}
                </div>

                {inviteForm.role === 'manager' && clients.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">Assign clients (optional — can be set later)</label>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                      {clients.map((c) => {
                        const checked = inviteForm.client_ids.includes(c.id)
                        return (
                          <label key={c.id} className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${checked ? 'text-[#1C1008] dark:text-amber-300 font-medium' : 'text-slate-700 dark:text-slate-300'}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => setInviteForm((f) => ({
                                ...f,
                                client_ids: e.target.checked
                                  ? [...f.client_ids, c.id]
                                  : f.client_ids.filter((id) => id !== c.id),
                              }))}
                              className="h-4 w-4 rounded border-slate-300 accent-[#1C1008]"
                            />
                            {c.team_name}
                            {c.league && <span className="ml-1 text-xs text-slate-400">{c.league}</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={inviting}
                    className="flex-1 rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d1e0e] disabled:opacity-50"
                  >
                    {inviting ? 'Sending invite…' : 'Send invite'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteOpen(false)}
                    className="rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
