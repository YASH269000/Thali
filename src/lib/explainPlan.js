// "Why this meal" — the constraint work, made visible.
//
// evaluateRecipe has always worked out why each dish was set aside, and
// filterRecipes has always dropped it at the `break`. Nothing here recomputes
// anything: it groups what was already known, and samples it down to a size a
// person can read.
//
// This is explanation, not advice. Every sentence says what Thali did and who
// it did it for. Nothing here makes a claim about anyone's health — the flag
// notes describe the food, the constraint phrases describe a choice the family
// already told us about, and the disclaimer on the plan still applies.

const MAX_GROUPS = 8
const EXAMPLES_PER_GROUP = 3

/**
 * An even spread across the list, not the first N.
 *
 * The catalogue is ordered by source — 988 INDB rows, then 106 Thali
 * Originals, then 370 International v2 — so "the first three" would be three
 * ICMR-NIN rows every single time, whatever the family asked for. Taking every
 * ⌈n/k⌉-th entry spreads the sample across the whole group, and is stable: the
 * same plan explains itself the same way on every render, which matters
 * because a panel that reshuffles as you read it looks broken.
 */
function spread(items, count) {
  if (items.length <= count) return [...items]
  const step = items.length / count
  const out = []
  for (let i = 0; i < count; i += 1) out.push(items[Math.floor(i * step)])
  return out
}

/**
 * Examples worth showing first.
 *
 * A family that asked for Italian learns more from a rejected Italian dish
 * than from a rejected INDB row they have never heard of, so same-cuisine
 * examples lead. Within each half the spread above still applies.
 */
function pickExamples(items, cuisine) {
  const named = cuisine && cuisine !== 'indian' && cuisine !== 'surprise' ? cuisine : null
  if (!named) return spread(items, EXAMPLES_PER_GROUP)

  const sameCuisine = items.filter((r) => r.region === named)
  const rest = items.filter((r) => r.region !== named)
  const fromCuisine = spread(sameCuisine, EXAMPLES_PER_GROUP)
  if (fromCuisine.length >= EXAMPLES_PER_GROUP) return fromCuisine
  return [...fromCuisine, ...spread(rest, EXAMPLES_PER_GROUP - fromCuisine.length)]
}

/** Who a constraint belongs to, and what kind of thing it is. */
function describeConstraint(c) {
  const isGuest = String(c.id || '').startsWith('guest:')
  const sources = []
  if (c.diet && c.diet !== 'non_veg') sources.push({ kind: 'diet', label: c.diet })
  if (c.religion && c.religion !== 'none') sources.push({ kind: 'religion', label: c.religion })
  for (const f of c.activeFasts || []) sources.push({ kind: 'fast', label: f })
  for (const a of c.allergens || []) sources.push({ kind: 'allergy', label: a })
  for (const h of c.health || []) {
    if (['diabetes_t1', 'diabetes_t2', 'pcod'].includes(h)) sources.push({ kind: 'health', label: 'low-GI' })
    if (h === 'lactose_intolerant') sources.push({ kind: 'health', label: 'lactose-free' })
    if (h === 'gluten_sensitive') sources.push({ kind: 'health', label: 'gluten-free' })
  }
  return {
    memberId: c.id,
    name: c.name,
    isGuest,
    sources,
    requiredFlags: c.requiredFlags || [],
  }
}

/**
 * Everything the panel needs, small enough to send.
 *
 * @param {object} filtered  the filterRecipes result
 * @param {object} context   { cuisine, mealType, eligible, candidatesSent, planned }
 */
export function buildExplanation(filtered, context = {}) {
  const { rejections = [], constraints = [], stats = {}, swaps = [] } = filtered
  const { cuisine = null, mealType = null, eligible = null, candidatesSent = null } = context

  // One group per (person, reason) pair — the same shape the exclusion was
  // decided on, so the counts add up to the total rather than double-counting
  // a dish that fails two constraints. Only the first failure was recorded.
  const groups = new Map()
  for (const r of rejections) {
    const key = `${r.memberId}|${r.because}|${r.kind}`
    if (!groups.has(key)) {
      groups.set(key, {
        memberId: r.memberId,
        member: r.member,
        because: r.because,
        kind: r.kind,
        count: 0,
        items: [],
      })
    }
    const g = groups.get(key)
    g.count += 1
    g.items.push(r)
  }

  const ranked = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_GROUPS)

  return {
    mealType,
    cuisine,
    // Where the pool went. Each number is a real step in the filter, in order.
    funnel: {
      catalogue: stats.catalogue ?? null,
      afterConstraints: stats.mains ?? null,
      needsAChange: stats.swaps ?? swaps.length,
      setAside: stats.excluded ?? rejections.length,
      fitsThisMeal: eligible,
      offeredToTheModel: candidatesSent,
    },
    constraints: constraints.map(describeConstraint),
    // Sampled, never the whole list: 983 rejections is a wall, not an answer.
    reasons: ranked.map((g) => ({
      member: g.member,
      memberId: g.memberId,
      because: g.because,
      kind: g.kind,
      count: g.count,
      examples: pickExamples(g.items, cuisine).map((r) => ({
        recipeId: r.recipeId,
        name: r.name,
        detail: r.detail,
      })),
    })),
    // How many groups did not fit, so the panel never implies it showed all.
    moreReasons: Math.max(0, groups.size - ranked.length),
  }
}
