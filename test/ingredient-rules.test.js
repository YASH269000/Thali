// Ingredient rules for the traditions the nine compliance flags cannot express.
//
// Until this, only ekadashiSafe, navratriSafe and onionGarlicFree narrowed
// anything. Paryushana had no column in the recipe data at all, so a Jain
// member observing it was served what an unfasting member was served.
//
// The two halves worth pinning are the matcher reuse and the salt decision.
// The matcher is the pantry's, unchanged, which is why `potato` does not claim
// `sweet potato` and `salt` does not claim `sendha namak` — a second matcher
// written for this file would have had to rediscover both. And salt is a swap
// rather than an exclusion because 985 of 1,464 recipes say bare "salt" and
// almost all of them are nutrition-database imports reading
// "plain: 100g; salt: 0.17tsp", which is a table listing sodium chloride, not
// a cook choosing a salt.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  ALL_RULES, DIET_RULES, TRADITION_RULES, ingredientNamesOf, ruleSwaps,
  ruleViolations, rulesFor,
} from '../src/lib/ingredientRules.js'
import { filterRecipes, selectCandidatesForMeal, MEAL_TARGET } from '../src/lib/mealPlanRules.js'
import { FAST_LABEL } from '../src/data/memberOptions.js'

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))
const byId = Object.fromEntries(RECIPES.map((r) => [r.recipeId, r]))

const base = {
  age: 40, relationship: 'self', diet: 'vegetarian', health: [], religion: 'Hindu',
  cuisine: 'north_indian', spiceLevel: 2, dislikes: '', lifeStage: 'adult',
}
const keeping = (fastId, extra = {}) =>
  ({ ...base, id: 'm1', name: 'Asha', fasts: fastId ? [fastId] : [], ...extra })
const poolFor = (fastId, extra) => filterRecipes(
  RECIPES, [keeping(fastId, extra)], new Set(fastId ? [fastId] : []),
).mains

/* ------------------------------------------------------------------ *
 * The traditions that had no rules before                             *
 * ------------------------------------------------------------------ */

test('Paryushana and Das Lakshana narrow the pool, which they never did', () => {
  const unfasting = poolFor(null).length
  const paryushana = poolFor('paryushana_parva').length
  const dasLakshana = poolFor('das_lakshana_parva').length

  assert.ok(paryushana < unfasting,
    `Paryushana still serves ${paryushana} of ${unfasting} — the gap is not closed`)
  assert.equal(paryushana, dasLakshana, 'the two share their food rules')

  // And it narrows for the right reason: a root vegetable, not a flag alone.
  const aloo = RECIPES.find((r) => /^Aloo|Potato/i.test(r.name) && r.flags?.jainSafe?.status !== 'yes')
  if (aloo) {
    const rules = rulesFor('vegetarian', ['paryushana_parva'])
    assert.ok(ruleViolations(aloo, rules).length > 0)
  }
})

test('Sawan sets the greens aside for the month', () => {
  const sawan = poolFor('sawan_somvar_vrat')
  const rules = rulesFor('vegetarian', ['sawan_somvar_vrat'])
  assert.ok(sawan.length < poolFor(null).length)
  for (const r of sawan) {
    assert.equal(ruleViolations(r, rules).length, 0, `${r.recipeId} ${r.name}`)
  }
  // Spinach is the commonest of them and must be gone.
  assert.ok(!sawan.some((r) => /\bpalak\b|\bspinach\b/i.test(r.name)),
    'a spinach dish survived Sawan')
})

test('the Jain diet carries the same rules as the parvas, every day', () => {
  const jain = filterRecipes(RECIPES, [{ ...base, id: 'm1', name: 'Kirti', diet: 'jain', fasts: [] }], new Set()).mains
  const rules = rulesFor('jain', [])
  assert.equal(rules.length, 1)
  for (const r of jain) assert.equal(ruleViolations(r, rules).length, 0, `${r.recipeId} ${r.name}`)
})

/* ------------------------------------------------------------------ *
 * Salt: the decision that had to be measured before it was made       *
 * ------------------------------------------------------------------ */

