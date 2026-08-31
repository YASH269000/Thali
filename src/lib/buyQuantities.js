// "Buy for" — the purchase quantity beside the recipe quantity.
//
// This is a display layer and nothing else. It never touches how much of an
// ingredient a recipe needs: `Need` is the aggregated recipe amount, exactly as
// the list has always shown it, and `Buy` is a separate number derived from it.
// Cooking reads Need; the shop reads Buy.
//
// Three rules do all the work:
//
//   1. Buy is never less than Need. Every rounding here goes UP, through a
//      ladder of real pack sizes. Rounding to the nearest pack would tell
//      someone to buy 250 g when the recipe needs 260 g, which is a list that
//      is wrong on one row in fifty and silent about it.
//   2. Perishables do not multiply. Nobody buys a week of coriander.
//   3. Amounts that arrived from a composite recipe's batch do not multiply
//      either — the batch already covers more than this meal. See
//      DATA-ISSUES #7 and the `fixed` half of each bucket.

import { COUNT_PLURAL } from './shoppingList.js'

export const BUY_WINDOWS = [
  { id: 'meal', label: 'This meal', multiplier: 1 },
  { id: '3days', label: '3 days', multiplier: 3 },
  { id: 'week', label: '1 week', multiplier: 7 },
]

export const DEFAULT_WINDOW = 'meal'

export function windowById(id) {
  return BUY_WINDOWS.find((w) => w.id === id) || BUY_WINDOWS[0]
}

/* ------------------------------------------------------------------ *
 * Pack sizes                                                          *
 * ------------------------------------------------------------------ */

// Rungs first, then a step for anything above the top rung.
const MASS_PACKS = [100, 250, 500, 1000]
const MASS_STEP = 500
const VOLUME_PACKS = [200, 500, 1000]
const VOLUME_STEP = 500

function roundUpTo(value, packs, step) {
  if (!Number.isFinite(value) || value <= 0) return null
  for (const pack of packs) if (value <= pack) return pack
  return Math.ceil(value / step) * step
}

/* ------------------------------------------------------------------ *
 * Density                                                             *
 *                                                                     *
 * Spoons and cups are not a purchase unit — nobody sells 2 tbsp of    *
 * besan — so a spoon amount becomes grams (dry) or millilitres        *
 * (liquid) before it meets a pack size.                               *
 *                                                                     *
 * Keyed on `base` from ingredientIdentity, which for anything the     *
 * ingredient guide knows is the guide's key: `atta`, `besan`, `haldi`.*
 * Grams per cup; this codebase counts 1 cup as 48 tsp.                *
 * ------------------------------------------------------------------ */

const TSP_PER_CUP = 48

// Dry goods: grams per cup.
const GRAMS_PER_CUP = {
  atta: 120, maida: 120, besan: 100, suji: 165, rajgira: 120, singhara: 120,
  kuttu: 120, poha: 60, cornflour: 120, 'rice flour': 160, 'corn flour': 120,
  rice: 185, 'sama ke chawal': 180,
  'toor dal': 200, 'chana dal': 200, 'moong dal': 200, 'masoor dal': 200,
  'urad dal': 200,
  sugar: 200, jaggery: 190,
  paneer: 225, khoya: 240, curd: 245,
  makhana: 30, sabudana: 180,
  // Ground spices and dried leaves are light; the guide keys land here.
  haldi: 110, jeera: 100, dhaniya: 90, 'garam masala': 100, 'chaat masala': 110,
  'kasuri methi': 25, ajwain: 100, saunf: 95, methi_dana: 110,
  'kadhi patta': 25, 'coriander leaves': 20, 'mint leaves': 20,
}

// Anything measured in spoons that is poured rather than scooped. 1 tsp ≈ 5 ml.
const LIQUID_RE = /\b(milk|cream|water|juice|stock|broth|vinegar|syrup|honey|sauce|puree|pur[ée]e|passata|essence|extract|oil|ghee|curd|yogurt|yoghurt|buttermilk|paste|ketchup|wine|liquid)\b/i

// Count units that describe the size of one item rather than a different unit.
// A bare "2" and "2 medium" are the same count of the same thing.
const SIZE_COUNTS = new Set(['', 'medium', 'large', 'small'])

const ML_PER_TSP = 5
const DEFAULT_GRAMS_PER_CUP = 150

// An ingredient's own name ends where its instructions begin. "Cornflour
// mixed in 1 tbsp water" is cornflour, and reading the whole string put it on
// the millilitre ladder because of the word "water".
const HEAD_RE = /\b(?:mixed|dissolved|soaked|steeped|whisked|blended|beaten|diluted|in|with|for|or|plus)\b/i

function headNoun(text) {
  return String(text || '').split(HEAD_RE)[0].trim()
}

