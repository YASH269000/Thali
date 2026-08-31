// Display-layer names for the shopping list.
//
// The recipe database speaks two dialects. Thali Originals are written the way
// a cook talks — "2 tbsp coriander", "2 tbsp oil". INDB (ICMR-NIN) rows are
// written the way a nutrition table talks — "Coriander leaves (Coriandrum
// sativum)", "Oil, sunflower", "Water, distilled". Same ingredient, two names.
//
// That mismatch caused three visible bugs: staples that were never recognised
// as staples, the same ingredient listed twice under both names, and Latin
// binomials on a shopping list.
//
// Nothing here rewrites recipes.json. The recipe text stays exactly as the
// source wrote it — Cook Mode, the ingredient popover and the Gemini prompt all
// still read the original strings. This is only what the shopping list shows.

import { lookupIngredient } from './ingredientGuide.js'

/* ------------------------------------------------------------------ *
 * Cleaning                                                            *
 * ------------------------------------------------------------------ */

// Latin genus + species only: "(Coriandrum sativum)", "(Capsicum annum)".
// Deliberately not all parentheticals — "SIVA'S, AMHUR POWDER (DRY MANGO
// POWDER)" keeps its gloss, which is the only readable half of that name.
const BINOMIAL_RE = /\s*\(\s*[A-Z][a-z]+(?:\s+[a-z][a-z-]+){1,2}\s*\)/g

// INDB qualifiers that describe a lab sample rather than a purchase. Dropping
// them is safe; anything not on this list is kept, because in this data a
// qualifier is usually the whole difference between two products —
// "Wheat flour, refined" is maida and "Wheat flour, atta" is not.
const NOISE_QUALIFIERS = new Set([
  'distilled', 'raw', 'fresh', 'ripe', 'average', 'plain', 'hybrid',
  'big', 'small', 'medium', 'large', 'whole', 'poultry', 'cow', 'buffalo',
  'all varieties', 'milled', 'brown skin', 'small clove', 'big clove',
  'flesh only', 'kernel', 'edible portion', 'without salt',
])

// "white" is noise on sugar and bread, where it is the default form, and
// signal on egg, where "Egg, white" is a different thing from "Egg, whole".
// Colour words are the same story: noise on sugar, load-bearing on chillies.
const NOISE_FOR_HEAD = {
  sugar: new Set(['white']),
  bread: new Set(['white']),
  rice: new Set(['white']),
  flour: new Set(['white']),
}

// Trailing instructions are not part of the name. Stripping them is what lets
// "water as needed" and "oil for deep frying" reach the staples check as
// "water" and "oil".
const TRAILING_NOTE_RE =
  /\s*(?:,|\(|—|-)?\s*\b(?:as needed|as required|to taste|if needed|optional|for (?:deep )?(?:frying|cooking|greasing|basting|garnish|tempering|the tadka)|for garnish|adjust)\b\s*\)?\s*$/gi

// A trailing parenthetical that carries an instruction or a measure, rather
// than naming the thing: "water as needed (about 1/4 cup)", "Salt (soak +
// grind + ferment 8 hours)". A gloss like "(dry mango powder)" is not one of
// these and is kept.
const INSTRUCTION_PAREN_RE =
  /\s*\([^()]*\b(?:about|approx\.?|approximately|adjust|as needed|as required|optional|to taste|soak|soaked|grind|ferment|rest|overnight|hours?|minutes?|min|refer)\b[^()]*\)\s*$/i

// Sub-phrases stripped from inside a kept qualifier.
const NOISE_PHRASES = [
  /\ball varieties\b/gi, /\bedible portion\b/gi, /\bweighed with.*$/i,
  /\bflesh only\b/gi, /\baverage\b/gi,
]

