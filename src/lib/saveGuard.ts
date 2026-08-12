// Save-integrity guard.
//
// A Supabase write can come back with error === null yet affect ZERO rows —
// most commonly when Row-Level Security silently blocks it (e.g. a manager
// editing a team they aren't assigned to). Without a check, the UI happily
// reports "saved" when nothing was written. That is the one failure mode we
// never want: an edit must either truly persist, or surface an error.
//
// Usage: append `.select(...)` to the write so the affected rows come back,
// then pass the result here. It throws on a real error OR on a 0-row write.
// Callers already have try/catch or error state to show the message.
//
//   assertSaved(
//     await supabase.from('trips').update(patch).eq('id', id).select('id'),
//     'save this trip',
//   )

type WriteResult = { data: unknown; error: { message: string } | null }

export function assertSaved(res: WriteResult, action = 'save this change'): void {
  if (res.error) throw new Error(res.error.message)
  const rows = Array.isArray(res.data) ? res.data : res.data == null ? [] : [res.data]
  if (rows.length === 0) {
    throw new Error(
      `Couldn't ${action}. You may not have permission to edit this team — only its assigned managers and admins can. ` +
        `If you should have access, refresh and try again, or ask an admin to add you to the team.`,
    )
  }
}
