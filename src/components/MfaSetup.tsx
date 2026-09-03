import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Optional two-factor (TOTP) enrollment for staff. Purely opt-in: this only lets
// a user ADD or REMOVE an authenticator app. Nothing anywhere enforces MFA, so a
// user without it signs in exactly as before. No lockout risk.

type Factor = { id: string; friendly_name?: string | null; status: string }
type Enroll = { factorId: string; qr: string; secret: string }

function friendlyError(m: string): string {
  if (/not enabled|disabled|unsupported/i.test(m)) {
    return 'Two-factor sign-in is not enabled for this workspace yet. An admin can turn on MFA in the Supabase Auth settings; then this will work.'
  }
  return m
}

export default function MfaSetup() {
  const [factors, setFactors] = useState<Factor[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [enroll, setEnroll] = useState<Enroll | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) setErr(friendlyError(error.message))
    else setFactors(((data?.totp ?? []) as Factor[]).filter((f) => f.status === 'verified'))
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const startEnroll = async () => {
    setErr(null)
    setBusy(true)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    setBusy(false)
    if (error || !data) { setErr(friendlyError(error?.message ?? 'Could not start setup.')); return }
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    setCode('')
  }

  const confirmEnroll = async () => {
    if (!enroll) return
    setBusy(true)
    setErr(null)
    const ch = await supabase.auth.mfa.challenge({ factorId: enroll.factorId })
    if (ch.error) { setBusy(false); setErr(ch.error.message); return }
    const v = await supabase.auth.mfa.verify({ factorId: enroll.factorId, challengeId: ch.data.id, code: code.trim() })
    setBusy(false)
    if (v.error) { setErr('That code did not match. Enter the current 6-digit code from your app.'); return }
    setEnroll(null)
    setCode('')
    refresh()
  }

  const cancelEnroll = async () => {
    if (enroll) { try { await supabase.auth.mfa.unenroll({ factorId: enroll.factorId }) } catch { /* ignore */ } }
    setEnroll(null)
    setCode('')
    setErr(null)
  }

  const remove = async (factorId: string) => {
    if (!confirm('Remove this authenticator? Your login will no longer ask for a code.')) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) setErr(error.message)
    else refresh()
  }

  if (loading) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</div>
      )}

      {factors.length > 0 && (
        <ul className="space-y-2">
          {factors.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Authenticator app <span className="text-emerald-600 dark:text-emerald-400">· active</span>
              </span>
              <button onClick={() => remove(f.id)} disabled={busy}
                className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {enroll ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Scan this with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.
          </p>
          <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <img src={enroll.qr} alt="Authenticator QR code" className="h-40 w-40 rounded bg-white p-2" />
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Can’t scan? Enter this key manually:
              <code className="mt-1 block break-all rounded bg-slate-100 dark:bg-slate-700 px-2 py-1 font-mono text-slate-700 dark:text-slate-200">{enroll.secret}</code>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" placeholder="123456"
              className="w-28 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-1.5 text-sm tracking-widest text-slate-900 dark:text-slate-100" />
            <button onClick={confirmEnroll} disabled={busy || code.length !== 6}
              className="rounded-lg bg-[#1C1008] dark:bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white dark:text-slate-900 disabled:opacity-50">
              {busy ? 'Verifying…' : 'Turn on'}
            </button>
            <button onClick={cancelEnroll} disabled={busy}
              className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        factors.length === 0 && (
          <button onClick={startEnroll} disabled={busy}
            className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
            {busy ? 'Starting…' : 'Add authenticator app'}
          </button>
        )
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Optional. Adding this asks for a one-time code from your phone at each sign-in.
      </p>
    </div>
  )
}
