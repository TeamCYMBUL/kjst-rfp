import * as pdfjsLib from 'pdfjs-dist'

// ---------------------------------------------------------------------------
// Team look-up tables (MLB + NBA abbreviations)
// ---------------------------------------------------------------------------
export const TEAM_CITIES: Record<string, string> = {
  // MLB
  MIA: 'Miami', ATL: 'Atlanta', WSH: 'Washington', WAS: 'Washington',
  PHI: 'Philadelphia', NYY: 'New York', BAL: 'Baltimore', BOS: 'Boston',
  TB: 'Tampa', TOR: 'Toronto', DET: 'Detroit', CLE: 'Cleveland',
  CWS: 'Chicago', MIN: 'Minneapolis', KC: 'Kansas City', TEX: 'Arlington',
  HOU: 'Houston', LAA: 'Anaheim', SEA: 'Seattle', ATH: 'Sacramento',
  OAK: 'Oakland', CHC: 'Chicago', MIL: 'Milwaukee', CIN: 'Cincinnati',
  PIT: 'Pittsburgh', STL: 'St. Louis', SF: 'San Francisco', LAD: 'Los Angeles',
  SD: 'San Diego', AZ: 'Phoenix', COL: 'Denver',
  // NBA-only abbreviations (not overlapping with MLB above)
  LAL: 'Los Angeles', GSW: 'San Francisco', BKN: 'Brooklyn', CHI: 'Chicago',
  MEM: 'Memphis', ORL: 'Orlando', IND: 'Indianapolis', NOP: 'New Orleans',
  PHX: 'Phoenix', POR: 'Portland', NOR: 'New Orleans', DAL: 'Dallas',
  DEN: 'Denver', UTA: 'Salt Lake City', SAC: 'Sacramento', OKC: 'Oklahoma City',
  SAS: 'San Antonio', CHA: 'Charlotte', NYK: 'New York',
}

