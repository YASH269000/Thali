// Recipes that point at another recipe instead of repeating it.
//
// Five Thali Originals are written as pure cross-references — "Refer to Recipe
// E001", "Same as Ekadashi Sabudana Vada (E008) — use same recipe" — in BOTH
// the ingredients and the preparation field. Nothing else is in those fields.
//
// Dropping such a line would leave the dish contributing nothing to a shopping
// list and nothing to Cook Mode: a shopper who buys the list is missing a whole
// dish, and a cook who opens the dish is told to go and find another recipe.
// So the reference is followed rather than filtered.
//
// Deliberately narrow. It matches the two phrasings that actually occur and
// nothing else — a broad "does this look like an instruction" test over an
// ingredients field is what would start deleting real food.
//
// Nothing here edits recipes.json; resolution happens as the plan is built.

// Recipe ids in this database are letters then digits: E001, R010, INT008.
const ID_RE = /\b([A-Z]{1,4}\d{2,4})\b/

const REF_HEAD_RE = /^\s*(?:refer\s+to\s+recipe|same\s+as)\b/i

// Sheet names, glosses and connectives that sit between the id and any real
// modification: "in Ekadashi Recipes", "(Jain Puran Poli)", "— use same recipe".
const FILLER_RE =
  /^\s*(?:in\s+[A-Za-z\s]*recipes?(?:\s+sheet)?|\([^)]*\)|[—-]\s*use\s+same\s+recipe|same\s+recipe|\.|,)\s*/i

// What introduces the modification itself.
const MODIFIER_RE = /^\s*(?:with\s+modification\s*:|but\b|with\b|except\b|however\b)\s*/i

/**
 * A cross-reference, if this text is one.
 * @returns {{ targetId: string, modification: string } | null}
 */
export function parseRecipeRef(text) {
  const raw = String(text || '').trim()
  if (!raw || !REF_HEAD_RE.test(raw)) return null

  const m = ID_RE.exec(raw)
  if (!m) return null

  let rest = raw.slice(m.index + m[1].length)
  let prev = null
  while (prev !== rest) { prev = rest; rest = rest.replace(FILLER_RE, '') }

  const mod = MODIFIER_RE.test(rest) ? rest.replace(MODIFIER_RE, '').trim() : ''
  return { targetId: m[1], modification: mod.replace(/\s+/g, ' ').trim() }
}

/**
 * Follow a recipe's references, if it has any.
 *
 * Ingredients and preparation are resolved separately because they carry
 * different notes: D002's ingredients say "substitute jaggery with 1 tsp
 * stevia" while its preparation says "skip jaggery entirely, or replace with
 * stevia (½ tsp)". Both are shown verbatim, in the place each belongs, and
 * neither is applied — see the contradiction they contain.
 *
 * `serves` is NOT taken from the target. The dish being cooked is this one, so
 * its own serves is what quantities scale against.
 *
 * @param {object} recipe
 * @param {Map<string, object>} byId
 * @returns {object} the recipe, with ingredients/preparation resolved and a
 *   `ref` describing what happened (absent when there was no reference)
 */
export function resolveRecipeRef(recipe, byId) {
  if (!recipe) return recipe
  const ingRef = parseRecipeRef(recipe.ingredients)
  const prepRef = parseRecipeRef(recipe.preparation)
  if (!ingRef && !prepRef) return recipe

  const targetId = ingRef?.targetId || prepRef?.targetId
  const target = byId?.get?.(targetId) || null

  const ref = {
    targetId,
    targetName: target?.name || null,
    // From the ingredients field: what the shopping list must flag.
    modification: ingRef?.modification || '',
    // From the preparation field: what the cook must read before step 1.
    prepNote: prepRef?.modification || '',
    resolved: Boolean(target),
  }

  if (!target) return { ...recipe, ref }

  return {
    ...recipe,
    ingredients: ingRef ? target.ingredients : recipe.ingredients,
    preparation: prepRef ? target.preparation : recipe.preparation,
    hasFullPreparation: prepRef
      ? Boolean(target.hasFullPreparation)
      : recipe.hasFullPreparation,
    ref,
  }
}

