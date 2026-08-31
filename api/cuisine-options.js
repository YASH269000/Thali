// POST /api/cuisine-options
//
// Which cuisines this family could actually eat for a given meal today.
// Purely deterministic — no model call — so the picker can be shown before
// anything is generated, and a cuisine whose pool the family's constraints
// have gutted is never offered.

import { activeFastIdsOn } from '../src/lib/fastingRules.js'
import { filterRecipes, internationalCuisineOptions } from '../src/lib/mealPlanRules.js'
import { guestsAsMembers, normaliseGuests } from '../src/lib/guests.js'
import RECIPES from '../src/data/recipes.json' with { type: 'json' }

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

// How to describe the constraint that shrank a cuisine's pool, in the words a
// family would use for it. Ordered most-restrictive first: a Jain member also
// requires onionGarlicFree, and "a Jain meal" is the useful half of that.
const FLAG_PHRASE = [
  ['jainSafe', 'Jain'],
  ['onionGarlicFree', 'no-onion-garlic'],
  ['vegan', 'vegan'],
  ['diabeticFriendly', 'low-GI'],
  ['glutenFree', 'gluten-free'],
  ['lactoseFree', 'lactose-free'],
  ['alcoholFree', 'alcohol-free'],
]

/** "a Jain, gluten-free meal" — or plain "meal" when nothing binds. */
function mealDescription(requiredFlags) {
  const held = new Set(requiredFlags)
  const words = FLAG_PHRASE.filter(([flag]) => held.has(flag)).map(([, word]) => word)
  // jainSafe already implies onionGarlicFree; saying both is noise.
  const trimmed = words.includes('Jain')
    ? words.filter((w) => w !== 'no-onion-garlic')
    : words
  if (trimmed.length === 0) return 'meal'
  return `${trimmed.join(', ')} meal`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  const body = req.body || {}
  const family = Array.isArray(body.family) ? body.family : []
  if (family.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty "family" array.' })
  }

  const presentIds = Array.isArray(body.presentMembers) ? body.presentMembers : null
  const diners = presentIds ? family.filter((m) => presentIds.includes(m.id)) : family
  if (diners.length === 0) {
    return res.status(400).json({ error: 'No present members.' })
  }

  const guests = guestsAsMembers(normaliseGuests(Array.isArray(body.guests) ? body.guests : []))
  const date = body.date ? new Date(body.date) : new Date()
  if (Number.isNaN(date.getTime())) {
    return res.status(400).json({ error: `Invalid date: ${body.date}` })
  }

  const activeFastIds = activeFastIdsOn(date)
  const { mains, constraints } = filterRecipes(RECIPES, [...diners, ...guests], activeFastIds)
  const anyFasting = constraints.some((c) => c.activeFasts.length > 0)

  // Every flag anyone at the table requires today, so a warning can name the
  // reason rather than saying "constraints".
  const requiredFlags = [...new Set(constraints.flatMap((c) => c.requiredFlags))]
  const description = mealDescription(requiredFlags)

  // Someone fasting means no international option at all — a pizza is never
  // ekadashiSafe, and the picker is hidden rather than shown all-disabled.
  // A cuisine that cannot be offered gets a reason, so the picker can say why
  // rather than silently hiding it.
  const strict = [...new Set(constraints.flatMap((c) => c.strictFlags))]
  // Named rather than generic: "not enough dishes" tells a family nothing they
  // can act on, while "no-onion-garlic" tells them which member's constraint is
  // doing it and that Indian is the way round it.
  const reasonFor = (cuisine, count, meal) => {
    if (count === 0) {
      return strict.includes('diabeticFriendly')
        ? `No ${cuisine} dish is safe for everyone today \u2014 most are too high-GI for a member who needs low-GI food.`
        : `No ${cuisine} dish works for a ${description} today.`
    }
    return `Only ${count} ${cuisine} ${count === 1 ? 'dish works' : 'dishes work'} for a ${description} today \u2014 not enough for a ${meal}. Indian has more.`
  }

  // A cuisine can be offerable and still be too thin for the meal asked for:
  // a Buddhist member takes Indo-Chinese from 47 lunch dishes to 4, which is
  // enough to cook from but not enough for the 4-5 a lunch wants. The plan
  // would come back honest and short; this says so before it is generated,
  // in the same terms.
  const byMeal = {}
  for (const meal of MEAL_TYPES) {
    byMeal[meal] = anyFasting ? [] : internationalCuisineOptions(mains, meal)
      .map((o) => ({
        ...o,
        reason: o.available ? null : reasonFor(o.cuisine, o.count, meal),
        note: o.thin
          ? (o.count < o.needed
            ? `Only ${o.count} ${o.cuisine} ${o.count === 1 ? 'dish works' : 'dishes work'} for a ${description} today, so this would be a ${o.count}-dish ${meal} rather than the usual ${o.needed}-${o.most}. A short honest meal is better than an invented one, but Indian or another cuisine will give you a fuller one.`
            : `Only ${o.count} ${o.cuisine} dishes work for a ${description} today — just enough for a ${meal}, with nothing spare to swap or leave out. Try Indian or another cuisine for more choice.`)
          : null,
      }))
  }

  return res.status(200).json({
    anyFasting,
    activeFasts: [...new Set(constraints.flatMap((c) => c.activeFasts))],
    byMeal,
    // A cuisine is offerable if it can furnish a meal for at least one meal type.
    // Cuisines that exist in the database but cannot be served today, with
    // the reason, so the UI explains rather than hides.
    unavailable: anyFasting ? [] : Object.values(
      MEAL_TYPES.reduce((acc, m) => {
        for (const o of byMeal[m]) {
          if (o.available) delete acc[o.cuisine]
          else if (!(o.cuisine in acc)) acc[o.cuisine] = { cuisine: o.cuisine, reason: o.reason }
        }
        return acc
      }, {}),
    ),
    offerable: anyFasting ? [] : [...new Set(
      MEAL_TYPES.flatMap((m) => byMeal[m].filter((o) => o.available).map((o) => o.cuisine)),
    )],
    // What the family's constraints add up to today, for the warning text.
    requiredFlags,
    mealDescription: description,
  })
}
