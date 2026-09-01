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

import { BLOCKING_KINDS, unknownMemberIds } from './memberValidation.js'
import { FAST_LABEL } from '../data/memberOptions.js'
import { observanceFor } from './observanceProfile.js'
import { ruleSwaps, ruleViolations, rulesFor } from './ingredientRules.js'

export const FLAG_KEYS = [
  'ekadashiSafe', 'navratriSafe', 'jainSafe', 'diabeticFriendly',
  'lactoseFree', 'vegan', 'onionGarlicFree', 'glutenFree', 'alcoholFree',
]

/**
 * Non-Indian recipes, whatever import they came from.
 *
 * Written once because six places test it — the candidate reservation, the
 * cuisine picker, the weighted pick and the prompt builder — and a rename that
 * lands in five of them silently stops reserving international slots rather
 * than failing.
 */
export function isInternational(recipe) {
  return recipe?.source === 'International v2'
}

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

// Gelatine and the rendered fats say nothing about themselves. "Gelatine:
// 0.25tsp" sits in the middle of an INDB ingredient row that is otherwise
// milk, sugar and fruit, and no other word in the row objects — 12 desserts
// were reaching vegetarian, Jain and vegan members on the strength of that.
const MEAT_RE = /\b(chicken|mutton|lamb|goat|beef|pork|bacon|ham|fish|prawn|shrimp|crab|lobster|squid|oyster|clam|anchov|tuna|salmon|sardine|mackerel|pomfret|duck|quail|turkey|keema|kheema|seekh|kebab|liver|meat|gelatin|gelatine|gelatin(?:e)?s|isinglass|lard|tallow|suet|worcestershire)\b/i
// Mayonnaise is egg. It is the one animal ingredient in this data that never
// says its own name — "Korean Corn Cheese: corn, mozzarella, mayo, butter"
// reads as vegetarian to a word match that only looks for "egg".
const EGG_RE = /\b(egg|eggs|omelet|omelette|anda|ande|bhurji|mayonnaise|mayo)\b/i

// Text that says an animal ingredient is ABSENT must not read as presence.
// The International v2 set states this constantly and deliberately — "400 g
// ramen noodles (egg-free)", "½ cup eggless mayonnaise", "24 gyoza wrappers
// (egg-free)" — and 28 of its 350 vegetarian recipes were being classified
// `egg` and hidden from vegetarians because of it.
//
// Same shape as NUT_NEGATION_RE below: a scrub rather than a lookbehind, since
// a variable-length lookbehind is a SyntaxError on Safari below 16.4 and this
// module is imported by the client.
//
// "eggless mayonnaise" needs its own branch: scrubbing "eggless" alone leaves
// "mayonnaise", which EGG_RE still catches.
const EGG_NEGATION_RE =
  /\b(?:eggless|egg[-\u2010\u2011\u2013\s]?free|vegan)\s+mayo(?:nnaise)?\b|\begg(?:s)?[-\u2010\u2011\u2013\s]?free\b|\beggless\b|\b(?:without|no)\s+eggs?\b/gi

// "oyster mushroom" is a mushroom. Bare "oyster" and "oyster sauce" stay meat,
// so this is deliberately anchored to the mushroom.
//
// The rest are the same absence statements the egg scrub handles, in the words
// this data uses for them: Refried Beans ends "No lard — oil only", the
// vegetarian kimchi and curry paste end "No fish sauce", "No shrimp paste".
// Adding `lard` to MEAT_RE without this would have hidden the refried beans
// from vegetarians on the strength of a sentence saying they are safe.
//
// The tail handles the coordinated form these files actually write: "No fish
// sauce or shrimp — fully vegetarian", "No dried shrimp, no fish sauce".
const ANIMAL_ABSENCE = '(?:dried\\s+)?(?:lard|gelatin(?:e)?|fish\\s+sauce|oyster\\s+sauce|worcestershire|shrimp\\s+paste|shrimp|meat)'
const MEAT_NEGATION_RE = new RegExp(
  `\\boysters?\\s+mushrooms?\\b`
  + `|\\b(?:no|without|free\\s+of)\\s+${ANIMAL_ABSENCE}(?:\\s*,?\\s*(?:or|and|no)\\s+${ANIMAL_ABSENCE})*\\b`
  + `|\\bvegetarian\\s+(?:gelatin(?:e)?|fish\\s+sauce|oyster\\s+sauce|worcestershire)\\b`,
  'gi',
)

/** Name + ingredients with absence statements removed. */
function animalHaystack(recipe) {
  return `${recipe.name || ''} ${recipe.ingredients || ''}`
    .replace(EGG_NEGATION_RE, ' ')
    .replace(MEAT_NEGATION_RE, ' ')
}

