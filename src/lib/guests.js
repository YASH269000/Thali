// Guests are one-off diners: a cousin who drops by, an aunt visiting.
//
// They are modelled as pseudo-members so their constraints flow through the
// same deterministic filter the family uses. That matters because you cannot
// cook two versions of a meal — one Jain guest makes the whole pot Jain.

export const GUEST_RESTRICTIONS = [
  { id: 'none', label: 'No restrictions' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'jain', label: 'Jain' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'gluten_free', label: 'Gluten-free' },
  { id: 'diabetic', label: 'Diabetic' },
  { id: 'nut_allergy', label: 'Nut allergy' },
]

export const RESTRICTION_LABEL = GUEST_RESTRICTIONS.reduce((acc, r) => {
  acc[r.id] = r.label
  return acc
}, {})

// 'non_veg' is the permissive diet: it allows every dish kind, so a guest
// whose only constraint is health-based adds no dietary restriction.
const RESTRICTION_TO_MEMBER = {
  none: { diet: 'non_veg', health: [] },
  vegetarian: { diet: 'vegetarian', health: [] },
  jain: { diet: 'jain', health: [] },
  vegan: { diet: 'vegan', health: [] },
  gluten_free: { diet: 'non_veg', health: ['gluten_sensitive'] },
  diabetic: { diet: 'non_veg', health: ['diabetes_t2'] },
  nut_allergy: { diet: 'non_veg', health: ['nut_allergy'] },
}

export function guestHeadcount(guests) {
  return (guests || []).reduce((n, g) => n + Math.max(0, Number(g.count) || 0), 0)
}

/** Drop empty groups — adding a group then setting it to zero means no guests. */
export function normaliseGuests(guests) {
  return (guests || []).filter((g) => (Number(g.count) || 0) > 0)
}

/**
 * One pseudo-member per guest *group*. Count affects portions, not
 * constraints: three vegetarians restrict the menu exactly as one does.
 */
export function guestsAsMembers(guests) {
  return normaliseGuests(guests).map((g, i) => {
    const map = RESTRICTION_TO_MEMBER[g.restriction] || RESTRICTION_TO_MEMBER.none
    return {
      id: `guest:${g.id ?? i}`,
      name: g.name?.trim() || `Guest ${i + 1}`,
      isGuest: true,
      count: Math.max(1, Number(g.count) || 1),
      restriction: g.restriction || 'none',
      diet: map.diet,
      health: [...map.health],
      fasts: [],
      lifeStage: 'adult',
    }
  })
}

/** "2 vegetarian friends, 1 Jain aunt" — for the prompt and the guest card. */
export function describeGuests(guests) {
  return normaliseGuests(guests).map((g, i) => {
    const label = RESTRICTION_LABEL[g.restriction] || 'No restrictions'
    const name = g.name?.trim() || `Guest ${i + 1}`
    const n = Math.max(1, Number(g.count) || 1)
    return n > 1 ? `${name} × ${n} (${label})` : `${name} (${label})`
  })
}

/** Constraints a guest imposes that the family cannot be cooked around. */
export function guestWholeMealConstraints(guests) {
  const list = normaliseGuests(guests)
  const notes = []
  if (list.some((g) => g.restriction === 'jain')) {
    notes.push({
      kind: 'jain',
      message: 'Because you have a Jain guest, today’s meal is Jain-compliant — no onion, garlic, or root vegetables.',
    })
  }
  if (list.some((g) => g.restriction === 'nut_allergy')) {
    notes.push({
      kind: 'nut_allergy',
      message: 'A guest has a nut allergy, so the whole meal avoids nuts — nothing is cooked separately.',
    })
  }
  if (list.some((g) => g.restriction === 'vegan')) {
    notes.push({
      kind: 'vegan',
      message: 'A vegan guest means the whole meal is dairy-free today — no ghee, milk, curd or paneer.',
    })
  }
  return notes
}

/* ------------------------------------------------------------------ *
 * Persistence                                                         *
 *                                                                     *
 * Guests belong to a day, not to a session: the cousin who came for
 * Sunday lunch is not assumed back on Monday. Stored with a date stamp
 * and dropped when the date changes.
 * ------------------------------------------------------------------ */

export const GUESTS_KEY = 'thali_guests'

export function loadGuests(now = new Date()) {
  try {
    const raw = window.sessionStorage.getItem(GUESTS_KEY)
    const saved = raw ? JSON.parse(raw) : null
    if (!saved || !Array.isArray(saved.guests)) return []
    if (saved.date !== now.toDateString()) return []
    return saved.guests
  } catch {
    return []
  }
}

export function saveGuests(guests, now = new Date()) {
  try {
    window.sessionStorage.setItem(GUESTS_KEY, JSON.stringify({
      date: now.toDateString(),
      guests,
    }))
  } catch {
    // Not fatal — guests are asked for again next time.
  }
}
