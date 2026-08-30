// Turns a family + a date into the set of recipes that may be served, applying
// the agreed filter policy:
//
//   yes         -> include in the main plan
//   no          -> exclude entirely
//   conditional -> keep out of the main plan, surface as a "possible swap"
//                  together with the note describing the required change
//   partial     -> exclude only for members with the strict form of that
//                  constraint (in this data `partial` occurs solely on
//                  diabeticFriendly, so: exclude for diabetics, allow otherwise)

export const FLAG_KEYS = [
  'ekadashiSafe', 'navratriSafe', 'jainSafe', 'diabeticFriendly',
  'lactoseFree', 'vegan', 'onionGarlicFree', 'glutenFree',
]

/* ------------------------------------------------------------------ *
 * Vegetarian safety net                                               *
 *                                                                     *
 * The 8 compliance flags have no vegetarian/non-veg column, and 309 of
 * the 1095 recipes contain meat, fish or egg. Without this check a
 * vegetarian family could be served Chicken Biryani, since none of the
 * 8 flags would object. Keyword matching over name + ingredients is a
 * heuristic, not authoritative data — a real `dietKind` column in the
 * source workbook should replace it.
 * ------------------------------------------------------------------ */

const MEAT_RE = /\b(chicken|mutton|lamb|goat|beef|pork|bacon|ham|fish|prawn|shrimp|crab|lobster|squid|oyster|clam|anchov|tuna|salmon|sardine|mackerel|pomfret|duck|quail|turkey|keema|kheema|seekh|kebab|liver|meat)\b/i
const EGG_RE = /\b(egg|eggs|omelet|omelette|anda|ande|bhurji)\b/i

/** 'non_veg' | 'egg' | 'veg' — the most restrictive category a recipe fits. */
export function dietKind(recipe) {
  // An explicit dietKind on the record always wins. Imported international
  // dishes carry one, because keyword inference cannot tell that "Pad Thai",
  // "Bibimbap", "Carbonara" or "Pho" contain meat — nothing in those names
  // says so, and a vegetarian must never be served one by accident.
  const explicit = recipe.dietKind
  if (explicit === 'veg' || explicit === 'egg' || explicit === 'non_veg') return explicit

  const blob = `${recipe.name || ''} ${recipe.ingredients || ''}`
  if (MEAT_RE.test(blob)) return 'non_veg'
  if (EGG_RE.test(blob)) return 'egg'
  return 'veg'
}

// Allergy safety net. `nut_allergy` is in the health list but there is no
// nut-free column among the 8 compliance flags, so nothing would otherwise
// stop a peanut dish reaching someone allergic to it. Keyword matching over
// name + ingredients is a heuristic, not authoritative data — a real
// allergen column in the source workbook should replace it.
const NUT_RE = /\b(peanut|peanuts|groundnut|groundnuts|moongphali|cashew|cashews|kaju|almond|almonds|badam|pistachio|pista|walnut|akhrot|hazelnut|pecan|macadamia|nut butter|peanut butter|mixed nuts|dry fruits?|nuts)\b/i

export function containsNuts(recipe) {
  return NUT_RE.test(`${recipe.name || ''} ${recipe.ingredients || ''}`)
}

const DIET_ALLOWS = {
  non_veg: ['veg', 'egg', 'non_veg'],
  eggetarian: ['veg', 'egg'],
  vegetarian: ['veg'],
  jain: ['veg'],
  vegan: ['veg'],
  sattvic: ['veg'],
}

/* ------------------------------------------------------------------ *
 * Constraints                                                         *
 * ------------------------------------------------------------------ */

const DIET_FLAGS = {
  jain: ['jainSafe', 'onionGarlicFree'],
  sattvic: ['onionGarlicFree'],
  vegan: ['vegan'],
}

const HEALTH_FLAGS = {
  lactose_intolerant: 'lactoseFree',
  gluten_sensitive: 'glutenFree',
  diabetes_t1: 'diabeticFriendly',
  diabetes_t2: 'diabeticFriendly',
}

const STRICT_HEALTH = ['diabetes_t1', 'diabetes_t2']

// Only two fasting traditions have a matching compliance flag.
function fastFlags(activeFastIds) {
  const flags = []
  for (const id of activeFastIds) {
    if (id.includes('ekadashi')) flags.push('ekadashiSafe')
    if (id.includes('navratri')) flags.push('navratriSafe')
  }
  return flags
}

