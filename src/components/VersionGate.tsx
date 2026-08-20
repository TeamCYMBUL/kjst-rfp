import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

// Keeps every open tab on the latest deploy. Staff often leave the app open for
// days; without this they keep running whatever bundle was live when the tab was
// opened — so already-fixed bugs "come back" for them. We bake the build id into
// the app (__APP_VERSION__) and also publish it at /version.json. This polls that
// file; when it differs, a newer deploy is live and we refresh the client:
//   • automatically at the next page navigation (a natural, safe break), and
//   • immediately if the user clicks the banner.
// index.html and version.json are served no-store (see vercel.json), so a reload
// always pulls the newest code — there is no stale cache to fight.

const CURRENT = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
const POLL_MS = 2 * 60 * 1000 // check every 2 minutes and on tab focus

export default function VersionGate() {
  const [stale, setStale] = useState(false)
  const staleRef = useRef(false)
  const location = useLocation()

  useEffect(() => {
    if (CURRENT === 'dev') return // don't nag during local dev
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const { version } = await res.json()
        if (!cancelled && version && version !== CURRENT) {
          staleRef.current = true
          setStale(true)
        }
      } catch {
        /* offline or transient — ignore, we'll try again */
      }
    }
    check()
    const id = window.setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener('focus', check)
    }
  }, [])

  // Auto-refresh at the next navigation once a new version is waiting. A route
  // change is a natural break (nobody is mid-edit), so this updates active users
  // seamlessly. Users parked on one screen get the banner below.
  useEffect(() => {
    if (staleRef.current) window.location.reload()
  }, [location.pathname])

  if (!stale) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-[#1C1008] px-4 py-2 text-sm text-white shadow-lg">
      <span>A new version of the platform is available.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md bg-white px-3 py-1 text-xs font-semibold text-[#1C1008] hover:bg-slate-100"
      >
        Refresh now
      </button>
    </div>
  )
}
