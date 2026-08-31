// Builds the aggregated shopping list deterministically from the chosen
// recipes, rather than asking the model to scale quantities.
//
// The model scaled down reliably but not up — rice stayed at 1.5 cups when
// the table grew from 3 diners to 5. Arithmetic does not have that problem.

import { ingredientIdentity } from './ingredientNames.js'

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
 * Aggregate a shopping list for `totalDiners`, scaling each recipe by
 * totalDiners / recipe.serves.
 *
 * @param {Array} recipes  full recipe records (need `ingredients` and `serves`)
 * @param {number} totalDiners
 * @returns {Array<string>} e.g. "Toor dal — 1 1/2 cups"
 */
export function buildShoppingList(recipes, totalDiners) {
  // One entry per ingredient identity. Staples are dropped as they are read
  // rather than at the end, so a staple can never merge with something that
  // is not one.
  const items = []

  for (const recipe of recipes) {
    const serves = Number(recipe.serves) > 0 ? Number(recipe.serves) : 4
    const factor = totalDiners / serves

    for (const item of splitIngredients(recipe.ingredients)) {
      const parsed = parseIngredient(item)
      if (!parsed.name) continue

      const { base, form, clean } = ingredientIdentity(parsed.name)
      // The staples check reads the cleaned name, which is the fix for INDB
      // rows: "Water, distilled" and "Oil, sunflower" only look like water and
      // oil once the lab qualifiers are off them.
      if (!clean || isPantryStaple(clean)) continue

      // NO_SCALE deliberately reads the raw name, not the cleaned one: it is
      // about how a quantity behaves, not about what the thing is called, and
      // it already matches both dialects.
      const scalable = parsed.quantity !== null && !NO_SCALE.test(parsed.name)
      const value = scalable ? parsed.quantity * factor : parsed.quantity

      items.push({ base, form, name: clean, unit: parsed.unit, value })
    }
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
      entry = { name: it.name, amounts: new Map(), unitless: false }
      merged.set(key, entry)
    }
    // Prefer the longer name: "Coriander leaves" reads better than "Coriander".
    if (it.name.length > entry.name.length) entry.name = it.name

    if (it.value === null) { entry.unitless = true; continue }

    const family = unitFamily(it.unit)
    // Counts ("2 medium", a bare "3") only add to the identical unit.
    const bucket = family ? family.name : `as:${String(it.unit || '').toLowerCase()}`
    const scale = family ? family.units[String(it.unit).toLowerCase()] : 1
    entry.amounts.set(bucket, (entry.amounts.get(bucket) || 0) + it.value * scale)
  }

  return [...merged.values()].map((e) => {
    // Sorted by family so a line reads the same whatever order the dishes
    // happened to come in.
    const parts = [...e.amounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, total]) => {
        if (bucket.startsWith('as:')) {
          const unit = bucket.slice(3)
          const amount = formatQuantity(total, unit)
          return amount ? `${amount}${unit ? ` ${unit}` : ''}` : ''
        }
        const { value, unit } = inBestUnit(total, bucket)
        const amount = formatQuantity(value, unit)
        return amount ? `${amount} ${unit}` : ''
      })
      .filter(Boolean)

    return parts.length ? `${e.name} — ${parts.join(' + ')}` : e.name
  })
}

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

/** Comparable tokens for a name: lowercase words, parentheticals dropped. */
function nameTokens(text) {
  return new Set(
    String(text || '')
      .replace(/\s*\(.*?\)/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  )
}

/**
 * Expand each pantry entry into the terms that should match it, pulling
 * aliases from the ingredient guide so "asafoetida" in the pantry also
 * clears "hing" from the list, and vice versa.
 */
export function expandPantryTerms(pantryItems, lookup) {
  // Each term remembers the pantry entry it came from, so the UI can say which
  // ticked item did the work rather than only how many lines vanished.
  const terms = []
  const seen = new Set()
  for (const raw of pantryItems || []) {
    const item = String(raw || '').trim()
    if (!item) continue
    const words = [item]
    const entry = lookup?.(item)
    if (entry) {
      words.push(entry.key)
      for (const alias of entry.aliases || []) words.push(alias)
    }
    for (const w of words) {
      const lower = w.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      const tokens = nameTokens(lower)
      if (tokens.size > 0) terms.push({ item, tokens })
    }
  }
  return terms
}

/**
 * Drop shopping-list lines the family already has.
 *
 * @param {string[]} lines        aggregated shopping list
 * @param {string[]} pantryItems  what the family says it has
 * @param {Function} [lookup]     ingredient-guide lookup, for aliases
 * @returns {{ lines: string[], removed: string[], matched: string[] }}
 *   matched — the pantry entries that actually took something off this list,
 *   in the order they were ticked. Which ticked items are relevant to THIS
 *   meal is not visible from the removed lines alone.
 */
export function applyPantry(lines, pantryItems, lookup) {
  const terms = expandPantryTerms(pantryItems, lookup)
  if (terms.length === 0) return { lines: [...(lines || [])], removed: [], matched: [] }

  const kept = []
  const removed = []
  const matched = new Set()
  for (const line of lines || []) {
    // Compare against the ingredient name only, never the quantity.
    const tokens = nameTokens(String(line).split('\u2014')[0])
    const hits = terms.filter((term) => [...term.tokens].every((t) => tokens.has(t)))
    if (hits.length > 0) {
      removed.push(line)
      for (const h of hits) matched.add(h.item)
    } else kept.push(line)
  }
  return { lines: kept, removed, matched: [...matched] }
}
