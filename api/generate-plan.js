// POST /api/generate-plan
//
// Body: { family: Member[], date?: ISO string, mealType?: 'breakfast'|'lunch'|'dinner' }
//
// Deploys unchanged as a Vercel serverless function. In local development the
// same default export is driven by a Vite middleware (see vite.config.js), so
// `npm run dev` serves this route without the Vercel CLI.

import { GoogleGenerativeAI } from '@google/generative-ai'
import { activeFastIdsOn, calendarNotesOn, foodRulesFor } from '../src/lib/fastingRules.js'
import {
  compactForPrompt, dessertAvailability, dessertsFor, filterRecipes,
  isInternational, MEAL_TARGET, roleOf, selectCandidatesForMeal, SINGLETON_ROLES,
} from '../src/lib/mealPlanRules.js'
import { buildShoppingList } from '../src/lib/shoppingList.js'
import { buildExplanation } from '../src/lib/explainPlan.js'
import { findRefContradictions, resolveComponents, resolveRecipeRef } from '../src/lib/recipeRefs.js'
import { FAST_LABEL } from '../src/data/memberOptions.js'
// Statically imported, never read from disk. A runtime readFileSync is not
// traceable by the Vercel bundler, so recipes.json was omitted from the
// deployed function and the module threw on load. A static import is
// inlined into the bundle, exactly like the JSON the src/lib modules import.
import RECIPES from '../src/data/recipes.json' with { type: 'json' }
import {
  describeGuests, guestHeadcount, guestWholeMealConstraints, guestsAsMembers, normaliseGuests,
} from '../src/lib/guests.js'

const MODEL = 'gemini-3.6-flash'
const MAX_CANDIDATES = 80
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

// Shape of the meal differs sharply by type; without this the model returns
// the same dal-sabzi-rice-roti combination three times.
// Two sets of briefs. On a day when someone is fasting the meal stays
// traditional and Indian, because the fasting rules are the whole point. On an
// ordinary day the family's real repertoire is wider than that — Indo-Chinese
// is the most-ordered non-Indian cuisine in India — so the brief says so, or
// the model returns dal-sabzi-roti forever and the imported dishes never win.
const MEAL_BRIEF_FASTING = {
  breakfast:
    'Suggest a light, quick Indian breakfast — typically 1 main + 1 side ' +
    '(like chutney/pickle) + 1 beverage. Keep it to 2-3 dishes. Do NOT ' +
    'return a dal-rice-roti thali; this is breakfast.',
  lunch:
    'Suggest a complete traditional Indian lunch thali — the heaviest meal ' +
    'of the day. Include: 1 dal, 1 rice OR roti (or both), 1-2 sabzis, ' +
    '1 raita/salad, and optional pickle. Lunch is where the family eats ' +
    'together, so make it complete. Aim for 4-5 dishes.',
  dinner:
    'Suggest a lighter Indian dinner — typically 1 dal, 1 sabzi, 1 roti/paratha, ' +
    'optional rice for those who want it. Dinner should be easier to digest ' +
    'than lunch: go easier on fried and heavy dishes. Aim for 3-4 dishes.',
}

// Shape guidance only — deliberately cuisine-neutral. Naming the Indian
// structure here ("1 dal, 1 sabzi, 1 roti") made Indian the default-shaped
// answer, and the model returned it every time even with a coherent
// single-cuisine alternative sitting in the candidate list.
//
// MEAL_TARGET — what a full meal of each type looks like — is imported rather
// than declared, because the cuisine picker warns about exactly the cuisines
// that will push shapeFor() below its floor, and the two must agree.

/**
 * The "how many dishes" sentence, capped at what actually exists.
 *
 * Asking for 4-5 dishes from a pool of 3 is how a vegetarian East Asian lunch
 * came back as two rice dishes and a ramen: the model was told to build a full
 * lunch and given three dishes to build it from, so it used all three.
 */
function shapeFor(mealType, available) {
  const [lo, hi] = MEAL_TARGET[mealType] || MEAL_TARGET.dinner
  const base = MEAL_SHAPE[mealType] || MEAL_SHAPE.dinner
  if (!Number.isFinite(available) || available >= lo) return base
  return `Only ${available} ${available === 1 ? 'dish fits' : 'dishes fit'} today, so return ${available === 1 ? 'that one dish' : `those ${available}`} and no more. Do NOT pad the meal to ${lo}-${hi} dishes, and do NOT repeat a dish. A short honest meal is better than an invented one.`
}

const MEAL_SHAPE = {
  breakfast:
    'Keep it to 2-3 dishes: one main, one side, one beverage. Do NOT return a ' +
    'dal-rice-roti thali; this is breakfast.',
  lunch:
    'Aim for 4-5 dishes. Lunch is the heaviest meal and where the family eats ' +
    'together, so make it complete.',
  dinner:
    'Aim for 3-4 dishes. Dinner should be easier to digest than lunch: go ' +
    'easier on fried and heavy dishes.',
}