/**
 * What one member requires today.
 * @returns {{ id, name, diet, allowedKinds, requiredFlags, strictFlags, activeFasts }}
 */
export function memberConstraints(member, activeFastIds) {
  const required = new Set()

  for (const f of DIET_FLAGS[member.diet] || []) required.add(f)
  for (const h of member.health || []) {
    if (HEALTH_FLAGS[h]) required.add(HEALTH_FLAGS[h])
  }

  const observed = (member.fasts || []).filter((id) => activeFastIds.has(id))
  for (const f of fastFlags(observed)) required.add(f)

  // Flags where `partial` is not good enough for this member.
  const strict = new Set()
  if ((member.health || []).some((h) => STRICT_HEALTH.includes(h))) {
    strict.add('diabeticFriendly')
  }

  return {
    id: member.id,
    name: member.name,
    diet: member.diet,
    allowedKinds: DIET_ALLOWS[member.diet] || ['veg'],
    requiredFlags: [...required],
    strictFlags: [...strict],
    activeFasts: observed,
    health: member.health || [],
    likes: member.likes || '',
    dislikes: member.dislikes || '',
    lifeStage: member.lifeStage,
    spiceLevel: member.spiceLevel,
    age: member.age,
    relationship: member.relationship,
  }
}

/**
 * Verdict for one recipe against one member.
 * @returns {{ verdict: 'ok'|'excluded'|'conditional', reasons: string[] }}
 *   'excluded'    — a hard `no`, a disallowed diet kind, or a `partial` the
 *                   member is strict about
 *   'conditional' — servable only with the modification named in the note
 */
export function evaluateRecipe(recipe, constraints) {
  const reasons = []
  const caveats = []
  let conditional = false

  if (!constraints.allowedKinds.includes(dietKind(recipe))) {
    return {
      verdict: 'excluded',
      reasons: [`${dietKind(recipe)} dish, ${constraints.name} is ${constraints.diet}`],
    }
  }

  // An allergy is never "conditional" — exclude outright.
  if (constraints.health.includes('nut_allergy') && containsNuts(recipe)) {
    return { verdict: 'excluded', reasons: [`contains nuts, ${constraints.name} has a nut allergy`] }
  }

  for (const flag of constraints.requiredFlags) {
    const f = recipe.flags?.[flag]
    if (!f) continue
    if (f.status === 'no') {
      return { verdict: 'excluded', reasons: [`${flag}: ${f.note}`] }
    }
    if (f.status === 'partial') {
      // A `partial` dish is edible for a strict member with a stated caution —
      // "Moderate GI: small portions", "lower GI than white rice". Excluding
      // them outright left a diabetic family with almost no non-Indian food at
      // all. They are included now, but the caution travels with the dish and
      // must be shown wherever it appears: a partial dish is never presented
      // as unconditionally safe.
      if (constraints.strictFlags.includes(flag)) {
        const note = String(f.note || '').trim()
        caveats.push({
          member: constraints.name,
          memberId: constraints.id,
          flag,
          note: note || 'Moderate GI — serve a smaller portion',
        })
      }
      continue
    }
    if (f.status === 'conditional') {
      conditional = true
      reasons.push(`${flag}: ${f.note}`)
    }
  }

  return conditional
    ? { verdict: 'conditional', reasons, caveats }
    : { verdict: 'ok', reasons: [], caveats }
}

/**
 * Split the catalogue for one family on one date.
 * @returns {{ mains, swaps, constraints, stats }}
 *   mains — servable to every member as written
 *   swaps — servable to every member only after a stated modification
 */
export function filterRecipes(recipes, family, activeFastIds) {
  const constraints = family.map((m) => memberConstraints(m, activeFastIds))

  const mains = []
  const swaps = []
  // recipeId -> [{ member, flag, note }]. Cautions that must be displayed
  // alongside the dish, never dropped.
  const caveats = new Map()

  for (const recipe of recipes) {
    let excluded = false
    let anyConditional = false
    const modifications = []
    const recipeCaveats = []

    for (const c of constraints) {
      const { verdict, reasons, caveats: cv } = evaluateRecipe(recipe, c)
      if (verdict === 'excluded') { excluded = true; break }
      if (cv?.length) recipeCaveats.push(...cv)
      if (verdict === 'conditional') {
        anyConditional = true
        modifications.push({ member: c.name, changes: reasons })
      }
    }

    if (excluded) continue
    if (recipeCaveats.length) caveats.set(recipe.recipeId, recipeCaveats)
    if (anyConditional) swaps.push({ recipe, modifications })
    else mains.push(recipe)
  }

  return {
    mains,
    swaps,
    constraints,
    caveats,
    stats: {
      catalogue: recipes.length,
      mains: mains.length,
      swaps: swaps.length,
      excluded: recipes.length - mains.length - swaps.length,
    },
  }
}

