// Builds the aggregated shopping list deterministically from the chosen
// recipes, rather than asking the model to scale quantities.
//
// The model scaled down reliably but not up — rice stayed at 1.5 cups when
// the table grew from 3 diners to 5. Arithmetic does not have that problem.

import { ingredientIdentity, pantryIdentity, pantryMatches, prepLabel } from './ingredientNames.js'
import { namedInModification } from './recipeRefs.js'

const VULGAR = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

// Longest first so "tbsp" is not shadowed by "tb".
const UNITS = [
  'tablespoons', 'tablespoon', 'teaspoons', 'teaspoon', 'tbsp', 'tsp',
  'cups', 'cup', 'grams', 'gram', 'kg', 'gm', 'g', 'litres', 'liter', 'litre', 'ltr', 'ml', 'l',
  'pinch', 'pinches', 'handful', 'handfuls', 'bunches', 'bunch',
  'cloves', 'clove', 'inches', 'inch', 'pieces', 'piece', 'slices', 'slice',
  'medium', 'large', 'small', 'nos', 'no',
]

// Fats and tempering aromatics do not scale with head count: a tadka for six
// is not twice the tadka for three, and the pan size sets the oil.
const NO_SCALE = /\b(ghee|oil|butter|makhan|asafoetida|hing|mustard seeds?|cumin seeds?|jeera|rai|curry leaves?|kadhi patta|bay leaf|bay leaves|tejpatta|cinnamon|dalchini|cloves?|laung|cardamom|elaichi|peppercorns?|turmeric|haldi|salt|namak|water)\b/i

const FRACTIONS = [
  [0, ''], [0.25, '1/4'], [0.33, '1/3'], [0.5, '1/2'],
  [0.67, '2/3'], [0.75, '3/4'],
]

function parseNumber(raw) {
  const s = String(raw).trim()
  if (!s) return null
  // "1 ½" or "1½"
  const mixed = /^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(s)
  if (mixed) return Number(mixed[1]) + VULGAR[mixed[2]]
  if (VULGAR[s] !== undefined) return VULGAR[s]
  // "8-10" -> take the upper end, matching how a cook shops
  const range = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/.exec(s)
  if (range) return Number(range[2])
  // "1/2"
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Format a scaled amount the way a person would write it on a list. */
export function formatQuantity(value, unit) {
  if (value === null || !Number.isFinite(value)) return ''
  const metric = /^(g|gm|grams?|ml|kg|litres?|liter|ltr|l)$/i.test(unit || '')

  if (metric) {
    // Whole numbers, to a sensible step for the magnitude.
    const step = value >= 200 ? 25 : value >= 50 ? 10 : 5
    return String(Math.max(step, Math.round(value / step) * step))
  }

  if (value >= 10) return String(Math.round(value))

  // Quarter steps below ten, written as fractions.
  const rounded = Math.max(0.25, Math.round(value * 4) / 4)
  const whole = Math.floor(rounded)
  const rest = Number((rounded - whole).toFixed(2))
  const frac = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.02)?.[1] ?? ''
  if (whole === 0) return frac || String(rounded)
  return frac ? `${whole} ${frac}` : String(whole)
}

