import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { KJLogoMark } from '../components/DashboardLayout'

type Mode = 'signin' | 'signup' | 'forgot' | 'reset'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none'

export default function Login() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Detect Supabase password-recovery redirect (link clicked from email)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset')
    })
    return () => subscription.unsubscribe()
  }, [])

  // Already signed in and not in reset flow → go to the dashboard
  if (session && mode !== 'reset') return <Navigate to="/" replace />

  const clear = () => { setError(null); setNotice(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    clear()
    setBusy(true)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else navigate('/', { replace: true })

    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) setError(error.message)
      else if (data.session) navigate('/', { replace: true })
      else setNotice('Account created. Check your email to confirm, then sign in.')

    } else if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      })
      if (error) setError(error.message)
      else setNotice('Password reset link sent — check your inbox.')

    } else if (mode === 'reset') {
      if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); setBusy(false); return }
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) setError(error.message)
      else {
        setNotice('Password updated successfully!')
        setTimeout(() => navigate('/', { replace: true }), 1500)
      }
    }

    setBusy(false)
  }

  const title =
    mode === 'forgot' ? 'Reset your password' :
    mode === 'reset'  ? 'Set a new password' :
    mode === 'signup' ? 'Create your account' :
                        'Sign in to your account'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mb-3 flex justify-center">
            <KJLogoMark dark />
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">RFP Platform</h1>
          <p className="mt-1 text-sm text-slate-500">{title}</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* Signup: full name */}
          {mode === 'signup' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                className={inputCls} required />
            </div>
          )}

          {/* Sign in / Sign up / Forgot: email */}
          {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className={inputCls} required autoComplete="email" />
            </div>
          )}

          {/* Sign in / Sign up: password */}
          {(mode === 'signin' || mode === 'signup') && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Password</label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => { clear(); setMode('forgot') }}
                    className="text-xs text-slate-400 hover:text-[#1C1008] transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className={inputCls} required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={6} />
            </div>
          )}

          {/* Reset: new password */}
          {mode === 'reset' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                className={inputCls} required autoComplete="new-password" minLength={6}
                placeholder="At least 6 characters" />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-emerald-600">{notice}</p>}

          <button type="submit" disabled={busy}
            className="w-full rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-medium text-white hover:bg-[#2C1A0D] disabled:opacity-50">
            {busy ? 'Please wait…' :
             mode === 'forgot' ? 'Send reset link' :
             mode === 'reset'  ? 'Update password' :
             mode === 'signup' ? 'Create account' :
                                 'Sign in'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-slate-500">
          {mode === 'signin' && (
            <button onClick={() => { clear(); setMode('signup') }} className="text-[#1C1008] hover:underline">
              Need an account? Create one
            </button>
          )}
          {mode === 'signup' && (
            <button onClick={() => { clear(); setMode('signin') }} className="text-[#1C1008] hover:underline">
              Already have an account? Sign in
            </button>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button onClick={() => { clear(); setMode('signin') }} className="text-slate-400 hover:text-[#1C1008] hover:underline">
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
