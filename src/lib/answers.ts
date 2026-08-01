import { supabase } from './supabase'

// Fetch ALL concession answers for a set of responses, paging past Supabase's
// 1000-row cap. A big client (or a trip with many hotels) can have thousands of
// answers; a single un-paged query would silently return only the first 1000,
// making every later bid render with dashes instead of its real Yes/No answers.
export async function fetchAllAnswersByResponseIds(
  responseIds: string[],
): Promise<any[]> {
  if (responseIds.length === 0) return []
  const PAGE = 1000
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('concession_answers')
      .select('response_id, concession_item_id, answer_yes_no, answer_value, comment')
      .in('response_id', responseIds)
      .order('response_id')
      .order('concession_item_id')
      .range(from, from + PAGE - 1)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}
