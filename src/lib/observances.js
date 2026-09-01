// What the calendar says on a given day, and how much to trust it.
//
// Three sources, in a fixed order of precedence:
//
//   1. USER OVERRIDE   a family confirmed or corrected a date themselves.
//                      Nothing outranks it. Their panchang, their kitchen.
//   2. CURATED         dates no rule decides — the Jain sect calendars and
//                      the Sikh Gurpurabs — plus the Islamic dates, which are
//                      arithmetic but provisional because the real calendar is
//                      decided by sighting the crescent.
//   3. COMPUTED        everything derived from a tithi, from panchanga/.
//
// The engine owns the vocabulary as well as the dates: TITHI_RULES below is
// imported from it, so an observance id that the engine does not know cannot
// be invented here or in the data. The dates themselves are precomputed into
// observances.json — a year of ephemeris costs over a second, which is too
// slow to block a calendar render — and test/panchanga-source-of-truth.test.js
// fails if that file and a fresh engine run disagree.

import { TITHI_RULES } from '../../panchanga/rules.js'
import computed from '../data/observances.json' with { type: 'json' }
import fastingData from '../data/fastingTraditions.json' with { type: 'json' }
import { FAST_LABEL, slugify } from '../data/memberOptions.js'
import { DEFAULT_LOCATION_KEY, locationName } from './location.js'

export const CONFIDENCE = {
  COMPUTED: 'computed',
  UNSTABLE: 'computed_unstable',
  CURATED: 'curated',
  PROVISIONAL: 'provisional',
}

/** Human wording for each level, used wherever a date is shown with its basis. */
export const CONFIDENCE_LABEL = {
  [CONFIDENCE.COMPUTED]: 'Calculated',
  [CONFIDENCE.UNSTABLE]: 'Calculated — please confirm',
  [CONFIDENCE.CURATED]: 'From Thali’s curated list',
  [CONFIDENCE.PROVISIONAL]: 'Provisional — depends on the moon sighting',
}

export const YEARS = computed.years
export const PLACE = computed.place
/** The cities the generator checked each date against. */
export const CITIES = computed.cities || {}

/**
 * Engine observance id -> the fasting-tradition ids a member can actually
 * select. The two vocabularies were written years apart and mostly differ
 * ("maha_shivaratri" against "maha_shivaratri_vrat"), so the mapping is
 * written out rather than guessed at by string similarity.
 *
 * An empty array is a deliberate decision, not an oversight: the observance is
 * real and gets a calendar entry, but no tradition in the database corresponds
 * to it, so nobody's meal plan changes. `test/observance-mapping.test.js`
 * asserts every engine rule appears here and every id on the right is a real
 * tradition slug, so a rule added to the engine cannot silently go nowhere.
 */
export const OBSERVANCE_FASTS = {
  ekadashi_vrat: ['ekadashi_vrat'],
  pradosh_vrat: ['pradosh_vrat'],
  sankashti_chaturthi: ['sankashti_chaturthi'],
  purnima: ['purnima_vrat', 'satyanarayan_vrat'],
  amavasya: ['amavasya_vrat'],
  janmashtami: ['janmashtami_vrat'],
  maha_shivaratri: ['maha_shivaratri_vrat'],
  karwa_chauth: ['karwa_chauth'],
  hariyali_teej: ['teej_vrat_hariyali_hartalika'],
  hartalika_teej: ['teej_vrat_hariyali_hartalika'],
  ganesh_chaturthi: ['ganesh_chaturthi_vrat'],
  ahoi_ashtami: ['ahoi_ashtami_vrat'],
  navratri_chaitra: ['navratri_vrat'],
  navratri_sharad: ['navratri_vrat'],
  ram_navami: ['ram_navami_vrat'],
  chhath_puja: ['chhath_puja_vrat'],
  mahavir_jayanti: ['mahavir_jayanti'],
  buddha_purnima: ['vesak_buddha_purnima'],
  sawan_somvar: ['sawan_somvar_vrat'],
  makar_sankranti: ['makar_sankranti_pongal'],

  // Real observances with no corresponding tradition in the database.
  // Vinayaka Chaturthi, Durgashtami and Kalashtami are kept monthly by many
  // families but the database offers no row to select; Jain Chaturdashi has
  // no row either (Upvas is a personal choice, not a fixed day, so mapping it
  // here would mark 25 days a year on someone who chose one); and Dussehra
  // and Diwali are feasts, not fasts.
  vinayaka_chaturthi: [],
  masik_durgashtami: [],
  kalashtami: [],
  jain_chaturdashi: [],
  dussehra: [],
  diwali: [],

  // Provisional Islamic dates.
  ramadan_start: ['ramadan_ramzan'],
  eid_al_fitr: ['ramadan_ramzan'],
  arafah: ['arafah_fast_day_of_arafah'],
  eid_al_adha: [],
  ashura: ['ashura_fast'],

  // Curated: no rule decides these.
  guru_gobind_singh_gurpurab: ['gurpurab_observances'],
  guru_nanak_gurpurab: ['gurpurab_observances'],
  vaisakhi: ['gurpurab_observances'],
  paryushana_parva: ['paryushana_parva', 'atthai_8_day_continuous_fast'],
  das_lakshana_parva: ['das_lakshana_parva'],
  navpad_oli: ['navpad_oli_ayambil_oli'],
}