export const TEAM_NAMES: Record<string, string> = {
  // MLB
  MIA: 'Miami Marlins', ATL: 'Atlanta Braves', WSH: 'Washington Nationals',
  WAS: 'Washington Nationals', PHI: 'Philadelphia Phillies', NYY: 'New York Yankees',
  BAL: 'Baltimore Orioles', BOS: 'Boston Red Sox', TB: 'Tampa Bay Rays',
  TOR: 'Toronto Blue Jays', DET: 'Detroit Tigers', CLE: 'Cleveland Guardians',
  CWS: 'Chicago White Sox', MIN: 'Minnesota Twins', KC: 'Kansas City Royals',
  TEX: 'Texas Rangers', HOU: 'Houston Astros', LAA: 'Los Angeles Angels',
  SEA: 'Seattle Mariners', ATH: 'Athletics', OAK: 'Athletics',
  CHC: 'Chicago Cubs', MIL: 'Milwaukee Brewers', CIN: 'Cincinnati Reds',
  PIT: 'Pittsburgh Pirates', STL: 'St. Louis Cardinals', SF: 'San Francisco Giants',
  LAD: 'Los Angeles Dodgers', SD: 'San Diego Padres', AZ: 'Arizona Diamondbacks',
  COL: 'Colorado Rockies',
  // NBA-only
  LAL: 'Los Angeles Lakers', GSW: 'Golden State Warriors', BKN: 'Brooklyn Nets',
  CHI: 'Chicago Bulls', MEM: 'Memphis Grizzlies', ORL: 'Orlando Magic',
  IND: 'Indiana Pacers', NOP: 'New Orleans Pelicans', PHX: 'Phoenix Suns',
  POR: 'Portland Trail Blazers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets',
  UTA: 'Utah Jazz', SAC: 'Sacramento Kings', OKC: 'Oklahoma City Thunder',
  SAS: 'San Antonio Spurs', CHA: 'Charlotte Hornets', NYK: 'New York Knicks',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PdfItem = { x: number; y: number; str: string }

type ColBounds = { xMin: number; xMax: number; monthNum: number; year: number }

type GameEntry = { date: string; abbrev: string; city: string }

const MONTH_MAP: Record<string, number> = {
  JANUARY: 1, JAN: 1, FEBRUARY: 2, FEB: 2, MARCH: 3, MAR: 3,
  APRIL: 4, APR: 4, MAY: 5, JUNE: 6, JUN: 6,
  JULY: 7, JUL: 7, AUGUST: 8, AUG: 8, SEPTEMBER: 9, SEP: 9, SEPT: 9,
  OCTOBER: 10, OCT: 10, NOVEMBER: 11, NOV: 11, DECEMBER: 12, DEC: 12,
}

const DAY_NAMES = new Set(['SUN', 'MON', 'TUES', 'WED', 'THU', 'FRI', 'SAT',
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseMonthNum(str: string): number {
  const upper = str.toUpperCase()
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    if (upper.includes(name)) return num
  }
  return 0
}

function groupIntoRows(items: PdfItem[], tolerance = 5): { y: number; items: PdfItem[] }[] {
  const map = new Map<number, PdfItem[]>()
  for (const item of items) {
    let key = item.y
    for (const k of map.keys()) {
      if (Math.abs(k - item.y) <= tolerance) { key = k; break }
    }
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return [...map.entries()]
    .sort(([a], [b]) => b - a) // descending y = top-to-bottom in PDF space
    .map(([y, its]) => ({ y, items: its.sort((a, b) => a.x - b.x) }))
}

function colOf(x: number, bounds: ColBounds[]): number {
  return bounds.findIndex(b => x >= b.xMin && x <= b.xMax)
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function parseCalendarSchedulePdf(buffer: ArrayBuffer): Promise<{
  isCalendar: boolean
  rows: string[][]
}> {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

  // Collect all text items from page 1 only (page 2 is usually a stat table)
  const rawItems: PdfItem[] = []
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  for (const it of content.items as any[]) {
    if (!it.str?.trim()) continue
    rawItems.push({ x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), str: it.str.trim() })
  }

  // Detect calendar format: needs at least 7 day-name items
  const hasDayNames = rawItems.filter(it => DAY_NAMES.has(it.str.toUpperCase())).length >= 7
  if (!hasDayNames) return { isCalendar: false, rows: [] }

  // Year — take the max 4-digit year found so the schedule year (e.g. 2027)
  // beats any earlier publication/copyright dates printed in the document
  const yearItems = rawItems.filter(it => /^20\d\d$/.test(it.str))
  const baseYear = yearItems.length > 0
    ? Math.max(...yearItems.map(it => parseInt(it.str)))
    : new Date().getFullYear()

  const rows = groupIntoRows(rawItems)

  // Find all "day-header" rows (rows with ≥7 day-name tokens)
  const dayHeaderRows = rows.filter(r =>
    r.items.filter(it => DAY_NAMES.has(it.str.toUpperCase())).length >= 7
  )
  if (dayHeaderRows.length === 0) return { isCalendar: false, rows: [] }

  const games: GameEntry[] = []

  // Process each day-header row as the start of a calendar section
  for (let dhi = 0; dhi < dayHeaderRows.length; dhi++) {
    const dhRow = dayHeaderRows[dhi]
    const nextDhY = dhi < dayHeaderRows.length - 1 ? dayHeaderRows[dhi + 1].y : -Infinity
    const prevDhY = dhi === 0 ? Infinity : dayHeaderRows[dhi - 1].y

    // Build month-column boundaries from this day-header row's SUN items
    const sunItems = dhRow.items.filter(it => it.str.toUpperCase() === 'SUN')
    if (sunItems.length === 0) continue

    const colBounds: ColBounds[] = sunItems.map((sun, i) => {
      const xMin = i === 0 ? -Infinity : (sunItems[i - 1].x + sun.x) / 2
      const xMax = i === sunItems.length - 1 ? Infinity : (sun.x + sunItems[i + 1].x) / 2
      return { xMin, xMax, monthNum: 0, year: baseYear }
    })

    // Find month names in rows ABOVE this day header (between prevDhY and dhRow.y)
    const sectionMonthRows = rows.filter(r =>
      r.y > dhRow.y + 2 && r.y < prevDhY &&
      r.items.some(it => parseMonthNum(it.str) > 0)
    )

    // Assign starting month to each column
    for (const mRow of sectionMonthRows) {
      for (const item of mRow.items) {
        const mNum = parseMonthNum(item.str)
        if (!mNum) continue
        const ci = colOf(item.x, colBounds)
        if (ci >= 0 && colBounds[ci].monthNum === 0) colBounds[ci].monthNum = mNum
      }
    }
    // Fill any unresolved columns sequentially from the first known one
    for (let i = 0; i < colBounds.length; i++) {
      if (colBounds[i].monthNum === 0) {
        const prev = colBounds[i - 1]
        if (prev) {
          let m = prev.monthNum + 1, y = prev.year
          if (m > 12) { m = 1; y++ }
          colBounds[i].monthNum = m; colBounds[i].year = y
        } else {
          colBounds[i].monthNum = 1
        }
      }
    }

    // Track current (month, year) per column as we scan downward
    const curMonth = colBounds.map(b => ({ m: b.monthNum, y: b.year }))
    const prevDayNums = colBounds.map(() => 0)

    // Rows in this calendar section (between this day-header and the next)
    const sectionRows = rows.filter(r => r.y < dhRow.y && r.y > nextDhY)

    let ri = 0
    while (ri < sectionRows.length) {
      const row = sectionRows[ri]

      // Is this a date-number row? (contains ≥2 numbers in range 1-31)
      const dateItems = row.items.filter(it => /^\d{1,2}$/.test(it.str) && +it.str >= 1 && +it.str <= 31)
      if (dateItems.length < 2) { ri++; continue }

      // Map each date number to its column and detect month rollovers
      const dateCells: { ci: number; day: number; x: number }[] = []
      for (const di of dateItems) {
        const ci = colOf(di.x, colBounds)
        if (ci < 0) continue
        const day = +di.str

        // Month rollover when day resets from high to low
        if (day < prevDayNums[ci] && prevDayNums[ci] > 20) {
          curMonth[ci].m++
          if (curMonth[ci].m > 12) { curMonth[ci].m = 1; curMonth[ci].y++ }
        }
        prevDayNums[ci] = day
        dateCells.push({ ci, day, x: di.x })
      }

      // Scan subsequent rows for opponent codes until the next date-number row
      let j = ri + 1
      while (j < sectionRows.length) {
        const oppRow = sectionRows[j]
        // Stop when we hit another date-number row
        if (oppRow.items.filter(it => /^\d{1,2}$/.test(it.str) && +it.str >= 1 && +it.str <= 31).length >= 2) break

        for (const oppItem of oppRow.items) {
          const raw = oppItem.str
          if (!raw.startsWith('@')) { j++; continue }
          const abbrev = raw.slice(1).toUpperCase()
          if (!/^[A-Z]{1,4}$/.test(abbrev)) { j++; continue }
          const city = TEAM_CITIES[abbrev]
          if (!city) { j++; continue }

          // Match to nearest date cell by x proximity across all columns.
          // Avoids mis-assigning codes when column boundary midpoints are imprecise.
          if (dateCells.length === 0) { j++; continue }
          const nearest = dateCells.reduce((b, c) => Math.abs(c.x - oppItem.x) < Math.abs(b.x - oppItem.x) ? c : b)
          const ci = nearest.ci

          games.push({
            date: isoDate(curMonth[ci].y, curMonth[ci].m, nearest.day),
            abbrev,
            city,
          })
        }
        j++
      }
      ri = j
    }
  }

  if (games.length === 0) return { isCalendar: true, rows: [] }

  // Sort by date and deduplicate
  games.sort((a, b) => a.date.localeCompare(b.date))
  const seen = new Set<string>()
  const unique = games.filter(g => {
    const key = `${g.date}:${g.abbrev}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })

  // Group consecutive same-city games into road trips (≤2 days gap)
  const trips: GameEntry[][] = []
  let cur = [unique[0]]
  for (let i = 1; i < unique.length; i++) {
    const g = unique[i], prev = unique[i - 1]
    const gap = (new Date(g.date).getTime() - new Date(prev.date).getTime()) / 86400000
    if (g.city === prev.city && gap <= 2) {
      cur.push(g)
    } else {
      trips.push(cur); cur = [g]
    }
  }
  trips.push(cur)

  // Build output rows
  const resultRows: string[][] = [['opponent', 'city', 'game_date', 'arrival_date', 'departure_date']]
  for (const trip of trips) {
    const first = trip[0], last = trip[trip.length - 1]
    const arrival = new Date(first.date); arrival.setDate(arrival.getDate() - 1)
    const depart = new Date(last.date); depart.setDate(depart.getDate() + 1)
    const teamName = TEAM_NAMES[first.abbrev] || first.abbrev
    resultRows.push([
      `@ ${teamName}`,
      first.city,
      first.date,
      arrival.toISOString().slice(0, 10),
      depart.toISOString().slice(0, 10),
    ])
  }

  return { isCalendar: true, rows: resultRows }
}
