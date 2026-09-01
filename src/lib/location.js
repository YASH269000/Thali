// Where this household is, and the one place that stores it.
//
// Delhi is the default because the published all-India calendars this engine
// is checked against use it, not because it is more correct. Everything else
// about a panchanga is local, and for a timing fast that is not a nicety: the
// moon rises at 19:42 in Kolkata and 20:56 in Mumbai on Karva Chauth 2026.
// Seventy-four minutes. Telling a woman in Mumbai her nirjala fast is over on
// Delhi's moonrise ends it forty-four minutes early.
//
// So the location is asked for, stored beside the family, and threaded into
// every engine call that takes one.
//
// WHAT IT DOES NOT DO IS MOVE THE TITHI DATES.
//
// A tithi is the same instant everywhere; only the sunrise it is measured
// against is local. That is still enough to move 14 of 352 observances across
// 2026 and 2027 — Kolkata's sunrise is about fifty minutes earlier than
// Delhi's, and it accounts for twelve of them. But the app ships ONE
// precomputed table, and recomputing a year per city in the browser costs
// about a second. So the shipped dates stay Delhi's and the generator records
// where they move to instead; a family outside Delhi is ASKED about those
// dates rather than silently handed the wrong one. Same prompt, same slot, as
// the five dates that move under a perturbed ephemeris.

import { LOCATIONS, DEFAULT_LOCATION } from '../../panchanga/locations.js'

export { LOCATIONS, DEFAULT_LOCATION }

export const LOCATION_KEY = 'thali_location'

/** The default, by key, so a stored value and an unstored one look the same. */
export const DEFAULT_LOCATION_KEY = Object.keys(LOCATIONS)
  .find((k) => LOCATIONS[k] === DEFAULT_LOCATION) || 'delhi'

/** Every city that can be chosen, in the order the picker shows them. */
export const LOCATION_OPTIONS = Object.entries(LOCATIONS)
  .map(([id, place]) => ({ id, ...place }))
  .sort((a, b) => a.name.localeCompare(b.name))

/**
 * The stored city key.
 *
 * An unreadable or unrecognised value falls back to Delhi rather than to
 * nothing: every caller here needs a place, and a missing one would mean no
 * sunrise at all. The failure is visible — the picker shows Delhi — rather
 * than a screen with no times on it.
 */
export function loadLocationKey() {
  try {
    const raw = window.localStorage.getItem(LOCATION_KEY)
    return raw && LOCATIONS[raw] ? raw : DEFAULT_LOCATION_KEY
  } catch {
    return DEFAULT_LOCATION_KEY
  }
}

export function saveLocationKey(key) {
  try {
    if (!LOCATIONS[key]) return false
    window.localStorage.setItem(LOCATION_KEY, key)
    return true
  } catch {
    return false
  }
}

/** The place itself, for the engine calls that take one. */
export function placeFor(key) {
  return LOCATIONS[key] || DEFAULT_LOCATION
}

export function loadLocation() {
  return placeFor(loadLocationKey())
}

/** "Delhi", for printing beside a time so the assumption is never hidden. */
export function locationName(key) {
  return placeFor(key).name
}

/** Is this the city the shipped dates were computed for? */
export function isDefaultLocation(key) {
  return placeFor(key) === DEFAULT_LOCATION
}