// How restrictive a kind is: who CANNOT eat it. Used to combine the declared
// kind with the inferred one.
const KIND_RANK = { veg: 0, egg: 1, non_veg: 2 }

/** 'non_veg' | 'egg' | 'veg' — the most restrictive category a recipe fits. */
export function dietKind(recipe) {
  // Keyword inference always runs, whatever the record claims.
  const blob = animalHaystack(recipe)
  const inferred = MEAT_RE.test(blob) ? 'non_veg' : EGG_RE.test(blob) ? 'egg' : 'veg'

  // An explicit dietKind can only make a recipe STRICTER, never more
  // permissive. It has to be able to tighten: keyword inference cannot tell
  // that "Pad Thai", "Bibimbap", "Carbonara" or "Pho" contain meat, and the
  // imported international rows carry the flag precisely for that.
  //
  // Letting it loosen is what served egg to a vegetarian. 32 of the 95
  // international rows disagree with their own ingredient text, and the flag
  // was winning every time — "Veg Ramen (dietKind: veg) :: wheat ramen
  // noodles, broth, veg, egg" passed the vegetarian gate untouched, because
  // returning the flag early meant EGG_RE below never ran at all.
  const declared = KIND_RANK[recipe.dietKind] === undefined ? null : recipe.dietKind
  if (!declared) return inferred
  return KIND_RANK[declared] >= KIND_RANK[inferred] ? declared : inferred
}

/* ------------------------------------------------------------------ *
 * Allergens                                                           *
 *                                                                     *
 * The `allergens` column is the best data here, and it exists on 370  *
 * of 1,464 recipes — the International v2 import carries it, the 988  *
 * INDB rows and 106 Thali Originals do not. An allergen check reading  *
 * only that column would clear every Indian dish for a soy-allergic    *
 * member, so each allergen is ALSO matched by keyword, exactly as the  *
 * nut check has always worked. Where a compliance flag covers the      *
 * whole catalogue it is used instead, because it is better than both.  *
 *                                                                     *
 * An allergy is never "conditional". A dish that can be made safe by   *
 * swapping an ingredient is still a dish containing the allergen, and  *
 * the swap list is not the place to learn that.                        *
 * ------------------------------------------------------------------ */

const NUT_RE = /\b(peanut|peanuts|groundnut|groundnuts|moongphali|cashew|cashews|kaju|almond|almonds|badam|pistachio|pista|walnut|akhrot|hazelnut|pecan|macadamia|nut butter|peanut butter|mixed nuts|dry fruits?|nuts)\b/i

// INDB ingredient strings describe absence as well as presence — "Breakfast
// cereal, crunchy clusters type, without nuts" excluded four dishes from a
// nut-allergic member for containing the word "nuts" in a phrase saying they
// contain none. Negated mentions are blanked before the keyword test.
//
// Written as a scrub rather than a lookbehind on purpose: a variable-length
// lookbehind is a SyntaxError on Safari below 16.4, and this module is imported
// by the client, so an unsupported pattern would fail at parse time and take
// the whole app down on an older phone rather than degrade.
const NUT_NEGATION_RE =
  /\b(?:without|no|non|free\s+of|excluding|minus)\s+(?:added\s+)?(?:nut|nuts|dry\s+fruits?)\b|\bnuts?\s*[-\u2010\u2011\u2013]?\s*free\b/gi

const SOY_RE = /\b(soy\s?sauce|soya?|soybeans?|soya?\s+beans?|tofu|edamame|tempeh|miso|gochujang|hoisin|doubanjiang|tamari|ponzu|teriyaki|bean\s+curd|textured\s+vegetable\s+protein)\b/i
const SOY_NEGATION_RE = /\bsoy\s*[-\u2010\u2011\u2013]?\s*free\b|\b(?:without|no)\s+soy\b/gi

const SESAME_RE = /\b(sesame|tahini|gingelly|za\u2019?atar|zaatar|benne|til\s+seeds?)\b/i
const SESAME_NEGATION_RE = /\bsesame\s*[-\u2010\u2011\u2013]?\s*free\b|\b(?:without|no)\s+sesame\b/gi

/**
 * How each allergen is detected.
 *
 *   field    — what the `allergens` column calls it, where there is one
 *   keywords — for the 1,094 records with no allergens column
 *   flag     — a compliance flag covering the WHOLE catalogue, which beats
 *              both. `lactoseFree: no` and `conditional` alike mean the dish
 *              contains dairy; conditional only means the dairy is butter or
 *              ghee, which is a lactose-tolerance distinction and not an
 *              allergy one.
 */
