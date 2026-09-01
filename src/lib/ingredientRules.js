// What a tradition forbids in the pot, as distinct from what a flag can say.
//
// The recipe schema carries nine compliance flags, and until now only two of
// them — ekadashiSafe and navratriSafe — plus onionGarlicFree narrowed
// anything. Every other tradition reached the model as prompt text and the
// family as a banner while the deterministic filter ignored it, which
// docs/DATA-ISSUES.md has recorded as an open gap since the "why this meal"
// panel made it visible.
//
// The flags cannot close it. "Sendha namak only" and "no leafy greens for the
// month of Sawan" are not properties nine booleans can express, and adding a
// tenth for each tradition would mean re-annotating 1,464 recipes by hand for
// every rule anybody ever adds. So a tradition carries keyword lists instead,
// evaluated against the ingredient text.
//
// ONE MATCHER, REUSED.
//
// Nothing here parses an ingredient. `splitIngredients` cuts the string the
// way the shopping list cuts it, `parseIngredient` takes the quantity off, and
// `matchPantryLine` decides whether a keyword names it — the same three
// functions, in the same order, that decide whether a family already has
// something in the pantry. That matters beyond avoiding duplication: the
// matcher does exact base-and-form comparison rather than substring, which is
// why `potato` does not claim `sweet potato`, `onion` does not claim `spring
// onion`, and `salt` does not claim `sendha namak`. A second matcher written
// for this file would have had to rediscover all three.
//
// FORBIDDEN VERSUS SWAP.
//
// A keyword can exclude a dish or it can annotate it. The distinction is not
// stylistic — it was forced by the data. Of 1,464 recipes, 19 name sendha
// namak and every one of them is hand-written; 985 say bare "salt" and the
// vast majority are machine-imported from a nutrition database whose ingredient
// strings read "plain: 100g; salt: 0.17tsp". That is a table listing sodium
// chloride as an analysed component, not a cook choosing a salt. Excluding on
// it would have cut the Ekadashi pool from 185 to 106 and the demo family's
// from 83 to 24, on the strength of an import format. So bare salt attaches a
// swap note and only an explicitly named table or iodised salt excludes.

import { matchPantryLine, pantryIdentity } from './ingredientNames.js'
import { parseIngredient, splitIngredients } from './shoppingList.js'

/* ------------------------------------------------------------------ *
 * The rules                                                           *
 * ------------------------------------------------------------------ */

/**
 * Ekadashi and Navratri, which share their food rules.
 *
 * No grains or cereals, and only the vrat flours; no pulses, lentils or
 * besan; sendha namak rather than table salt; no allium; nothing non-
 * vegetarian. Dairy and potato are permitted and are most of what is left.
 */
const VRAT = {
  id: 'vrat',
  label: 'Ekadashi and Navratri',
  // Deliberately empty: ekadashiSafe and navratriSafe are the two flags
  // fastFlags() already maps, and naming them here would make an Ekadashi
  // member require navratriSafe as well.
  flags: [],
  vegetarianOnly: true,
  forbidden: [
    // Grains and cereals. The vrat flours below are deliberately different
    // bases to the canonicaliser, so none of these reaches them.
    'rice', 'basmati rice', 'brown rice', 'wheat', 'atta', 'whole wheat flour',
    'maida', 'suji', 'rava', 'semolina', 'oats', 'barley', 'corn', 'maize',
    'cornflour', 'millet', 'bajra', 'jowar', 'ragi', 'poha', 'vermicelli',
    'bread', 'pasta', 'noodles', 'daliya', 'quinoa', 'couscous',
    // Pulses, lentils and their flour.
    'dal', 'toor dal', 'arhar dal', 'moong dal', 'chana dal', 'urad dal',
    'masoor dal', 'rajma', 'chickpeas', 'chana', 'kabuli chana', 'besan',
    'gram flour', 'lentils', 'peas', 'matar', 'green peas', 'soya', 'tofu',
    'sprouts', 'beans',
    // Allium.
    'onion', 'spring onion', 'shallots', 'leek', 'garlic', 'garlic cloves', 'lehsun',
    // Never on a vrat.
    'egg', 'eggs', 'chicken', 'mutton', 'lamb', 'beef', 'pork', 'fish',
    'prawns', 'wine', 'beer', 'rum', 'vinegar',
    // The salt a vrat actually forbids — named, not inferred. See the note
    // above on why bare "salt" is a swap and not this.
    'table salt', 'iodised salt', 'iodized salt',
  ],
  swaps: [
    {
      when: ['salt'],
      note: 'Use sendha namak (rock salt) — regular salt is not taken on a vrat.',
    },
  ],
  // Recorded rather than enforced. The forbidden list is what narrows the
  // pool; this says what the tradition positively allows, for the prompt and
  // for anyone reading the rule.
  permitted: [
    'kuttu', 'buckwheat flour', 'singhara', 'water chestnut flour', 'rajgira',
    'amaranth flour', 'sama', 'sama ke chawal', 'samak rice', 'sabudana',
    'sendha namak', 'rock salt', 'potato', 'sweet potato', 'milk', 'curd',
    'paneer', 'ghee', 'makhana', 'peanuts',
  ],
}

