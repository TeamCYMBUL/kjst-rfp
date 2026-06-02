import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

export type StaffRole = 'admin' | 'manager'

export type StaffProfile = {
  id: string
  display_name: string
  role: StaffRole
}

let cached: StaffProfile | null = null

export function useProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<StaffProfile | null>(cached)
  const [loading, setLoading] = useState(cached === null)

  useEffect(() => {
    if (!user) {
      cached = null
      setProfile(null)
      setLoading(false)
      return
    }
    if (cached) {
      setProfile(cached)
      setLoading(false)
      return
    }
    supabase
      .from('staff_profiles')
      .select('id, display_name, role')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        const p = (data as StaffProfile) ?? null
        cached = p
        setProfile(p)
        setLoading(false)
      })
  }, [user?.id])

  return {
    profile,
    loading,
    isAdmin: profile?.role === 'admin',
    isManager: profile?.role === 'manager',
  }
}

/** Call this after updating a user's role to bust the cache */
export function bustProfileCache() {
  cached = null
}
