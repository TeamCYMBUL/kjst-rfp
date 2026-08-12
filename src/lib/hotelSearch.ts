// Shared "smart" hotel search used by the Hotels directory and the Add-hotel-to-RFP
// autocomplete. Normalizes text, matches each search word independently (word
// order doesn't matter, words can span fields), allows partial words, and
// tolerates a single-character typo per word.

export const normalizeSearch = (s: string): string =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

// True if a and b differ by at most one insert / delete / substitution.
export const withinOneEdit = (a: string, b: string): boolean => {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) // substitution
  return la < lb ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i) // insert / delete
}

// Build a matcher for a query. Returns a predicate over a list of text fields.
export const makeHotelMatcher = (query: string): ((fields: (string | null | undefined)[]) => boolean) => {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean)
  return (fields) => {
    if (!tokens.length) return true
    const hay = normalizeSearch(fields.filter(Boolean).join(' '))
    if (!hay) return false
    const words = hay.split(' ')
    return tokens.every(
      (t) => hay.includes(t) || (t.length >= 4 && words.some((w) => withinOneEdit(w, t))),
    )
  }
}