/**
 * Trim to a prompt-sized candidate list.
 * Thali Originals go first — they are the only recipes with preparation steps.
 */
export function selectCandidates(mains, limit = 80) {
  const originals = mains.filter((r) => r.hasFullPreparation)
  const imported = mains.filter((r) => !r.hasFullPreparation)
  return [...originals, ...imported].slice(0, limit)
}

/** Compact shape for the prompt — preparation is stripped, rehydrated later. */
export function compactForPrompt(recipe) {
  return {
    recipeId: recipe.recipeId,
    name: recipe.name,
    category: recipe.category,
    region: recipe.region,
    prepTimeMin: recipe.prepTimeMin,
    cookTimeMin: recipe.cookTimeMin,
    calories: recipe.caloriesPerServing,
    hasSteps: recipe.hasFullPreparation,
    source: recipe.source,
    ingredients: String(recipe.ingredients || '').slice(0, 220),
  }
}

/* ------------------------------------------------------------------ *
 * Meal-type shaping                                                   *
 *                                                                     *
 * Without this every meal type draws from the same pool and the model
 * returns the same dal-sabzi-rice-roti combo three times. Two things
 * fix it: restrict the pool per meal type, and stratify the candidates
 * by role so the model always has a dal AND a rice AND a sabzi to pick
 * from rather than 80 dals.
 *
 * Only 26 of 1095 recipes carry category "Breakfast", so category alone
 * is too thin — dish names carry the signal and are matched too.
 * ------------------------------------------------------------------ */

const BREAKFAST_NAME_RE = /\b(poha|upma|uppma|dosa|idli|idly|paratha|parantha|chilla|cheela|chila|dalia|daliya|thepla|sheera|halwa|uttapam|uthappam|appam|puttu|porridge|oats|dhokla|khakhra|pongal|vada|sabudana khichdi|misal|dabeli|sandwich|toast|cornflakes|muesli|smoothie|lassi|chai|tea|coffee|milk)\b/i

const ROLE_RULES = [
  ['beverage', /beverage|drink/i, /\b(tea|chai|coffee|lassi|juice|smoothie|milk|sharbat|thandai|buttermilk|chaas)\b/i],
  ['dal', /\bdal\b/i, /\b(dal|daal|sambar|kadhi|rasam|chole|rajma|chana masala)\b/i],
  ['rice', /rice/i, /\b(rice|pulao|pulav|biryani|khichdi|chawal|bath|bisibele)\b/i],
  ['bread', /bread/i, /\b(roti|chapati|phulka|paratha|parantha|puri|poori|naan|kulcha|thepla|bhakri|khakhra)\b/i],
  ['sabzi', /sabzi|curry/i, /\b(sabzi|sabji|bhaji|curry|masala|kootu|poriyal|thoran)\b/i],
  ['accompaniment', /accompaniment|pickle|chutney|salad|raita/i, /\b(chutney|pickle|achar|raita|salad|papad|kachumber)\b/i],
  ['dessert', /dessert|sweet/i, /\b(kheer|halwa|barfi|laddoo|ladoo|payasam|shrikhand|sheera|gulab)\b/i],
  ['snack', /snack/i, /\b(pakora|bhajiya|samosa|tikki|cutlet|vada)\b/i],
]

/** Coarse role bucket for a recipe, from its category then its name. */
export function roleOf(recipe) {
  const cat = String(recipe.category || '')
  const name = String(recipe.name || '')
  for (const [role, catRe] of ROLE_RULES) if (catRe.test(cat)) return role
  for (const [role, , nameRe] of ROLE_RULES) if (nameRe.test(name)) return role
  return 'main'
}