// Sentence case, not title case: a shopping list is written, not headlined,
// and the source capitalisation is inconsistent between the two dialects.
// Commas inside a gloss do not separate qualifiers. "bottle gourd
// (dudhi/lauki — peeled, cubed)" is one name; splitting on every comma made it
// "Cubed) bottle gourd (dudhi/lauki — peeled".
function splitTopLevelCommas(text) {
  const out = []
  let depth = 0
  let current = ''
  for (const ch of text) {
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

const sentenceCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s)

// "SIVA'S, AMHUR POWDER (DRY MANGO POWDER)" — an INDB row that leads with a
// brand. The brand is not what you shop for; the rest of the row is.
const isBrandHead = (head) => head === head.toUpperCase() && head.includes("'")

// Qualifiers that name the form and so read correctly after the head noun.
const SUFFIX_QUALIFIERS = new Set([
  'dal', 'powder', 'seeds', 'seed', 'leaves', 'leaf', 'flour', 'paste', 'juice', 'oil',
])

/**
 * A shopping-list name for an ingredient, in either dialect.
 * "Oil, sunflower"                        -> "Sunflower oil"
 * "Coriander leaves (Coriandrum sativum)" -> "Coriander leaves"
 * "Rice, parboiled, milled"               -> "Parboiled rice"
 * "2 tbsp coriander"                      -> "Coriander" (already clean)
 */
export function cleanIngredientName(raw) {
  let s = String(raw || '').replace(BINOMIAL_RE, ' ').trim()
  if (!s) return ''

  // Some recipe rows run a whole method into the ingredient: "Salt (soak +
  // grind + ferment 8 hours). For sambar: refer to recipe F007". Only the part
  // before the first sentence break names the ingredient.
  s = s.split(/\.\s+/)[0].trim()

  // Peel trailing instructions, alternating with instruction parentheticals so
  // "water as needed (about 1/4 cup)" reduces all the way to "water".
  let prev = null
  while (prev !== s) {
    prev = s
    s = s.replace(INSTRUCTION_PAREN_RE, ' ').trim()
    s = s.replace(TRAILING_NOTE_RE, '').trim()
    // Peeling a note from inside a gloss can leave the gloss hanging open:
    // "besan (chickpea flour, if needed)" loses ", if needed)" and reads
    // "Besan (chickpea flour" on the list. An unclosed parenthetical is not a
    // name, so what is left of it goes too.
    if ((s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length) {
      s = s.slice(0, s.lastIndexOf('(')).trim()
    }
  }
  if (!s) return ''

  const parts = splitTopLevelCommas(s)
  if (parts.length > 1) {
    const head = parts[0]
    const headWords = head.toLowerCase().split(/\s+/)
    const headNoise = headWords.reduce(
      (acc, w) => (NOISE_FOR_HEAD[w] ? new Set([...acc, ...NOISE_FOR_HEAD[w]]) : acc),
      new Set(),
    )
    const kept = []
    for (let q of parts.slice(1)) {
      // "green - all varieties" -> "green"
      q = q.replace(/\s*-\s*/g, ' ')
      for (const re of NOISE_PHRASES) q = q.replace(re, ' ')
      q = q.replace(/\s+/g, ' ').trim()
      const ql = q.toLowerCase()
      if (!q || NOISE_QUALIFIERS.has(ql) || headNoise.has(ql)) continue
      kept.push(q)
    }
    if (kept.length && isBrandHead(head)) {
      s = kept.join(' ')
    } else if (kept.length >= 3) {
      // Three or more trailing parts is a list, not a qualified name —
      // "MIXED NUTS CASHEWS, ALMONDS, HAZELNUTS, ..." Reordering it produces
      // nonsense, so it is left in the order the source wrote it.
      s = [head, ...kept].join(' ')
    } else if (kept.length) {
      // A qualifier naming the form follows the head ("Bengal gram, dal" ->
      // "Bengal gram dal"); anything else precedes it ("Oil, sunflower" ->
      // "Sunflower oil").
      const after = kept.filter((q) => SUFFIX_QUALIFIERS.has(q.toLowerCase()))
      const before = kept.filter((q) => !SUFFIX_QUALIFIERS.has(q.toLowerCase()))
      s = [...before, head, ...after].join(' ')
    } else {
      s = head
    }
  }

  return sentenceCase(s.replace(/\s+/g, ' ').trim())
}

/* ------------------------------------------------------------------ *
 * Canonical identity                                                  *
 * ------------------------------------------------------------------ */

// The form a thing is sold in. Two names that disagree here are two different
// purchases, however similar they read: coriander seeds are not coriander
// powder. An absent form matches any single present one, so a recipe's bare
// "coriander" merges with "coriander leaves" but never splits seeds from
// powder.
const FORMS = ['powder', 'seeds', 'seed', 'leaves', 'leaf', 'flour', 'paste', 'oil', 'juice']

// Head-noun equivalences the ingredient guide does not carry, because it is a
// substitution dictionary and these are not substitutions. Bare "coriander" or
// "mint" in a recipe always means the fresh herb.
const IMPLIED_FORM = {
  coriander: 'coriander leaves',
  dhania: 'coriander leaves',
  mint: 'mint leaves',
  pudina: 'mint leaves',
  curry: 'curry leaves',
}

function formOf(lower) {
  for (const f of FORMS) {
    if (new RegExp(`\\b${f}\\b`).test(lower)) return f === 'seed' ? 'seeds' : (f === 'leaf' ? 'leaves' : f)
  }
  return ''
}

/**
 * Identity of an ingredient for merging: `{ base, form }`.
 *
 * Aliases come from the ingredient guide (ingredientSubstitutes.json) via the
 * same lookupIngredient the pantry matcher uses, so "turmeric powder",
 * "turmeric" and "Turmeric powder (Curcuma domestica)" are one thing here
 * exactly as they are one thing to the pantry.
 */
export function ingredientIdentity(raw) {
  const clean = cleanIngredientName(raw)
  // Parentheticals are kept for display but ignored for identity: "cabbage
  // (shredded)" and "cabbage" are one purchase, and a gloss should not split
  // a line the way a binomial used to.
  const lower = clean
    .replace(/\s*\(.*?\)/g, ' ')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!lower) return { base: '', form: '', clean }

  const implied = IMPLIED_FORM[lower]
  const settled = implied || lower
  const form = formOf(settled)

  // The guide is the alias authority. It resolves "cumin seeds" and "cumin"
  // onto one key; where it knows nothing, the cleaned name is its own key.
  const entry = lookupIngredient(settled) || lookupIngredient(lower)
  const base = entry
    ? entry.key
    : settled.replace(new RegExp(`\\b(?:${FORMS.join('|')})\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim() || settled

  return { base, form, clean }
}

/* ------------------------------------------------------------------ *
 * Pantry identity                                                     *
 *                                                                     *
 * The same canonicaliser as the shopping-list dedupe above, with two
 * differences that matter only when answering "does this family
 * already have this?".
 *
 * A pantry hit tells someone they own an ingredient. Being wrong costs
 * them the dish, so the rule is: same thing, prepared differently, is
 * a match; a different product on the shelf never is.
 * ------------------------------------------------------------------ */

// What a cook does to an ingredient they already have. Someone with tomatoes
// in the fridge has them whether the recipe wants them chopped or sliced.
//
// "ground" is deliberately absent. Every word here is an action; "ground"
// names a different product — ground coriander is coriander powder, not
// coriander leaves, and treating it as an action makes the pantry claim the
// one thing it must never claim. Same for powdered, dried, raw, cooked,
// roasted and smoked.
const PREP_WORDS = [
  'sliced', 'chopped', 'diced', 'minced', 'grated', 'crushed', 'mashed',
  'julienned', 'cubed', 'shredded', 'boiled', 'blanched', 'soaked', 'toasted',
]

const PREP_DEGREE = ['finely', 'roughly', 'thinly', 'coarsely']

// State and grade words that do not change what you buy. Deliberately short.
// "fresh" is NOT here: fresh coriander and dried coriander are two different
// purchases, and the same is true of every fresh/dried pair in this data.
const STATE_WORDS = [
  'thick', 'thin', 'cold', 'warm', 'chilled', 'full-fat', 'low-fat', 'plain',
]

const PREP_RUN = `(?:(?:${PREP_DEGREE.join('|')})\\s+)?(?:${PREP_WORDS.join('|')})`
const STRIPPABLE = `(?:${PREP_RUN}|${STATE_WORDS.join('|')})`
const LEAD_RE = new RegExp(`^(?:${STRIPPABLE})\\s+`, 'i')
const TAIL_RE = new RegExp(`\\s+(?:${STRIPPABLE})$`, 'i')
// Prep is reported wherever it appears, including inside a parenthetical,
// because that is where recipes usually put it: "2 tomatoes (chopped)".
const ANY_PREP_RE = new RegExp(`\\b(?:${PREP_RUN})\\b`, 'gi')

/** Leading and trailing prep/state words removed. */
function stripQualifiers(text) {
  let s = String(text || '').trim()
  for (;;) {
    const lead = LEAD_RE.exec(s)
    if (lead) { s = s.slice(lead[0].length).trim(); continue }
    const tail = TAIL_RE.exec(s)
    if (tail) { s = s.slice(0, tail.index).trim(); continue }
    break
  }
  return s
}

/**
 * `{ base, form, prep }` for one side of a pantry comparison.
 *
 * Qualifiers come off BEFORE ingredientIdentity, not after. The canonicaliser
 * has rules that only fire on a bare head noun — IMPLIED_FORM turns
 * "coriander" into "coriander leaves" — and they cannot fire on "chopped
 * coriander". Stripping afterwards left that ingredient with no form while the
 * pantry chip had one, and the two never met.
 *
 * `prep` is only ever reported to the user, never used to decide a match.
 */
export function pantryIdentity(raw) {
  const text = String(raw || '')
  const prep = [...new Set(
    (text.match(ANY_PREP_RE) || []).map((p) => p.toLowerCase().replace(/\s+/g, ' ')),
  )]

  // Parentheticals are prep or gloss, never identity — ingredientIdentity
  // ignores them for base and form anyway, so dropping them here only lets the
  // strip above see the head noun.
  const outside = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  const settled = stripQualifiers(outside) || outside || text
  const { base, form } = ingredientIdentity(settled)

  // When the guide recognises the whole name, the name IS the ingredient and
  // any form word inside it belongs to the alias rather than distinguishing
  // anything: "gram flour" is besan, not a flour form of besan. Without this,
  // exact form matching below rejected besan/gram flour and atta/whole wheat
  // flour, which the guide has always said are the same thing.
  const aliased = Boolean(lookupIngredient(settled.toLowerCase()))
  return { base, form: aliased ? '' : form, prep }
}

/**
 * Does a pantry entry cover this ingredient?
 *
 * Word-for-word equality, never a subset test, and forms must match exactly.
 *
 * Subset is what the old matcher used, and it is why "Onion" in the pantry
 * claimed "spring onion". Exact forms are what the shopping-list dedupe
 * deliberately does NOT do — there, an absent form joins the one form its base
 * is sold in, which is right for merging two mentions of one purchase and
 * wrong here: it made "Onion" cover onion powder, "Garlic" cover garlic paste
 * and "Rice" cover rice flour.
 */
export function pantryMatches(itemIdentity, ingredientIdentityish) {
  const a = itemIdentity
  const b = ingredientIdentityish
  if (!a?.base || !b?.base) return false
  if (a.form !== b.form) return false
  const wa = a.base.split(/\s+/).filter(Boolean)
  const wb = b.base.split(/\s+/).filter(Boolean)
  return wa.length === wb.length && wa.every((w, i) => sameWord(w, wb[i]))
}

/** Candidate stems for one word, so singular and plural compare equal. */
function wordStems(w) {
  const keys = new Set([w])
  if (/ies$/.test(w) && w.length > 4) {
    keys.add(`${w.slice(0, -3)}y`)
    keys.add(`${w.slice(0, -3)}i`)
  } else if (/(?:ch|sh|s|x|z|o)es$/.test(w) && w.length > 3) {
    keys.add(w.slice(0, -2))
  }
  if (/s$/.test(w) && !/(?:ss|us|is)$/.test(w) && w.length > 3) keys.add(w.slice(0, -1))
  return keys
}

function sameWord(a, b) {
  if (a === b) return true
  const sa = wordStems(a)
  return [...wordStems(b)].some((k) => sa.has(k))
}

// Past participle -> the gerund a note is written in. Spelled out rather than
// derived: "sliced" minus "d" plus "ing" is "sliceing".
const PREP_GERUND = {
  sliced: 'slicing', chopped: 'chopping', diced: 'dicing', minced: 'mincing',
  grated: 'grating', crushed: 'crushing', mashed: 'mashing',
  julienned: 'julienning', cubed: 'cubing', shredded: 'shredding',
  boiled: 'boiling', blanched: 'blanching', soaked: 'soaking',
  toasted: 'toasting',
}

/** "needs chopping and slicing" — what is still to do, for the pantry note. */
export function prepLabel(prep) {
  const verbs = []
  for (const raw of prep || []) {
    const words = String(raw).toLowerCase().split(/\s+/).filter(Boolean)
    const participle = words.at(-1)
    const gerund = PREP_GERUND[participle]
    if (!gerund) continue
    const degree = words.length > 1 ? `${words.slice(0, -1).join(' ')} ` : ''
    const phrase = `${degree}${gerund}`
    if (!verbs.includes(phrase)) verbs.push(phrase)
  }
  if (verbs.length === 0) return ''
  if (verbs.length === 1) return `needs ${verbs[0]}`
  return `needs ${verbs.slice(0, -1).join(', ')} and ${verbs.at(-1)}`
}
