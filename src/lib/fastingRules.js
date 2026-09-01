// Which fasting traditions are active on a given date.
//
// Shared by the Family Profile screen and the meal-plan API so the two can
// never disagree about what today means.
//
// Dates arrive two ways and both matter:
//   1. observances — from src/lib/observances.js, which is the calendar engine
//      for anything tithi-derived and a short curated table for the rest.
//   2. masterIndex traditions defined by frequency alone ("Weekly (every
//      Saturday)") — these appear in no calendar, so a date-only check would
//      miss every weekly fast.
//
// This file used to hold the first half itself, as 25 hand-typed rows matched
// by substring against their free text. That is why Ekadashi showed twice in a
// year that has twenty-four of it, and why five of the rows were on the wrong
// day. Dates now come from one place and this file only joins them to members.

import { FAST_LABEL, slugify } from '../data/memberOptions.js'
import fastingData from '../data/fastingTraditions.json' with { type: 'json' }
import {
  CONFIDENCE, datesNeedingConfirmation, isoDateOf, observancesOn,
} from './observances.js'

export { CONFIDENCE, datesNeedingConfirmation, isoDateOf }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday']

// A tradition tied to a weekday names it in its frequency: "Weekly (every
// Monday)", "4 Mondays during Shravan month". That weekday is authoritative.
function weekdayOf(frequency) {
  const f = String(frequency || '')
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    if (new RegExp(`\\b${WEEKDAYS[i]}s?\\b`, 'i').test(f)) return i
  }
  return null
}

// Traditions whose frequency alone fixes their days: every Monday, every
// Thursday. Computed once — masterIndex does not change at run time.
const WEEKLY = fastingData.masterIndex
  .map((row) => ({
    id: slugify(row.fastingTraditionName),
    weekday: weekdayOf(row.frequency),
    everyWeek: /every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
      .test(row.frequency || ''),
  }))
  .filter((r) => r.weekday !== null && r.everyWeek)

/**
 * Set of tradition slugs active on `date`.
 *
 * `overrides` is the family's own corrections, keyed `observanceId@date`. It
 * is passed rather than read from storage so the serverless planner and the
 * browser reach the same answer from the same argument.
 */
export function activeFastIdsOn(date, overrides) {
  const active = new Set()

  for (const w of WEEKLY) {
    if (w.weekday === date.getDay()) active.add(w.id)
  }

  for (const o of observancesOn(date, overrides)) {
    for (const id of o.fastIds) active.add(id)
  }

  return active
}

/** Observances on `date`, whatever their source. */
export function observancesFor(date, overrides) {
  return observancesOn(date, overrides)
}

/**
 * Calendar context for `date`, for the meal-plan prompt.
 *
 * Every field carried here has a value. The engine now produces an observance
 * on roughly half the days of the year against 25 curated rows before, and
 * most of them — a Vinayaka Chaturthi, an Amavasya — have no dietary guidance
 * attached. Emitting those as notes with empty impact and action fields would
 * put a page of blanks in front of the model, so guidance appears only where
 * it exists and the note itself still names the day.
 */