test('bare salt is a swap note, not an exclusion', () => {
  const rules = rulesFor('vegetarian', ['ekadashi_vrat'])
  // An INDB row whose ingredient string is a nutrition table.
  const indb = RECIPES.find((r) => r.source === 'INDB (ICMR-NIN)'
    && /\bsalt\b/i.test(r.ingredients || '')
    && r.flags?.ekadashiSafe?.status === 'yes')
  assert.ok(indb, 'no bare-salt Ekadashi recipe left to test with')
  assert.deepEqual(ruleViolations(indb, rules), [], 'bare salt excluded a dish')
  const swaps = ruleSwaps(indb, rules)
  assert.equal(swaps.length, 1)
  assert.match(swaps[0].note, /sendha namak/i)
})

test('a salt the recipe actually names as wrong does exclude', () => {
  const rules = rulesFor('vegetarian', ['ekadashi_vrat'])
  const fake = { recipeId: 'TEST1', ingredients: '1 tsp iodised salt, 2 potatoes' }
  assert.equal(ruleViolations(fake, rules)[0]?.term, 'iodised salt')
})

test('sendha namak is not salt, and sweet potato is not potato', () => {
  // The pantry matcher compares base and form exactly rather than by substring,
  // which is the whole reason it could be reused here.
  const vrat = rulesFor('vegetarian', ['ekadashi_vrat'])
  const jain = rulesFor('jain', [])
  const sendha = { recipeId: 'TEST2', ingredients: '1 tsp sendha namak, 1 cup sabudana' }
  assert.deepEqual(ruleViolations(sendha, vrat), [])
  assert.deepEqual(ruleSwaps(sendha, vrat), [], 'sendha namak asked for a swap to itself')

  const sweet = { recipeId: 'TEST3', ingredients: '200 g sweet potato, 1 tsp cumin' }
  assert.deepEqual(ruleViolations(sweet, vrat), [], 'sweet potato is vrat food')
  assert.equal(ruleViolations(sweet, jain)[0]?.term, 'sweet potato', 'and a root for a Jain')
  const plain = { recipeId: 'TEST4', ingredients: '2 potatoes (boiled)' }
  assert.deepEqual(ruleViolations(plain, vrat), [], 'potato is vrat food')
  assert.equal(ruleViolations(plain, jain)[0]?.term, 'potato')
})

/* ------------------------------------------------------------------ *
 * Honey: split the way the data splits                                *
 * ------------------------------------------------------------------ */

test('optional honey is a swap; structural honey is an exclusion', () => {
  const jain = rulesFor('jain', [])
  const optional = byId.E012
  assert.match(optional.ingredients, /honey \(optional\)/i)
  assert.deepEqual(ruleViolations(optional, jain), [], 'an optional ingredient excluded a dish')
  assert.match(ruleSwaps(optional, jain)[0].note, /jaggery/i)

  const structural = byId.IC030
  assert.equal(ruleViolations(structural, jain)[0]?.term, 'honey',
    'Honey Noodles is not a dish you can leave the honey out of')
})

/* ------------------------------------------------------------------ *
 * Turmeric and ginger stay out, on purpose                            *
 * ------------------------------------------------------------------ */

test('no rule names turmeric or ginger, and the reason is structural', () => {
  // pantryIdentity('fresh turmeric').base is 'turmeric' — the canonicaliser
  // strips `fresh`, correctly, everywhere else it fires. So a `fresh turmeric`
  // keyword matches the powdered haldi that Jain cooking uses freely, and it
  // excluded 31 correctly-flagged recipes. The keyword is dropped rather than
  // the canonicaliser special-cased; the real cases were fixed at the flag.
  for (const rule of ALL_RULES) {
    for (const term of rule.forbidden) {
      assert.ok(!/turmeric|haldi/i.test(term),
        `${rule.id} forbids "${term}" — see the note in ingredientRules.js`)
      assert.ok(!/\bginger\b/i.test(term),
        `${rule.id} forbids "${term}" — see the note in ingredientRules.js`)
    }
  }
  // And the flags carry those cases instead.
  for (const id of ['W008', 'B014', 'D003', 'D006']) {
    assert.equal(byId[id].flags.jainSafe.status, 'no', id)
    assert.match(byId[id].flags.jainSafe.note, /fresh root/i, id)
  }
})