const ALLERGENS = {
  nuts: { field: /\b(peanuts?|tree\s+nuts?)\b/i, keywords: NUT_RE, negation: NUT_NEGATION_RE },
  soy: { field: /\bsoy\b/i, keywords: SOY_RE, negation: SOY_NEGATION_RE },
  sesame: { field: /\bsesame\b/i, keywords: SESAME_RE, negation: SESAME_NEGATION_RE },
  dairy: { field: /\bdairy\b/i, flag: 'lactoseFree' },
}

/** health id -> the allergen it excludes. */
const HEALTH_ALLERGENS = {
  nut_allergy: 'nuts',
  soy_allergy: 'soy',
  sesame_allergy: 'sesame',
  dairy_allergy: 'dairy',
}

export const ALLERGEN_LABEL = {
  nuts: 'nuts', soy: 'soy', sesame: 'sesame', dairy: 'dairy',
}

/** Does this recipe contain the named allergen? */
export function containsAllergen(recipe, allergen) {
  const rule = ALLERGENS[allergen]
  if (!rule) return false

  // A flag that exists on every record is better evidence than either the
  // column or a keyword, so it answers alone.
  if (rule.flag) {
    const status = recipe.flags?.[rule.flag]?.status
    if (status) return status !== 'yes'
  }

  if (rule.field.test(String(recipe.allergens || ''))) return true

  if (!rule.keywords) return false
  let haystack = `${recipe.name || ''} ${recipe.ingredients || ''}`
  if (rule.negation) haystack = haystack.replace(rule.negation, ' ')
  return rule.keywords.test(haystack)
}

/**
 * Kept as its own export because it is the one allergen with a long history
 * here, and because reading `containsNuts(r)` at a call site says more than
 * `containsAllergen(r, 'nuts')`. Behaviour is unchanged.
 */