export function calendarNotesOn(date, overrides, observedFastIds = null) {
  return observancesOn(date, overrides)
    // A long observance is context on its first day and noise on the other
    // eighty-eight. Vassa is the case that forced this: a three-month retreat
    // named in every prompt from July to October, to households with no
    // Buddhist member in them. Where the caller knows which traditions are
    // actually kept, a multi-week observance has to be one of them; where it
    // does not, nothing is filtered and the behaviour is what it was.
    .filter((o) => {
      if (!observedFastIds) return true
      const span = o.through && o.through > o.date
        ? (Date.parse(o.through) - Date.parse(o.date)) / 86400000 : 0
      if (span < 14) return true
      return (o.fastIds || []).some((id) => observedFastIds.has(id))
    })
    .map((o) => {
    const guidance = o.guidance || o.guidanceRow || null
    const note = {
      date: o.date,
      observance: o.name,
      religion: o.religion,
      confidence: o.confidence,
    }
    if (o.tithi) note.tithi = `${o.tithi}, ${o.masa}`
    if (o.through && o.through !== o.date) note.runsThrough = o.through
    if (guidance) {
      note.impact = guidance.dietaryImpactSummary
      note.appAction = guidance.appAction
    }
    if (o.confidence === CONFIDENCE.PROVISIONAL) {
      note.caution = 'Provisional — the Islamic month begins on a local sighting '
        + 'of the crescent, so this may be a day either side.'
    }
    if (o.confidence === CONFIDENCE.UNSTABLE) {
      note.caution = 'This date sits on a tithi boundary tight enough that it '
        + 'could legitimately be the adjacent day; the family has been asked to confirm it.'
    }
    return note
  })
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
 * Every lunar date now comes from one index keyed by ISO date, so a
 * day is a map lookup rather than a scan of calendar rows. Weekly
 * observances (Somvar, Shanivar) still come from tradition frequency
 * because no calendar lists them. activeFastIdsOn merges both, so a
 * month is 28-31 calls and a year is twelve months.
 * ------------------------------------------------------------------ */

/** The fasts this member observes that are active on `date`. */
export function memberFastsOn(member, date, overrides) {
  const active = activeFastIdsOn(date, overrides)
  return (member.fasts || []).filter((id) => active.has(id))
}

/**
 * Fasting activity for one family across one Gregorian month.
 *
 * @returns {{
 *   year, month, daysInMonth, firstWeekday,
 *   days: Array<{ day, date, isFasting, entries, labels, observances, needsConfirmation }>,
 *   perMember: Array<{ memberId, name, dayCount, breakdown: Array<{label, count}> }>,
 *   totalFastingDays
 * }}
 */
export function fastingMonth(family, year, month, overrides) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()

  const perMember = new Map(
    family.map((m) => [m.id, { memberId: m.id, name: m.name, dayCount: 0, counts: new Map() }]),
  )

  const days = []
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day)
    const active = activeFastIdsOn(date, overrides)
    const onThisDay = observancesOn(date, overrides)

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

    // The observance knows the occasion by name — "Aja Ekadashi", not
    // "Ekadashi Vrat" — so where one of today's observances maps to a fast
    // somebody here keeps, its name leads the label list.
    const observed = onThisDay.filter((o) =>
      o.fastIds.some((id) => entries.some((e) => active.has(id) &&
        family.some((m) => m.id === e.memberId && (m.fasts || []).includes(id)))))
    const labels = [...new Set([...observed.map((o) => o.name), ...labelSet])]

    days.push({
      day,
      date,
      isFasting: entries.length > 0,
      entries,
      labels,
      observances: onThisDay.map((o) => ({
        id: o.id,
        name: o.name,
        confidence: o.confidence,
        source: o.source,
        addedByFamily: o.addedByFamily || false,
      })),
      // Only a date somebody here actually observes is worth interrupting for.
      needsConfirmation: observed.some((o) => o.confidence === CONFIDENCE.UNSTABLE),
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

/**
 * A whole Gregorian year, as twelve month views.
 *
 * Deliberately a loop over fastingMonth rather than its own day loop. Every
 * weekday-bound rule lives inside activeFastIdsOn; calling the month builder
 * twelve times inherits that by construction, where a second day loop here
 * would be a second place for it to go wrong.
 *
 * @returns {{ year, months, totalFastingDays, perMember, confirmations }}
 */
export function fastingYear(family, year, overrides, locationKey) {
  const months = []
  for (let month = 0; month < 12; month += 1) {
    months.push(fastingMonth(family, year, month, overrides))
  }

  const perMember = new Map(
    family.map((m) => [m.id, { memberId: m.id, name: m.name, dayCount: 0, counts: new Map() }]),
  )

  for (const mo of months) {
    for (const p of mo.perMember) {
      const rec = perMember.get(p.memberId)
      if (!rec) continue
      rec.dayCount += p.dayCount
      for (const b of p.breakdown) {
        rec.counts.set(b.label, (rec.counts.get(b.label) || 0) + b.count)
      }
    }
  }

  // The handful of dates that move when the ephemeris is perturbed, narrowed
  // to the ones this family keeps. A date nobody observes needs no answer.
  const observedIds = new Set(family.flatMap((m) => m.fasts || []))
  const confirmations = datesNeedingConfirmation(year, overrides, locationKey)
    .filter((o) => o.fastIds.some((id) => observedIds.has(id)))

  return {
    year,
    months,
    confirmations,
    totalFastingDays: months.reduce((n, mo) => n + mo.totalFastingDays, 0),
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