/** 'mass' | 'volume' — which ladder a spoon amount should land on. */
function spoonTarget(entry) {
  if (GRAMS_PER_CUP[entry.base] !== undefined) return 'mass'
  const head = `${headNoun(entry.base)} ${headNoun(entry.name)}`
  if (/\b(flour|starch|powder|atta|maida|besan|rava|suji|semolina|sugar|dal|rice)\b/i.test(head)) return 'mass'
  return LIQUID_RE.test(head) ? 'volume' : 'mass'
}

/** Spoon-family tsp -> grams or millilitres. */
function fromSpoons(entry, tsp) {
  if (spoonTarget(entry) === 'volume') return { bucket: 'volume', value: tsp * ML_PER_TSP }
  const perCup = GRAMS_PER_CUP[entry.base] ?? DEFAULT_GRAMS_PER_CUP
  return { bucket: 'mass', value: (tsp / TSP_PER_CUP) * perCup }
}

/* ------------------------------------------------------------------ *
 * Perishables                                                         *
 *                                                                     *
 * Held at the meal quantity whatever the window. Deliberately broad:  *
 * being wrong in this direction under-buys, and the shopper can see   *
 * the Need column and decide. Being wrong the other way is a week of  *
 * coriander going black in the fridge.                                *
 * ------------------------------------------------------------------ */

const PERISHABLE_RE = new RegExp([
  // Fresh herbs and anything sold as leaves
  '\\b(coriander|dhaniya|cilantro|mint|pudina|curry\\s*leaves|kadhi\\s*patta|basil|parsley|dill|thyme|rosemary|oregano|chives|lemongrass|galangal|kaffir|leaves|leaf)\\b',
  // Greens
  '\\b(spinach|palak|methi|fenugreek\\s*leaves|amaranth|lettuce|kale|rocket|arugula|bok\\s*choy|watercress|greens|sprouts)\\b',
  // Dairy and fresh protein
  '\\b(milk|cream|curd|dahi|yogurt|yoghurt|paneer|tofu|cheese|mozzarella|ricotta|parmesan|cheddar|feta|halloumi|mascarpone|labneh|queso|butter|khoya|mawa)\\b',
  // Meat, fish and eggs. Most plans are vegetarian, but the catalogue is not.
  '\\b(chicken|mutton|lamb|goat|beef|pork|bacon|ham|fish|prawn|prawns|shrimp|crab|squid|tuna|salmon|duck|turkey|keema|kheema|liver|meat|egg|eggs)\\b',
  // Already cooked, and fresh coconut. Nobody buys a week of cooked rice.
  '\\b(cooked|boiled|steamed|leftover|coconut)\\b',
  // Fresh vegetables and fruit — per the brief, all of them
  '\\b(tomato|tomatoes|onion|onions|potato|potatoes|garlic|ginger|carrot|carrots|capsicum|pepper|peppers|cabbage|cauliflower|broccoli|zucchini|courgette|eggplant|aubergine|brinjal|mushroom|mushrooms|cucumber|radish|beetroot|beans|peas|corn|okra|bhindi|lauki|dudhi|tindora|tendli|karela|turai|arbi|suran|pumpkin|squash|celery|leek|shallot|scallion|spring\\s*onion|chilli|chillies|chili|chilies|banana|mango|apple|lemon|lime|orange|pineapple|papaya|avocado|berries|grapes)\\b',
  // Anything that says so itself
  '\\bfresh\\b',
].join('|'), 'i')

// A preserved form of a perishable thing keeps: dry red chillies are not
// chillies for this purpose, and tinned tomatoes are not tomatoes. Checked
// first, because the word that makes them shelf-stable sits right next to the
// word that would otherwise condemn them.
const PRESERVED_RE = /\b(dried|dry|dehydrated|powder|powdered|ground|tinned|canned|tin|can|frozen|pickled|preserved|sun-dried|desiccated|flakes|paste|puree|pur[\u00e9e]e|passata|concentrate|essence|extract|sauce|ketchup|jarred|bottled|long-life|uht|condensed|evaporated|oil|ghee|seeds|seed|peppercorns|nuts)\b/i

/** Does this row spoil before the window is out? */
export function isPerishable(entry) {
  const text = `${entry.base || ''} ${entry.name || ''}`
  if (PRESERVED_RE.test(text)) return false
  return PERISHABLE_RE.test(text)
}

/* ------------------------------------------------------------------ *
 * Buy                                                                 *
 * ------------------------------------------------------------------ */

/**
 * The purchase amount for one row, as a display string.
 *
 * @param {object} entry       a row from buildShoppingEntries
 * @param {number} multiplier  1 | 3 | 7
 * @returns {string} '' when the row carries no quantity at all
 */
