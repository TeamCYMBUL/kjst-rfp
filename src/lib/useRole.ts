import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../auth/AuthContext'

export type UserRole = 'admin' | 'manager' | 'viewer' | null

export function useRole(): {
  role: UserRole
  loading: boolean
  assignedClientIds: Set<string>
  canEditClient: (clientId: string) => boolean
} {
  const { user } = useAuth()
  const [role, setRole] = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)
  const [assignedClientIds, setAssignedClientIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) {
      setRole(null)
      setAssignedClientIds(new Set())
      setLoading(false)
      return
    }

    Promise.all([
      // Role: read from profiles (authoritative table)
      supabase.from('profiles').select('role').eq('id', user.id).single(),
      // Assignments: which clients is this user responsible for?
      supabase.from('client_assignments').select('client_id').eq('staff_user_id', user.id),
    ]).then(([{ data: pData }, { data: aData }]) => {
      const r = pData?.role as string | undefined
      if (r === 'admin' || r === 'manager' || r === 'viewer') {
        setRole(r)
      } else {
        setRole('admin')
      }
      setAssignedClientIds(new Set((aData ?? []).map((a) => a.client_id)))
      setLoading(false)
    })
  }, [user?.id])

  const canEditClient = (clientId: string) => {
    if (role === 'admin') return true
    return assignedClientIds.has(clientId)
  }

  return { role, loading, assignedClientIds, canEditClient }
}