/** Paren-aware split: "2 potatoes (boiled, cubed)" is one item. */
export function splitIngredients(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  if (raw.includes(';')) return raw.split(';').map((s) => s.trim()).filter(Boolean)

  const out = []
  let depth = 0
  let current = ''
  for (const ch of raw) {
    if (ch === '(') depth += 1
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** @returns {{quantity:number|null, unit:string, name:string, raw:string}} */
export function parseIngredient(item) {
  let raw = String(item || '').trim()
  if (!raw) return { quantity: null, unit: '', name: '', raw }

  // Recipes group a tempering with a header glued to its first item:
  // "FOR TADKA: 2 tbsp ghee". Drop the header so the amount is readable.
  raw = raw.replace(/^(?:FOR\s+[A-Z][A-Z\s]*|TO\s+[A-Z][A-Z\s]*):\s*/, '').trim()

  // INDB rows put the amount last: "Milk, whole, Cow: 50ml"
  const indb = /^(.+?):\s*([\d.]+)\s*([A-Za-z]*)$/.exec(raw)
  if (indb) {
    return {
      quantity: parseNumber(indb[2]),
      unit: (indb[3] || '').toLowerCase(),
      name: indb[1].trim(),
      raw,
    }
  }

  // Order matters: the mixed and range forms must be tried before a bare
  // integer, or "1½ cups" parses as "1" and leaves "½ cups" in the name.
  const qtyMatch = /^((?:\d+\s*[½¼¾⅓⅔⅛⅜⅝⅞])|(?:\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?)|(?:\d+\s*\/\s*\d+)|(?:\d+(?:\.\d+)?)|[½¼¾⅓⅔⅛⅜⅝⅞])\s*/.exec(raw)
  if (!qtyMatch) return { quantity: null, unit: '', name: raw, raw }

  const quantity = parseNumber(qtyMatch[1])
  let rest = raw.slice(qtyMatch[0].length).trim()

  let unit = ''
  for (const u of UNITS) {
    const re = new RegExp(`^${u}\\b\\.?`, 'i')
    if (re.test(rest)) {
      unit = u.toLowerCase()
      rest = rest.replace(re, '').trim()
      break
    }
  }
  return { quantity, unit, name: rest, raw }
}

/* ------------------------------------------------------------------ *
 * Units                                                               *
 *                                                                     *
 * Amounts add up only inside a family. Spoons and cups convert to each
 * other; grams and millilitres do not, and neither converts to "2
 * medium". Where an ingredient arrives in two families it stays one
 * line carrying both amounts, which is what a shopper needs to see.
 * ------------------------------------------------------------------ */

const UNIT_FAMILIES = [
  { name: 'mass', base: 'g', units: { g: 1, gm: 1, gram: 1, grams: 1, kg: 1000 } },
  { name: 'volume', base: 'ml', units: { ml: 1, l: 1000, litre: 1000, litres: 1000, liter: 1000, ltr: 1000 } },
  {
    name: 'spoon',
    base: 'tsp',
    units: {
      tsp: 1, teaspoon: 1, teaspoons: 1,
      tbsp: 3, tablespoon: 3, tablespoons: 3,
      cup: 48, cups: 48,
    },
  },
]

// Largest first, so a total is written in the biggest unit it fills.
const PREFERRED = { mass: ['kg', 'g'], volume: ['l', 'ml'], spoon: ['cup', 'tbsp', 'tsp'] }

// Count units that are the same unit in singular and plural. Stored singular
// and written back out plural above, so a line reads "7 cloves" not
// "1 clove + 6 cloves".
const COUNT_SINGULAR = {
  cloves: 'clove', pieces: 'piece', slices: 'slice', bunches: 'bunch',
  pinches: 'pinch', handfuls: 'handful', inches: 'inch', nos: 'no',
}
export const COUNT_PLURAL = Object.fromEntries(
  Object.entries(COUNT_SINGULAR).map(([plural, singular]) => [singular, plural]),
)

function countUnit(unit) {
  const u = String(unit || '').toLowerCase()
  return COUNT_SINGULAR[u] || u
}

function unitFamily(unit) {
  const u = String(unit || '').toLowerCase()
  if (!u) return null
  return UNIT_FAMILIES.find((f) => f.units[u]) || null
}

/** Amount rewritten in the largest unit of its family that it fills. */
function inBestUnit(baseValue, familyName) {
  const family = UNIT_FAMILIES.find((f) => f.name === familyName)
  for (const unit of PREFERRED[familyName]) {
    const factor = family.units[unit]
    if (baseValue / factor >= 1) return { value: baseValue / factor, unit }
  }
  const unit = PREFERRED[familyName].at(-1)
  return { value: baseValue / family.units[unit], unit }
}

/**
 * Structured rows behind the shopping list: one per ingredient identity, with
 * per-bucket totals rather than a formatted string.
 *
 * Extracted so the display layer can offer a "Buy for" quantity beside the
 * recipe's own. Nothing about the arithmetic changed — buildShoppingList below
 * is these entries, formatted.
 *
 * @param {Array} recipes  full recipe records (need `ingredients` and `serves`)
 * @param {number} totalDiners
 */
export function buildShoppingEntries(recipes, totalDiners) {
  // One entry per ingredient identity. Staples are dropped as they are read
  // rather than at the end, so a staple can never merge with something that
  // is not one.
  const items = []

  const read = (text, factor, ref, skipLines, fromComponent = false) => {
    for (const item of splitIngredients(text)) {
      // "1 cup hummus (see recipe)" is not a thing to buy — it is a thing to
      // make, and the chickpeas and tahini for it are added below. Leaving
      // both on the list has the shopper buying the dish twice.
      if (skipLines?.has(item)) continue

      const parsed = parseIngredient(item)
      if (!parsed.name) continue

      const { base, form, clean } = ingredientIdentity(parsed.name)
      // The staples check reads the cleaned name, which is the fix for INDB
      // rows: "Water, distilled" and "Oil, sunflower" only look like water and
      // oil once the lab qualifiers are off them.
      if (!clean || isPantryStaple(clean)) continue

      // NO_SCALE deliberately reads the raw name, not the cleaned one: it is
      // about how a quantity behaves, not about what the thing is called, and
      // it already matches both dialects. "oil for deep frying (about 3 cups)"
      // is the International v2 spelling of the same idea: the fryer sets the
      // amount, not the head count.
      const scalable = parsed.quantity !== null && !NO_SCALE.test(parsed.name)
      const value = scalable ? parsed.quantity * factor : parsed.quantity

      // A dish that points at another recipe can carry a substitution — D002
      // is J007 "with jaggery replaced by stevia", and J007 really does list
      // jaggery. Marking the line itself is the point: a note printed beside a
      // numbered list is read after the shopper has already read the line.
      const flagged = namedInModification(clean, ref?.modification)

      items.push({ base, form, name: clean, unit: parsed.unit, value, flagged, fromComponent })
    }
  }

  for (const recipe of recipes) {
    const serves = Number(recipe.serves) > 0 ? Number(recipe.serves) : 4
    const factor = totalDiners / serves

    const components = recipe.components || []
    read(
      recipe.ingredients, factor, recipe.ref,
      new Set(components.flatMap((c) => c.ingredientLines || [c.ingredientLine]).filter(Boolean)),
    )

    // Sub-recipes the dish uses as ingredients — "2 cups marinara sauce",
    // "16 falafel". Their own ingredients are folded in here, or the shopper
    // buys the lasagne and has nothing to make the sauce from.
    //
    // Scaled by the parent's factor, which is the honest reading of a batch:
    // you cannot make 3 tbsp of curry paste, you make a jar, and a meal for
    // eight needs twice the jar a meal for four does. It over-buys where a
    // dish wants a spoonful, so componentBatches() below names every folded-in
    // sub-recipe for the UI rather than letting the extra appear from nowhere.
    //
    // Tagged, because a batch already covers more than this meal: the "Buy
    // for" control must not multiply it again. See buyQuantities.js.
    for (const c of components) read(c.ingredients, factor, null, null, true)
  }

  // A name with no form joins the one form its base is otherwise sold in, so
  // a recipe's bare "coriander" merges into "coriander leaves" — but never
  // collapses seeds into powder, because those are two forms, not one.
  const formsByBase = new Map()
  for (const it of items) {
    if (!it.form) continue
    if (!formsByBase.has(it.base)) formsByBase.set(it.base, new Set())
    formsByBase.get(it.base).add(it.form)
  }
  for (const it of items) {
    if (it.form) continue
    const forms = formsByBase.get(it.base)
    if (forms && forms.size === 1) it.form = [...forms][0]
  }

  const merged = new Map()
  for (const it of items) {
    const key = `${it.base}|${it.form}`
    let entry = merged.get(key)
    if (!entry) {
      entry = {
        key,
        base: it.base,
        form: it.form,
        name: it.name,
        // bucket -> { total, fixed }. `fixed` is the part that came from a
        // component's batch and must not be multiplied again.
        amounts: new Map(),
        unitless: false,
        flagged: false,
      }
      merged.set(key, entry)
    }
    if (it.flagged) entry.flagged = true
    // Prefer the longer name: "Coriander leaves" reads better than "Coriander".
    if (it.name.length > entry.name.length) entry.name = it.name

    if (it.value === null) { entry.unitless = true; continue }

    const family = unitFamily(it.unit)
    // Counts ("2 medium", a bare "3") only add to the identical unit —
    // singular and plural of one count being the same unit. Without this
    // "1 clove garlic" and "6 cloves garlic" became two amounts on one line.
    const bucket = family ? family.name : `as:${countUnit(it.unit)}`
    const scale = family ? family.units[String(it.unit).toLowerCase()] : 1
    const amount = it.value * scale
    const cell = entry.amounts.get(bucket) || { total: 0, fixed: 0 }
    cell.total += amount
    if (it.fromComponent) cell.fixed += amount
    entry.amounts.set(bucket, cell)
  }

  return [...merged.values()]
}

/** One bucket written the way a list writes it: "1 1/2 cups", "3 cloves". */
export function formatBucket(bucket, total) {
  if (bucket.startsWith('as:')) {
    const unit = bucket.slice(3)
    const amount = formatQuantity(total, unit)
    const label = unit && total > 1 ? (COUNT_PLURAL[unit] || unit) : unit
    return amount ? `${amount}${label ? ` ${label}` : ''}` : ''
  }
  const { value, unit } = inBestUnit(total, bucket)
  const amount = formatQuantity(value, unit)
  return amount ? `${amount} ${unit}` : ''
}

/** The amount half of a row: "1 1/2 cups + 3 cloves", or '' when there is none. */
export function formatAmounts(entry) {
  // Sorted by family so a line reads the same whatever order the dishes
  // happened to come in.
  return [...entry.amounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, cell]) => formatBucket(bucket, cell.total))
    .filter(Boolean)
    .join(' + ')
}

