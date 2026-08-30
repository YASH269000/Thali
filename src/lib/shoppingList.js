// Builds the aggregated shopping list deterministically from the chosen
// recipes, rather than asking the model to scale quantities.
//
// The model scaled down reliably but not up — rice stayed at 1.5 cups when
// the table grew from 3 diners to 5. Arithmetic does not have that problem.

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

/** Key for merging the same ingredient across dishes. */
function mergeKey(name, unit) {
  return `${name.toLowerCase().replace(/\s*\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').trim()}|${unit}`
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
  const merged = new Map()

  for (const recipe of recipes) {
    const serves = Number(recipe.serves) > 0 ? Number(recipe.serves) : 4
    const factor = totalDiners / serves

    for (const item of splitIngredients(recipe.ingredients)) {
      const parsed = parseIngredient(item)
      if (!parsed.name) continue

      const scalable = parsed.quantity !== null && !NO_SCALE.test(parsed.name)
      const value = scalable ? parsed.quantity * factor : parsed.quantity

      const key = mergeKey(parsed.name, parsed.unit)
      const existing = merged.get(key)
      if (existing) {
        if (existing.value !== null && value !== null) existing.value += value
      } else {
        merged.set(key, {
          name: parsed.name,
          unit: parsed.unit,
          value,
          scaled: scalable,
          raw: parsed.raw,
        })
      }
    }
  }

  const lines = [...merged.values()]
    .filter((e) => !isPantryStaple(e.name))
    .map((e) => {
      if (e.value === null) return e.name
      const amount = formatQuantity(e.value, e.unit)
      if (!amount) return e.name
      const unit = e.unit ? ` ${e.unit}` : ''
      return `${e.name} — ${amount}${unit}`
    })
  return lines
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
  // A named oil is a deliberate choice, unlike generic "oil"
  /\b(mustard|coconut|sesame|til|groundnut|peanut|olive|sunflower|rice bran|ghee)\s+oil\b/i,
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
  /^(?:cooking|vegetable|refined|any|neutral|plain)?\s*oil(?:\s*for\s*.*)?$/i,
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