test('the nine corrected flags stay corrected, with their evidence', () => {
  const corrections = [
    ['ASC480', 'ekadashiSafe'], ['OSR056', 'ekadashiSafe'], ['OSR056', 'jainSafe'],
    ['OSR009', 'jainSafe'], ['BFP264', 'jainSafe'], ['W008', 'jainSafe'],
    ['B014', 'jainSafe'], ['D003', 'jainSafe'], ['D006', 'jainSafe'],
  ]
  for (const [id, flag] of corrections) {
    assert.equal(byId[id].flags[flag].status, 'no', `${id} ${flag}`)
    assert.ok(byId[id].flags[flag].note.length > 20,
      `${id} ${flag} was corrected without recording why`)
  }
})

/* ------------------------------------------------------------------ *
 * Every tradition can still put a meal on the table                   *
 * ------------------------------------------------------------------ */

test('no tradition is narrowed past what a meal needs', () => {
  for (const fastId of ['ekadashi_vrat', 'navratri_vrat', 'paryushana_parva',
    'das_lakshana_parva', 'sawan_somvar_vrat']) {
    const mains = poolFor(fastId)
    assert.ok(mains.length > 0, `${fastId} serves nothing`)
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      const sel = selectCandidatesForMeal(mains, meal, {
        limit: 40, excludeIds: [], anyFasting: true, forceCuisine: 'indian',
      })
      const [need] = MEAL_TARGET[meal]
      assert.ok(sel.candidates.length >= need,
        `${fastId} offers ${sel.candidates.length} candidates for a ${meal} that wants ${need}`)
    }
  }
})

/* ------------------------------------------------------------------ *
 * The vocabulary                                                      *
 * ------------------------------------------------------------------ */

test('every rule is attached to a tradition that exists', () => {
  const known = new Set(Object.keys(FAST_LABEL))
  const unknown = Object.keys(TRADITION_RULES).filter((id) => !known.has(id))
  assert.deepEqual(unknown, [], 'a rule is attached to a tradition nobody can select')
  assert.deepEqual(Object.keys(DIET_RULES), ['jain'])
})

test('a rule names the tradition the member keeps, not its own label', () => {
  // One rule set serves Ekadashi and Navratri both. A member keeping Ekadashi
  // is not keeping Navratri, and the panel says so.
  const [rule] = rulesFor('vegetarian', ['ekadashi_vrat'], (id) => FAST_LABEL[id] || id)
  assert.deepEqual(rule.keptAs, ['Ekadashi Vrat'])
  assert.equal(rule.label, 'Ekadashi and Navratri')

  const filtered = filterRecipes(RECIPES, [keeping('ekadashi_vrat')], new Set(['ekadashi_vrat']))
  const fromRule = filtered.rejections.find((r) => String(r.flag || '').startsWith('ingredient:'))
  assert.ok(fromRule, 'no dish was set aside by an ingredient rule')
  assert.equal(fromRule.because, 'is keeping Ekadashi')
})

test('ingredient names are read the way the shopping list reads them', () => {
  const names = ingredientNamesOf(byId.E003)
  assert.ok(names.includes('sendha namak'), JSON.stringify(names))
  assert.ok(!names.some((n) => /^\d/.test(n)), 'a quantity survived into an ingredient name')
})

/* ------------------------------------------------------------------ *
 * The audit sweep                                                     *
 *                                                                     *
 * Deliberately a WIDER net than the rules enforce. The rules decide   *
 * what a family is served; this asks the other question — what do the *
 * FLAGS still pass? Three recipes were found by it that no amount of  *
 * checking individual ingredients had turned up, including an onion   *
 * pickle flagged navratriSafe, because every earlier sweep had looked *
 * at ekadashiSafe alone.                                              *
 *                                                                     *
 * Kept as a test rather than run once, so a recipe added next month   *
 * with a flag derived rather than considered fails the build instead  *
 * of reaching a plate.                                                *
 * ------------------------------------------------------------------ */