export function buyAmount(entry, multiplier = 1) {
  const perishable = isPerishable(entry)

  // Spoon amounts convert into mass or volume first, so a row that arrives as
  // "80 g + 2 cup" leaves as one pack rather than two unbuyable halves.
  const totals = new Map()
  // The size word merged counts should keep, when they all agree on one:
  // "1 large" must not print as a bare "1", but "1/4 + 1/4 medium" has to
  // become one number and can only keep "medium" because nothing disagrees.
  const sizeLabels = new Set()
  for (const [bucket, cell] of entry.amounts) {
    // A component's batch is already more than this meal needs, so only the
    // rest of the row is allowed to grow with the window.
    const growable = perishable ? 0 : Math.max(0, cell.total - cell.fixed)
    const held = cell.total - growable
    const scaled = held + growable * multiplier

    let target = bucket
    let value = scaled
    if (bucket === 'spoon') {
      const converted = fromSpoons(entry, scaled)
      target = converted.bucket
      value = converted.value
    } else if (bucket.startsWith('as:')) {
      // "1/4" and "1/4 medium" are a quarter of the same onion. Need keeps
      // them apart, because that is what the recipes wrote; Buy adds them up,
      // or a row needing half an onion tells you to buy two.
      const unit = bucket.slice(3)
      if (SIZE_COUNTS.has(unit)) {
        target = 'as:'
        if (unit) sizeLabels.add(unit)
      } else target = bucket
    }
    totals.set(target, (totals.get(target) || 0) + value)
  }

  const parts = [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, value]) => {
      if (bucket === 'mass') {
        const grams = roundUpTo(value, MASS_PACKS, MASS_STEP)
        if (!grams) return ''
        return grams >= 1000 ? `${Number((grams / 1000).toFixed(1))} kg` : `${grams} g`
      }
      if (bucket === 'volume') {
        const ml = roundUpTo(value, VOLUME_PACKS, VOLUME_STEP)
        if (!ml) return ''
        return ml >= 1000 ? `${Number((ml / 1000).toFixed(1))} l` : `${ml} ml`
      }
      // Counts: you cannot buy a third of an onion.
      const unit = bucket === 'as:' && sizeLabels.size === 1
        ? [...sizeLabels][0]
        : bucket.slice(3)
      const whole = Math.ceil(value - 1e-9)
      if (!Number.isFinite(whole) || whole <= 0) return ''
      // Reuses the list's own plural map, so a count reads "7 inches" rather
      // than the "7 inchs" a naive `+ s` produced. Size words never pluralise:
      // "3 large", not "3 larges".
      const label = unit && whole > 1 && !SIZE_COUNTS.has(unit)
        ? (COUNT_PLURAL[unit] || `${unit}s`)
        : unit
      return label ? `${whole} ${label}` : String(whole)
    })
    .filter(Boolean)

  return parts.join(' + ')
}

/** Is any of this row's quantity held back from the multiplier, and why? */
export function heldReason(entry) {
  if (isPerishable(entry)) return 'perishable — stays at the meal quantity'
  const fixed = [...entry.amounts.values()].some((c) => c.fixed > 0)
  const mixed = [...entry.amounts.values()].some((c) => c.fixed > 0 && c.total > c.fixed)
  if (mixed) return 'part of this comes from a sub-recipe batch, which is not multiplied'
  if (fixed) return 'comes from a sub-recipe batch, which is not multiplied'
  return ''
}

/* ------------------------------------------------------------------ *
 * Edited quantities                                                   *
 *                                                                     *
 * A shopper who knows their kitchen overrides the arithmetic — "we go *
 * through 2 kg of rice, not 1". The override is theirs, so it is kept *
 * exactly as typed and never re-rounded.                              *
 * ------------------------------------------------------------------ */

export const BUY_WINDOW_KEY = 'thali_buy_window'
export const BUY_EDITS_KEY = 'thali_buy_edits'

/**
 * Edits are keyed by row AND window. "2 kg of rice" chosen for a week is not
 * an answer to what this one meal needs, so switching the control back must
 * show the meal's own number again — and switching forward must return the
 * week's.
 */
export function editKey(entry, windowId) {
  return `${entry.key}|${windowId}`
}

export function loadBuyWindow() {
  try {
    const raw = window.localStorage.getItem(BUY_WINDOW_KEY)
    return BUY_WINDOWS.some((w) => w.id === raw) ? raw : DEFAULT_WINDOW
  } catch {
    return DEFAULT_WINDOW
  }
}

export function saveBuyWindow(id) {
  try { window.localStorage.setItem(BUY_WINDOW_KEY, id) } catch { /* not fatal */ }
}

export function loadBuyEdits() {
  try {
    const raw = window.localStorage.getItem(BUY_EDITS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {}
  }
}

export function saveBuyEdits(edits) {
  try { window.localStorage.setItem(BUY_EDITS_KEY, JSON.stringify(edits)) } catch { /* not fatal */ }
}

/** What the Buy box shows: the shopper's own figure, or the computed one. */
export function buyValue(entry, windowId, edits) {
  const edited = edits?.[editKey(entry, windowId)]
  if (typeof edited === 'string') return edited
  return buyAmount(entry, windowById(windowId).multiplier)
}
