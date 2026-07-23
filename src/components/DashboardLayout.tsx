import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useProfile } from '../hooks/useProfile'
import { useRole } from '../lib/useRole'
import { TIMELINE_ADMIN_EMAIL } from '../lib/activity'


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
  const { role } = useRole()
  const isViewer = role === 'viewer'
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className={`flex h-screen ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
      {/* Mobile top bar (hidden on lg+) — hamburger opens the nav drawer */}
      <div className="lg:hidden fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 bg-[#1C1008] px-4">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <KJLogoMark />
      </div>

      {/* Mobile backdrop when drawer is open */}
      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setNavOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-[#1C1008] transform transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="border-b border-white/10 px-5 py-5">
          <KJLogoMark />
          <div className="mt-2 text-[11px] text-white/40 font-medium tracking-wide">
            RFP Platform
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" onClick={() => setNavOpen(false)}>
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

          {/* Playbook — always-available "how to run an RFP" guide */}
          <NavLink
            to="/playbook"
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-2">📖</span>Playbook
          </NavLink>

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

          {/* Timeline — restricted to the single timeline-admin account (not all
              admins). Mirrors the SQL is_timeline_admin() gate on the data. */}
          {user?.email === TIMELINE_ADMIN_EMAIL && (
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

        <div className="border-t border-white/10 p-3" onClick={() => setNavOpen(false)}>
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

      <main className={`flex-1 overflow-y-auto pt-14 lg:pt-0 ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