/** Is this recipe plausible for the given meal type? */
export function fitsMealType(recipe, mealType) {
  const cat = String(recipe.category || '')
  const role = roleOf(recipe)

  if (mealType === 'breakfast') {
    if (/breakfast/i.test(cat)) return true
    if (BREAKFAST_NAME_RE.test(String(recipe.name || ''))) return true
    // Sides and drinks round out a breakfast plate.
    return role === 'accompaniment' || role === 'beverage'
  }

  // Lunch and dinner are thali-shaped; desserts and drinks stay optional
  // extras rather than filling the candidate list.
  return ['dal', 'rice', 'bread', 'sabzi', 'accompaniment', 'main'].includes(role)
}

// How many candidates of each role to offer the model, per meal type.
const QUOTAS = {
  breakfast: { main: 26, bread: 12, snack: 8, accompaniment: 14, beverage: 10, dessert: 4, dal: 3, rice: 3 },
  lunch: { dal: 14, rice: 12, bread: 12, sabzi: 20, accompaniment: 12, main: 8 },
  dinner: { dal: 14, sabzi: 20, bread: 14, rice: 8, accompaniment: 10, main: 8 },
}

// Share of each role's quota reserved for recipes that carry preparation
// steps. The rest is drawn from everything else in that role, so the 989
// ingredients-only imports actually reach the model.
const FULL_PREP_SHARE = 0.6

// Share of each role's quota held for non-Indian dishes on ordinary days.
// Without a reservation they compete with ~800 Indian imports for the same
// variety slots and about two per pool survive — too few for the model to
// assemble a coherent non-Indian meal from. Zero when anyone is fasting: a
// pizza is never ekadashiSafe.
const INTERNATIONAL_SHARE = 0.20

// One cuisine per generation, weighted by how much Indian households actually
// order it (the dataset's own research: Indo-Chinese is the largest non-Indian
// cuisine footprint, Italian second, fast food third). Spreading the reserved
// slots across cuisines produced a Thai sabzi beside Italian bread beside
// Indo-Chinese rice — no coherent meal, so the model ignored all of it.
const INTERNATIONAL_CUISINE_WEIGHTS = {
  'Indo-Chinese': 35,
  Italian: 22,
  Continental: 18,
  Mexican: 8,
  Thai: 7,
  'Middle Eastern': 5,
  'East Asian': 5,
}

// Below this a cuisine cannot furnish a meal, so it is not worth choosing.
const MIN_CUISINE_DISHES = 3

/**
 * Weighted pick of one international cuisine that can actually supply a meal
 * from this pool. Returns null when none can.
 */
export function internationalCuisineOptions(pool, mealType) {
  const counts = new Map()
  for (const r of pool) {
    if (r.source !== 'International') continue
    if (mealType && !fitsMealType(r, mealType)) continue
    counts.set(r.region, (counts.get(r.region) || 0) + 1)
  }
  return Object.keys(INTERNATIONAL_CUISINE_WEIGHTS)
    .map((region) => ({
      cuisine: region,
      count: counts.get(region) || 0,
      available: (counts.get(region) || 0) >= MIN_CUISINE_DISHES,
    }))
}

export function pickInternationalCuisine(pool, random = Math.random) {
  const counts = new Map()
  for (const r of pool) {
    if (r.source !== 'International') continue
    counts.set(r.region, (counts.get(r.region) || 0) + 1)
  }
  const eligible = [...counts.entries()]
    .filter(([region, n]) => n >= MIN_CUISINE_DISHES && INTERNATIONAL_CUISINE_WEIGHTS[region])
    .map(([region]) => region)
  if (eligible.length === 0) return null

  const total = eligible.reduce((sum, r) => sum + INTERNATIONAL_CUISINE_WEIGHTS[r], 0)
  let roll = random() * total
  for (const region of eligible) {
    roll -= INTERNATIONAL_CUISINE_WEIGHTS[region]
    if (roll <= 0) return region
  }
  return eligible[eligible.length - 1]
}

/** Random sample without replacement, RNG injectable so tests can seed it. */
function sampleFrom(items, count, random = Math.random) {
  if (count <= 0 || items.length === 0) return []
  if (items.length <= count) return [...items]
  const pool = [...items]
  const out = []
  for (let i = 0; i < count; i += 1) {
    const j = Math.floor(random() * pool.length)
    out.push(pool.splice(j, 1)[0])
  }
  return out
}

/**
 * Meal-type aware, role-stratified candidate selection.
 * `excludeIds` drops recently served dishes — but only while enough
 * candidates remain, so a narrow fasting day never ends up with nothing.
 */
