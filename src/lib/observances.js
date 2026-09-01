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

/**
 * Apply a family's own corrections.
 *
 * An override is keyed by the observance and the date the app originally
 * offered, so confirming or moving one occurrence never touches the other
 * twenty-three. `movedTo` relocates it; `confirmed` leaves the date alone and
 * only settles the confidence, which is what the confirmation prompt writes
 * when the family says the calculated day was right.
 */
export function applyOverrides(entries, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return entries
  return entries.map((e) => {
    const o = overrides[`${e.id}@${e.date}`]
    if (!o) return e
    const shift = o.movedTo && o.movedTo !== e.date
      ? { date: o.movedTo, movedFrom: e.date }
      : {}
    return {
      ...e,
      ...shift,
      source: 'override',
      confidence: CONFIDENCE.CURATED,
      confirmedByFamily: true,
    }
  })
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

/** Dates whose confidence asks the family to check them, in one year. */
export function datesNeedingConfirmation(year, overrides) {
  return applyOverrides(BASE, overrides)
    .filter((e) => e.confidence === CONFIDENCE.UNSTABLE && e.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Is this year inside the range the data covers? */
export function yearIsCovered(year) {
  return YEARS.includes(year)
}