/** Every observance id the engine holds a tithi rule for. */
export const TITHI_DERIVED_IDS = new Set(TITHI_RULES.map((r) => r.id))

export const GUIDANCE = fastingData.observanceGuidance

/* ------------------------------------------------------------------ *
 * Building the day index                                              *
 * ------------------------------------------------------------------ */

const iso = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
export { iso as isoDateOf }

/** Each day between two ISO dates, inclusive. */
function daysBetween(from, to) {
  const out = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function normalise(entry, source) {
  return {
    ...entry,
    source,
    fastIds: OBSERVANCE_FASTS[entry.id] || [],
    guidance: GUIDANCE[entry.id] || null,
  }
}

/** The curated rows, flattened from their date ranges into one entry each. */
function curatedEntries() {
  return fastingData.curatedDates.flatMap((row) => row.dates.map((d) => normalise({
    id: row.observanceId,
    name: row.name,
    religion: row.religion,
    date: d.date,
    through: d.until || null,
    confidence: row.confidence,
    resolvedBy: row.source,
    note: row.note,
    guidanceRow: {
      dietaryImpactSummary: row.dietaryImpactSummary,
      appAction: row.appAction,
    },
  }, 'curated')))
}

const BASE = [
  ...computed.observances.map((e) => normalise(e, 'computed')),
  ...computed.provisional.map((e) => normalise(e, 'provisional')),
  ...curatedEntries(),
]

/* ------------------------------------------------------------------ *
 * Templates for dates the family adds                                 *
 * ------------------------------------------------------------------ */

/**
 * What an observance IS, with every date-specific field stripped off.
 *
 * A user date overrides the date and nothing else. That is a requirement and
 * it is met by construction here: a family supplies a date, and the name,
 * religion, fast ids and food guidance are cloned from the shipped record for
 * that observance. There is no field a household can set that changes what the
 * tradition means, only when they keep it.
 *
 * Sixteen of the forty-three traditions ship no date at all — Ekasana, Upvas
 * and Varsitap are kept on a day the practitioner chooses, and the weekly
 * vrats are derived from a weekday rather than tabulated — and those are
 * exactly the ones a household most needs to add dates for. They fall back to
 * the tradition row in the database, so every tradition somebody can select is
 * one they can add a date for.
 */
function buildTemplates() {
  const out = new Map()

  // The shipped observances come first: they carry the real guidance text and
  // the rule's own name.
  for (const e of BASE) {
    if (out.has(e.id)) continue
    const rule = TITHI_RULES.find((r) => r.id === e.id)
    out.set(e.id, {
      id: e.id,
      // The per-occurrence name is wrong for a date nobody shipped — "Aja
      // Ekadashi" names one night in September, not the tradition.
      name: rule?.name || (e.ekadashiName ? 'Ekadashi Vrat' : e.name),
      religion: e.religion,
      fastIds: e.fastIds,
      guidance: e.guidance || null,
      guidanceRow: e.guidanceRow || null,
    })
  }

  // Then every tradition a member can actually select, for the ones above
  // that produced nothing.
  const claimed = new Set([...out.values()].flatMap((t) => t.fastIds))
  for (const row of fastingData.masterIndex) {
    const id = slugify(row.fastingTraditionName)
    if (claimed.has(id) || out.has(id)) continue
    out.set(id, {
      id,
      name: row.fastingTraditionName,
      religion: row.religion.replace(/\s*\(.*\)\s*$/, '').trim() === 'Islam'
        ? 'Muslim'
        : row.religion.replace(/\s*\(.*\)\s*$/, '').trim(),
      fastIds: [id],
      guidance: GUIDANCE[id] || null,
      guidanceRow: null,
    })
  }
  return out
}

export const OBSERVANCE_TEMPLATES = buildTemplates()

/** The template a date is added against — never anything the family typed. */
export function templateFor(observanceId) {
  return OBSERVANCE_TEMPLATES.get(observanceId) || null
}

/**
 * Which observance id a fasting tradition adds its dates under.
 *
 * Two traditions can share an id in the other direction — Hariyali and
 * Hartalika Teej both feed `teej_vrat_hariyali_hartalika` — so this picks the
 * one that actually ships dates and falls back to the tradition's own slug.
 */
export function observanceIdForFast(fastId) {
  for (const [id, t] of OBSERVANCE_TEMPLATES) {
    if (t.fastIds.includes(fastId)) return id
  }
  return fastId
}

/* ------------------------------------------------------------------ *
 * Precedence                                                          *
 * ------------------------------------------------------------------ */

/**
 * Apply a family's own answers. This is the top of user > curated > computed.
 *
 * An answer is keyed by the observance and the date it is about, so settling
 * one occurrence never touches the other twenty-three, and the four answers
 * exclude each other in the store rather than being reconciled here:
 *
 *   confirmed  the shipped date stands, and stops being a question
 *   movedTo    it stands one or more days away
 *   removed    this household does not keep this occurrence
 *   added      this household keeps it on a day nothing shipped
 *
 * The last of those is the only one that creates an entry, and it creates it
 * from `templateFor` — so a user date carries the tradition's kind and its
 * food rules unchanged, and overrides the date alone.
 */
export function applyOverrides(entries, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return entries

  const out = []
  for (const e of entries) {
    const o = overrides[`${e.id}@${e.date}`]
    if (!o) {
      out.push(e)
      continue
    }
    if (o.removed) continue
    const shift = o.movedTo && o.movedTo !== e.date
      ? { date: o.movedTo, movedFrom: e.date }
      : {}
    out.push({
      ...e,
      ...shift,
      source: 'override',
      confidence: CONFIDENCE.CURATED,
      confirmedByFamily: true,
    })
  }

  // A date already produced above wins over an added one saying the same
  // thing, so the relocated occurrence keeps its provenance instead of being
  // replaced by a bare "you added this". Keyed on the traditions an entry
  // covers rather than on its id, because an added Maha Shivaratri is filed
  // under the tradition slug and the shipped one under the engine's rule id —
  // different ids, same day in the same kitchen.
  const taken = new Set(out.map(coverageKey))

  for (const [key, o] of Object.entries(overrides)) {
    if (!o.added) continue
    const at = key.lastIndexOf('@')
    const id = key.slice(0, at)
    const date = key.slice(at + 1)
    const template = templateFor(id)
    if (!template) continue

    const entry = {
      ...template,
      date,
      through: o.through || null,
      source: 'override',
      confidence: CONFIDENCE.CURATED,
      confirmedByFamily: true,
      addedByFamily: true,
      resolvedBy: 'set by your family',
    }
    if (taken.has(coverageKey(entry))) continue
    taken.add(coverageKey(entry))
    out.push(entry)
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

/** What an entry occupies: the traditions it marks, on the day it marks them. */
function coverageKey(e) {
  const fasts = (e.fastIds || []).slice().sort().join(',')
  return `${fasts || e.id}@${e.date}`
}

/**
 * ISO date -> the observances on it.
 *
 * A multi-day observance is indexed on every day it covers, so a member
 * fasting through Navratri is marked for all nine, but `date` stays the day
 * the observance is known by.
 */
export function observanceIndex(overrides) {
  const index = new Map()
  const push = (day, entry) => {
    if (!index.has(day)) index.set(day, [])
    index.get(day).push(entry)
  }
  for (const e of applyOverrides(BASE, overrides)) {
    const span = e.through && e.through > e.date
      ? daysBetween(e.from || e.date, e.through)
      : [e.date]
    for (const day of span) push(day, e)
  }
  return index
}

let cached = null
let cachedKey = null

/** The index, memoised on the override set — building it walks ~350 rows. */
export function cachedIndex(overrides) {
  const key = overrides ? JSON.stringify(overrides) : ''
  if (cachedKey !== key) {
    cached = observanceIndex(overrides)
    cachedKey = key
  }
  return cached
}

/** Observances falling on a Date. */
export function observancesOn(date, overrides) {
  return cachedIndex(overrides).get(iso(date)) || []
}

/**
 * Dates that carry a question rather than an answer, in one year.
 *
 * Two kinds, and they are asked in different words because they are not the
 * same doubt. A `computed_unstable` date sits on a tithi boundary tight enough
 * that a quarter of an hour moves it. A `provisional` one is an Islamic date
 * that no calculation settles at all: the month begins when the crescent is
 * sighted, locally, and Eid al-Adha 2026 was kept on 27 May in Jammu & Kashmir
 * and 28 May everywhere else in India.
 *
 * Answering either one writes to the same slot, so a family cannot end up
 * holding two contradictory answers about one day.
 */
export const QUESTIONABLE = [CONFIDENCE.UNSTABLE, CONFIDENCE.PROVISIONAL]

/**
 * Does this date land on a different day in the family's city?
 *
 * The shipped dates are Delhi's and stay Delhi's — one precomputed table, and
 * a per-city recompute costs a second a year in the browser. What the
 * generator records instead is where each date moves to, so a family outside
 * Delhi can be asked about the fourteen that move rather than handed the wrong
 * one silently.
 *
 * @returns {{ city, date } | null}
 */
export function variantFor(entry, locationKey) {
  if (!locationKey || locationKey === DEFAULT_LOCATION_KEY) return null
  // A family that has answered has settled it, whatever prompted the question.
  // Without this the row survives its own answer: moving Yogini Ekadashi to
  // Kolkata's date leaves `variesByCity` naming the day it now sits on, and it
  // would go on asking about a date it had already been given.
  if (entry.source === 'override') return null
  const date = entry.variesByCity?.[locationKey]
  if (!date || date === entry.date) return null
  return { city: locationName(locationKey), date }
}

/**
 * Dates that carry a question rather than an answer, in one year.
 *
 * Three kinds now, and they are asked in different words because they are
 * three different doubts. A `computed_unstable` date sits on a tithi boundary
 * tight enough that a quarter of an hour moves it. A `provisional` one is an
 * Islamic date no calculation settles — the month begins on a local sighting.
 * And a date that MOVES for the family's own city is not in doubt at all in
 * Delhi; it is simply a different day where they live, and the engine knows
 * which day.
 *
 * All three write to the same slot, so a family cannot end up holding two
 * contradictory answers about one occurrence.
 */
export function datesNeedingConfirmation(year, overrides, locationKey) {
  return applyOverrides(BASE, overrides)
    .filter((e) => e.date.startsWith(String(year)))
    .map((e) => {
      const variant = variantFor(e, locationKey)
      return variant ? { ...e, variant } : e
    })
    .filter((e) => QUESTIONABLE.includes(e.confidence) || e.variant)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Every occurrence of one observance in a year, with its provenance.
 *
 * What the "your dates" screen lists. Includes dates the family removed, so
 * that a removal is visible and reversible rather than a thing that silently
 * happened once.
 */
export function occurrencesOf(observanceId, year, overrides) {
  const shown = applyOverrides(BASE, overrides)
    .filter((e) => e.id === observanceId && e.date.startsWith(String(year)))

  // A removal filed against a tradition the app no longer knows — withdrawn
  // between deploys, say — has no template to describe it. The store checks
  // that a key is slug-shaped, not that the slug is real, so this is the one
  // path where stale storage would otherwise reach the screen and render a
  // row with no name on it.
  const template = templateFor(observanceId)
  const removed = !template ? [] : Object.entries(overrides || {})
    .filter(([key, o]) => o.removed && key.startsWith(`${observanceId}@`))
    .map(([key]) => key.slice(key.lastIndexOf('@') + 1))
    .filter((d) => d.startsWith(String(year)))
    .map((date) => ({ ...template, date, source: 'removed', confidence: null }))

  return [...shown, ...removed].sort((a, b) => a.date.localeCompare(b.date))
}

/** The observances a family's selected fasts actually correspond to. */
export function observedObservanceIds(family) {
  const fasts = new Set((family || []).flatMap((m) => m.fasts || []))
  const ids = new Set()
  for (const id of fasts) ids.add(observanceIdForFast(id))
  return [...ids]
    .filter((id) => templateFor(id))
    .sort((a, b) => (templateFor(a).name).localeCompare(templateFor(b).name))
}

/** Every date the calendar already produces for one observance. */
export function resolvedDatesFor(observanceId, overrides) {
  return applyOverrides(BASE, overrides)
    .filter((e) => e.id === observanceId)
    .map((e) => e.date)
}

export { FAST_LABEL }

/** Is this year inside the range the data covers? */
export function yearIsCovered(year) {
  return YEARS.includes(year)
}
