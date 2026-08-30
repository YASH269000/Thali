// Which fasting traditions are active on a given date.
//
// Shared by the Family Profile screen and the meal-plan API so the two can
// never disagree about what today means.
//
// The database carries dates two different ways and both matter:
//   1. calendar2026 rows pinned to a date ("Sep 7", or a range like "Aug 3-24")
//   2. masterIndex traditions defined by frequency alone ("Weekly (every
//      Saturday)") — these never appear in the calendar, so a date-only check
//      would miss every weekly fast.

import fastingData from '../data/fastingTraditions.json' with { type: 'json' }
import { FAST_LABEL, slugify } from '../data/memberOptions.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday']

// "Sep 7" matches Sep 7. "Aug 3-24" matches any day from 3 to 24.
export function calendarRowMatches(dateText, today) {
  const m = /^([A-Za-z]{3})\s+(\d+)(?:\s*-\s*(\d+))?$/.exec(String(dateText).trim())
  if (!m) return false
  if (MONTHS.indexOf(m[1]) !== today.getMonth()) return false
  const day = today.getDate()
  const from = Number(m[2])
  const to = m[3] ? Number(m[3]) : from
  return day >= from && day <= to
}

// Tradition name without its parenthetical and trailing "Vrat", for matching
// against free-text calendar entries ("Aja Ekadashi" -> "Ekadashi Vrat").
function matchKey(name) {
  return name.replace(/\s*\(.*?\)/g, '').replace(/\s+vrat$/i, '').trim().toLowerCase()
}

// A tradition tied to a weekday names it in its frequency: "Weekly (every
// Monday)", "4 Mondays during Shravan month". That weekday is authoritative.
function weekdayOf(frequency) {
  const f = String(frequency || '')
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    if (new RegExp(`\\b${WEEKDAYS[i]}s?\\b`, 'i').test(f)) return i
  }
  return null
}

/** Set of tradition slugs active on `date`. */
export function activeFastIdsOn(date) {
  const active = new Set()
  const weekday = WEEKDAYS[date.getDay()]

  for (const row of fastingData.masterIndex) {
    const id = slugify(row.fastingTraditionName)
    const boundDay = weekdayOf(row.frequency)

    // A Monday fast cannot fall on a Thursday. Enforcing this first also stops
    // multi-day calendar ranges from over-reporting: the row "Aug 3-24 | Sawan
    // Somvar Vrat (4 Mondays)" would otherwise mark all 22 days, and its key
    // "somvar" is a substring of the weekly "Somvar Vrat" name as well.
    if (boundDay !== null && boundDay !== date.getDay()) continue

    if (boundDay === date.getDay() &&
      new RegExp(`every\\s+${weekday}`, 'i').test(row.frequency || '')) {
      active.add(id)
    }

    const key = matchKey(row.fastingTraditionName)
    if (key.length >= 4) {
      for (const cal of fastingData.calendar2026) {
        if (calendarRowMatches(cal.date, date) &&
          String(cal.fastingTraditionsActive).toLowerCase().includes(key)) {
          active.add(id)
        }
      }
    }
  }
  return active
}

/** Calendar rows describing `date`, for prompt context. */
export function calendarNotesOn(date) {
  return fastingData.calendar2026
    .filter((c) => calendarRowMatches(c.date, date))
    .map((c) => ({
      date: c.date,
      traditions: c.fastingTraditionsActive,
      impact: c.dietaryImpactSummary,
      appAction: c.appAction,
    }))
}

/** Food rules for the named traditions, so the model gets the real constraints. */
export function foodRulesFor(traditionLabels) {
  const wanted = traditionLabels.map((t) => t.toLowerCase())
  return fastingData.foodRules
    .filter((r) => wanted.some((w) => w.includes(r.fastingTradition.toLowerCase()) ||
      r.fastingTradition.toLowerCase().includes(w.split(' ')[0])))
    .map((r) => ({
      tradition: r.fastingTradition,
      allowed: r.allowedFoods,
      forbidden: r.forbiddenFoods,
      saltRule: r.specialSaltRule,
appLogic: r.notesForAppLogic,
    }))
}

/* ------------------------------------------------------------------ *
 * Month view                                                          *
 *                                                                     *
 * Lunar observances (Ekadashi, Navratri, Janmashtami) do not fall on
 * fixed Gregorian dates, so they are read from the calendar2026 rows
 * rather than computed. Weekly observances (Somvar, Shanivar) are not
 * in that calendar at all and come from masterIndex frequency instead.
 * activeFastIdsOn already merges both, so a month is just 28-31 calls.
 * ------------------------------------------------------------------ */

/** The fasts this member observes that are active on `date`. */
export function memberFastsOn(member, date) {
  const active = activeFastIdsOn(date)
  return (member.fasts || []).filter((id) => active.has(id))
}

/**
 * Fasting activity for one family across one Gregorian month.
 *
 * @returns {{
 *   year, month, daysInMonth, firstWeekday,
 *   days: Array<{ day, date, isFasting, entries: Array<{memberId,memberName,fasts:string[]}>, labels: string[] }>,
 *   perMember: Array<{ memberId, name, dayCount, breakdown: Array<{label, count}> }>,
 *   totalFastingDays
 * }}
 */
export function fastingMonth(family, year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()

  const perMember = new Map(
    family.map((m) => [m.id, { memberId: m.id, name: m.name, dayCount: 0, counts: new Map() }]),
  )

  const days = []
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day)
    const active = activeFastIdsOn(date)

    // Calendar rows name the specific occasion ("Aja Ekadashi") where the
    // tradition list only knows the generic one ("Ekadashi Vrat").
    const occasions = calendarNotesOn(date).map((c) => c.traditions)

    const entries = []
    const labelSet = new Set()

    for (const m of family) {
      const hits = (m.fasts || []).filter((id) => active.has(id))
      if (hits.length === 0) continue
      const labels = hits.map((id) => FAST_LABEL[id] || id)
      entries.push({ memberId: m.id, memberName: m.name, fasts: labels })

      const rec = perMember.get(m.id)
      if (rec) {
        rec.dayCount += 1
        for (const label of labels) rec.counts.set(label, (rec.counts.get(label) || 0) + 1)
      }
      for (const label of labels) labelSet.add(label)
    }

    // Prefer the calendar's specific wording when it refers to a fast someone
    // here actually observes.
    const labels = [...labelSet]
    for (const occ of occasions) {
      if (labels.some((l) => occ.toLowerCase().includes(l.split(' ')[0].toLowerCase()))) {
        labels.unshift(occ)
        break
      }
    }

    days.push({
      day,
      date,
      isFasting: entries.length > 0,
      entries,
      labels: [...new Set(labels)],
    })
  }

  return {
    year,
    month,
    daysInMonth,
    firstWeekday,
    days,
    totalFastingDays: days.filter((d) => d.isFasting).length,
    perMember: [...perMember.values()]
      .map((r) => ({
        memberId: r.memberId,
        name: r.name,
        dayCount: r.dayCount,
        breakdown: [...r.counts.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.dayCount - a.dayCount),
  }
}
