// One-off importer: reference/international - v2/*.json  ->  src/data/recipes.json
//
// Replaces the 95 `source: 'International'` rows with the 350-recipe
// International v2 set. Re-runnable: it always rebuilds from the current
// recipes.json by dropping BOTH old-International and any previously imported
// International v2 rows before appending.
//
// Mapping decisions worth knowing:
//   - `role` is taken verbatim. Nothing here re-infers it; roleOf() in
//     mealPlanRules.js now prefers the stored value.
//   - `ingredients` is joined with '; ' rather than ', ' so splitIngredients()
//     takes its semicolon path and cannot mis-split "300 g mushrooms
//     (shiitake, oyster, button)" into three ingredients.
//   - `preparation` is joined as "STEP n: ..." because splitSteps() in
//     timerParser.js splits on exactly that.
//   - The v2 flags are flat strings ('yes'|'no'|'partial'|'conditional'); the
//     app reads { status, note }. The status maps 1:1. The NOTE HAS NO SOURCE
//     and is synthesised here from the recipe's own ingredients and allergens
//     — see noteFor(). Notes are user-facing (swap text, diabetic cautions),
//     so a blank would ship "glutenFree: " to a family.

import fs from 'node:fs'
import path from 'node:path'

const SRC_DIR = 'reference/international - v2'
const OUT = 'src/data/recipes.json'
const SOURCE = 'International v2'

const has = (text, re) => re.test(text)
const list = (text, re) => [...new Set(
  [...text.matchAll(re)].map((m) => m[0].toLowerCase()),
)]

// Word-boundary aware on both ends, so "onions" and "potatoes" match too.
const ROOT_RE = /\b(onions?|garlic|potatoes|potato|carrots?|ginger|radish|beetroots?|sweet potatoes?|turnips?|shallots?|leeks?|scallions?|yams?|daikon|galangal|taro|jicama|spring onions?)\b/gi
const ONION_RE = /\b(onions?|garlic|shallots?|leeks?|scallions?|spring onions?|chives)\b/gi
const DAIRY_RE = /\b(milk|cheese|butter|cream|paneer|yoghurt|yogurt|curd|ghee|ricotta|mozzarella|parmesan|cheddar|halloumi|mascarpone|feta|labneh|crema|queso|khoya|condensed milk)\b/gi
const HONEY_RE = /\bhoney\b/i
// "coconut milk" and "peanut butter" are not dairy; strip them before looking.
const NOT_DAIRY_RE = /\b(coconut|almond|soy|oat|cashew|peanut|nut)\s+(milk|butter|cream|yoghurt|yogurt)\b/gi
const SUGAR_RE = /\b(sugar|jaggery|honey|condensed milk|syrup|chocolate|caramel|molasses)\b/i
const REFINED_RE = /\b(maida|all-purpose flour|white rice|noodles?|pasta|spaghetti|penne|macaroni|bread|tortillas?|rice|cornflour|potatoes?|potato)\b/i

/** The dairy actually present, coconut/nut milks discounted. */
function dairyIn(ing) {
  const scrubbed = ing.replace(NOT_DAIRY_RE, ' ')
  return list(scrubbed, DAIRY_RE)
}

function joinList(items) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/**
 * User-facing text for one flag. Synthesised — the v2 files carry a status and
 * nothing else. Every branch either names something the recipe really lists,
 * or says nothing beyond the status.
 */
function noteFor(flag, status, rec, ing) {
  if (status === 'yes') return 'Yes'

  if (status === 'partial') {
    // Only ever diabeticFriendly in this data.
    return 'Moderate GI — fine in a smaller portion, alongside vegetables and protein'
  }

  if (status === 'conditional') {
    if (flag === 'glutenFree') {
      const swaps = []
      if (/\bsoy sauce\b/i.test(ing)) swaps.push('tamari in place of soy sauce')
      if (/\b(noodles?|ramen|udon|yakisoba|lo mein)\b/i.test(ing)) swaps.push('rice noodles')
      if (/\b(gochujang|doubanjiang|miso|hoisin)\b/i.test(ing)) swaps.push('a certified gluten-free paste')
      return swaps.length
        ? `Conditional — gluten-free with ${joinList(swaps)}`
        : 'Conditional — a documented swap achieves this'
    }
    if (flag === 'lactoseFree') {
      const d = dairyIn(ing)
      return d.length
        ? `Conditional — replace the ${joinList(d)} with oil or a plant-based equivalent`
        : 'Conditional — replace the dairy with a plant-based equivalent'
    }
    return 'Conditional — a documented swap achieves this'
  }

  // status === 'no'
  switch (flag) {
    case 'ekadashiSafe':
      return `No — ${rec.cuisine} food falls outside the Ekadashi fasting rules`
    case 'navratriSafe':
      return `No — ${rec.cuisine} food falls outside the Navratri fasting rules`
    case 'onionGarlicFree': {
      const found = list(ing, ONION_RE)
      return found.length
        ? `No (contains ${joinList(found)})`
        : 'No — onion or garlic enters through one of its component recipes'
    }
    case 'jainSafe': {
      const roots = list(ing, ROOT_RE)
      return roots.length
        ? `No (root vegetables: ${joinList(roots)})`
        : 'No — not Jain-permissible as written'
    }
    case 'vegan': {
      const parts = []
      const d = dairyIn(ing)
      if (d.length) parts.push(joinList(d))
      if (HONEY_RE.test(ing)) parts.push('honey')
      return parts.length ? `No (contains ${joinList(parts)})` : 'No (contains an animal product)'
    }
    case 'lactoseFree': {
      const d = dairyIn(ing)
      return d.length ? `No (contains ${joinList(d)})` : 'No (contains dairy)'
    }
    case 'glutenFree': {
      const allergens = String(rec.allergens || '')
      return /gluten/i.test(allergens)
        ? 'No (contains gluten — wheat flour, pasta, bread or noodles)'
        : 'No (contains gluten)'
    }
    case 'diabeticFriendly':
      return has(ing, SUGAR_RE)
        ? 'No (added sugar)'
        : has(ing, REFINED_RE)
          ? 'No (refined carbohydrate, high GI)'
          : 'No'
    case 'alcoholFree':
      return 'No (contains alcohol)'
    default:
      return 'No'
  }
}