/** One entry as the single line the list has always rendered. */
export function formatEntry(entry) {
  const amounts = formatAmounts(entry)
  const mark = entry.flagged ? ` ${SUBSTITUTION_MARK}` : ''
  return amounts ? `${entry.name} — ${amounts}${mark}` : `${entry.name}${mark}`
}

/**
 * Aggregate a shopping list for `totalDiners`, scaling each recipe by
 * totalDiners / recipe.serves.
 *
 * Kept as the string form because that is what the API response carries and
 * what the WhatsApp share reads. The structured entries above are the same
 * computation one step earlier; this is only their formatting.
 *
 * @param {Array} recipes  full recipe records (need `ingredients` and `serves`)
 * @param {number} totalDiners
 * @returns {Array<string>} e.g. "Toor dal — 1 1/2 cups"
 */
export function buildShoppingList(recipes, totalDiners) {
  return buildShoppingEntries(recipes, totalDiners).map(formatEntry)
}

/** Travels with the line itself, so it survives the WhatsApp share too. */
export const SUBSTITUTION_MARK = '(see substitution note)'

/* ------------------------------------------------------------------ *
 * Pantry staples                                                      *
 *                                                                     *
 * Nobody shops for water. These are assumed present in any Indian
 * kitchen, so they stay in the recipe but leave the shopping list.
 *
 * The keep-list is checked FIRST and wins, because several exclusions
 * are near-misses of things that must survive: "mustard oil" is a
 * recipe choice while plain "oil" is not; "coriander leaves" are fresh
 * produce while "coriander powder" is a staple; "sendha namak" is a
 * fasting requirement while "salt" is not.
 * ------------------------------------------------------------------ */