/**
 * The Jain rules, kept year-round by a Jain household and intensified during
 * Paryushana and Das Lakshana.
 *
 * NEITHER GINGER NOR TURMERIC APPEARS BELOW, AND THAT IS DELIBERATE.
 *
 * Both are underground and both are genuinely excluded fresh. But the
 * canonicaliser strips `fresh` as a qualifier, so `pantryIdentity('fresh
 * turmeric').base` is `turmeric` — the same base as the powdered haldi in
 * every Indian kitchen, which Jain cooking uses freely. A `fresh turmeric`
 * keyword therefore matches plain "turmeric" and excluded 31 recipes that were
 * correctly flagged jainSafe.
 *
 * The fix is not to special-case the canonicaliser. Stripping `fresh` is right
 * everywhere else it fires, and a recipe that says only "turmeric" carries no
 * information about which one it means — no matcher can recover what the text
 * does not contain. So the keyword is dropped and the four recipes where bare
 * ginger really was the fresh root were corrected at the flag instead. If
 * someone later "improves" the canonicaliser to keep `fresh`, this comment is
 * the reason not to, and docs/DATA-ISSUES.md records it too.
 */
const JAIN = {
  id: 'jain',
  label: 'Jain, Paryushana and Das Lakshana',
  // Paryushana and Das Lakshana had NO column in the recipe data at all —
  // docs/DATA-ISSUES.md recorded that a Paryushana member was no better served
  // than someone keeping no fast. These are the flags they should always have
  // required; the keyword list below is the half no flag could express.
  flags: ['jainSafe', 'onionGarlicFree', 'alcoholFree'],
  forbidden: [
    // Roots, tubers and corms.
    'potato', 'sweet potato', 'yam', 'arbi', 'colocasia', 'suran', 'turnip',
    'beetroot', 'carrot', 'radish', 'mooli', 'daikon',
    // Underground allium.
    'onion', 'spring onion', 'shallots', 'leek', 'garlic', 'garlic cloves', 'lehsun',
    // Brinjal, for the seeds.
    'brinjal', 'baingan', 'aubergine', 'eggplant',
    // Honey, where it is structural. The optional case is a swap below.
    'honey',
  ],
  swaps: [
    {
      when: ['honey'],
      onlyWhenOptional: true,
      note: 'Leave the honey out or use jaggery — honey is not taken in a Jain kitchen.',
    },
  ],
  permitted: [],
}

/**
 * Sawan, the month, with its stricter Mondays.
 *
 * A month-long tag rather than a day: `sawan_somvar_vrat` is active across the
 * whole of purnimanta Shravana, and `somvar_vrat_monday_fast` is additionally
 * active on the four Mondays inside it, so the Monday is stricter by carrying
 * two traditions rather than by a rule written here.
 *
 * Leafy greens are set aside for the month because the monsoon is when they
 * carry insects, and the same reasoning gives cabbage, whose layers are where
 * insects nest. Lettuce has no Indian tradition attached to it; it is here
 * because it is raw and leafy and the reasoning transfers.
 */
const SAWAN = {
  id: 'sawan',
  label: 'Sawan and Sawan Somvar',
  flags: ['onionGarlicFree', 'alcoholFree'],
  // The month is kept vegetarian, which is a dish KIND rather than a flag.
  vegetarianOnly: true,
  forbidden: [
    'spinach', 'palak', 'fenugreek leaves', 'methi leaves', 'mustard greens',
    'sarson', 'amaranth leaves', 'chaulai', 'bathua', 'lettuce', 'cabbage',
    'kale', 'greens',
    'brinjal', 'baingan', 'aubergine', 'eggplant',
  ],
  swaps: [],
  permitted: [],
}

/**
 * Which traditions carry which rules.
 *
 * Keyed by the fasting-tradition slugs a member actually selects, so the
 * lookup is against `activeFastIds` and nothing has to be resolved first.
 * `test/ingredient-rules.test.js` asserts every key is a real tradition.
 */