const FLAGS = [
  'ekadashiSafe', 'navratriSafe', 'jainSafe', 'diabeticFriendly',
  'lactoseFree', 'vegan', 'onionGarlicFree', 'glutenFree', 'alcoholFree',
]

const STATUS = { yes: 'yes', no: 'no', partial: 'partial', conditional: 'conditional' }

function convert(rec) {
  const ing = rec.ingredients.join('; ')
  const flags = {}
  for (const flag of FLAGS) {
    const raw = String(rec[flag] ?? '').toLowerCase()
    const status = STATUS[raw]
    if (!status) throw new Error(`${rec.id}: unmapped ${flag} value ${JSON.stringify(rec[flag])}`)
    flags[flag] = { status, note: noteFor(flag, status, rec, ing) }
  }

  return {
    recipeId: rec.id,
    name: rec.name,
    hindiName: rec.hindiName || '',
    category: rec.category,
    region: rec.region,
    serves: rec.serves,
    prepTimeMin: rec.prepMin,
    cookTimeMin: rec.cookMin,
    difficulty: rec.difficulty,
    ingredients: ing,
    preparation: rec.preparation
      .map((s, i) => `STEP ${i + 1}: ${s}`)
      .join(' '),
    tips: null,
    caloriesPerServing: rec.caloriesPerServing,
    source: SOURCE,
    source_sheet: rec.cuisine,
    hasFullPreparation: Boolean(rec.hasFullPreparation),
    flags,
    // Authoritative, never re-inferred — see roleOf() in mealPlanRules.js.
    role: rec.role,
    cuisine: rec.cuisine,
    // 'lunch, dinner' | 'breakfast, snack' | 'dessert'. Read by fitsMealType().
    mealTypes: rec.mealTypes,
    // Carried for completeness; nothing reads it yet (members use numeric
    // spiceLevel and the model reasons about that).
    spice: rec.spice,
    dietKind: rec.dietKind,
    containsEgg: rec.containsEgg,
    allergens: rec.allergens,
  }
}

/* ------------------------------------------------------------------ *
 * Two modes                                                           *
 *                                                                     *
 *   (default)     the original full import: drop every `International`
 *                 row, convert every v2 file, replace.
 *   --additions   append the *_ADDITIONS.json files and touch nothing
 *                 that is already in recipes.json.
 *                                                                     *
 * The append mode exists because the full import REBUILDS every note   *
 * from noteFor(), which would silently undo scripts/clean-flag-notes.  *
 * If you ever do re-run the full import, run clean-flag-notes.mjs      *
 * straight afterwards or the catalogue goes back to saying             *
 * "No (root vegetables: onion and garlic)".                            *
 * ------------------------------------------------------------------ */

const APPEND_ONLY = process.argv.includes('--additions')
const isAdditions = (f) => f.endsWith('_ADDITIONS.json')

const files = fs.readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => (APPEND_ONLY ? isAdditions(f) : true))
  .sort()
const incoming = files.flatMap((f) =>
  JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')))

const existing = JSON.parse(fs.readFileSync(OUT, 'utf8'))
const before = existing.length

if (APPEND_ONLY) {
  const ids = new Set(existing.map((r) => r.recipeId))
  const converted = []
  for (const rec of incoming) {
    // An id already present means this ran before, or the additions overlap
    // the set they extend. Either way, stop rather than duplicate a recipe.
    if (ids.has(rec.id)) throw new Error(`${rec.id} is already in ${OUT} — refusing to append`)
    ids.add(rec.id)
    converted.push(convert(rec))
  }
  const out = [...existing, ...converted]
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`mode              append-only (${files.length} files)`)
  console.log(`before            ${before}`)
  console.log(`appended          ${converted.length}`)
  console.log(`after             ${out.length}`)
  console.log('\nnow run: node scripts/clean-flag-notes.mjs --write')
  console.log('(the notes above are freshly generated and need the same pass the 350 had)')
} else {
  const dropped = existing.filter((r) => r.source === 'International').length
  const kept = existing.filter((r) => r.source !== 'International' && r.source !== SOURCE)

  // Every Indian record keeps the same 8 flags it had and gains alcoholFree.
  // Verified by grep before this ran: the only alcohol anywhere in the old
  // catalogue was INT029 Mushroom Risotto (white wine), one of the 95 being
  // removed.
  let backfilled = 0
  for (const r of kept) {
    if (r.flags && !r.flags.alcoholFree) {
      r.flags.alcoholFree = { status: 'yes', note: 'Yes' }
      backfilled += 1
    }
  }

  const converted = incoming.map(convert)
  const ids = new Set(kept.map((r) => r.recipeId))
  for (const r of converted) {
    if (ids.has(r.recipeId)) throw new Error(`duplicate recipeId ${r.recipeId}`)
    ids.add(r.recipeId)
  }

  const out = [...kept, ...converted]
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)

  console.log(`before            ${before}`)
  console.log(`removed (Intl)    ${dropped}`)
  console.log(`alcoholFree added ${backfilled}`)
  console.log(`imported (v2)     ${converted.length}`)
  console.log(`after             ${out.length}`)
}