// Checked before the keep-list: these are staples that happen to look like
// something the keep-list protects. "bay leaf" contains "leaf" but is a dried
// spice, not fresh produce; "chilli powder" contains "chilli" but is not the
// fresh chilli people buy.
const STAPLE_OVERRIDE = [
  /^(?:bay\s*leaf|bay\s*leaves|tejpatta|tej\s*patta)$/i,
  /^(?:red\s*|kashmiri\s*)?chilli?\s*powder$/i,
  /^lal\s*mirch(?:\s*powder)?$/i,
]

const KEEP_ALWAYS = [
  // Fasting-specific salts and flours
  /\b(sendha|rock|kala|black|pink|himalayan|sea)\s*(namak|salt)\b/i,
  /\bnamak\b(?!\s*$)/i,
  /\b(kuttu|singhara|rajgira|amaranth|buckwheat|water chestnut)\b/i,
  // A named oil is a deliberate choice, unlike generic "oil". Sunflower is
  // NOT on this list: it is what INDB writes for plain cooking oil in 447 of
  // its rows, and no Thali Original asks for it by name, so treating it as a
  // choice put "Sunflower oil" on every list under a note promising oil was
  // excluded.
  /\b(mustard|coconut|sesame|til|groundnut|peanut|olive|rice bran|ghee)\s+oil\b/i,
  // Specialty blends, bought per recipe
  /\b(biryani|chole|chaat|pav bhaji|sambar|rasam|kitchen king|tandoori|chana|kadai|butter chicken)\s*(masala|powder)\b/i,
  // Fresh herbs and produce
  /\b(leaves|leaf)\b/i,
  /\b(ginger|garlic|onion|chilli|chili|chillies|chilies|tomato|coriander leaves|mint|pudina)\b/i,
]