/**
 * Non-fast-day brief. When a coherent international cuisine is on offer the
 * two options are stated as equals and its dishes are named outright, so the
 * model can see a real meal exists on both sides.
 */
function openBrief(mealType, cuisine, intlDishes) {
  const shape = shapeFor(mealType, intlDishes.length)

  // No cuisine reserved: the family asked for Indian, or nothing else could
  // furnish a meal today. This is the original Indian brief.
  if (!cuisine || intlDishes.length === 0) {
    return MEAL_BRIEF_FASTING[mealType] || MEAL_BRIEF_FASTING.dinner
  }

  // A cuisine was chosen. Instruct it — offering a choice was tried and the
  // model returned the Indian thali nine times out of nine.
  return `Build a complete ${cuisine} ${mealType}. The family has chosen ${cuisine} food for this meal, so do NOT return an Indian thali.

Use these ${cuisine} dishes — they are the only ones that fit today's dietary constraints:
${intlDishes.map((d) => `- ${d}`).join('\n')}

Choose the ones that make a coherent ${cuisine} ${mealType} together. Every dish you return must come from this ${cuisine} list. Do not add Indian dishes to it. ${shape}`
}

function buildPrompt({
  family, constraints, mealType, dateLabel, calendarNotes, foodRules, candidates,
  recentRecipeIds, guestSummary = [], guestCount = 0, guestNotes = [], headcount,
  anyFasting = false, internationalCuisine = null, internationalDishes = [],
}) {
  const members = constraints.map((c) => ({
    memberId: c.id,
    name: c.name,
    age: c.age,
    relationship: c.relationship,
    diet: c.diet,
    lifeStage: c.lifeStage,
    spiceLevel: c.spiceLevel,
    health: c.health,
    likes: c.likes,
    dislikes: c.dislikes,
    fastsActiveToday: c.activeFasts.map((id) => FAST_LABEL[id] || id),
    mustSatisfyFlags: c.requiredFlags,
  }))

  const guestBlock = guestCount > 0
    ? `\nGUESTS — ${guestCount} joining this meal:\n${guestSummary.map((g) => `- ${g}`).join('\n')}\n
Their dietary constraints must ALSO be respected. The meal must satisfy family
and guests together, cooked once. You cannot make a separate dish for a guest.
${guestNotes.map((n) => `- ${n.message}`).join('\n')}\n`
    : ''

  const recentBlock = recentRecipeIds.length
    ? `\nRECENTLY SERVED — DO NOT REPEAT:\nThe family has already eaten these in the last 5 meals: ${recentRecipeIds.join(', ')}.\nDo not suggest any of them. Choose different dishes from the candidates below.\n`
    : ''

  return `You are the kitchen planner for an Indian joint family. Plan ONE ${mealType} for ${dateLabel} that the whole family can eat from a single kitchen.

MEAL BRIEF — ${mealType.toUpperCase()}:
${anyFasting
  ? `${MEAL_BRIEF_FASTING[mealType]}\nSomeone is fasting today, so keep the whole meal traditional and Indian.`
  : openBrief(mealType, internationalCuisine, internationalDishes)}

EATING THIS MEAL — ${family.length} ${family.length === 1 ? 'person' : 'people'}:
${JSON.stringify(members, null, 2)}

Plan for THESE specific family members only. Anyone not in this list is absent
today: ignore them entirely. Do not cook for them, do not mention them, and do
not let their diets, health conditions or fasts constrain this meal.

There are ${headcount} ${headcount === 1 ? 'person' : 'people'} eating${guestCount > 0 ? ` (${family.length} family + ${guestCount} guests)` : ''}. Choose the
dish count and portions with that in mind. Do NOT produce a shopping list —
quantities are calculated separately from the recipe data.

${guestBlock}${recentBlock}
${calendarNotes.length ? `TODAY'S CALENDAR CONTEXT:\n${JSON.stringify(calendarNotes, null, 2)}\n` : ''}
${foodRules.length ? `FASTING FOOD RULES IN FORCE:\n${JSON.stringify(foodRules, null, 2)}\n` : ''}
CANDIDATE RECIPES — every one of these has ALREADY been verified as safe for
every member today. Choose ONLY from this list. Never invent a recipe and never
use a recipeId that does not appear here.
${JSON.stringify(candidates, null, 2)}

Each candidate carries a "role" (dal, rice, bread, sabzi, accompaniment,
beverage, snack, dessert, main) — use it to build the shape the brief asks for.

PER-MEMBER ATTRIBUTION — READ CAREFULLY
For each dish, list which family members can eat it as-is (servesMembers, by
memberId), which cannot (excludedMembers, each with a specific health or dietary
reason), and suggest a substitute dish from the available candidates for any
excluded members. Do NOT put everyone in servesMembers by default — actually
reason about each member's diet, their active fasts, their dislikes, their life
stage, and ONLY these five health conditions: diabetes (type 1 and type 2),
PCOD/PCOS (handled as the same low-GI need as diabetes), lactose intolerance,
gluten sensitivity, and nut allergy. A rich dessert is not
automatically fine for a diabetic; a heavily spiced dish is not automatically
fine for a toddler. If a dish genuinely is safe for everyone, put all members in
servesMembers and leave excludedMembers empty. Every member must appear in
exactly one of servesMembers or excludedMembers for every dish.

HEALTH CONDITIONS YOU MUST NOT REASON ABOUT
A member's "health" list may also contain hypertension, cholesterol, thyroid or
kidney_issues. These are recorded for the family's own reference only. The
recipe data carries NO sodium, fat, potassium, phosphorus or protein figures, so
you have nothing to judge them with and any judgement you make would be invented.
Therefore:
- Never place a member in excludedMembers because of hypertension, cholesterol,
  thyroid or kidney_issues. No "too high in sodium", "too much saturated fat",
  "high potassium" or similar reasoning — you cannot know this.
- Never cite any of these four in an excludedMembers reason, a substitute note,
  a perMemberNotes line, or a dish's "why".
- Equally, never assert a dish is safe, suitable, low-sodium, heart-friendly or
  kidney-friendly for such a member. Say nothing about it either way.
Every dietary constraint that genuinely restricts this meal has ALREADY been
enforced in code before these candidates reached you. Your job is to compose a
good meal from a pre-verified pool, not to re-adjudicate safety.

TASK
Follow the MEAL BRIEF above for how many dishes and which roles. Prefer
dishes with hasSteps=true, since those carry full preparation instructions.
Where two candidates fit the brief equally well, prefer the one matching a
member's "likes". Likes are a soft nudge only — a bonus when honoured, never a
requirement. Never exclude a member from a dish because it is not among their
likes, never let likes override a diet, health, allergy, fasting or life-stage
constraint, and never pick a dish outside the candidate list to satisfy one.
Cover the whole family from one cooking session; where one member is fasting
and others are not, say plainly in perMemberNotes which dish serves whom.

Return ONLY a JSON object, no markdown fence, in exactly this shape:
{
  "dishes": [
    { "recipeId": "<from the candidate list>",
      "name": "<recipe name>",
      "role": "<e.g. main, bread, dal, side, sweet>",
      "servesMembers": ["<memberId>", ...],
      "excludedMembers": [ { "memberId": "<memberId>", "reason": "<specific health or dietary reason>" } ],
      "substitutes": [ { "forMemberId": "<memberId>", "substituteDish": "<another dish from THIS plan or the candidates>", "note": "<why it suits them>" } ],
      "why": "<one sentence on why this dish fits today>" }
  ],
  "perMemberNotes": { "<member name>": "<what this member eats and any caution>" },
  "prepTimeTotalMin": <integer, realistic for cooking these together>,
  "planSummary": "<two sentences describing the thali as a whole>"
}`
}

// Models sometimes wrap JSON in a fence or add prose despite the mime type.
function parseModelJson(text) {
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(cleaned)
}

/**
 * Normalise one dish's per-member attribution.
 * Anything the model returns that cannot be resolved to a real family member
 * is dropped rather than shown, and every member is forced into exactly one
 * of serves/excluded so the UI can never render a contradiction.
 */
function buildAttribution(dish, family, resolveMember) {
  const serves = []
  const excluded = []
  const seen = new Set()

  for (const ref of Array.isArray(dish.servesMembers) ? dish.servesMembers : []) {
    const m = resolveMember(ref)
    if (m && !seen.has(m.memberId)) { serves.push(m); seen.add(m.memberId) }
  }

  for (const e of Array.isArray(dish.excludedMembers) ? dish.excludedMembers : []) {
    const m = resolveMember(e?.memberId ?? e?.name ?? e)
    if (!m || seen.has(m.memberId)) continue
    excluded.push({ ...m, reason: String(e?.reason || 'not suitable for this member').trim() })
    seen.add(m.memberId)
  }

  // A member the model forgot is assumed served, matching the old behaviour
  // rather than silently vanishing from the card.
  for (const m of family) {
    if (!seen.has(m.id)) { serves.push({ memberId: m.id, name: m.name }); seen.add(m.id) }
  }

  const excludedIds = new Set(excluded.map((e) => e.memberId))
  const substitutes = (Array.isArray(dish.substitutes) ? dish.substitutes : [])
    .map((s) => {
      const m = resolveMember(s?.forMemberId ?? s?.memberId)
      if (!m || !s?.substituteDish) return null
      return {
        ...m,
        substituteDish: String(s.substituteDish).trim(),
        note: String(s.note || '').trim(),
      }
    })
    // Only offer a substitute to someone actually excluded.
    .filter((s) => s && excludedIds.has(s.memberId))

  return { servesMembers: serves, excludedMembers: excluded, substitutes }
}

// Reported once per cold start, never reconciled. A recipe whose ingredients
// and preparation give different amounts for the same substitution is a data
// fix, not something to paper over at runtime: both texts reach the user
// verbatim. See docs/DATA-ISSUES.md.
for (const c of findRefContradictions(RECIPES)) {
  console.warn(
    `[thali:data] ${c.recipeId} ${c.name}: cross-reference notes disagree — ` +
    `ingredients say "${c.ingredientsSays}" (${c.amounts.ingredients.join(', ')}), ` +
    `preparation says "${c.preparationSays}" (${c.amounts.preparation.join(', ')}). ` +
    'Both are shown to the user; neither is applied.',
  )
}

/**
 * The family's calendar corrections, as sent by the browser.
 *
 * Validated rather than trusted: this arrives over the wire and is used to
 * decide whether today is a fast, which is the one decision the planner must
 * not get wrong. Anything not shaped like `observanceId@YYYY-MM-DD` mapping to
 * a confirmation is dropped, and the date the answer moves an observance TO
 * has to be a date.
 */
function readOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw).slice(0, 200)) {
    if (!/^[a-z0-9_]+@\d{4}-\d{2}-\d{2}$/.test(key)) continue
    if (!value || typeof value !== 'object') continue
    const entry = { confirmed: value.confirmed === true }
    if (typeof value.movedTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.movedTo)) {
      entry.movedTo = value.movedTo
    }
    out[key] = entry
  }
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  // Key-format agnostic on purpose. Google has used at least two shapes
  // (legacy AIza..., current AQ....), so validating a prefix would reject
  // valid keys the next time the format moves. Only reject what is provably
  // not a key: absent, too short, or the placeholder we ship in .env.local.
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const isUnset = apiKey.length <= 30 ||
    /^(your-|<|changeme|placeholder)/i.test(apiKey)
  if (isUnset) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not set.',
      hint: 'Put your real key in .env.local (local) or the Vercel project environment variables (deployed), then restart the dev server. Get a key at https://aistudio.google.com/apikey',
    })
  }

  const body = req.body || {}
  const family = Array.isArray(body.family) ? body.family : null
  if (!family || family.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty "family" array.' })
  }

  // Who is actually home for this meal. Absent members are dropped entirely:
  // their diets, health conditions and fasts must not constrain the cooking,
  // and their portions must not be bought or cooked.
  const presentIds = Array.isArray(body.presentMembers) ? body.presentMembers : null
  const diners = presentIds
    ? family.filter((m) => presentIds.includes(m.id))
    : family
  if (diners.length === 0) {
    return res.status(400).json({
      error: 'No present members. "presentMembers" matched nobody in "family".',
      presentMembers: presentIds,
    })
  }
  const absent = family.filter((m) => !diners.includes(m))

  // Guests join as pseudo-members so their constraints run through the same
  // deterministic filter. You cannot cook two versions of one pot: a Jain
  // guest makes the whole meal Jain, an allergy binds every dish.
  const guests = normaliseGuests(Array.isArray(body.guests) ? body.guests : [])
  const guestMembers = guestsAsMembers(guests)
  const guestCount = guestHeadcount(guests)
  const guestNotes = guestWholeMealConstraints(guests)
  const guestSummary = describeGuests(guests)
  const headcount = diners.length + guestCount

  const mealType = MEAL_TYPES.includes(body.mealType) ? body.mealType : 'dinner'
  // 'indian' (default) | a cuisine name | 'surprise'
  const requestedCuisine = typeof body.cuisine === 'string' ? body.cuisine : 'indian'
  const includeDessert = body.includeDessert === true

  const recentRecipeIds = Array.isArray(body.recentRecipeIds)
    ? body.recentRecipeIds.filter((x) => typeof x === 'string').slice(0, 60)
    : []
  const date = body.date ? new Date(body.date) : new Date()
  if (Number.isNaN(date.getTime())) {
    return res.status(400).json({ error: `Invalid date: ${body.date}` })
  }

  // ---- constraints and filtering (deterministic, before any model call) ----
  const overrides = readOverrides(body.observanceOverrides)
  const activeFastIds = activeFastIdsOn(date, overrides)
  const filtered = filterRecipes(RECIPES, [...diners, ...guestMembers], activeFastIds)
  const { mains, swaps, constraints, stats, caveats } = filtered

  // A member carrying a fast id the app cannot read is the one case worth
  // refusing over. Everything else fails closed to the strictest reading and
  // plans anyway; a fast has no strictest reading to fall back to, because
  // only Ekadashi and Navratri carry a compliance flag at all. Planning would
  // mean guessing at a rule on the one day of the year it matters most.
  const blocked = constraints.filter((c) => c.blocked)
  if (blocked.length > 0) {
    const detail = blocked.map((c) => `${c.name}: ${c.unknownIds
      .filter((u) => u.kind === 'fasts')
      .map((u) => `"${u.id}"`).join(', ')}`)
    console.warn(`[thali:member] refusing to plan — unreadable fast id(s): ${detail.join('; ')}`)
    return res.status(422).json({
      error: `Thali cannot read a fasting setting for ${blocked.map((c) => c.name).join(' and ')}.`,
      hint: 'Open Family and re-select their fasts. Thali will not plan a meal around a fast it cannot read — on a fast day that would quietly serve an unrestricted menu.',
      unreadable: blocked.map((c) => ({ memberId: c.id, name: c.name, ids: c.unknownIds })),
    })
  }

  if (mains.length === 0 && swaps.length === 0) {
    return res.status(422).json({
      error: 'No recipe in the database satisfies every member today.',
      stats,
      constraints: constraints.map((c) => ({ name: c.name, requiredFlags: c.requiredFlags })),
    })
  }

  // Computed once and reused for both the candidate reservation and the
  // meal brief, so the two can never disagree about whether today is a fast.
  const anyFasting = constraints.some((c) => c.activeFasts.length > 0)

  const selection = selectCandidatesForMeal(mains, mealType, {
    limit: MAX_CANDIDATES,
    excludeIds: recentRecipeIds,
    anyFasting,
    forceCuisine: anyFasting ? 'indian' : requestedCuisine,
  })

  if (selection.candidates.length === 0) {
    return res.status(422).json({
      error: `No ${mealType} recipe in the database satisfies every member today.`,
      stats, mealType,
    })
  }

  const candidates = selection.candidates.map((r) => ({
    ...compactForPrompt(r),
    role: roleOf(r),
  }))
  const dateLabel = date.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const activeLabels = [...new Set(constraints.flatMap((c) => c.activeFasts))]
    .map((id) => FAST_LABEL[id] || id)

  const prompt = buildPrompt({
    family: diners, constraints, mealType, dateLabel, recentRecipeIds,
    guestSummary, guestCount, guestNotes, headcount,
    anyFasting,
    internationalCuisine: selection.internationalCuisine,
    internationalDishes: candidates
      .filter((c) => isInternational(c))
      .map((c) => `${c.name} (${c.category})`),
    calendarNotes: calendarNotesOn(date, overrides),
    foodRules: foodRulesFor(activeLabels),
    candidates,
  })

  // ---- model call ----
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      // Generous, because 2.5 Flash thinks by default and thinking tokens
      // count here — a tight cap truncates the JSON mid-object.
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  })
  const ask = async (text) => (await model.generateContent(text)).response.text()

  let raw
  try {
    raw = await ask(prompt)
  } catch (err) {
    return res.status(502).json({
      error: 'Gemini request failed.',
      detail: err?.message || String(err),
      model: MODEL,
    })
  }

  let plan
  try {
    plan = parseModelJson(raw)
  } catch (err) {
    return res.status(502).json({
      error: 'Gemini returned text that is not valid JSON.',
      detail: err?.message || String(err),
      raw: String(raw).slice(0, 2000),
    })
  }

  if (!Array.isArray(plan.dishes) || plan.dishes.length === 0) {
    return res.status(502).json({ error: 'Gemini response had no dishes array.', raw: plan })
  }

  // ---- rehydrate: the model only ever saw compact records ----
  const byId = new Map(RECIPES.map((r) => [r.recipeId, r]))

  // ---- invented recipe ids ----
  //
  // The model is told never to use a recipeId outside the candidate list, and
  // mostly does not. When it does, the dish is not a display problem: it has
  // no ingredients, no preparation and no compliance flags, which means it
  // passed no diet, allergy, religion or fasting check on its way here. Every
  // other dish on the plate was verified in code before the model ever saw it.
  // An invented one must never sit beside them as though it had been.
  //
  // It also silently shortened the shopping list — a plan of five dishes whose
  // list covered four, with nothing saying why.
  let unknownNote = null
  const unknownIn = (list) => list.filter((d) => !byId.has(d.recipeId))

  let unknown = unknownIn(plan.dishes)
  const inventedIds = unknown.map((d) => `"${d.recipeId}"`).join(', ')
  if (unknown.length > 0) {
    const named = inventedIds
    console.warn(`[thali:unknown] model returned ${unknown.length} recipe id(s) not in the catalogue: ${named}. Retrying once.`)
    try {
      const retry = await ask(`${prompt}

YOUR PREVIOUS ANSWER WAS REJECTED
${named} ${unknown.length === 1 ? 'is not a recipeId' : 'are not recipeIds'} in the candidate list. Every dish you return must use a recipeId that appears verbatim in the CANDIDATE RECIPES above. Do not invent one, do not adapt one, and do not guess. Return the plan again using only those ids. If you cannot fill the meal from them, return the shorter meal — fewer dishes is correct, an invented dish is not.`)
      const second = parseModelJson(retry)
      if (Array.isArray(second.dishes) && second.dishes.length > 0
        && unknownIn(second.dishes).length === 0) {
        plan = second
        unknown = []
      }
    } catch {
      // Falls through to dropping — a failed retry must not fail the plan.
    }
  }

  if (unknown.length > 0) {
    const drop = new Set(unknown)
    plan = { ...plan, dishes: plan.dishes.filter((d) => !drop.has(d)) }
    const names = unknown.map((d) => d.name || d.recipeId)
    console.warn(`[thali:unknown] retry still invented; dropped ${names.join(', ')}`)
    unknownNote = `${names.join(' and ')} ${names.length === 1 ? 'was' : 'were'} left out — ${names.length === 1 ? 'that dish is' : 'those dishes are'} not in Thali's recipe book, so ${names.length === 1 ? 'it has' : 'they have'} no ingredients or method and ${names.length === 1 ? 'was' : 'were'} never checked against anyone's diet.`

    // Dropping every dish would leave a plan that is not a plan. The client
    // treats a dishless plan as nothing to show, so say so honestly instead.
    if (plan.dishes.length === 0) {
      return res.status(502).json({
        error: 'Gemini returned only recipes that do not exist.',
        hint: 'Try again — this usually clears on a second attempt.',
        detail: `Invented ids: ${inventedIds}`,
      })
    }
  }

  // ---- role validation ----
  //
  // The role stored on a dish used to be `d.role` — the model's own claim,
  // never checked. Nothing stopped it returning two rice dishes, and for a
  // vegetarian East Asian lunch nothing could: the whole cuisine offered three
  // eligible dishes and two of them were rice. Roles are recomputed here from
  // the recipe record, and a plan that doubles up on a role that cannot repeat
  // is sent back once before anything is dropped.
  let roleNote = null
  const duplicateRoles = (list) => {
    const firstOf = new Map()
    const extras = []
    for (const d of list) {
      const role = roleOf(byId.get(d.recipeId) || {})
      if (!SINGLETON_ROLES.has(role)) continue
      if (firstOf.has(role)) extras.push({ role, kept: firstOf.get(role), extra: d })
      else firstOf.set(role, d)
    }
    return extras
  }

  let dupes = duplicateRoles(plan.dishes)
  if (dupes.length > 0) {
    const named = dupes
      .map((x) => `"${x.extra.name || x.extra.recipeId}" and "${x.kept.name || x.kept.recipeId}" are both ${x.role}`)
      .join('; ')
    console.warn(`[thali:roles] rejected a plan — ${named}. Retrying once.`)
    try {
      const retry = await ask(`${prompt}

YOUR PREVIOUS ANSWER WAS REJECTED
${named}. A meal may contain at most one dish of each of these roles: ${[...SINGLETON_ROLES].join(', ')}.
Return the plan again with only one of them, choosing a dish of a different
role from the candidate list instead. If no other role is available, return the
shorter meal — fewer dishes is correct, a repeated role is not.`)
      const second = parseModelJson(retry)
      if (Array.isArray(second.dishes) && second.dishes.length > 0
        && duplicateRoles(second.dishes).length === 0) {
        plan = second
        dupes = []
      }
    } catch {
      // Falls through to dropping — a failed retry must not fail the plan.
    }
  }

  if (dupes.length > 0) {
    // Second attempt still doubled up: keep the first of each role and say so,
    // rather than silently serving two rice dishes as if that were the plan.
    const drop = new Set(dupes.map((x) => x.extra))
    plan = { ...plan, dishes: plan.dishes.filter((d) => !drop.has(d)) }
    const names = dupes.map((x) => x.extra.name || x.extra.recipeId)
    console.warn(`[thali:roles] retry still duplicated; dropped ${names.join(', ')}`)
    roleNote = `${names.join(' and ')} ${names.length === 1 ? 'was' : 'were'} left out — the plan had more than one ${[...new Set(dupes.map((x) => x.role))].join(' and ')} dish, and today's choices could not fill the gap.`
  }

  // The model is asked for memberIds but sometimes answers with names.
  // Accept either, and hand the client resolved {memberId, name} pairs so the
  // UI never has to guess.
  const memberIndex = new Map()
  for (const m of diners) {
    if (m.id) memberIndex.set(String(m.id).toLowerCase(), m)
    if (m.name) memberIndex.set(String(m.name).trim().toLowerCase(), m)
  }
  const resolveMember = (ref) => {
    const key = String(ref ?? '').trim().toLowerCase()
    const m = memberIndex.get(key)
    return m ? { memberId: m.id, name: m.name } : null
  }
  const attribution = (d) => buildAttribution(d, diners, resolveMember)

  // Five Thali Originals are written as pure cross-references ("Refer to
  // Recipe E001"). Following them here, where the whole database is in memory,
  // keeps recipes.json untouched and keeps the 1.8 MB of recipes out of the
  // browser bundle — the client just receives a dish that has ingredients.
  // Recipes a dish uses as ingredients — "2 cups marinara sauce", "16
  // falafel". Resolved here, where the whole database is in memory, and sent
  // with the dish: the browser rebuilds the shopping list from plan.dishes and
  // has no catalogue of its own to look them up in.
  const plannedIds = plan.dishes.map((d) => d.recipeId)

  const dishes = plan.dishes.map((d) => {
    const full = resolveRecipeRef(byId.get(d.recipeId), byId)
    const components = full ? resolveComponents(full, RECIPES, { skipIds: plannedIds }) : []
    return {
      recipeId: d.recipeId,
      name: full?.name || d.name,
      // Recomputed, never the model's own claim about what it returned.
      role: roleOf(full || {}) || d.role || '',
      why: d.why || '',
      ...attribution(d),
      // Always true now: a dish whose id is not in the catalogue is retried
      // and then dropped above, so nothing unknown reaches this point. Kept in
      // the response because it is the field a client would check, and it
      // should stay checkable if that guarantee ever weakens.
      known: Boolean(full),
      hindiName: full?.hindiName || '',
      category: full?.category || '',
      region: full?.region || '',
      serves: full?.serves ?? null,
      prepTimeMin: full?.prepTimeMin ?? null,
      cookTimeMin: full?.cookTimeMin ?? null,
      difficulty: full?.difficulty || null,
      caloriesPerServing: full?.caloriesPerServing ?? null,
      ingredients: full?.ingredients || '',
      preparation: full?.preparation || null,
      tips: full?.tips || null,
      hasFullPreparation: Boolean(full?.hasFullPreparation),
      source: full?.source || null,
      flags: full?.flags || null,
      // Sub-recipes this dish is built from. Cook Mode shows them as
      // "make this first"; the shopping list folds their ingredients in.
      components,
      // Cautions that must be displayed with the dish — a `partial` dish is
      // never presented to a diabetic as unconditionally safe.
      caveats: caveats.get(d.recipeId) || [],
      // Present only on a dish that points at another recipe. `modification`
      // is what the shopping list must flag; `prepNote` is what the cook has
      // to read before step 1. Neither is applied — see recipeRefs.js.
      ref: full?.ref || null,
    }
  })

  // ---- dessert ----
  //
  // Added alongside the meal, never in place of a savoury dish, and chosen
  // here rather than by the model: that guarantees exactly one, actually of
  // the dessert role, and drawn from `mains` — so it has already passed every
  // diet, allergen, religion and fasting check the rest of the plate passed.
  //
  // A `partial` diabeticFriendly dessert keeps its caveat, exactly as a
  // partial savoury dish does; a `no` one was excluded upstream for a member
  // who needs low-GI food and can never reach here.
  let dessertNote = null
  if (includeDessert) {
    // Whatever cuisine the meal actually ended up being, so the dessert
    // belongs to the same table.
    const dessertCuisine = selection.internationalCuisine || requestedCuisine
    const availability = dessertAvailability(mains, RECIPES, dessertCuisine, constraints)
    if (!availability.available) {
      dessertNote = availability.reason
    } else {
      const eligible = dessertsFor(mains, dessertCuisine)
      const onPlate = new Set(dishes.map((d) => d.recipeId))
      // Prefer one not already on the plate and not served recently; fall back
      // to the whole set rather than skipping the course over a repeat.
      const fresh = eligible.filter((r) => !onPlate.has(r.recipeId) && !recentRecipeIds.includes(r.recipeId))
      const pool = fresh.length > 0 ? fresh : eligible
      const choice = pool[Math.floor(Math.random() * pool.length)]
      if (choice) {
        const full = resolveRecipeRef(choice, byId)
        dishes.push({
          recipeId: full.recipeId,
          name: full.name,
          role: 'dessert',
          why: 'Added as the dessert for this meal.',
          servesMembers: diners.map((m) => ({ memberId: m.id, name: m.name })),
          excludedMembers: [],
          substitutes: [],
          known: true,
          hindiName: full.hindiName || '',
          category: full.category || '',
          region: full.region || '',
          serves: full.serves ?? null,
          prepTimeMin: full.prepTimeMin ?? null,
          cookTimeMin: full.cookTimeMin ?? null,
          difficulty: full.difficulty || null,
          caloriesPerServing: full.caloriesPerServing ?? null,
          ingredients: full.ingredients || '',
          preparation: full.preparation || null,
          tips: full.tips || null,
          hasFullPreparation: Boolean(full.hasFullPreparation),
          source: full.source || null,
          flags: full.flags || null,
          caveats: caveats.get(full.recipeId) || [],
          ref: full.ref || null,
          components: resolveComponents(full, RECIPES, { skipIds: [...onPlate, full.recipeId] }),
          isDessert: true,
        })
      }
    }
  }

  // Alternates for in-place dish swapping. Only the roles actually on the
  // plate, 12 each, so the payload stays around 70 KB instead of shipping the
  // whole 1.8 MB database to the browser.
  const planRoles = [...new Set(dishes.map((d) => roleOf(byId.get(d.recipeId) || {})))]
  const onPlate = new Set(dishes.map((d) => d.recipeId))
  const alternates = {}
  for (const role of planRoles) {
    alternates[role] = mains
      .filter((r) => roleOf(r) === role && !onPlate.has(r.recipeId))
      .slice(0, 12)
      .map((raw) => resolveRecipeRef(raw, byId))
      .map((r) => ({
        // An alternate can be swapped onto the plate, after which the client
        // rebuilds the shopping list and Cook Mode from it. Without its
        // components, swapping in the lasagne quietly loses the marinara.
        components: resolveComponents(r, RECIPES, { skipIds: plannedIds }),
        recipeId: r.recipeId,
        name: r.name,
        role,
        hindiName: r.hindiName || '',
        category: r.category || '',
        region: r.region || '',
        serves: r.serves ?? null,
        prepTimeMin: r.prepTimeMin ?? null,
        cookTimeMin: r.cookTimeMin ?? null,
        difficulty: r.difficulty || null,
        caloriesPerServing: r.caloriesPerServing ?? null,
        ingredients: r.ingredients || '',
        preparation: r.preparation || null,
        tips: r.tips || null,
        hasFullPreparation: Boolean(r.hasFullPreparation),
        source: r.source || null,
        flags: r.flags || null,
        known: true,
        why: '',
        caveats: caveats.get(r.recipeId) || [],
        ref: r.ref || null,
      }))
  }

  const possibleSwaps = swaps.slice(0, 12).map(({ recipe, modifications }) => ({
    recipeId: recipe.recipeId,
    name: recipe.name,
    category: recipe.category,
    prepTimeMin: recipe.prepTimeMin,
    hasFullPreparation: recipe.hasFullPreparation,
    modifications,
  }))

  // Members whose settings could not all be read. Not blocking — the strictest
  // rules were applied instead — but the meal is narrower than it should be
  // and the family should be told why rather than left to wonder.
  const unreadableSettings = constraints
    .filter((c) => c.unknownIds?.length > 0)
    .map((c) => ({ memberId: c.id, name: c.name, ids: c.unknownIds }))

  // The constraint work, made readable. Grouped and sampled from what
  // evaluateRecipe already decided — see src/lib/explainPlan.js.
  const explanation = buildExplanation(filtered, {
    cuisine: selection.internationalCuisine || requestedCuisine,
    mealType,
    eligible: selection.eligible,
    candidatesSent: candidates.length,
  })

  return res.status(200).json({
    explanation,
    unreadableSettings,
    // Set only when a dessert was asked for and could not be given, with the
    // reason. The UI shows it rather than quietly omitting the course.
    dessertNote,
    includeDessert,
    // Set only when a duplicate role survived the retry and a dish was
    // dropped. The UI shows it rather than presenting the short plan as if
    // nothing had happened.
    roleNote,
    // Same, for a dish the model invented. Shown in the same place and the
    // same style; both can be set at once.
    unknownNote,
    mealType,
    presentMembers: diners.map((m) => ({ memberId: m.id, name: m.name })),
    absentMembers: absent.map((m) => ({ memberId: m.id, name: m.name })),
    headcount,
    guestCount,
    guestSummary,
    guestNotes,
    date: date.toISOString(),
    dateLabel,
    activeFasts: activeLabels,
    dishes,
    perMemberNotes: plan.perMemberNotes || {},
    prepTimeTotalMin: Number(plan.prepTimeTotalMin) || null,
    // Computed from the recipes, not taken from the model: scaling by
    // totalDiners / recipe.serves is arithmetic, and the model scaled down
    // reliably but not up.
    // Built from `dishes`, not from the raw catalogue records. Those carry
    // the resolved cross-reference and the sub-recipes; re-reading byId threw
    // both away, so this list disagreed with the one the browser rebuilds from
    // the same dishes — and a D002-style dish aggregated the literal words
    // "Refer to Recipe J007".
    //
    // LOAD-BEARING, and not for the reason its name suggests. The browser
    // rebuilds this list itself, so nothing renders these strings — but the
    // shopping section's visibility is gated on this field's length, and
    // deleting it as redundant would silently delete the whole section.
    // See the guard in MealPlan.jsx and test/shopping-visibility.test.js.
    ingredientsAggregated: buildShoppingList(dishes, headcount),
    planSummary: plan.planSummary || '',
    possibleSwaps,
    alternates,
    meta: {
      model: MODEL,
      candidatesSent: candidates.length,
      headcount,
    guestCount,
    guestSummary,
    guestNotes,
      familySize: family.length,
      eligibleForMealType: selection.eligible,
      recentExclusionApplied: selection.excludedApplied,
      recentExcludedCount: recentRecipeIds.length,
      anyFasting,
      internationalCandidates: candidates.filter((c) => isInternational(c)).length,
      internationalCuisine: selection.internationalCuisine,
      candidateRoles: candidates.reduce((a, c) => {
        a[c.role] = (a[c.role] || 0) + 1
        return a
      }, {}),
      ...stats,
    },
  })
}