export function containsNuts(recipe) {
  return containsAllergen(recipe, 'nuts')
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

/* ------------------------------------------------------------------ *
 * Religion                                                            *
 *                                                                     *
 * These are identity constraints, not fasts. They hold every day of
 * the year, so they sit here beside diet rather than in fastFlags()
 * where they would switch on and off with the calendar. Same tier as
 * `vegetarian`: a hard `no` excludes the dish outright.
 *
 * Only what the flag data can actually enforce is listed. Halal, for
 * instance, is a slaughter method the recipes carry no column for, so
 * nothing here pretends to check it.
 * ------------------------------------------------------------------ */
const RELIGION_FLAGS = {
  Muslim: ['alcoholFree'],
  Sikh: ['alcoholFree'],
  // The Five Precepts read as no alcohol; the pungent roots (onion, garlic,
  // and their family) are the long-standing monastic and Mahayana exclusion.
  Buddhist: ['onionGarlicFree', 'alcoholFree'],
}

const HEALTH_FLAGS = {
  lactose_intolerant: 'lactoseFree',
  gluten_sensitive: 'glutenFree',
  diabetes_t1: 'diabeticFriendly',
  diabetes_t2: 'diabeticFriendly',
  // PCOD/PCOS is insulin-resistance driven, so the dietary advice is the same
  // low-GI advice diabetes gets. It reuses that flag rather than needing
  // nutrition data the recipes do not carry.
  pcod: 'diabeticFriendly',
}

// Members for whom a `partial` dish must carry a visible caution rather than
// passing silently. This never excludes anything — see evaluateRecipe.
const STRICT_HEALTH = ['diabetes_t1', 'diabetes_t2', 'pcod']

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
 * What to require when an id cannot be read.
 *
 * Skipping it was the bug: a constraint nobody recognises is a constraint
 * nobody applies, and the member ends up less protected than if they had
 * selected nothing. So an unreadable id is treated as the strictest thing it
 * could have been.
 *
 * `allowedKinds` is untouched — DIET_ALLOWS already falls back to `['veg']`,
 * which is the strictest kind and the one thing here that always failed safe.
 */
// Every diet flag any diet asks for. Jain is the strictest and supplies both.
const STRICTEST_DIET_FLAGS = [...new Set(Object.values(DIET_FLAGS).flat())]
// Every religion flag any religion asks for.
const STRICTEST_RELIGION_FLAGS = [...new Set(Object.values(RELIGION_FLAGS).flat())]
// Every health flag that filters, plus every allergen: an unreadable health id
// could have been any of them.
const STRICTEST_HEALTH_FLAGS = [...new Set(Object.values(HEALTH_FLAGS))]
const ALL_ALLERGENS = Object.keys(ALLERGENS)

const warnedIds = new Set()

function warnUnknownId(kind, id, memberName) {
  const key = `${kind}:${id}`
  if (warnedIds.has(key)) return
  warnedIds.add(key)
  console.warn(
    `[thali:member] unrecognised ${kind} id "${id}" on ${memberName || 'a member'} — ` +
    (BLOCKING_KINDS.has(kind)
      ? 'refusing to plan around a fast that cannot be read.'
      : 'applying the strictest rules instead of none. Re-select it, or migrate it in src/lib/family.js.'),
  )
}

/**
 * What one member requires today.
 * @returns {{ id, name, diet, allowedKinds, requiredFlags, strictFlags, activeFasts }}
 */
export function memberConstraints(member, activeFastIds) {
  const required = new Set()

  // Anything the app cannot interpret is treated as the strictest thing it
  // could have meant, never as nothing at all.
  const unknown = unknownMemberIds(member)
  for (const u of unknown) warnUnknownId(u.kind, u.id, member.name)
  const unreadable = new Set(unknown.map((u) => u.kind))

  for (const f of DIET_FLAGS[member.diet] || []) required.add(f)
  if (unreadable.has('diet')) for (const f of STRICTEST_DIET_FLAGS) required.add(f)

  for (const f of RELIGION_FLAGS[member.religion] || []) required.add(f)
  if (unreadable.has('religion')) for (const f of STRICTEST_RELIGION_FLAGS) required.add(f)

  for (const h of member.health || []) {
    if (HEALTH_FLAGS[h]) required.add(HEALTH_FLAGS[h])
  }
  if (unreadable.has('health')) for (const f of STRICTEST_HEALTH_FLAGS) required.add(f)

  const observed = (member.fasts || []).filter((id) => activeFastIds.has(id))

  /* -------------------------------------------------------------- *
   * How this member keeps today's fasts                             *
   *                                                                 *
   * The additive rule lives here and is enforced by shape rather    *
   * than by care: `required` is a Set and only ever gets .add().    *
   * A strict observance ADDS a flag; a loose one adds nothing. No   *
   * branch below removes a flag, so a looser member joining the     *
   * table cannot widen the plate of a stricter one who is already   *
   * at it. Removing a flag would need a .delete() and there isn't   *
   * one — see test/observance-additive.test.js, which asserts the   *
   * pool is byte-identical with and without the looser member.      *
   * -------------------------------------------------------------- */
  const observances = observed.map((id) => observanceFor(member, id))

  // The health exemption is the one setting that subtracts, and it subtracts
  // only from this member's own contribution. Under a union that is safe
  // while anybody else keeps the fast; when they are the sole observer the
  // pool widens, which is the right answer and not a leak.
  const binding = observances.filter((o) => !o.observesLightly)
  for (const f of fastFlags(binding.map((o) => o.fastId))) required.add(f)

  // Onion and garlic, all day, for anyone whose observance says so.
  if (binding.some((o) => o.alliumScope === 'none_all_day')) required.add('onionGarlicFree')

  // A tradition's own compliance flags, which until now only Ekadashi and
  // Navratri had. Paryushana and Das Lakshana required nothing at all, so a
  // Jain member observing them was served exactly what an unfasting member
  // was — the gap docs/DATA-ISSUES.md named.
  const ingredientRules = rulesFor(
    member.diet,
    binding.map((o) => o.fastId),
    (id) => FAST_LABEL[id] || id,
  )
  for (const rule of ingredientRules) {
    for (const f of rule.flags || []) required.add(f)
  }

  // Flags where `partial` is not good enough for this member.
  const strict = new Set()
  if (unreadable.has('health')
    || (member.health || []).some((h) => STRICT_HEALTH.includes(h))) {
    strict.add('diabeticFriendly')
  }

  const allergens = unreadable.has('health')
    ? [...ALL_ALLERGENS]
    : (member.health || []).map((h) => HEALTH_ALLERGENS[h]).filter(Boolean)

  return {
    id: member.id,
    name: member.name,
    diet: member.diet,
    religion: member.religion || 'none',
    allergens: [...new Set(allergens)],
    // Ids this member carries that the app cannot read, and whether any of
    // them is one the planner refuses to guess around (a fast).
    unknownIds: unknown,
    blocked: unknown.some((u) => BLOCKING_KINDS.has(u.kind)),
    // A tradition that is kept vegetarian narrows the KINDS rather than
    // adding a flag: there is no "vegetarianSafe" column and there should not
    // be one, because `dietKind` already reads it off the dish.
    allowedKinds: ingredientRules.some((r) => r.vegetarianOnly)
      ? (DIET_ALLOWS[member.diet] || ['veg']).filter((k) => k === 'veg')
      : (DIET_ALLOWS[member.diet] || ['veg']),
    requiredFlags: [...required],
    strictFlags: [...strict],
    activeFasts: observed,
    // How this member keeps each of them, resolved against the tradition's
    // baseline. Carried so the additive suggestions and the prompt read the
    // same resolution the filter used, rather than resolving it twice.
    observances,
    // What today's traditions forbid in the pot, which the nine compliance
    // flags cannot express — see src/lib/ingredientRules.js. Resolved from the
    // BINDING observances only, so the health exemption reaches these the same
    // way it reaches the flags rather than being a second thing to remember.
    ingredientRules,
    health: member.health || [],
    likes: member.likes || '',
    dislikes: member.dislikes || '',
    lifeStage: member.lifeStage,
    spiceLevel: member.spiceLevel,
    age: member.age,
    relationship: member.relationship,
  }
}

/* ------------------------------------------------------------------ *
 * Why a dish was not shown                                            *
 *                                                                     *
 * evaluateRecipe has always worked these out and filterRecipes has    *
 * always thrown them away at the `break`. Keeping them costs one small *
 * object per excluded recipe and no extra work: the "why this meal"    *
 * panel is plumbing, not a second pass over the catalogue.             *
 *                                                                     *
 * A reason has to name the person it belongs to. "diabeticFriendly:    *
 * no" is a fact about a column; "Sumitra needs low-GI food" is a fact  *
 * about a family.                                                     *
 * ------------------------------------------------------------------ */

const FAST_FLAGS = new Set(['ekadashiSafe', 'navratriSafe'])

const DIET_PHRASE = {
  vegetarian: 'is vegetarian',
  eggetarian: 'is eggetarian',
  vegan: 'is vegan',
  jain: 'eats Jain',
  sattvic: 'eats sattvic',
  non_veg: 'eats everything',
}

const FLAG_PHRASE = {
  jainSafe: 'eats Jain',
  onionGarlicFree: 'avoids onion and garlic',
  vegan: 'is vegan',
  diabeticFriendly: 'needs low-GI food',
  lactoseFree: 'avoids lactose',
  glutenFree: 'avoids gluten',
  alcoholFree: 'avoids alcohol',
}

/** "is keeping Ekadashi", or what the flag stands for. */
function flagPhrase(flag) {
  if (FAST_FLAGS.has(flag)) {
    return `is keeping ${flag === 'ekadashiSafe' ? 'Ekadashi' : 'Navratri'}`
  }
  return FLAG_PHRASE[flag] || `needs ${flag}`
}

/**
 * How to name the traditions that brought an ingredient rule in.
 *
 * Falls back to the rule's label only when nothing named it — a diet-only
 * rule with no fast behind it.
 */
function keptPhrase(rule) {
  // "Ekadashi Vrat" is the database's name for the tradition; "Ekadashi" is
  // what a family calls the day, and it is what flagPhrase above already says.
  // The two wordings sit side by side in the same panel, so they match.
  const kept = (rule.keptAs || [])
    .filter(Boolean)
    .map((label) => String(label).replace(/\s*\(.*?\)/g, '').replace(/\s+vrat$/i, '').trim())
  if (kept.length === 0) return rule.label
  if (kept.length === 1) return kept[0]
  return `${kept.slice(0, -1).join(', ')} and ${kept.at(-1)}`
}

/** The dish's own note, without the verdict word it starts with. */
function cleanReason(note) {
  const text = String(note || '').trim()
  if (!text) return ''
  return text
    .replace(/^No\s*[—–-]\s*/i, '')
    .replace(/^No\s*\((.*)\)$/i, '$1')
    .replace(/^No\b[,:]?\s*/i, '')
    .trim()
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
      rejection: {
        kind: 'diet',
        member: constraints.name,
        memberId: constraints.id,
        because: DIET_PHRASE[constraints.diet] || `eats ${constraints.diet}`,
        detail: dietKind(recipe) === 'non_veg' ? 'contains meat or fish' : 'contains egg',
      },
    }
  }

  // An allergy is never "conditional" — exclude outright. One loop rather
  // than a branch per allergen: they differ in how they are detected, which
  // ALLERGENS above owns, and not in what happens once they are.
  for (const allergen of constraints.allergens) {
    if (!containsAllergen(recipe, allergen)) continue
    return {
      verdict: 'excluded',
      reasons: [`contains ${ALLERGEN_LABEL[allergen]}, ${constraints.name} has a ${ALLERGEN_LABEL[allergen]} allergy`],
      rejection: {
        kind: 'allergy',
        member: constraints.name,
        memberId: constraints.id,
        because: `has a ${ALLERGEN_LABEL[allergen]} allergy`,
        detail: `contains ${ALLERGEN_LABEL[allergen]}`,
      },
    }
  }

  // A tradition's ingredient rules, which the flags cannot express. Placed
  // beside the allergy check rather than among the flags because it is the
  // same kind of thing: a fact read off the ingredient list, not a column
  // somebody annotated. An exclusion here is hard — a vrat that admits a
  // pulse is not a vrat.
  for (const rule of constraints.ingredientRules || []) {
    const hit = ruleViolations(recipe, [rule])[0]
    if (!hit) continue
    return {
      verdict: 'excluded',
      reasons: [`contains ${hit.term}, which ${rule.label} excludes`],
      rejection: {
        kind: 'fast',
        flag: `ingredient:${hit.term}`,
        member: constraints.name,
        memberId: constraints.id,
        // The tradition this member is keeping, not the rule set's own name:
        // one rule set serves Ekadashi and Navratri both, and a family keeping
        // one of them is not keeping the other.
        because: `is keeping ${keptPhrase(rule)}`,
        detail: `contains ${hit.ingredient}`,
      },
    }
  }

  for (const flag of constraints.requiredFlags) {
    const f = recipe.flags?.[flag]
    if (!f) continue
    if (f.status === 'no') {
      // A note that only restated the status was blanked in the data, so the
      // reason falls back to the flag alone rather than rendering "jainSafe: ".
      return {
        verdict: 'excluded',
        reasons: [f.note ? `${flag}: ${f.note}` : flag],
        rejection: {
          kind: FAST_FLAGS.has(flag) ? 'fast' : 'flag',
          flag,
          member: constraints.name,
          memberId: constraints.id,
          because: flagPhrase(flag),
          // The dish's own note, cleaned up in the flag-note pass, says what
          // is actually in it: "contains onion and garlic".
          detail: cleanReason(f.note),
        },
      }
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
      reasons.push(f.note ? `${flag}: ${f.note}` : flag)
    }
  }

  // The other half of the ingredient rules. A dish that says "salt" is not
  // wrong for a vrat — it is right with sendha namak, and the note says so
  // rather than the dish being dropped for an import artefact. Carried like a
  // caveat: the dish is servable and the modification travels with it.
  for (const rule of constraints.ingredientRules || []) {
    for (const swap of ruleSwaps(recipe, [rule])) {
      caveats.push({
        member: constraints.name,
        memberId: constraints.id,
        flag: `swap:${rule.id}`,
        note: swap.note,
        swap: true,
      })
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

  // Why each excluded recipe was excluded. Recorded rather than recomputed:
  // evaluateRecipe already worked it out and this loop used to drop it.
  const rejections = []

  for (const recipe of recipes) {
    let excluded = false
    let anyConditional = false
    const modifications = []
    const recipeCaveats = []

    for (const c of constraints) {
      const { verdict, reasons, caveats: cv, rejection } = evaluateRecipe(recipe, c)
      if (verdict === 'excluded') {
        excluded = true
        if (rejection) {
          rejections.push({
            recipeId: recipe.recipeId,
            name: recipe.name,
            region: recipe.region || '',
            source: recipe.source || '',
            ...rejection,
          })
        }
        // The FIRST constraint that rejects it is the one reported. A dish can
        // fail several at once and naming them all reads as piling on.
        break
      }
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
    rejections,
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

// Roles a record may declare outright. The ROLE_RULES keyword ladder below is
// only a fallback for records that carry no role of their own.
const KNOWN_ROLES = new Set([
  'dal', 'rice', 'bread', 'sabzi', 'accompaniment', 'beverage',
  'snack', 'dessert', 'soup', 'main',
])

/**
 * Coarse role bucket for a recipe.
 *
 * A stored `role` is authoritative and is never re-inferred. The keyword
 * ladder was built for Indian dish names and has nothing to say about
 * "Minestrone" or "Enfrijoladas" — it would file most of the International v2
 * set under `main` and the meal would come back shapeless.
 */
export function roleOf(recipe) {
  const declared = String(recipe.role || '')
  if (KNOWN_ROLES.has(declared)) return declared

  const cat = String(recipe.category || '')
  const name = String(recipe.name || '')
  for (const [role, catRe] of ROLE_RULES) if (catRe.test(cat)) return role
  for (const [role, , nameRe] of ROLE_RULES) if (nameRe.test(name)) return role
  return 'main'
}

/**
 * Meal types a record declares for itself, as a Set, or null when it declares
 * none. International v2 carries this ('lunch, dinner' | 'breakfast, snack' |
 * 'dessert'); the Indian records do not and fall through to the heuristic.
 */
const DECLARABLE_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

function declaredMealTypes(recipe) {
  const raw = String(recipe.mealTypes || '').trim()
  if (!raw) return null
  const parts = raw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  // "dessert" is a course, not a meal type. Taken literally it matches no meal
  // and the 26 International v2 desserts became reachable from nothing at all,
  // while the Indian desserts still reached breakfast through the name rules
  // below. A declaration that names no real meal falls through to the
  // heuristic, so both sets are treated the same way.
  const meals = parts.filter((p) => DECLARABLE_MEAL_TYPES.includes(p))
  return meals.length > 0 ? new Set(meals) : null
}

/** Is this recipe plausible for the given meal type? */
export function fitsMealType(recipe, mealType) {
  const declared = declaredMealTypes(recipe)
  if (declared) {
    if (declared.has(mealType)) return true
    // "breakfast, snack" also earns a place as a starter or side at a bigger
    // meal, which is how these dishes are actually eaten. "dessert" does not:
    // it stays an optional extra rather than filling the candidate list, the
    // same treatment the Indian desserts get below.
    if (mealType !== 'breakfast' && declared.has('snack')) return true
    return false
  }

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
  return ['dal', 'rice', 'bread', 'sabzi', 'accompaniment', 'soup', 'main'].includes(role)
}

// How many candidates of each role to offer the model, per meal type.
// `soup` earns its own line rather than riding the tail backfill: a role with
// no quota key gets zero reserved slots, and an East Asian or Continental
// lunch leans on soup the way an Indian one leans on dal.
const QUOTAS = {
  breakfast: { main: 26, bread: 12, snack: 8, accompaniment: 14, beverage: 10, dessert: 4, dal: 3, rice: 3 },
  lunch: { dal: 14, rice: 12, bread: 12, sabzi: 20, accompaniment: 12, soup: 8, main: 8 },
  dinner: { dal: 14, sabzi: 20, bread: 14, rice: 8, accompaniment: 10, soup: 8, main: 8 },
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
 * What a full meal of each type looks like: [fewest, most] dishes.
 *
 * Lives here rather than in api/generate-plan.js because two callers need the
 * same number and must not disagree about it — the prompt, which drops to the
 * honest-small-plan wording below the floor, and the cuisine picker, which has
 * to warn about exactly the cuisines that will trigger it.
 */
export const MEAL_TARGET = { breakfast: [2, 3], lunch: [4, 5], dinner: [3, 4] }

/**
 * Roles a single meal may hold only once. A thali can carry two sabzis or two
 * accompaniments; it does not carry two rices, or two soups.
 *
 * Lives beside MEAL_TARGET and for the same reason: the planner enforces it
 * and the cuisine picker has to count with it, or the picker promises a
 * four-dish lunch from a pool that is really two soups and a pickle.
 */
export const SINGLETON_ROLES = new Set(['rice', 'main', 'dal', 'bread', 'soup'])

/** [fewest, most] dishes for a meal of this type. */
export function dishesNeededFor(mealType) {
  return MEAL_TARGET[mealType] || MEAL_TARGET.dinner
}

/* ------------------------------------------------------------------ *
 * Dessert                                                             *
 *                                                                     *
 * 153 dessert-role recipes are reachable from no meal at all: lunch    *
 * and dinner do not admit the role, and no dessert name reads as       *
 * breakfast. Rather than widen those pools — a thali is not improved   *
 * by a gulab jamun competing with the dal for a slot — a dessert is    *
 * added alongside the meal, on request, exactly one.                   *
 *                                                                     *
 * It is chosen here rather than by the model, which guarantees three   *
 * things the prompt could only ask for: exactly one, actually of the   *
 * dessert role, and drawn from the same filtered pool as everything    *
 * else — so it has already passed every diet, allergen, religion and   *
 * fasting check the savoury dishes passed.                             *
 * ------------------------------------------------------------------ */

/** Desserts of one cuisine within a pool. 'indian' means everything else. */
export function dessertsFor(pool, cuisine) {
  return pool.filter((r) => roleOf(r) === 'dessert'
    && (cuisine && cuisine !== 'indian' && cuisine !== 'surprise'
      ? r.region === cuisine
      : !isInternational(r)))
}

/**
 * Whether a dessert can be offered for this cuisine today, and if not, why.
 *
 * The reason matters as much as the answer. A toggle that is simply greyed out
 * teaches nobody anything, and both common causes are worth stating: every one
 * of the 26 International v2 desserts is `diabeticFriendly: no`, so one
 * diabetic member removes dessert from all seven non-Indian cuisines; and none
 * is ekadashiSafe, so a fast day does the same.
 *
 * @param {Array} mains       recipes that passed every member's constraints
 * @param {Array} catalogue   every recipe, to tell "none exist" from "none fit"
 * @param {string} cuisine
 * @param {Array} constraints from filterRecipes
 */
export function dessertAvailability(mains, catalogue, cuisine, constraints = []) {
  const eligible = dessertsFor(mains, cuisine)
  const label = !cuisine || cuisine === 'indian' || cuisine === 'surprise' ? 'Indian' : cuisine
  if (eligible.length > 0) return { available: true, count: eligible.length, reason: null }

  const exists = dessertsFor(catalogue, cuisine).length
  if (exists === 0) {
    return { available: false, count: 0, reason: `Thali has no ${label} dessert yet.` }
  }

  const fasting = [...new Set(constraints.flatMap((c) => c.activeFasts))]
  if (fasting.length > 0) {
    return {
      available: false,
      count: 0,
      reason: `Sweets are set aside today — no ${label} dessert is safe for the fast being kept.`,
    }
  }

  const strict = constraints.some((c) => c.strictFlags.includes('diabeticFriendly'))
  if (strict) {
    return {
      available: false,
      count: 0,
      reason: `Every ${label} dessert Thali knows is high-GI, so none suits a member who needs low-GI food.`,
    }
  }

  return {
    available: false,
    count: 0,
    reason: `No ${label} dessert fits everyone\u2019s constraints today.`,
  }
}

/**
 * Weighted pick of one international cuisine that can actually supply a meal
 * from this pool. Returns null when none can.
 */
/**
 * How many dishes a cuisine can actually put on the table for one meal.
 *
 * Not the same as how many pass the dietary filter, and the gap is what made
 * the picker lie. For a Buddhist member, Indo-Chinese had 4 eligible lunch
 * dishes — two soups, a pickle and a green tea — and the plan came back with
 * two. Both losses are structural, not chance:
 *
 *   - a role with no quota for this meal type is never sampled, so the tea
 *     was counted and could not be served;
 *   - a singleton role can only ever contribute one dish, so the second soup
 *     was counted and had to be dropped.
 *
 * Counting the way the planner actually builds gives 2, which is what arrives.
 */
function usableDishes(recipes, mealType) {
  const quota = QUOTAS[mealType] || QUOTAS.dinner
  const byRole = new Map()
  for (const r of recipes) {
    const role = roleOf(r)
    if (!quota[role]) continue
    byRole.set(role, (byRole.get(role) || 0) + 1)
  }
  let total = 0
  for (const [role, n] of byRole) total += SINGLETON_ROLES.has(role) ? 1 : n
  return total
}

export function internationalCuisineOptions(pool, mealType) {
  const byCuisine = new Map()
  for (const r of pool) {
    if (!isInternational(r)) continue
    if (mealType && !fitsMealType(r, mealType)) continue
    if (!byCuisine.has(r.region)) byCuisine.set(r.region, [])
    byCuisine.get(r.region).push(r)
  }
  const [needed, most] = dishesNeededFor(mealType)
  return Object.keys(INTERNATIONAL_CUISINE_WEIGHTS)
    .map((region) => {
      const recipes = byCuisine.get(region) || []
      // What the family could eat, and what a meal can actually be built from.
      // The second is the one every threshold below is judged against.
      const eligible = recipes.length
      const count = usableDishes(recipes, mealType)
      return {
        cuisine: region,
        count,
        eligible,
        needed,
        most,
        available: count >= MIN_CUISINE_DISHES,
        // Enough to cook from, but with no slack left for the meal being
        // planned. The test is `<= needed`, not `< needed`: a lunch wants 4-5
        // dishes, so a pool of exactly 4 means every single one has to be used
        // and one duplicate-role collision makes the meal shorter still. The
        // plan would be honest and short either way; the picker says so first,
        // rather than letting a thin plan arrive looking like a bug.
        thin: count >= MIN_CUISINE_DISHES && count <= needed,
      }
    })
}

export function pickInternationalCuisine(pool, random = Math.random) {
  const counts = new Map()
  for (const r of pool) {
    if (!isInternational(r)) continue
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
      ? bucket.filter((r) => isInternational(r) && r.region === cuisine)
      : []
    const domestic = bucket.filter((r) => !isInternational(r))
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
