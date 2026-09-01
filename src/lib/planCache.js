// The last plan that actually worked, per combination.
//
// Gemini returns 503 under load. When every retry has failed there is still
// something honest to offer: the plan this family got last time they asked for
// this same meal. It is not a fresh answer and must never be dressed as one —
// see the banner in MealPlan.jsx — but it beats an error page when someone is
// standing in a kitchen.
//
// Keyed by the same planKey the generation effect uses, so a cached plan can
// only ever be offered for the exact meal type, cuisine and set of diners it
// was generated for.

export const PLAN_CACHE_KEY = 'thali_last_plans'

// A full plan is ~119 KB, and 107 KB of that is `alternates` — twelve swap
// candidates per role on the plate, each carrying its whole recipe. A cached
// plan is a fallback, not a working surface, so they are dropped: 13 KB each
// means several combinations fit without crowding localStorage.
const MAX_ENTRIES = 6

/** The parts worth keeping. Alternates are the swap UI's, not the plan's. */
function slim(plan) {
  const rest = { ...(plan || {}) }
  delete rest.alternates
  return rest
}

function readAll() {
  try {
    const raw = window.localStorage.getItem(PLAN_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

/**
 * Remember a plan that generated cleanly.
 * @param {string} key   from planKey(mealType, present, guests, cuisine)
 * @param {object} plan  the API response
 */
export function rememberPlan(key, plan) {
  if (!key || !plan?.dishes?.length) return
  try {
    const all = readAll()
    all[key] = { savedAt: new Date().toISOString(), plan: slim(plan) }

    // Oldest out first, so a family that cooks the same three meals keeps them.
    const keys = Object.keys(all)
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => String(all[a].savedAt).localeCompare(String(all[b].savedAt)))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => { delete all[k] })
    }
    window.localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(all))
  } catch {
    // Storage full or unavailable — the fallback is a convenience, and losing
    // it must never break generating a real plan.
  }
}

/**
 * The last plan for this exact combination, if there is one.
 * @returns {{ plan, savedAt } | null}
 */
export function recallPlan(key) {
  if (!key) return null
  const entry = readAll()[key]
  if (!entry?.plan?.dishes?.length) return null
  return entry
}

/** "Sunday, 31 August" — how the banner names when the plan was made. */
export function describeSavedAt(savedAt) {
  const d = new Date(savedAt)
  if (Number.isNaN(d.getTime())) return 'an earlier session'
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const label = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  return sameDay ? `earlier today, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : label
}
