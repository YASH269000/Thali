// The shopping section is gated on one source and rendered from another, on
// purpose. This pins the reason, because the two look redundant.
//
//   plan.ingredientsAggregated  ->  did this meal need anything at all?
//   shopping.rows               ->  what is left after the pantry?
//
// Collapsing them into a single test would make "Everything is already in your
// pantry" unreachable: a family who owns every ingredient would get no section
// at all rather than the one message telling them they are done.
//
// These assert the data conditions the JSX guard reads, not the JSX. There is
// no DOM renderer in this project, and the conditions are where the meaning
// lives — `plan.ingredientsAggregated?.length > 0` in MealPlan.jsx and the
// `shopping.rows.length > 0` ternary inside it.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildShoppingEntries, buildShoppingList, applyPantry } from '../src/lib/shoppingList.js'

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))
const byId = Object.fromEntries(RECIPES.map((r) => [r.recipeId, r]))

/** A plan dish, shaped the way api/generate-plan.js sends one. */
const asDish = (recipe) => ({
  recipeId: recipe.recipeId,
  name: recipe.name,
  ingredients: recipe.ingredients,
  serves: recipe.serves,
  components: [],
})

/** The server field the section's visibility is gated on. */
const serverAggregate = (recipes, headcount) => buildShoppingList(recipes, headcount)

/** What the browser renders inside the section. */
const clientRows = (plan, pantry) => applyPantry(
  plan.dishes.length ? buildShoppingEntries(plan.dishes, plan.headcount) : [],
  pantry,
)

test('a meal that needs nothing hides the section rather than showing a blank list', () => {
  const plan = { headcount: 4, dishes: [], ingredientsAggregated: serverAggregate([], 4) }

  assert.equal(plan.ingredientsAggregated.length, 0, 'guard source is empty')
  const sectionVisible = plan.ingredientsAggregated.length > 0
  assert.equal(sectionVisible, false, 'the whole section is hidden, so there is no blank list to see')
  assert.equal(clientRows(plan, []).rows.length, 0)
})

test('a dish the catalogue does not know contributes nothing, and hides the section', () => {
  // An unknown recipeId carries no ingredients. Before the plan-level fix this
  // was the shape that produced a plan of N dishes and a shorter list.
  const invented = { recipeId: 'ZZZ999', name: 'Invented Dish', ingredients: '', serves: null, components: [] }
  const plan = { headcount: 4, dishes: [invented], ingredientsAggregated: serverAggregate([invented], 4) }

  assert.equal(plan.ingredientsAggregated.length, 0)
  assert.equal(plan.ingredientsAggregated.length > 0, false)
})

test('a meal whose every ingredient is in the pantry keeps the section and shows the pantry message', () => {
  // One recipe, and a pantry holding everything it asks for.
  const recipe = byId.B003 // Chapati/Roti - flour, oil, salt
  const plan = {
    headcount: 4,
    dishes: [asDish(recipe)],
    ingredientsAggregated: serverAggregate([recipe], 4),
  }
  assert.ok(plan.ingredientsAggregated.length > 0, 'this meal does need something')

  // Tick every line the meal produced.
  const everything = buildShoppingEntries(plan.dishes, plan.headcount).map((row) => row.name)
  const shopping = clientRows(plan, everything)

  const sectionVisible = plan.ingredientsAggregated.length > 0
  assert.equal(sectionVisible, true, 'the section stays, because the meal did need things')
  assert.equal(shopping.rows.length, 0, 'nothing is left to buy')
  assert.ok(shopping.removed.length > 0, 'and the pantry is credited with taking them off')
  // rows.length === 0 inside a visible section is exactly the branch that
  // renders "Everything is already in your pantry."
})

test('the guard cannot be replaced by the row count', () => {
  // The two disagree in precisely the case the message exists for, which is
  // why one cannot stand in for the other.
  const recipe = byId.B003
  const plan = {
    headcount: 4,
    dishes: [asDish(recipe)],
    ingredientsAggregated: serverAggregate([recipe], 4),
  }
  const everything = buildShoppingEntries(plan.dishes, plan.headcount).map((row) => row.name)

  assert.equal(plan.ingredientsAggregated.length > 0, true)
  assert.equal(clientRows(plan, everything).rows.length > 0, false)
})

test('the guard and the rows agree whenever the meal really needs something', () => {
  // Different diner counts scale amounts, never the set of rows, so the field
  // computed at headcount and the rows computed at headcount + guests can
  // never disagree about emptiness.
  const recipes = ['B003', 'J005', 'B002'].map((id) => byId[id])
  const plan = {
    headcount: 4,
    dishes: recipes.map(asDish),
    ingredientsAggregated: serverAggregate(recipes, 4),
  }
  for (const extraGuests of [0, 1, 3, 20]) {
    const rows = buildShoppingEntries(plan.dishes, plan.headcount + extraGuests)
    assert.equal(
      rows.length > 0,
      plan.ingredientsAggregated.length > 0,
      `guard and rows disagree at extraGuests=${extraGuests}`,
    )
  }
})
