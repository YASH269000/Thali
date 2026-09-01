// Every id a member carries, checked against the set the app actually offers.
//
// Ids reach the planner from localStorage, so they outlive any deploy that
// renames or withdraws one. Until now an id nobody recognised was skipped, and
// skipping a constraint does not weaken it — it removes it. Measured on a
// catalogue of 1,132 servable recipes, one character wrong opened:
//
//   fasting   185 -> 1,132     on exactly the day the fast matters
//   diet      472 -> 1,132     jain losing jainSafe and onionGarlicFree
//   religion  601 -> 1,132     Buddhist losing onionGarlicFree, alcoholFree
//   health    657 -> 1,132     a coeliac seeing the whole catalogue
//   allergy   987 -> 1,132
//
// Nothing on screen said so in any of those cases. This module is what the
// planner and the UI both read so they cannot disagree about which ids are
// real.

import {
  DIET_OPTIONS, FAST_LABEL, HEALTH_OPTIONS, RELIGIONS,
} from '../data/memberOptions.js'

const KNOWN_DIETS = new Set(DIET_OPTIONS.map((d) => d.id))
const KNOWN_RELIGIONS = new Set(RELIGIONS)
const KNOWN_HEALTH = new Set(HEALTH_OPTIONS.map((h) => h.id))
const KNOWN_FASTS = new Set(Object.keys(FAST_LABEL))

/**
 * Fasting is the one kind that cannot fail closed.
 *
 * For the others there is a meaningful strictest reading: an unknown diet can
 * be treated as Jain, an unknown religion as the union of every religion's
 * rules. Fasting has no such fallback. Only two traditions carry a compliance
 * flag at all — Ekadashi and Navratri — so applying "both flags" would look
 * like caution while covering none of Ramadan, Paryushana or the weekly vrats
 * a member might actually have meant. There is no strict reading to fall back
 * to, only a guess, on the one day of the year it matters most.
 */
export const BLOCKING_KINDS = new Set(['fasts'])

const KIND_LABEL = {
  diet: 'diet', religion: 'religion', health: 'health condition', fasts: 'fast',
}

/**
 * Ids on this member that the app cannot interpret.
 *
 * A missing or empty value is not an unrecognised one — those have working
 * defaults and always did. Only a value that is present and unknown counts,
 * which is the case a rename or a typo produces.
 *
 * @returns {Array<{ kind, id, label }>}
 */
export function unknownMemberIds(member) {
  if (!member) return []
  const out = []

  if (member.diet && !KNOWN_DIETS.has(member.diet)) {
    out.push({ kind: 'diet', id: member.diet, label: KIND_LABEL.diet })
  }
  if (member.religion && !KNOWN_RELIGIONS.has(member.religion)) {
    out.push({ kind: 'religion', id: member.religion, label: KIND_LABEL.religion })
  }
  for (const id of member.health || []) {
    if (!KNOWN_HEALTH.has(id)) out.push({ kind: 'health', id, label: KIND_LABEL.health })
  }
  for (const id of member.fasts || []) {
    if (!KNOWN_FASTS.has(id)) out.push({ kind: 'fasts', id, label: KIND_LABEL.fasts })
  }
  return out
}

/** Does this member carry an id the planner refuses to guess around? */
export function hasBlockingId(member) {
  return unknownMemberIds(member).some((u) => BLOCKING_KINDS.has(u.kind))
}

/** One sentence a family can act on, naming the member. */
export function unknownIdMessage(name, unknown) {
  if (!unknown || unknown.length === 0) return ''
  const kinds = [...new Set(unknown.map((u) => u.label))]
  const list = kinds.length === 1
    ? kinds[0]
    : `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}`
  const blocking = unknown.some((u) => BLOCKING_KINDS.has(u.kind))
  return `${name || 'This member'} has a ${list} setting Thali doesn’t recognise and can’t apply. `
    + (blocking
      ? 'Please re-select it — Thali will not plan a meal around a fast it cannot read.'
      : 'Please re-select it. Until then the strictest rules are applied, so the meal may be narrower than it needs to be.')
}

/** Every member with an unreadable id, for the screens that report it. */
export function familyIdWarnings(family) {
  return (family || [])
    .map((m) => ({ member: m, unknown: unknownMemberIds(m) }))
    .filter((x) => x.unknown.length > 0)
    .map((x) => ({
      memberId: x.member.id,
      name: x.member.name,
      unknown: x.unknown,
      blocking: x.unknown.some((u) => BLOCKING_KINDS.has(u.kind)),
      message: unknownIdMessage(x.member.name, x.unknown),
    }))
}
