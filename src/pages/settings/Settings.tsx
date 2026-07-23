import { useState } from 'react'
import { useTheme, type Theme } from '../../contexts/ThemeContext'
import { useAuth } from '../../auth/AuthContext'

// ── Theme preview mini-mockups ──────────────────────────────────────────────

function LightPreview() {
  return (
    <div className="w-full rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex h-3 items-center gap-1 bg-slate-100 px-2">
        <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <div className="h-1 w-8 rounded-full bg-slate-300" />
      </div>
      <div className="flex gap-1.5 p-2">
        <div className="w-8 shrink-0 rounded bg-[#1C1008]/80 py-2" />
        <div className="flex-1 space-y-1">
          <div className="h-2 rounded bg-slate-200" />
          <div className="h-2 w-3/4 rounded bg-slate-100" />
          <div className="h-2 w-1/2 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

function DarkPreview() {
  return (
    <div className="w-full rounded-lg border border-slate-700 bg-slate-900 overflow-hidden shadow-sm">
      <div className="flex h-3 items-center gap-1 bg-slate-800 px-2">
        <div className="h-1.5 w-1.5 rounded-full bg-slate-600" />
        <div className="h-1 w-8 rounded-full bg-slate-600" />
      </div>
      <div className="flex gap-1.5 p-2">
        <div className="w-8 shrink-0 rounded bg-[#1C1008] py-2" />
        <div className="flex-1 space-y-1">
          <div className="h-2 rounded bg-slate-700" />
          <div className="h-2 w-3/4 rounded bg-slate-800" />
          <div className="h-2 w-1/2 rounded bg-slate-800" />
        </div>
      </div>
    </div>
  )
}

function SystemPreview() {
  return (
    <div className="w-full rounded-lg border border-slate-300 overflow-hidden shadow-sm">
      <div className="flex">
        <div className="w-1/2 bg-white p-1.5">
          <div className="h-1.5 rounded bg-slate-200 mb-1" />
          <div className="h-1.5 w-2/3 rounded bg-slate-100" />
        </div>
        <div className="w-1/2 bg-slate-900 p-1.5">
          <div className="h-1.5 rounded bg-slate-700 mb-1" />
          <div className="h-1.5 w-2/3 rounded bg-slate-800" />
        </div>
      </div>
    </div>
  )
}

// ── Preference storage ──────────────────────────────────────────────────────

const PREFS_KEY = 'kjst_prefs'

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function savePrefs(prefs: Record<string, unknown>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

const THEME_OPTIONS: { key: Theme; label: string; icon: string; description: string; Preview: React.FC }[] = [
  {
    key: 'light',
    label: 'Light',
    icon: '☀️',
    description: 'Default light interface',
    Preview: LightPreview,
  },
  {
    key: 'dark',
    label: 'Dark',
    icon: '🌙',
    description: 'Easier on the eyes at night',
    Preview: DarkPreview,
  },
  {
    key: 'system',
    label: 'System',
    icon: '🖥️',
    description: 'Matches your device setting',
    Preview: SystemPreview,
  },
]

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()

  const prefs = loadPrefs()
  const [deadlineDays, setDeadlineDays] = useState<string>(
    String(prefs.defaultDeadlineDays ?? 7),
  )
  const [saved, setSaved] = useState(false)

  const handleSavePrefs = () => {
    savePrefs({ ...loadPrefs(), defaultDeadlineDays: Number(deadlineDays) || 7 })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage your preferences and account.
        </p>
      </div>

      {/* Appearance */}
      <Section
        title="Appearance"
        description="Choose how KJST RFP looks to you."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {THEME_OPTIONS.map(({ key, label, icon, description, Preview }) => {
            const isSelected = theme === key
            return (
              <button
                key={key}
                onClick={() => setTheme(key)}
                className={`relative rounded-xl border-2 p-4 text-left transition-all ${
                  isSelected
                    ? 'border-[#1C1008] ring-1 ring-[#1C1008]/30 dark:border-amber-400 dark:ring-amber-400/20'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500'
                }`}
              >
                {/* Checkmark */}
                {isSelected && (
                  <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#1C1008] dark:bg-amber-400">
                    <svg className="h-3 w-3 text-white dark:text-slate-900" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}

                {/* Mini preview */}
                <div className="mb-3">
                  <Preview />
                </div>

                {/* Label */}
                <div className="flex items-center gap-1.5">
                  <span className="text-base">{icon}</span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
              </button>
            )
          })}
        </div>
      </Section>

      {/* Account */}
      <Section title="Account" description="Your login information.">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
            </label>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-700">
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {user?.email ?? '—'}
              </span>
              <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                Verified
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              To change your email, contact your administrator.
            </p>
          </div>
        </div>
      </Section>

      {/* Preferences */}
      <Section
        title="Preferences"
        description="Default values used when creating new trips."
      >
        <div className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Default response deadline
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={90}
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(e.target.value)}
                className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1C1008] focus:outline-none focus:ring-1 focus:ring-[#1C1008] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:focus:border-amber-400 dark:focus:ring-amber-400/30"
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                days before arrival date
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              When you create a trip, the response deadline will default to this many days before
              the arrival date.
            </p>
          </div>

          <div>
            <button
              onClick={handleSavePrefs}
              className="rounded-lg bg-[#1C1008] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d1e0e] dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-slate-900"
            >
              {saved ? '✓ Saved' : 'Save preferences'}
            </button>
          </div>
        </div>
      </Section>

      {/* About */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              KJST RFP Platform
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Built for KJ Sports Travel · Internal tool
            </p>
          </div>
          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">
            v1.0
          </span>
        </div>
      </div>
    </div>
  )
}
