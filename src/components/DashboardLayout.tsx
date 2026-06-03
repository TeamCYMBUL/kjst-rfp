import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useProfile } from '../hooks/useProfile'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/clients', label: 'Clients' },
  { to: '/trips', label: 'Trips' },
  { to: '/hotels', label: 'Hotels' },
  { to: '/template', label: 'Template' },
]

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
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}

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
              Team
            </NavLink>
          )}

        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="truncate px-3 pb-2 text-xs text-white/35" title={user?.email ?? ''}>
            {user?.email}
          </div>
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
            ⚙️ Settings
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