/**
 * Does this ingredient name appear in a modification note?
 *
 * Used to mark the line itself rather than only printing the note beside it:
 * someone scanning a numbered list buys what is on it, and "jaggery" on a
 * diabetic dish is the one line that must not read as a plain purchase.
 */
export function namedInModification(name, modification) {
  const mod = String(modification || '').toLowerCase()
  if (!mod) return false
  return String(name || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4)
    .some((w) => mod.includes(w))
}

/**
 * Recipes whose two fields disagree about the same modification.
 *
 * Reported, never reconciled: D002 says "1 tsp stevia" in ingredients and
 * "stevia (1/2 tsp)" in preparation, and picking one would be inventing an
 * answer the data does not contain. Both are shown to the user verbatim.
 */
export function findRefContradictions(recipes) {
  const out = []
  for (const r of recipes || []) {
    const ing = parseRecipeRef(r.ingredients)
    const prep = parseRecipeRef(r.preparation)
    if (!ing?.modification || !prep?.modification) continue
    const amounts = (t) => (String(t).match(/(?:\d+(?:\.\d+)?|[½¼¾⅓⅔])\s*(?:tsp|tbsp|cups?|g|ml)/gi) || [])
      .map((a) => a.toLowerCase().replace(/\s+/g, ''))
    const a = amounts(ing.modification)
    const b = amounts(prep.modification)
    if (a.length && b.length && a.join() !== b.join()) {
      out.push({
        recipeId: r.recipeId,
        name: r.name,
        ingredientsSays: ing.modification,
        preparationSays: prep.modification,
        amounts: { ingredients: a, preparation: b },
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Composite recipes                                                   *
 *                                                                     *
 * The International v2 set uses recipes as ingredients. "Falafel Wrap
 * Plate" asks for 16 falafel; "Vegetable Lasagne" asks for 2 cups of
 * marinara sauce; every Thai curry starts from 3 tbsp of a curry paste
 * that is itself a recipe in the same file.
 *
 * Dropping the link costs the same two things D002 would cost: a
 * shopper buys the list and has no chickpeas for the falafel, and a
 * cook opens the wrap plate and is told to produce sixteen falafel out
 * of nowhere. So the reference is followed, exactly as a cross-
 * reference is — resolved as the plan is built, never written into
 * recipes.json.
 *
 * Deliberately a closed list rather than "does this ingredient look
 * like a dish name". Matching every ingredient against every recipe
 * name found "vegetable stock" inside "Kimbap (vegetable)" and
 * "oyster mushrooms" inside "Mapo Tofu (mushroom)" — a broad matcher
 * here starts folding whole recipes into a list for no reason.
 * ------------------------------------------------------------------ */

// Ingredient phrase -> the recipe that makes it, within the same cuisine.
// Longest phrases first: "vegetarian thai red curry paste" must be tried
// before "curry paste" would be, and "flour tortillas" before "tortillas".
const COMPONENT_NAMES = [
  'pickled mustard greens or cucumber relish',
  'vegetarian thai green curry paste',
  'vegetarian thai red curry paste',
  'vegetarian kimchi',
  'cucumber relish',
  'flour tortillas',
  'marinara sauce',
  'corn tortillas',
  'refried beans',
  'pico de gallo',
  'peanut sauce',
  'salsa verde',
  'salsa roja',
  'guacamole',
  'falafel',
  'hummus',
].sort((a, b) => b.length - a.length)

// The recipe each phrase resolves to, matched by name inside the same cuisine.
// Held as name patterns rather than ids so the link survives a re-import that
// renumbers the set.
const COMPONENT_TARGETS = {
  'vegetarian thai red curry paste': /^vegetarian thai red curry paste$/i,
  'vegetarian thai green curry paste': /^vegetarian thai green curry paste$/i,
  'pickled mustard greens or cucumber relish': /cucumber relish/i,
  'cucumber relish': /cucumber relish/i,
  'refried beans': /^refried beans/i,
  'vegetarian kimchi': /^vegetarian kimchi$/i,
  'marinara sauce': /^marinara sauce$/i,
  'corn tortillas': /^corn tortillas$/i,
  'flour tortillas': /^flour tortillas$/i,
  'pico de gallo': /^pico de gallo$/i,
  'peanut sauce': /^peanut sauce$/i,
  'salsa verde': /^salsa verde$/i,
  'salsa roja': /^salsa roja$/i,
  guacamole: /^guacamole$/i,
  falafel: /^falafel$/i,
  hummus: /^hummus$/i,
}

// TH006 -> TH043 Peanut Sauce -> TH041 red curry paste is two deep. Three is
// already more than this data contains and stops a bad edit looping.
const MAX_COMPONENT_DEPTH = 3

/** Everything a cuisine could be asked to make from scratch. */
function componentIndex(recipes, cuisine) {
  const inCuisine = recipes.filter((r) => (r.cuisine || r.region) === cuisine)
  const index = new Map()
  for (const phrase of COMPONENT_NAMES) {
    const target = inCuisine.find((r) => COMPONENT_TARGETS[phrase].test(String(r.name || '')))
    if (target) index.set(phrase, target)
  }
  return index
}

/**
 * Sub-recipes one recipe asks for by name.
 *
 * @param {object} recipe
 * @param {Array} recipes    the whole catalogue
 * @param {object} [options] `skipIds` — recipes already on the plan in their
 *   own right, so a marinara that is itself a dish is not folded in twice.
 * @returns {Array<{ targetId, targetName, ingredientLine, ingredients,
 *   preparation, serves, hasFullPreparation, depth, ingredientLines }>}
 *   Deepest-first, so "make this first" reads in the order a cook works:
 *   curry paste before peanut sauce before satay.
 */
export function resolveComponents(recipe, recipes, { skipIds = [] } = {}) {
  const cuisine = recipe?.cuisine || recipe?.region
  if (!recipe || !cuisine) return []

  const index = componentIndex(recipes, cuisine)
  if (index.size === 0) return []

  const skip = new Set(skipIds)
  const found = new Map()

  const walk = (host, depth) => {
    if (depth > MAX_COMPONENT_DEPTH) return
    for (const line of String(host.ingredients || '').split(';')) {
      const lower = line.toLowerCase()
      // First (longest) phrase wins, so "flour tortillas" never resolves as
      // plain "tortillas" and a curry paste never resolves as "peanut sauce".
      const phrase = COMPONENT_NAMES.find((p) => lower.includes(p))
      if (!phrase) continue
      const target = index.get(phrase)
      if (!target || target.recipeId === recipe.recipeId) continue
      if (skip.has(target.recipeId)) continue

      const seen = found.get(target.recipeId)
      if (seen) {
        // Reached twice: keep the deeper depth so it still sorts first, and
        // remember this line too. EA032 asks for kimchi and then for kimchi
        // juice; recording only the first left the second on the shopping
        // list beside the ingredients that make it.
        seen.depth = Math.max(seen.depth, depth)
        if (!seen.ingredientLines.includes(line.trim())) seen.ingredientLines.push(line.trim())
        continue
      }
      found.set(target.recipeId, {
        targetId: target.recipeId,
        targetName: target.name,
        ingredientLine: line.trim(),
        ingredientLines: [line.trim()],
        ingredients: target.ingredients || '',
        preparation: target.preparation || null,
        serves: target.serves ?? null,
        hasFullPreparation: Boolean(target.hasFullPreparation),
        depth,
      })
      walk(target, depth + 1)
    }
  }

  walk(recipe, 1)
  return [...found.values()].sort((a, b) => b.depth - a.depth)
}
