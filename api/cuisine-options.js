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

  // Someone fasting means no international option at all — a pizza is never
  // ekadashiSafe, and the picker is hidden rather than shown all-disabled.
  // A cuisine that cannot be offered gets a reason, so the picker can say why
  // rather than silently hiding it.
  const strict = [...new Set(constraints.flatMap((c) => c.strictFlags))]
  const reasonFor = (count) => {
    if (count === 0) {
      return strict.includes('diabeticFriendly')
        ? 'No dishes safe for everyone today — most are too high-GI for a diabetic member.'
        : 'No dishes fit everyone\u2019s constraints today.'
    }
    return `Only ${count} dish${count === 1 ? '' : 'es'} fit everyone today \u2014 not enough for a full meal.`
  }

  const byMeal = {}
  for (const meal of MEAL_TYPES) {
    byMeal[meal] = anyFasting ? [] : internationalCuisineOptions(mains, meal)
      .map((o) => ({ ...o, reason: o.available ? null : reasonFor(o.count) }))
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
  })
}
