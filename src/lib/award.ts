// Shared per-stay award logic — used by BOTH the Full grid (TripGrid) and the
// trip page (TripDetail) so the two can never drift apart.
//
// A trip can have TWO visits (same city twice) and the client may pick a
// different hotel per stay, so awards are tracked per stay (awarded_stay1 /
// awarded_stay2). Awarding a stay marks that winner; the trip only closes (and
// the non-winners get passed) once EVERY stay has a winner. Single-visit trips
// have one stay = Stay 1.
import { supabase } from './supabase'
import { logActivity } from './activity'

export type AwardCtx = {
  tripId: string
  twoVisit: boolean
  clientId: string | null
}

/** Award one stay to a hotel. Closes + passes losers only when all stays are won. */
export async function awardStay(
  ctx: AwardCtx,
  invitationId: string,
  hotelName: string,
  stay: 1 | 2,
): Promise<void> {
  const patch =
    stay === 1 ? { status: 'awarded', awarded_stay1: true } : { status: 'awarded', awarded_stay2: true }
  await supabase.from('rfp_invitations').update(patch).eq('id', invitationId)

  // Re-read the trip's award state to decide whether every stay is now set.
  const { data: fresh } = await supabase
    .from('rfp_invitations')
    .select('awarded_stay1, awarded_stay2')
    .eq('trip_id', ctx.tripId)
  const rows = (fresh ?? []) as { awarded_stay1: boolean; awarded_stay2: boolean }[]
  const stay1Won = rows.some((r) => r.awarded_stay1)
  const stay2Won = rows.some((r) => r.awarded_stay2)
  const fullyAwarded = ctx.twoVisit ? stay1Won && stay2Won : stay1Won

  if (fullyAwarded) {
    // Pass only the submitted hotels that won NEITHER stay — never a winner,
    // and never a declined/unavailable/already-passed hotel.
    await supabase
      .from('rfp_invitations')
      .update({ status: 'passed' })
      .eq('trip_id', ctx.tripId)
      .eq('status', 'submitted')
      .eq('awarded_stay1', false)
      .eq('awarded_stay2', false)
    await supabase.from('trips').update({ status: 'closed' }).eq('id', ctx.tripId)
  } else {
    // Keep the trip open until the other stay is decided.
    await supabase.from('trips').update({ status: 'collecting' }).eq('id', ctx.tripId)
  }

  void logActivity({
    event_type: 'awarded',
    client_id: ctx.clientId,
    trip_id: ctx.tripId,
    detail: { hotel_name: hotelName, stay: ctx.twoVisit ? stay : null },
  })
}

/** Undo one stay's award. Reopens the trip; the hotel drops to Submitted only if it wins no other stay. */
export async function undoAwardStay(
  ctx: AwardCtx,
  inv: { id: string; awarded_stay1?: boolean; awarded_stay2?: boolean },
  stay: 1 | 2,
): Promise<void> {
  const stillWinsOtherStay = stay === 1 ? inv.awarded_stay2 : inv.awarded_stay1
  const patch: Record<string, unknown> = stay === 1 ? { awarded_stay1: false } : { awarded_stay2: false }
  if (!stillWinsOtherStay) patch.status = 'submitted'
  await supabase.from('rfp_invitations').update(patch).eq('id', inv.id)
  await supabase.from('trips').update({ status: 'collecting' }).eq('id', ctx.tripId)
}
