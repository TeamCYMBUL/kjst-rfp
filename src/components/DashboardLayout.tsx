import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useProfile } from '../hooks/useProfile'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'
import { useRole } from '../lib/useRole'


function KJLogoMark({ dark = false }: { dark?: boolean }) {
  const color = dark ? '#1C1008' : 'white'
  return (
    <div className="flex items-center gap-2.5">
      {/* Double-border KJ box — mirrors the logo mark */}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center p-0.5"
        style={{ border: `2.5px solid ${color}` }}
      >
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ border: `1px solid ${color}` }}
        >
          <span className="text-sm font-black leading-none" style={{ color }}>
            KJ
          </span>
        </div>
      </div>
      {/* SPORTS / TRAVEL stacked text */}
      <div className="leading-[1.15]">
        <div className="text-[10px] font-black tracking-[0.18em]" style={{ color }}>
          SPORTS
        </div>
        <div className="text-[10px] font-black tracking-[0.18em]" style={{ color }}>
          TRAVEL
        </div>
      </div>
    </div>
  )
}

export { KJLogoMark }

export default function DashboardLayout() {
  const { user, signOut } = useAuth()
  const { isDark } = useTheme()
  const { isAdmin } = useProfile()
  const { completedCount, allDone, steps } = useOnboardingProgress()
  const { role } = useRole()
  const isViewer = role === 'viewer'

  return (
    <div className={`flex h-screen ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
      <aside className="flex w-60 flex-col bg-[#1C1008]">
        {/* Logo */}
        <div className="border-b border-white/10 px-5 py-5">
          <KJLogoMark />
          <div className="mt-2 text-[11px] text-white/40 font-medium tracking-wide">
            RFP Platform
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {/* Dashboard */}
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">📊</span>Dashboard
          </NavLink>

          {/* Get Started — only when onboarding not complete */}
          {!allDone && (
            <NavLink
              to="/getting-started"
              className={({ isActive }) =>
                `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span>
                <span className="mr-2">🚀</span>Get Started
              </span>
              <span className="rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-bold text-[#1C1008]">
                {completedCount}/{steps.length}
              </span>
            </NavLink>
          )}

          {/* Clients */}
          <NavLink
            to="/clients"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">🏀</span>Clients
          </NavLink>

          {/* Trips */}
          <NavLink
            to="/trips"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">✈️</span>Trips
          </NavLink>

          {/* RFPs — every hotel invitation across all trips */}
          <NavLink
            to="/rfps"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">📨</span>RFPs
          </NavLink>

          {/* Hotels */}
          <NavLink
            to="/hotels"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">🏨</span>Hotels
          </NavLink>

          {/* RFP Template */}
          <NavLink
            to="/template"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">📋</span>RFP Template
          </NavLink>

          {/* Timeline — admin only. Gated on the profiles-based role so it agrees
              with the RLS/is_admin() source (which is profiles.role, not staff_profiles). */}
          {role === 'admin' && (
            <NavLink
              to="/timeline"
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span className="mr-2">🕓</span>Timeline
            </NavLink>
          )}

          {/* Team — admin only */}
          {isAdmin && (
            <NavLink
              to="/team"
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span className="mr-2">👥</span>Team
            </NavLink>
          )}

        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="truncate px-3 pb-1 text-xs text-white/35" title={user?.email ?? ''}>
            {user?.email}
          </div>
          {isViewer && (
            <div className="px-3 pb-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/50">
                👁 View only
              </span>
            </div>
          )}
          <NavLink
            to="/tickets"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">🎫</span>Submit a Ticket
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">⚙️</span>Settings
          </NavLink>
          <button
            onClick={signOut}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className={`flex-1 overflow-y-auto ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
        <div className="mx-auto max-w-5xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
