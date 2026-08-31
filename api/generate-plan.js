// POST /api/generate-plan
//
// Body: { family: Member[], date?: ISO string, mealType?: 'breakfast'|'lunch'|'dinner' }
//
// Deploys unchanged as a Vercel serverless function. In local development the
// same default export is driven by a Vite middleware (see vite.config.js), so
// `npm run dev` serves this route without the Vercel CLI.

import { GoogleGenerativeAI } from '@google/generative-ai'
import { activeFastIdsOn, calendarNotesOn, foodRulesFor } from '../src/lib/fastingRules.js'
import { compactForPrompt, filterRecipes, roleOf, selectCandidatesForMeal } from '../src/lib/mealPlanRules.js'
import { buildShoppingList } from '../src/lib/shoppingList.js'
import { findRefContradictions, resolveRecipeRef } from '../src/lib/recipeRefs.js'
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
  const shape = MEAL_SHAPE[mealType] || MEAL_SHAPE.dinner

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

  const recentRecipeIds = Array.isArray(body.recentRecipeIds)
    ? body.recentRecipeIds.filter((x) => typeof x === 'string').slice(0, 60)
    : []
  const date = body.date ? new Date(body.date) : new Date()
  if (Number.isNaN(date.getTime())) {
    return res.status(400).json({ error: `Invalid date: ${body.date}` })
  }

  // ---- constraints and filtering (deterministic, before any model call) ----
  const activeFastIds = activeFastIdsOn(date)
  const { mains, swaps, constraints, stats, caveats } = filterRecipes(
    RECIPES, [...diners, ...guestMembers], activeFastIds,
  )

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
      .filter((c) => c.source === 'International')
      .map((c) => `${c.name} (${c.category})`),
    calendarNotes: calendarNotesOn(date),
    foodRules: foodRulesFor(activeLabels),
    candidates,
  })

  // ---- model call ----
  let raw
  try {
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
    const result = await model.generateContent(prompt)
    raw = result.response.text()
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
  const dishes = plan.dishes.map((d) => {
    const full = resolveRecipeRef(byId.get(d.recipeId), byId)
    return {
      recipeId: d.recipeId,
      name: full?.name || d.name,
      role: d.role || '',
      why: d.why || '',
      ...attribution(d),
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
      // Cautions that must be displayed with the dish — a `partial` dish is
      // never presented to a diabetic as unconditionally safe.
      caveats: caveats.get(d.recipeId) || [],
      // Present only on a dish that points at another recipe. `modification`
      // is what the shopping list must flag; `prepNote` is what the cook has
      // to read before step 1. Neither is applied — see recipeRefs.js.
      ref: full?.ref || null,
    }
  })

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

  return res.status(200).json({
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
    ingredientsAggregated: buildShoppingList(
      dishes.map((d) => byId.get(d.recipeId)).filter(Boolean),
      headcount,
    ),
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
      internationalCandidates: candidates.filter((c) => c.source === 'International').length,
      internationalCuisine: selection.internationalCuisine,
      candidateRoles: candidates.reduce((a, c) => {
        a[c.role] = (a[c.role] || 0) + 1
        return a
      }, {}),
      ...stats,
    },
  })
}