const AUDIT = {
  pulse: ['dal', 'toor dal', 'arhar dal', 'tuvar dal', 'moong dal', 'chana dal',
    'urad dal', 'masoor dal', 'rajma', 'chickpeas', 'chana', 'kabuli chana', 'besan',
    'gram flour', 'lentils', 'lentil', 'peas', 'matar', 'green peas', 'dried peas',
    'soya', 'soybean', 'soy', 'tofu', 'sprouts', 'beans', 'kidney beans',
    'french beans', 'lima beans', 'lobia', 'cowpea', 'moth beans', 'horse gram',
    'black gram', 'green gram', 'bengal gram', 'red gram', 'soya chunks', 'edamame'],
  grain: ['rice', 'basmati rice', 'brown rice', 'parboiled rice', 'rice flour',
    'puffed rice', 'murmura', 'poha', 'wheat', 'atta', 'whole wheat flour', 'maida',
    'refined flour', 'suji', 'rava', 'semolina', 'oats', 'barley', 'corn', 'maize',
    'cornflour', 'corn flour', 'makki', 'millet', 'bajra', 'jowar', 'ragi',
    'vermicelli', 'sevai', 'bread', 'pasta', 'noodles', 'macaroni', 'daliya',
    'quinoa', 'couscous', 'sattu', 'bulgur', 'cornmeal', 'breadcrumbs', 'flour'],
  allium: ['onion', 'spring onion', 'shallots', 'leek', 'garlic', 'garlic cloves',
    'chives', 'scallion', 'onion powder', 'garlic powder', 'onion paste',
    'ginger garlic paste'],
  fermented: ['vinegar', 'apple cider vinegar', 'soy sauce', 'soya sauce', 'tamari',
    'wine', 'rice wine', 'cooking wine', 'mirin', 'sake', 'beer', 'rum', 'brandy',
    'vodka', 'whisky', 'alcohol', 'yeast', 'idli batter', 'dosa batter', 'kimchi',
    'miso', 'tempeh', 'fish sauce', 'worcestershire', 'sourdough', 'kombucha'],
}

// Curd, paneer and buttermilk are fermented and are vrat food; the vrat flours
// are grains and are the point. Neither is a finding.
const PERMITTED_FERMENT = /curd|yoghurt|yogurt|dahi|paneer|buttermilk|chaas|lassi|khoya|cheese/i
const VRAT_STAPLE = /kuttu|buckwheat|singhara|water chestnut|rajgira|amaranth|\bsama\b|samak|barnyard|sabudana|sago|makhana/i

test('no recipe flagged safe for a vrat contains a pulse, grain, allium or ferment', () => {
  const findings = []
  for (const recipe of RECIPES) {
    const flags = ['ekadashiSafe', 'navratriSafe']
      .filter((f) => recipe.flags?.[f]?.status === 'yes')
    if (flags.length === 0) continue
    const names = ingredientNamesOf(recipe)
    for (const [category, terms] of Object.entries(AUDIT)) {
      for (const term of terms) {
        const found = names.find((n) => ruleViolations(
          { recipeId: `${recipe.recipeId}#${term}`, ingredients: n },
          [{ id: 'audit', forbidden: [term], swaps: [] }],
        ).length > 0)
        if (!found) continue
        if (category === 'fermented' && PERMITTED_FERMENT.test(found)) continue
        if (VRAT_STAPLE.test(found)) continue
        findings.push(`${recipe.recipeId} ${recipe.name} — ${flags.join('+')} but ${category}: ${term} in "${found}"`)
        break
      }
    }
  }
  assert.deepEqual(findings, [],
    'a flag and an ingredient disagree. The rule wins and the flag gets corrected — '
    + 'see "Nine compliance flags corrected" in docs/DATA-ISSUES.md for the format, '
    + 'and record the evidence in the flag\'s own note.')
})

test('the corrections from the sweep stay corrected', () => {
  // The three the ekadashiSafe-only sweeps could never have found.
  assert.equal(byId.ASC173.flags.navratriSafe.status, 'no')
  assert.equal(byId.ASC480.flags.navratriSafe.status, 'no')
  assert.equal(byId.OSR056.flags.navratriSafe.status, 'no')
  // N004 and the seven vinegar rows, both flags each.
  for (const id of ['N004', 'ASC512', 'ASC513', 'BFP163', 'BFP306', 'BFP310', 'BFP312', 'OSR058']) {
    assert.equal(byId[id].flags.ekadashiSafe.status, 'no', id)
    assert.equal(byId[id].flags.navratriSafe.status, 'no', id)
    assert.ok(byId[id].flags.ekadashiSafe.note.length > 20, `${id} corrected without evidence`)
  }
})