const STAPLES = [
  /^(?:cold|warm|hot|boiling|lukewarm|distilled|filtered|plain)?\s*water$/i,
  /^(?:table|iodi[sz]ed|common|regular|plain)?\s*salt(?:\s*to\s*taste)?$/i,
  /^salt\b.*\btaste$/i,
  /^(?:cooking|vegetable|refined|any|neutral|plain|sunflower)?\s*oil(?:\s*for\s*.*)?$/i,
  /^ghee(?:\s+for\s+.*)?$/i,
  /^(?:turmeric|haldi)(?:\s*powder)?$/i,
  /^(?:red\s*)?chilli?\s*powder$/i,
  /^lal\s*mirch(?:\s*powder)?$/i,
  /^(?:cumin|jeera)(?:\s*(?:seeds?|powder))?$/i,
  /^(?:coriander|dhaniya)\s*powder$/i,
  /^(?:mustard|rai)(?:\s*seeds?)?$/i,
  /^(?:asafoetida|asafetida|hing)$/i,
  /^garam\s*masala$/i,
  /^(?:bay\s*leaf|bay\s*leaves|tejpatta|tej\s*patta)$/i,
  /^(?:black\s*)?pepper(?:corns?)?(?:\s*powder)?$/i,
  /^kali\s*mirch(?:\s*powder)?$/i,
]