export function selectCandidatesForMeal(
  mains, mealType,
  {
    limit = 80, excludeIds = [], random = Math.random, anyFasting = false,
    // 'indian' -> no international slots. A cuisine name -> that one only.
    // 'surprise' or undefined -> weighted random pick.
    forceCuisine = undefined,
  } = {},
) {
  const exclude = new Set(excludeIds)
  const eligible = mains.filter((r) => fitsMealType(r, mealType))

  const trimmed = eligible.filter((r) => !exclude.has(r.recipeId))
  const MIN_POOL = 20
  const pool = trimmed.length >= MIN_POOL ? trimmed : eligible
  const excludedApplied = trimmed.length >= MIN_POOL

  const quotas = QUOTAS[mealType] || QUOTAS.dinner

  // All reserved slots come from this one cuisine, so the pool can furnish a
  // meal someone would actually cook together.
  const mealPool = pool.filter((r) => fitsMealType(r, mealType))
  let cuisine = null
  if (!anyFasting && forceCuisine !== 'indian') {
    if (forceCuisine && forceCuisine !== 'surprise') {
      // Honour the request only if that cuisine can actually furnish a meal.
      const opt = internationalCuisineOptions(mealPool, mealType)
        .find((o) => o.cuisine === forceCuisine)
      cuisine = opt?.available ? forceCuisine : null
    } else {
      cuisine = pickInternationalCuisine(mealPool, random)
    }
  }
  const byRole = new Map()
  for (const r of pool) {
    const role = roleOf(r)
    if (!byRole.has(role)) byRole.set(role, [])
    byRole.get(role).push(r)
  }

  const picked = []
  for (const [role, quota] of Object.entries(quotas)) {
    const bucket = byRole.get(role) || []

    // Non-Indian dishes are drawn from their own reserved slice first, so a
    // handful always reach the model rather than being crowded out.
    const intlPool = cuisine
      ? bucket.filter((r) => r.source === 'International' && r.region === cuisine)
      : []
    const domestic = bucket.filter((r) => r.source !== 'International')
    const intlTarget = cuisine ? Math.round(quota * INTERNATIONAL_SHARE) : 0
    const chosenIntl = sampleFrom(intlPool, intlTarget, random)

    // Whatever the reservation did not use returns to the domestic quota.
    const domesticQuota = quota - chosenIntl.length

    const withSteps = domestic.filter((r) => r.hasFullPreparation)
    const rest = domestic.filter((r) => !r.hasFullPreparation)

    // Reserve most of the remaining quota for recipes carrying preparation
    // steps, so Cook Mode works on what comes back — but not the whole quota.
    // Sorting steps-first and taking the top N starved whole roles of
    // everything else: `main` had 318 ingredients-only recipes available and
    // sent zero.
    // Reserve 60% of the quota for recipes with preparation steps, or however
    // many exist in this role, whichever is smaller. A constrained family can
    // leave a role with far fewer Originals than its share — a diabetic family
    // has 3 breads against a quota of 14 — and slicing the top of the list
    // meant the same three appeared in every single pool.
    const targetFull = Math.min(
      Math.round(domesticQuota * FULL_PREP_SHARE),
      withSteps.length,
    )
    // Sampled, not sliced: where a role has more Originals than its share,
    // a different subset appears each time instead of always the first few.
    const chosenFull = sampleFrom(withSteps, targetFull, random)

    // The rest of the quota is sampled from everything else in the role.
    const chosenRest = sampleFrom(rest, domesticQuota - chosenFull.length, random)

    // A role short on any kind fills up from the others rather than leaving
    // the quota unmet.
    const shortfall = domesticQuota - chosenFull.length - chosenRest.length
    const topUp = shortfall > 0
      ? sampleFrom(withSteps.filter((r) => !chosenFull.includes(r)), shortfall, random)
      : []

    picked.push(...chosenIntl, ...chosenFull, ...chosenRest, ...topUp)
  }

  // Backfill if quotas under-filled, so a thin day still offers choice.
  if (picked.length < limit) {
    const have = new Set(picked.map((r) => r.recipeId))
    for (const r of pool) {
      if (picked.length >= limit) break
      if (!have.has(r.recipeId)) picked.push(r)
    }
  }

  return {
    candidates: picked.slice(0, limit),
    internationalCuisine: cuisine,
    eligible: eligible.length,
    excludedApplied,
    roleCounts: Object.fromEntries(
      [...byRole.entries()].map(([k, v]) => [k, v.length]),
    ),
  }
}