export const TRADITION_RULES = {
  ekadashi_vrat: VRAT,
  navratri_vrat: VRAT,
  paryushana_parva: JAIN,
  das_lakshana_parva: JAIN,
  atthai_8_day_continuous_fast: JAIN,
  jain_year_round_dietary_rules: JAIN,
  sawan_somvar_vrat: SAWAN,
}

/** The Jain diet is an identity, not a fast, and carries the same rules. */
export const DIET_RULES = { jain: JAIN }

export const ALL_RULES = [VRAT, JAIN, SAWAN]

/* ------------------------------------------------------------------ *
 * Matching                                                           *
 * ------------------------------------------------------------------ */

const identityCache = new Map()
function identityOf(term) {
  if (!identityCache.has(term)) identityCache.set(term, pantryIdentity(term))
  return identityCache.get(term)
}

const nameCache = new Map()

/**
 * The ingredient names of a recipe, cleaned the way the shopping list cleans
 * them — quantity and unit off, parentheticals kept because they can name the
 * product.
 *
 * Cached on the recipe id: filterRecipes walks the whole catalogue for every
 * member, and re-parsing 1,464 ingredient strings per member is the one place
 * this could have become slow.
 */
export function ingredientNamesOf(recipe) {
  const key = recipe.recipeId
  if (!key) return splitIngredients(recipe.ingredients || '').map((i) => parseIngredient(i).name)
  if (!nameCache.has(key)) {
    nameCache.set(key, splitIngredients(recipe.ingredients || '')
      .map((item) => parseIngredient(item).name)
      .filter(Boolean))
  }
  return nameCache.get(key)
}

/** Does this recipe contain the thing this keyword names? */
function findTerm(recipe, term) {
  const id = identityOf(term)
  for (const name of ingredientNamesOf(recipe)) {
    if (matchPantryLine(id, name)) return name
  }
  return null
}

/** An ingredient the recipe itself marks as optional or offers an alternative to. */
const OPTIONAL = /\boptional\b|\bto serve\b|\bfor drizzling\b|\bor\s+\w/i

/**
 * Every forbidden ingredient this recipe contains, under one rule set.
 *
 * @returns {Array<{ rule, term, ingredient }>}
 */
export function ruleViolations(recipe, rules) {
  const out = []
  for (const rule of rules) {
    for (const term of rule.forbidden) {
      const swap = rule.swaps.find((s) => s.onlyWhenOptional && s.when.includes(term))
      const found = findTerm(recipe, term)
      if (!found) continue
      // An ingredient the recipe already calls optional is a swap, not an
      // exclusion — "honey (optional)" is a dish that works without it.
      if (swap && OPTIONAL.test(found)) continue
      out.push({ rule: rule.id, term, ingredient: found })
    }
  }
  return out
}

/**
 * Swap notes for a recipe that is servable but needs one thing done
 * differently.
 *
 * @returns {Array<{ rule, ingredient, note }>}
 */
export function ruleSwaps(recipe, rules) {
  const out = []
  for (const rule of rules) {
    for (const swap of rule.swaps) {
      for (const term of swap.when) {
        const found = findTerm(recipe, term)
        if (!found) continue
        if (swap.onlyWhenOptional && !OPTIONAL.test(found)) continue
        out.push({ rule: rule.id, ingredient: found, note: swap.note })
        break
      }
    }
  }
  return out
}

/**
 * The rule sets in force for a member today, deduplicated.
 *
 * Each carries `keptAs`: the traditions THIS member is actually keeping that
 * brought the rule in. One rule set serves several traditions — Ekadashi and
 * Navratri share their food rules, Paryushana and Das Lakshana share the Jain
 * ones — so the rule's own label is the wrong thing to say to a family. A
 * member keeping Ekadashi is keeping Ekadashi, not "Ekadashi and Navratri",
 * and the panel's rule is that a reason names the thing it belongs to.
 */
export function rulesFor(diet, activeFastIds, labelOf = (id) => id) {
  const kept = new Map()
  const add = (rule, as) => {
    if (!rule) return
    if (!kept.has(rule)) kept.set(rule, [])
    if (as && !kept.get(rule).includes(as)) kept.get(rule).push(as)
  }
  add(DIET_RULES[diet], diet === 'jain' ? 'a Jain kitchen' : null)
  for (const id of activeFastIds || []) add(TRADITION_RULES[id], labelOf(id))
  return [...kept.entries()].map(([rule, as]) => ({ ...rule, keptAs: as }))
}