/** Normalised name for staple matching: no parentheticals, no trailing notes. */
function bareName(name) {
  return String(name || '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s*(?:—|-)\s*.*$/, '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when this ingredient is assumed already in the kitchen. */
export function isPantryStaple(name) {
  const bare = bareName(name)
  if (!bare) return false
  if (STAPLE_OVERRIDE.some((re) => re.test(bare))) return true
  if (KEEP_ALWAYS.some((re) => re.test(bare))) return false
  return STAPLES.some((re) => re.test(bare))
}

/** Drop assumed-present staples from an aggregated list. */
export function filterPantryStaples(lines) {
  return lines.filter((line) => !isPantryStaple(String(line).split('—')[0]))
}

/* ------------------------------------------------------------------ *
 * User pantry                                                         *
 *                                                                     *
 * The staples list above is what every Indian kitchen is assumed to
 * hold. This is the rest: what THIS family happens to have today.
 *
 * Deliberately binary — in the pantry means dropped from the list, with
 * no quantities tracked. A real pantry model would need amounts, units
 * and depletion as meals are cooked; that is a different feature, and
 * "do I already have rice?" answers the question a shopper actually
 * asks while standing in the kitchen.
 * ------------------------------------------------------------------ */

/**
 * Each pantry entry canonicalised for matching.
 *
 * The aliases the old version pulled out of the ingredient guide by hand are
 * now inside pantryIdentity — ingredientIdentity already resolves "gram flour"
 * onto besan and "dahi" onto curd, so expanding them here as a second list was
 * a duplicate of the canonicaliser that could drift from it.
 */
export function expandPantryTerms(pantryItems) {
  const terms = []
  const seen = new Set()
  for (const raw of pantryItems || []) {
    const item = String(raw || '').trim()
    if (!item || seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    const id = pantryIdentity(item)
    if (id.base) terms.push({ item, id })
  }
  return terms
}

/**
 * The ingredient name half of an aggregated line, without its quantity or its
 * parentheticals: "Tomatoes (chopped) — 2" -> "Tomatoes".
 *
 * Shared with the UI on purpose. The pantry note is looked up by this name, so
 * a second copy that split on the first em-dash instead of the last quietly
 * stopped every note on a line whose gloss contained one.
 */
export function listItemName(line) {
  const text = String(line)
  const cut = text.lastIndexOf(' \u2014 ')
  const name = cut === -1 ? text : text.slice(0, cut)
  return name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || name.trim()
}

/**
 * Drop the rows the family already has.
 *
 * Takes structured entries rather than formatted lines, because the display
 * layer now needs the row itself — Need, Buy and the edit key all read fields
 * on it. The matching is unchanged.
 *
 * @param {Array} entries      rows from buildShoppingEntries
 * @param {string[]} pantryItems  what the family says it has
 * @returns {{ rows, removed, matched, prepared }}
 *   rows     — the entries still to buy
 *   removed  — the lines taken off, formatted, for the pantry summary
 *   matched  — the pantry entries that actually took something off THIS list,
 *              in the order they were ticked. Which ticked items are relevant
 *              to this meal is not visible from the removed lines alone.
 *   prepared — { item, name, prep } for every row whose recipe wanted the
 *              ingredient prepared. Having tomatoes is not the same as having
 *              them chopped, and the note says which is still to do.
 */
export function applyPantry(entries, pantryItems) {
  const terms = expandPantryTerms(pantryItems)
  const all = [...(entries || [])]
  if (terms.length === 0) return { rows: all, removed: [], matched: [], prepared: [] }

  const rows = []
  const removed = []
  const prepared = []
  const matched = new Set()
  for (const entry of all) {
    const id = pantryIdentity(entry.name)
    const hits = terms.filter((t) => pantryMatches(t.id, id))
    if (hits.length === 0) { rows.push(entry); continue }

    const line = formatEntry(entry)
    removed.push(line)
    for (const h of hits) matched.add(h.item)
    const label = prepLabel(id.prep)
    // Keyed on the name as the list DISPLAYS it, via the shared helper below,
    // because that is what the pantry note is rendered against.
    if (label) prepared.push({ item: hits[0].item, name: listItemName(line), prep: label })
  }
  return { rows, removed, matched: [...matched], prepared }
}

/**
 * The sub-recipes folded into a shopping list, in cooking order.
 *
 * Rendered beside the list for the same reason `substitutions` is: quantities
 * that appeared because a dish needs a batch of something else must say so.
 *
 * @returns {Array<{ dish, name, targetId, ingredientLine }>}
 */
export function componentBatches(recipes) {
  const out = []
  const seen = new Set()
  for (const recipe of recipes || []) {
    for (const c of recipe.components || []) {
      const key = `${recipe.recipeId}|${c.targetId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        dish: recipe.name,
        name: c.targetName,
        targetId: c.targetId,
        ingredientLine: c.ingredientLine || '',
      })
    }
  }
  return out
}
