import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../auth/AuthContext'

export type UserRole = 'admin' | 'manager' | 'viewer' | null

export function useRole(): { role: UserRole; loading: boolean } {
  const { user } = useAuth()
  const [role, setRole] = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setRole(null)
      setLoading(false)
      return
    }

    // Try staff_profiles first (existing table), fall back to profiles
    supabase
      .from('staff_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!error && data?.role) {
          const r = data.role as string
          if (r === 'admin' || r === 'manager' || r === 'viewer') {
            setRole(r)
          } else {
            setRole('admin') // unknown role → treat as admin
          }
          setLoading(false)
        } else {
          // Fall back to profiles table
          supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
            .then(({ data: pData }) => {
              const r = pData?.role as string | undefined
              if (r === 'admin' || r === 'manager' || r === 'viewer') {
                setRole(r)
              } else {
                setRole('admin') // default to admin for existing users
              }
              setLoading(false)
            })
        }
      })
  }, [user?.id])

  return { role, loading }
}
