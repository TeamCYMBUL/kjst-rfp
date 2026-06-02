import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type OnboardingStep = {
  n: number
  title: string
  description: string
  done: boolean
  href: string
  cta: string
}

export type OnboardingProgress = {
  steps: OnboardingStep[]
  completedCount: number
  allDone: boolean
  loading: boolean
}

export function useOnboardingProgress(): OnboardingProgress {
  const [done, setDone] = useState({
    hasClient: false,
    hasTrip: false,
    hasInvitation: false,
    hasSentEmail: false,
    hasBid: false,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [clients, trips, invitations, sentEmails, bids] = await Promise.all([
        supabase.from('clients').select('id').limit(1),
        supabase.from('trips').select('id').limit(1),
        supabase.from('rfp_invitations').select('id').limit(1),
        supabase.from('rfp_invitations').select('id').not('sent_at', 'is', null).limit(1),
        supabase
          .from('rfp_invitations')
          .select('id')
          .in('status', ['submitted', 'awarded'])
          .limit(1),
      ])
      setDone({
        hasClient: (clients.data?.length ?? 0) > 0,
        hasTrip: (trips.data?.length ?? 0) > 0,
        hasInvitation: (invitations.data?.length ?? 0) > 0,
        hasSentEmail: (sentEmails.data?.length ?? 0) > 0,
        hasBid: (bids.data?.length ?? 0) > 0,
      })
      setLoading(false)
    }
    load()
  }, [])

  const steps: OnboardingStep[] = [
    {
      n: 1,
      title: 'Create your first client',
      description:
        'Add a sports team and set their default room block and tournament windows. These pre-fill every new trip automatically.',
      done: done.hasClient,
      href: '/clients/new',
      cta: 'Add a client',
    },
    {
      n: 2,
      title: 'Create your first trip',
      description:
        'Set the city, opponent, game dates, and room block for a road trip. This is what gets sent to hotels.',
      done: done.hasTrip,
      href: '/trips/new',
      cta: 'Add a trip',
    },
    {
      n: 3,
      title: 'Invite your first hotel',
      description:
        "From a trip's detail page, add a hotel's name and contact. A unique, secure RFP link is generated for each property.",
      done: done.hasInvitation,
      href: '/trips',
      cta: 'Go to trips',
    },
    {
      n: 4,
      title: 'Send your first email invitation',
      description:
        'Hit "Send email" on a hotel invitation. The hotel receives a branded email with their unique proposal link.',
      done: done.hasSentEmail,
      href: '/trips',
      cta: 'Go to trips',
    },
    {
      n: 5,
      title: 'Receive your first bid',
      description:
        'Once a hotel submits their proposal, you can compare all bids side by side on the comparison grid.',
      done: done.hasBid,
      href: '/trips',
      cta: 'View trips',
    },
  ]

  const completedCount = steps.filter((s) => s.done).length
  const allDone = completedCount === steps.length

  return { steps, completedCount, allDone, loading }
}
