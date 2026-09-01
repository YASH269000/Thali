// The family roster, and the one place that reads or writes it.
//
// Two components loaded this key with their own identical copy of the same
// four lines. That was harmless until a stored value needed migrating, at
// which point the migration would have had to exist twice and stay in step.

export const FAMILY_KEY = 'thali_family'

/**
 * Health ids that were offered and then withdrawn, and what replaced them.
 *
 * This matters more than a rename usually would. `memberConstraints` ignores a
 * health id it does not recognise, silently — so a withdrawn id left sitting
 * in someone's storage does not weaken their filter, it removes it. A coeliac
 * carrying `gluten_allergy` would have seen 1,132 servable recipes where 657
 * are safe, with nothing on screen to say the filter had gone.
 *
 * `gluten_allergy` was offered for one deploy before being folded into
 * `gluten_sensitive`, which reads the same flag and offers the same
 * tamari-for-soy-sauce swap.
 */
const RENAMED_HEALTH = {
  gluten_allergy: 'gluten_sensitive',
}

/**
 * Rewrite withdrawn health ids in place.
 * @returns {{ family: Array, changed: boolean }}
 */
export function migrateFamily(family) {
  let changed = false
  const migrated = (family || []).map((member) => {
    const health = member?.health
    if (!Array.isArray(health) || health.length === 0) return member

    const next = []
    for (const id of health) {
      const renamed = RENAMED_HEALTH[id]
      if (renamed) changed = true
      const settled = renamed || id
      // A member holding both the old and the new id must not end up with the
      // same condition twice.
      if (!next.includes(settled)) next.push(settled)
    }
    if (next.length !== health.length) changed = true
    return changed ? { ...member, health: next } : member
  })
  return { family: migrated, changed }
}

/**
 * The family as stored, with any withdrawn ids rewritten AND written back.
 *
 * Written back on purpose: migrating on every read would leave the bad value
 * in storage for the next thing that reads it directly, and this repairs the
 * data once instead of compensating for it forever.
 */
export function loadFamily() {
  try {
    const raw = window.localStorage.getItem(FAMILY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []

    const { family, changed } = migrateFamily(parsed)
    if (changed) saveFamily(family)
    return family
  } catch {
    // Corrupt or unavailable storage (private mode, cleared data) — start
    // empty rather than crash the screen.
    return []
  }
}

export function saveFamily(family) {
  try {
    window.localStorage.setItem(FAMILY_KEY, JSON.stringify(family))
  } catch {
    // Storage unavailable — the roster works for this session only.
  }
}
