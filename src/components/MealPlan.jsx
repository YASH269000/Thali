import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  dinersLabel, guestHeadcount, loadGuests, normaliseGuests, saveGuests,
} from '../lib/guests.js'
import { displayName } from '../lib/names.js'
import { pickAlternatives, swapDish } from '../lib/dishSwap.js'
import {
  applyPantry, buildShoppingEntries, buildShoppingList, componentBatches,
  formatAmounts, listItemName, SUBSTITUTION_MARK,
} from '../lib/shoppingList.js'
import {
  BUY_WINDOWS, buyValue, editKey, heldReason, loadBuyEdits, loadBuyWindow,
  saveBuyEdits, saveBuyWindow, windowById,
} from '../lib/buyQuantities.js'
import { loadPantry, savePantry } from '../lib/pantry.js'
import { loadFamily } from '../lib/family.js'
import { familyIdWarnings } from '../lib/memberValidation.js'
import { buildShareMessage, whatsappUrl } from '../lib/shareList.js'
import CookMode from './CookMode.jsx'
import Clock from './Clock.jsx'
import Disclaimer from './Disclaimer.jsx'
import MultiDishCookMode from './MultiDishCookMode.jsx'
import WhoIsEating from './WhoIsEating.jsx'
import IngredientText from './IngredientPopover.jsx'
import Pantry from './Pantry.jsx'
import PerMemberDisplay from './PerMemberDisplay.jsx'
import './FamilyProfile.css'
import './MealPlan.css'

const RECENT_KEY = 'thali_recent_meals'
const MEAL_TYPE_KEY = 'thali_meal_type'
const PRESENT_KEY = 'thali_present_members'
const CUISINE_KEY = 'thali_cuisine'
const EXTRA_GUESTS_KEY = 'thali_extra_guests'
const RECENT_LIMIT = 5
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

// Labels and hints for the cuisines the database can produce. Which of them
// are actually offered comes from the API, not from this list — hardcoding a
// subset here previously hid Mexican, Thai and Middle Eastern from families
// who could eat them.
const CUISINE_META = {
  'Indo-Chinese': { label: 'Indo-Chinese', hint: 'Noodles, fried rice, manchurian' },
  Italian: { label: 'Italian', hint: 'Pasta, pizza, garlic bread' },
  Continental: { label: 'Continental', hint: 'Burgers, wraps, grills' },
  Mexican: { label: 'Mexican', hint: 'Tacos, burritos, nachos' },
  Thai: { label: 'Thai', hint: 'Curries, pad thai, jasmine rice' },
  'Middle Eastern': { label: 'Middle Eastern', hint: 'Hummus, falafel, shawarma' },
  'East Asian': { label: 'East Asian', hint: 'Sushi, ramen, bibimbap' },
}

// Display order, heaviest-ordered cuisine first.
const CUISINE_ORDER = [
  'Indo-Chinese', 'Italian', 'Continental', 'Mexican', 'Thai', 'Middle Eastern', 'East Asian',
]

const CUISINE_INDIAN = { id: 'indian', label: 'Indian', hint: 'The usual thali' }
const CUISINE_SURPRISE = { id: 'surprise', label: 'Surprise me', hint: 'Pick a cuisine for us' }

const KNOWN_CUISINE_IDS = ['indian', 'surprise', ...CUISINE_ORDER]

/** Cuisines that can furnish THIS meal type today, per the API. */
function offerableFor(cuisineInfo, mealType) {
  return (cuisineInfo?.byMeal?.[mealType] || [])
    .filter((o) => o.available)
    .map((o) => o.cuisine)
}

/** Indian always, then whatever the API says is offerable, then Surprise me. */
function cuisineChips(offerable = []) {
  const middle = CUISINE_ORDER
    .filter((c) => offerable.includes(c))
    .map((c) => ({ id: c, ...CUISINE_META[c] }))
  return [CUISINE_INDIAN, ...middle, ...(middle.length > 0 ? [CUISINE_SURPRISE] : [])]
}

const MEAL_HINTS = {
  breakfast: 'Light morning meal',
  lunch: 'Complete midday thali',
  dinner: 'Lighter evening meal',
}

// Survives a refresh so returning to the tab does not re-prompt, but a fresh
// session starts at the chooser rather than assuming dinner.
function loadMealType() {
  try {
    const v = window.sessionStorage.getItem(MEAL_TYPE_KEY)
    return MEAL_TYPES.includes(v) ? v : null
  } catch {
    return null
  }
}

function saveMealType(type) {
  try {
    window.sessionStorage.setItem(MEAL_TYPE_KEY, type)
  } catch {
    // Session storage unavailable — the chooser simply shows again next time.
  }
}

// Remembered attendance, validated against the family as it stands now: a
// member deleted since the last session must not linger in the selection.
// Identity of a plan: the inputs that determine it. Used both to skip a
// redundant regeneration and to tell whether the plan on screen still
// describes what the user currently has selected.
function guestSignature(list) {
  return normaliseGuests(list).map((g) => `${g.restriction}:${g.count}`).sort().join(',')
}

function planKey(type, ids, list, pick) {
  return `${type}|${[...ids].sort().join(',')}|${guestSignature(list)}|${pick}`
}

function loadCuisine() {
  try {
    const v = window.sessionStorage.getItem(CUISINE_KEY)
    return KNOWN_CUISINE_IDS.includes(v) ? v : 'indian'
  } catch {
    return 'indian'
  }
}

function saveCuisine(v) {
  try { window.sessionStorage.setItem(CUISINE_KEY, v) } catch { /* not fatal */ }
}

// Extra mouths at the table, for portions only. Separate from the guest
// groups on the who-screen: those carry dietary restrictions and change which
// dishes are chosen, and are already counted in plan.headcount. This number
// only multiplies quantities on the shopping list.
function loadExtraGuests() {
  try {
    const n = Number(window.sessionStorage.getItem(EXTRA_GUESTS_KEY))
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 0
  } catch {
    return 0
  }
}

function saveExtraGuests(n) {
  try { window.sessionStorage.setItem(EXTRA_GUESTS_KEY, String(n)) } catch { /* not fatal */ }
}

function loadPresent(family) {
  try {
    const raw = window.sessionStorage.getItem(PRESENT_KEY)
    const ids = raw ? JSON.parse(raw) : null
    if (!Array.isArray(ids)) return null
    const valid = ids.filter((id) => family.some((m) => m.id === id))
    return valid.length ? valid : null
  } catch {
    return null
  }
}

function savePresent(ids) {
  try {
    window.sessionStorage.setItem(PRESENT_KEY, JSON.stringify(ids))
  } catch {
    // Not fatal — attendance is asked again next session.
  }
}

// Flags worth surfacing as a badge when the dish actually satisfies them.
const BADGES = [
  ['ekadashiSafe', 'Ekadashi safe', 'chip-fast'],
  ['navratriSafe', 'Navratri safe', 'chip-fast'],
  ['jainSafe', 'Jain safe', 'chip-diet'],
  ['diabeticFriendly', 'Diabetic friendly', 'chip-health'],
  ['glutenFree', 'Gluten free', 'chip-health'],
  ['lactoseFree', 'Lactose free', 'chip-health'],
  ['vegan', 'Vegan', 'chip-diet'],
  ['onionGarlicFree', 'No onion/garlic', 'chip-diet'],
]

/* ------------------------------------------------------------------ *
 * Recently served dishes                                              *
 *                                                                     *
 * The last 5 generated plans, so the model can be told what the family
 * has already eaten. Read at call time rather than held in state: as a
 * dependency of the generate callback it would retrigger the effect
 * that writes it, and loop.
 * ------------------------------------------------------------------ */

function loadRecentMeals() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(-RECENT_LIMIT) : []
  } catch {
    return []
  }
}

function recentRecipeIds() {
  return [...new Set(loadRecentMeals().flatMap((m) => m.recipeIds || []))]
}

function rememberMeal(mealType, recipeIds) {
  try {
    const next = [...loadRecentMeals(), {
      mealType,
      at: new Date().toISOString(),
      recipeIds,
    }].slice(-RECENT_LIMIT)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable — variety tracking degrades, planning still works.
  }
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.6a9.3 9.3 0 00-8 14.1L3 22l5.5-1.4A9.3 9.3 0 1012 2.6z"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 8.2c.3-.1.6 0 .8.3l.8 1.3c.2.3.1.6-.1.8l-.5.5c-.1.2-.2.4 0 .6a6 6 0 002.3 2.3c.2.1.4 0 .6-.1l.5-.5c.2-.2.5-.3.8-.1l1.3.8c.3.2.4.5.3.8-.2.7-.9 1.3-1.7 1.3-2.9 0-6.6-3.7-6.6-6.6 0-.8.6-1.5 1.5-1.4z"
        fill="currentColor" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.5l10 6.5-10 6.5z" fill="currentColor" />
    </svg>
  )
}

function DishCard({ dish, onStartCooking, alternates, onSwap, recentIds }) {
  const [open, setOpen] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [offset, setOffset] = useState(0)
  const time = [dish.prepTimeMin, dish.cookTimeMin].filter((n) => typeof n === 'number')

  const picked = pickAlternatives(alternates, {
    excludeIds: [dish.recipeId],
    recentIds,
    offset,
    seed: dish.recipeId,
  })
  const totalTime = time.length ? time.reduce((a, b) => a + b, 0) : null

  return (
    <li className="dish-card">
      <div className="dish-head">
        <div>
          <p className="dish-name">{dish.name}</p>
          {dish.hindiName && <p className="dish-hindi">{dish.hindiName}</p>}
        </div>
        {dish.role && <span className="dish-role">{dish.role}</span>}
      </div>

      <p className="dish-meta">
        {[
          totalTime ? `${totalTime} min` : null,
          dish.difficulty,
          dish.region,
          typeof dish.caloriesPerServing === 'number' ? `${dish.caloriesPerServing} kcal` : null,
        ].filter(Boolean).join(' · ') || 'Timing not recorded'}
      </p>

      {dish.why && <p className="dish-why">{dish.why}</p>}

      <PerMemberDisplay dish={dish} />

      {(dish.caveats || []).length > 0 && (
        <div className="dish-caveats">
          {Object.entries((dish.caveats || []).reduce((acc, c) => {
            (acc[c.note] = acc[c.note] || []).push(displayName(c.member))
            return acc
          }, {})).map(([note, names]) => (
            <p key={note} className="dish-caveat">
              <span className="chip chip-health">{names.join(', ')}</span>
              {note}
            </p>
          ))}
        </div>
      )}

      <div className="chips">
        {BADGES.filter(([key]) => dish.flags?.[key]?.status === 'yes')
          .map(([key, label, cls]) => (
            <span key={key} className={`chip ${cls}`}>{label}</span>
          ))}
      </div>

      <div className="dish-actions">
        <button type="button" className="cook-btn" onClick={() => onStartCooking(dish)}>
          <PlayIcon /> Start cooking
        </button>
        <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}
          aria-expanded={open}>
          {open ? 'Hide recipe' : 'See full recipe'}
        </button>
        {picked.total > 0 && (
          <button type="button" className="link-btn swap-link"
            onClick={() => { setSwapping((v) => !v); setOffset(0) }}
            aria-expanded={swapping}>
            <SwapIcon /> Swap
          </button>
        )}
      </div>

      {swapping && (
        <div className="swap-picker">
          <p className="swap-prompt">Replace {dish.name} with:</p>
          {picked.options.length === 0 ? (
            <p className="swap-none">No other {dish.role || 'dish'} fits today&rsquo;s constraints.</p>
          ) : (
            <div className="swap-options">
              {picked.options.map((alt) => (
                <button key={alt.recipeId} type="button" className="swap-option"
                  onClick={() => { onSwap(dish.recipeId, alt); setSwapping(false) }}>
                  <span className="swap-option-name">{alt.name}</span>
                  <span className="swap-option-meta">
                    {[
                      alt.prepTimeMin != null && alt.cookTimeMin != null
                        ? `${alt.prepTimeMin + alt.cookTimeMin} min` : null,
                      alt.region,
                      alt.hasFullPreparation ? 'full recipe' : 'ingredients only',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="swap-actions">
            {picked.hasMore && (
              <button type="button" className="link-btn"
                onClick={() => setOffset((o) => o + 3)}>
                Show more options
              </button>
            )}
            <button type="button" className="link-btn swap-cancel"
              onClick={() => setSwapping(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="dish-detail">
          <h4>Ingredients</h4>
          <p>
            {dish.ingredients
              ? <IngredientText text={dish.ingredients} />
              : 'Not recorded for this recipe.'}
          </p>

          <h4>Preparation</h4>
          {dish.hasFullPreparation && dish.preparation ? (
            <ol className="steps">
              {dish.preparation
                .split(/STEP\s*\d+:\s*/i)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          ) : (
            <p className="detail-note">
              This recipe comes from the INDB (ICMR-NIN) nutrition database, which
              records ingredients and nutrition but no preparation steps. Cook it
              your usual way.
            </p>
          )}

          {dish.tips && (<><h4>Tips</h4><p>{dish.tips}</p></>)}
          {dish.source && <p className="detail-source">Source: {dish.source}</p>}
        </div>
      )}
    </li>
  )
}

/**
 * The ingredient name out of a "name — amount" line.
 *
 * Splits on the LAST separator, not the first: a name can carry one of its own
 * ("Onion (chopped fine — skip for Jain) — 1/2"). Parentheticals come off too,
 * because this is for a one-line summary, not the list itself.
 */

export default function MealPlan() {
  const navigate = useNavigate()
  const [family] = useState(loadFamily)
  const [mealType, setMealType] = useState(loadMealType)
  // Everyone is present by default — that is the common case; absence is the
  // exception worth a tap.
  const [present, setPresent] = useState(() => loadPresent(family) || family.map((m) => m.id))
  // 'meal' -> 'who' -> 'plan'. Nothing is generated before 'plan'.
  //
  // Always starts at 'meal', even when this session already has a meal type
  // and an attendance list saved. Resuming straight to 'plan' meant every
  // visit after the first generated immediately and never asked who was
  // eating — the step existed but you only ever saw it once, and "Change
  // who's eating" on the plan screen became the only way back to it. The
  // saved values are still loaded above; they now serve as pre-filled
  // defaults on the chooser rather than as a reason to skip it.
  const [stage, setStage] = useState('meal')
  // Kept across reopens of the attendance screen, so unchecking one child
  // does not wipe a guest list the user just typed in.
  const [guests, setGuests] = useState(loadGuests)
  const [cuisine, setCuisine] = useState(loadCuisine)
  // "Buy for" is a property of the shopping trip, not of one plan, so it and
  // any hand-edited quantities outlive a regeneration.
  const [buyWindow, setBuyWindow] = useState(loadBuyWindow)
  const [buyEdits, setBuyEdits] = useState(loadBuyEdits)
  // Which cuisines today's constraints can actually furnish a meal from.
  const [cuisineInfo, setCuisineInfo] = useState(null)
  const [pantry, setPantry] = useState(loadPantry)
  const [extraGuests, setExtraGuests] = useState(loadExtraGuests)
  // The planKey the plan currently in state was generated for. When the user
  // changes cuisine or meal, this no longer matches and the plan on screen is
  // known to be stale — so it is not shown as if it described the new choice.
  const [planKeyOf, setPlanKeyOf] = useState(null)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const inFlight = useRef(null)
  const [cookingDish, setCookingDish] = useState(null)
  const [wholeMeal, setWholeMeal] = useState(false)
  // Which meal type the current plan was generated for, so returning from the
  // chooser with the same choice costs nothing.
  const generatedFor = useRef(null)

  const generate = useCallback(async (type, ids, guestList, pick) => {
    // StrictMode double-invokes effects in dev; without this the screen would
    // fire two requests per view and burn the 10 RPM free-tier budget.
    if (inFlight.current) inFlight.current.abort()
    const controller = new AbortController()
    inFlight.current = controller

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          family,
          presentMembers: ids,
          guests: normaliseGuests(guestList || []),
          date: new Date().toISOString(),
          mealType: type,
          cuisine: pick,
          recentRecipeIds: recentRecipeIds(),
        }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data)
        setPlan(null)
      } else {
        setPlan(data)
        setPlanKeyOf(planKey(type, ids, guestList || [], pick))
        rememberMeal(type, data.dishes.map((d) => d.recipeId))
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError({ error: 'Could not reach the meal planner.', detail: err.message })
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null
        setLoading(false)
      }
    }
  }, [family])

  useEffect(() => {
    if (family.length === 0) {
      navigate('/', { replace: true })
      return undefined
    }
    if (stage !== 'plan') return undefined
    // Reaching 'plan' with nothing to plan for used to return here silently.
    // Nothing fetched, so `loading` stayed false and `planCurrent` false,
    // which left awaitingPlan true forever: a spinner with no request behind
    // it, no error and no timeout. Guests-only reached this every time —
    // confirm allowed it, and the server rejects an empty diner list anyway.
    // Any selection that cannot be planned now says why. The plan controls
    // above stay rendered, so "Change who's eating" is the way out.
    if (!mealType || present.length === 0) {
      // oxlint-disable-next-line react/set-state-in-effect
      setError(present.length === 0
        ? {
          error: 'Nobody from the family is eating this meal.',
          hint: 'Thali plans around your family\u2019s diets, health conditions and fasts, so at least one family member has to be eating. Use \u201cChange who\u2019s eating\u201d to pick someone.',
        }
        : { error: 'Choose a meal type first.' })
      return undefined
    }
    // Reopening a chooser and confirming the same meal and the same people
    // must not spend another Gemini call.
    if (generatedFor.current === planKey(mealType, present, guests, cuisine)) return undefined
    generatedFor.current = planKey(mealType, present, guests, cuisine)
    // Fetching is exactly the "synchronise with an external system" case
    // effects exist for; the setState inside is the request's loading flag.
    // oxlint-disable-next-line react/set-state-in-effect
    generate(mealType, present, guests, cuisine)
    return () => { if (inFlight.current) inFlight.current.abort() }
  }, [family.length, mealType, present, stage, guests, cuisine, generate, navigate])

  useEffect(() => {
    if (stage !== 'meal' || family.length === 0) return undefined
    let cancelled = false
    fetch('/api/cuisine-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family, presentMembers: present, guests: normaliseGuests(guests),
        date: new Date().toISOString(),
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCuisineInfo(d) })
      .catch(() => { if (!cancelled) setCuisineInfo(null) })
    return () => { cancelled = true }
  }, [stage, family, present, guests])

  // A cuisine saved from an earlier session can stop being offerable — someone
  // started a fast, a Jain guest joined. The chip already fell back to Indian
  // for display, but the request kept naming the old cuisine and the server
  // quietly planned Indian instead: the picker and the plan agreed only by
  // accident. Correcting the stored choice keeps one source of truth.
  useEffect(() => {
    if (!cuisineInfo) return
    const offerable = offerableFor(cuisineInfo, mealType)
    if (cuisineChips(offerable).some((c) => c.id === cuisine)) return
    saveCuisine('indian')
    // oxlint-disable-next-line react/set-state-in-effect
    setCuisine('indian')
  }, [cuisineInfo, cuisine, mealType])

  const chooseCuisine = (id) => {
    saveCuisine(id)
    setCuisine(id)
    // Changing cuisine on the chooser used to leave the user there with no
    // sign anything had happened: the generation effect is gated on
    // stage === 'plan', so nothing regenerated until they navigated back.
    // Returning to the plan lets it run immediately, loading state and all.
    if (plan) setStage('plan')
  }

  const chooseMeal = (type) => {
    saveMealType(type)
    setMealType(type)
    setStage('who')
  }

  const confirmWho = () => {
    savePresent(present)
    saveGuests(guests)
    setStage('plan')
  }

  const regenerate = () => {
    generatedFor.current = planKey(mealType, present, guests, cuisine)
    generate(mealType, present, guests, cuisine)
  }

  const changeWho = () => setStage('who')

  const handleSwap = (outgoingId, incoming) => {
    setPlan((prev) => {
      if (!prev) return prev
      const dishes = swapDish(prev.dishes, outgoingId, incoming)
      return {
        ...prev,
        dishes,
        // The list is computed from the recipes, so a swap recalculates it
        // exactly — no stale quantities from the dish that left.
        ingredientsAggregated: buildShoppingList(dishes, prev.headcount || 1),
      }
    })
  }

  // Shopping-list only: the pantry never touches meal generation, so a family
  // that already has paneer still gets paneer dishes suggested.
  // True only while the plan in state matches what is currently selected.
  // Both the thali visual and the shopping list read this same plan object,
  // which is why they went stale together.
  // A cuisine saved from an earlier session may not be offerable today; the
  // API already falls back to Indian, so reflect that in the picker.
  // Everything the picker shows is about the meal being planned, not a union
  // across all three. Indo-Chinese can furnish a Buddhist family a breakfast
  // and not a lunch; offering the chip on the strength of the breakfast, while
  // planning lunch, is how the request came to name a cuisine the server then
  // quietly dropped.
  const mealCuisines = cuisineInfo?.byMeal?.[mealType] || []
  const offerableNow = offerableFor(cuisineInfo, mealType)
  const unavailableNow = mealCuisines.filter((o) => !o.available && o.reason)
  // Offerable, but with no slack for this meal — the plan will be short and
  // says so here first.
  const thinCuisines = new Map(
    mealCuisines.filter((o) => o.thin && o.note).map((o) => [o.cuisine, o]),
  )

  const selectedCuisine = cuisineInfo
    && !cuisineChips(offerableNow).some((c) => c.id === cuisine)
    ? 'indian' : cuisine
  const selectedThinNote = thinCuisines.get(selectedCuisine)?.note || null

  // Cuisines that can be cooked from but cannot furnish a full meal of the
  // type being planned — a Buddhist member takes Indo-Chinese lunch from 47
  // dishes to 4. The plan would be honest and short; this warns first, so a
  // three-dish lunch is a choice rather than a surprise.
  const planCurrent = Boolean(plan) && planKeyOf === planKey(mealType, present, guests, cuisine)
  // A change is selected but its plan has not arrived yet.
  const awaitingPlan = stage === 'plan' && !error && (loading || !planCurrent)

  // Quantities are recomputed from the dishes rather than read off the plan,
  // so extra guests scale the list through the same serve-based arithmetic the
  // server uses — tempering, oil and ghee stay constant, as they do there.
  const baseServings = plan?.headcount || 1
  const totalServings = baseServings + extraGuests
  const baseEntries = plan?.dishes?.length
    ? buildShoppingEntries(plan.dishes, totalServings)
    : []

  const shopping = applyPantry(baseEntries, pantry)

  // What WhatsApp sends and what the copy count reports: the Buy figure, since
  // that is the number the shopper acts on.
  const shareLines = shopping.rows.map((row) => {
    const buy = buyValue(row, buyWindow, buyEdits)
    const mark = row.flagged ? ` ${SUBSTITUTION_MARK}` : ''
    return buy ? `${row.name} — ${buy}${mark}` : `${row.name}${mark}`
  })

  const changeBuyWindow = (id) => {
    setBuyWindow(id)
    saveBuyWindow(id)
  }

  const changeBuy = (row, value) => {
    const next = { ...buyEdits, [editKey(row, buyWindow)]: value }
    setBuyEdits(next)
    saveBuyEdits(next)
  }

  const resetBuy = (row) => {
    const next = { ...buyEdits }
    delete next[editKey(row, buyWindow)]
    setBuyEdits(next)
    saveBuyEdits(next)
  }

  // Dishes that borrow another recipe "with a modification". The note is
  // rendered against the list, and the affected line is marked inline too, so
  // the two cannot be read apart.
  const substitutions = (plan?.dishes || [])
    .filter((d) => d.ref?.modification)
    .map((d) => ({ dish: d.name, from: d.ref.targetName, text: d.ref.modification }))

  // Sub-recipes whose ingredients were folded into the list above. Said out
  // loud because the quantities are a batch of each: a curry that wants three
  // spoons of paste still needs a jar of paste made, and a list that grew by
  // twelve lines with no explanation reads like a bug.
  const componentNotes = componentBatches(plan?.dishes || [])

  // Named apart from setGuests, which owns the who-screen guest groups.
  const changeExtraGuests = (n) => {
    const next = Math.max(0, Math.min(50, Math.floor(n) || 0))
    setExtraGuests(next)
    saveExtraGuests(next)
  }

  const updatePantry = (next) => {
    setPantry(next)
    savePantry(next)
  }

  const presentMembers = family.filter((m) => present.includes(m.id))
  const presentNames = presentMembers.map((m) => displayName(m.name))
  const planGuestCount = plan?.guestCount ?? 0
  // Who this meal is being planned for, read from the attendance selection —
  // the same thing the header below reports and the who-screen button counted
  // all along. The loading copy used to read family.length instead, so a plan
  // for 2 of 4 announced itself as a plan for 4.
  //
  // Guests come from live state rather than plan.guestCount, because while the
  // first plan is still generating there is no plan to read, and on a
  // regeneration plan.guestCount is the previous plan's.
  const liveGuestCount = guestHeadcount(guests)
  // Shown wherever the meal is, not only on the Family screen — this is the
  // page where a narrower-than-expected plan would otherwise look arbitrary.
  const idWarnings = familyIdWarnings(presentMembers)
  const familyPart = presentMembers.length === family.length
    ? `${family.length} (family)`
    : `${presentMembers.length} of ${family.length} family`
  const attendanceLabel = planGuestCount > 0
    ? `Meal for ${familyPart} + ${planGuestCount} ${planGuestCount === 1 ? 'guest' : 'guests'} — ${presentMembers.length + planGuestCount} total`
    : (presentMembers.length === 1
      ? `Meal for ${presentNames[0]}`
      : `Meal for ${presentMembers.length} of ${family.length} (${presentNames.join(', ')})`)

  if (family.length === 0) return null

  return (
    <div className="thali">
      <header className="app-header">
        <div className="brand">
          <span className="logo">Thali</span>
          <p className="tagline">
            Your family&rsquo;s kitchen brain &mdash; one plan for everyone
          </p>
        </div>
        <p className="today">
          {plan && (
            <>
              {plan.dateLabel}
              <span className="today-sep" aria-hidden="true">&middot;</span>
            </>
          )}
          <Clock />
        </p>
      </header>

      <main className="content">
        {stage === 'plan' && (
          <div className="plan-controls">
            <div className="meal-toggle" role="group" aria-label="Meal type">
              {MEAL_TYPES.map((t) => (
                <button key={t} type="button"
                  className={`toggle-btn${mealType === t ? ' is-active' : ''}`}
                  onClick={() => chooseMeal(t)} disabled={loading}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div className="plan-links">
              <button type="button" className="link-btn change-meal"
                onClick={() => setStage('meal')} disabled={loading}>
                Change meal type
              </button>
              <button type="button" className="link-btn change-meal"
                onClick={changeWho} disabled={loading}>
                Change who&rsquo;s eating
              </button>
            </div>
          </div>
        )}

        {stage === 'meal' && (
          <section className="meal-chooser" aria-labelledby="chooser-heading">
            <h2 id="chooser-heading" className="chooser-title">
              What meal are you planning?
            </h2>
            <p className="chooser-sub">
              Thali plans one meal at a time, around everyone&rsquo;s constraints today.
            </p>
            <div className="chooser-grid">
              {MEAL_TYPES.map((t) => (
                <button key={t} type="button"
                  className={`chooser-card${mealType === t ? ' is-current' : ''}`}
                  onClick={() => chooseMeal(t)}>
                  <span className="chooser-card-name">{t[0].toUpperCase() + t.slice(1)}</span>
                  <span className="chooser-card-hint">{MEAL_HINTS[t]}</span>
                  {mealType === t && plan && (
                    <span className="chooser-card-tag">Already planned</span>
                  )}
                </button>
              ))}
            </div>
            {/* Hidden entirely when anyone is fasting: no international option
                exists on a fast day, so an all-disabled row would only puzzle. */}
            {cuisineInfo && !cuisineInfo.anyFasting && (
              <div className="cuisine-picker">
                <p className="cuisine-title">Which cuisine?</p>
                <div className="cuisine-row">
                  {cuisineChips(offerableNow).map((c) => (
                    <button key={c.id} type="button"
                      className={`cuisine-chip${selectedCuisine === c.id ? ' is-on' : ''}${thinCuisines.has(c.id) ? ' is-thin' : ''}`}
                      onClick={() => chooseCuisine(c.id)}
                      aria-pressed={selectedCuisine === c.id}>
                      <span className="cuisine-chip-name">{c.label}</span>
                      <span className="cuisine-chip-hint">
                        {thinCuisines.has(c.id)
                          ? `Only ${thinCuisines.get(c.id).count} dishes today`
                          : c.hint}
                      </span>
                    </button>
                  ))}
                </div>

                {selectedThinNote && (
                  <p className="cuisine-thin-note" role="status">{selectedThinNote}</p>
                )}

                {unavailableNow.length > 0 && (
                  <div className="cuisine-unavailable">
                    <p className="cuisine-unavailable-title">
                      Not available for this {mealType}
                    </p>
                    {unavailableNow.map((u) => (
                      <p key={u.cuisine} className="cuisine-unavailable-row">
                        <span className="chip chip-health">{u.cuisine}</span>
                        {u.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {cuisineInfo?.anyFasting && (
              <p className="cuisine-fasting-note">
                {cuisineInfo.activeFasts.join(', ')} today &mdash; the meal stays traditional Indian.
              </p>
            )}

            {plan && (
              <button type="button" className="link-btn chooser-back"
                onClick={() => setStage('plan')}>
                Back to the {mealType} plan
              </button>
            )}
            {/* The plan's action bar used to leak onto this screen through a
                `hidden` attribute that CSS was overriding, and its "Back to
                family" button was the only way off the chooser. With that
                leak fixed the way out has to be a real control. */}
            <button type="button" className="link-btn chooser-back"
              onClick={() => navigate('/')}>
              Back to family
            </button>
          </section>
        )}

        {stage === 'who' && (
          <WhoIsEating
            family={family}
            mealType={mealType || 'dinner'}
            selected={present}
            onChange={setPresent}
            guests={guests}
            onGuestsChange={(next) => { setGuests(next); saveGuests(next) }}
            onConfirm={confirmWho}
            onBack={() => setStage('meal')}
          />
        )}

        {awaitingPlan && (
          <div className="loading-state" role="status" aria-live="polite">
            <p className="loading-title">Thinking through your family&rsquo;s kitchen&hellip;</p>
            <p className="loading-body">
              Checking today&rsquo;s fasts, every diet and every health condition
              against {dinersLabel(presentMembers.length, liveGuestCount)}.
            </p>
          </div>
        )}

        {stage === 'plan' && error && !loading && (
          <div className="error-state" role="alert">
            <p className="error-title">{error.error || 'Something went wrong.'}</p>
            {error.hint && <p className="error-body">{error.hint}</p>}
            {error.detail && <p className="error-detail">{error.detail}</p>}
            <button type="button" className="btn btn-solid" onClick={regenerate}>
              Try again
            </button>
          </div>
        )}

        {stage !== 'meal' && idWarnings.length > 0 && (
          <div className="id-warning" role="alert">
            {idWarnings.map((w) => (
              <p key={w.memberId}>{w.message}</p>
            ))}
          </div>
        )}

        {stage === 'plan' && plan?.roleNote && planCurrent && !loading && (
          <p className="role-note" role="note">{plan.roleNote}</p>
        )}

        {/* A dish the model invented. Dropped on the server, because it has no
            ingredients, no method and no compliance flags — it passed none of
            the checks every other dish on the plate passed. Said out loud for
            the same reason the role note is. */}
        {stage === 'plan' && plan?.unknownNote && planCurrent && !loading && (
          <p className="role-note" role="note">{plan.unknownNote}</p>
        )}

        {stage === 'plan' && plan && planCurrent && !loading && (
          <>
            <p className="attendance">
              {attendanceLabel}
              {plan.meta?.internationalCuisine && (
                <span className="attendance-cuisine"> &middot; {plan.meta.internationalCuisine}</span>
              )}
            </p>

            {(plan.guestNotes || []).map((n) => (
              <div key={n.kind} className="guest-note">
                <span className="chip chip-stage">Guest constraint</span>
                <p>{n.message}</p>
              </div>
            ))}

            {plan.activeFasts?.length > 0 && (
              <div className="fast-banner">
                <span className="chip chip-fast">Active today</span>
                <p>{plan.activeFasts.join(' · ')}</p>
              </div>
            )}

            <section className="thali-visual" aria-label="Today's thali">
              <div className={`plate count-${Math.min(plan.dishes.length, 5)}`}>
                {plan.dishes.slice(0, 5).map((d) => (
                  <span key={d.recipeId} className="katori" title={d.name}>
                    <span className="katori-label">{d.name}</span>
                  </span>
                ))}
                <span className="plate-centre">{plan.mealType}</span>
              </div>
            </section>

            {plan.planSummary && <p className="plan-summary">{plan.planSummary}</p>}

            <div className="plan-stats">
              <span><strong>{plan.dishes.length}</strong> dishes</span>
              {plan.prepTimeTotalMin && <span><strong>{plan.prepTimeTotalMin}</strong> min total</span>}
              <span><strong>{plan.meta?.mains ?? 0}</strong> recipes qualified</span>
            </div>

            <h2 className="section-heading">The plan</h2>
            <ul className="dish-list">
              {plan.dishes.map((d) => (
                <DishCard key={d.recipeId} dish={d} onStartCooking={setCookingDish}
                  alternates={plan.alternates?.[d.role] || []}
                  recentIds={recentRecipeIds()}
                  onSwap={handleSwap} />
              ))}
            </ul>

            {Object.keys(plan.perMemberNotes || {}).length > 0 && (
              <>
                <h2 className="section-heading">Who eats what</h2>
                <ul className="notes-list">
                  {Object.entries(plan.perMemberNotes).map(([name, note]) => (
                    <li key={name} className="note-card">
                      <p className="note-name">{displayName(name)}</p>
                      <p className="note-body">{note}</p>
                    </li>
                  ))}
                  {planGuestCount > 0 && (
                    <li className="note-card is-guest">
                      <p className="note-name">
                        Guests &times; {planGuestCount}
                        {plan.guestSummary?.length > 0 && (
                          <span className="note-guest-detail"> ({plan.guestSummary.join(', ')})</span>
                        )}
                      </p>
                      <p className="note-body">
                        {(plan.guestNotes || []).map((n) => n.message).join(' ')
                          || 'Guests eat the same meal as the family — no separate cooking needed.'}
                      </p>
                    </li>
                  )}
                </ul>
              </>
            )}

            {/* Deliberately a different source from the rows below, and the two
                answer different questions. This one asks "did this meal need
                anything at all?", which only the unfiltered list can answer;
                shopping.rows asks "what is left after the pantry?".

                Collapsing them into one test would make "Everything is already
                in your pantry" unreachable — a family who owns every
                ingredient would get no section rather than the one message
                that tells them they are done. Asserted in
                test/shopping-visibility.test.js. */}
            {plan.ingredientsAggregated?.length > 0 && (
              <>
                <h2 className="section-heading">
                  Shopping list
                  {shopping.rows.length > 0 && (
                    <span className="heading-count">
                      &mdash; {shopping.rows.length}{' '}
                      {shopping.rows.length === 1 ? 'item' : 'items'}
                    </span>
                  )}
                </h2>
                {shopping.removed.length > 0 && (
                  <p className="hidden-note">
                    {shopping.removed.length}{' '}
                    {shopping.removed.length === 1 ? 'item' : 'items'} hidden
                    &mdash; already in your pantry
                  </p>
                )}
                <div className="portions">
                  <div className="portions-control">
                    <span className="portions-label">Guests coming</span>
                    <span className="portions-stepper">
                      <button type="button" aria-label="One fewer guest"
                        onClick={() => changeExtraGuests(extraGuests - 1)}
                        disabled={extraGuests === 0}>&minus;</button>
                      <span className="portions-n">{extraGuests}</span>
                      <button type="button" aria-label="One more guest"
                        onClick={() => changeExtraGuests(extraGuests + 1)}>+</button>
                    </span>
                    {extraGuests > 0 && (
                      <button type="button" className="link-btn portions-reset"
                        onClick={() => changeExtraGuests(0)}>Reset</button>
                    )}
                  </div>
                  <p className="portions-summary">
                    {extraGuests > 0
                      ? <>Quantities scaled for <strong>{totalServings}</strong>{' '}
                          &mdash; {baseServings} eating plus {extraGuests}{' '}
                          {extraGuests === 1 ? 'guest' : 'guests'}.</>
                      : <>Quantities are for <strong>{baseServings}</strong>{' '}
                          {baseServings === 1 ? 'person' : 'people'}.</>}
                  </p>
                </div>

                <p className="pantry-note">
                  Not shown: everyday staples (water, salt, oil, basic spices).
                  This list assumes you already have these.
                </p>
                {componentNotes.length > 0 && (
                  <div className="substitution-note" role="note">
                    <p>
                      Some of these dishes are made from other recipes, and the
                      list includes everything those need too:
                    </p>
                    <ul className="component-note-list">
                      {componentNotes.map((c) => (
                        <li key={`${c.dish}|${c.targetId}`}>
                          <strong>{c.dish}</strong> needs {c.ingredientLine || c.name}
                          {' '}&mdash; a batch of <strong>{c.name}</strong> is
                          {' '}included.
                        </li>
                      ))}
                    </ul>
                    <p>
                      A batch is scaled to the meal, not to the spoonful a dish
                      asks for, so you may have some left over.
                    </p>
                  </div>
                )}
                {substitutions.length > 0 && (
                  <div className="substitution-note" role="note">
                    {substitutions.map((sub) => (
                      <p key={sub.dish}>
                        <strong>{sub.dish}</strong> uses the{' '}
                        {sub.from || 'referenced'} recipe, with one change:{' '}
                        <em>{sub.text}</em>. Lines marked{' '}
                        <span className="substitution-mark">{SUBSTITUTION_MARK}</span>{' '}
                        below come from that recipe unchanged &mdash; check this
                        before you buy.
                      </p>
                    ))}
                  </div>
                )}
                {shopping.rows.length > 0 && (
                  <div className="buy-window">
                    <span className="buy-window-label" id="buy-window-label">Buy for</span>
                    <div className="buy-window-row" role="group" aria-labelledby="buy-window-label">
                      {BUY_WINDOWS.map((w) => (
                        <button key={w.id} type="button"
                          className={`buy-window-chip${buyWindow === w.id ? ' is-on' : ''}`}
                          onClick={() => changeBuyWindow(w.id)}
                          aria-pressed={buyWindow === w.id}>
                          {w.label}
                        </button>
                      ))}
                    </div>
                    {windowById(buyWindow).multiplier > 1 && (
                      <p className="buy-window-note">
                        Only things that keep are multiplied. Fresh produce, dairy
                        and herbs stay at the meal quantity, and so does anything
                        already covered by a sub-recipe batch.
                      </p>
                    )}
                  </div>
                )}

                {shopping.rows.length > 0 ? (
                  <ol className="shopping-list">
                    {shopping.rows.map((row, i) => {
                      const need = formatAmounts(row)
                      const held = windowById(buyWindow).multiplier > 1 ? heldReason(row) : ''
                      const edited = buyEdits[editKey(row, buyWindow)] !== undefined
                      return (
                        <li key={row.key} className={row.flagged ? 'is-flagged' : undefined}>
                          <span className="shopping-n" aria-hidden="true">{i + 1}.</span>
                          <div className="shopping-row">
                            <span className="shopping-item">
                              {row.name}
                              {row.flagged && (
                                <span className="substitution-mark"> {SUBSTITUTION_MARK}</span>
                              )}
                            </span>
                            <span className="shopping-qty">
                              <span className="shopping-need">
                                <span className="qty-label">Need</span>
                                {need || '\u2014'}
                              </span>
                              <label className="shopping-buy">
                                <span className="qty-label">Buy</span>
                                <input type="text" inputMode="text"
                                  className={`buy-input${edited ? ' is-edited' : ''}`}
                                  value={buyValue(row, buyWindow, buyEdits)}
                                  aria-label={`Buy quantity for ${row.name}`}
                                  onChange={(e) => changeBuy(row, e.target.value)} />
                                {edited && (
                                  <button type="button" className="buy-reset"
                                    onClick={() => resetBuy(row)}
                                    aria-label={`Reset buy quantity for ${row.name}`}>
                                    Reset
                                  </button>
                                )}
                              </label>
                            </span>
                            {held && <span className="shopping-held">{held}</span>}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="shopping-empty">Everything is already in your pantry.</p>
                )}

                <div className="share-row">
                  {shopping.rows.length > 0 ? (
                    <a className="btn share-btn"
                      href={whatsappUrl(buildShareMessage(
                        shareLines, plan.mealType, plan.dateLabel,
                      ))}
                      target="_blank" rel="noopener noreferrer">
                      <WhatsAppIcon /> Share on WhatsApp
                    </a>
                  ) : (
                    <button type="button" className="btn share-btn" disabled>
                      <WhatsAppIcon /> Nothing to buy
                    </button>
                  )}
                  <span className="share-note">
                    Shares the Buy quantities for {windowById(buyWindow).label.toLowerCase()}
                    {' '}&mdash; pantry items are left out.
                  </span>
                </div>

                <Pantry items={pantry} onChange={updatePantry}
                  removedNames={shopping.removed.map(listItemName)}
                  prepared={shopping.prepared}
                  matched={shopping.matched} />
              </>
            )}

            {plan.possibleSwaps?.length > 0 && (
              <>
                <h2 className="section-heading">Possible swaps</h2>
                <p className="section-sub">
                  Safe for everyone only after the change noted below. Kept out of
                  the main plan on purpose.
                </p>
                <ul className="swap-list">
                  {plan.possibleSwaps.map((s) => (
                    <li key={s.recipeId} className="swap-card">
                      <div className="swap-head">
                        <p className="dish-name">{s.name}</p>
                        {typeof s.prepTimeMin === 'number' && (
                          <span className="dish-role">{s.prepTimeMin} min</span>
                        )}
                      </div>
                      {s.modifications.map((m, i) => (
                        <p key={i} className="swap-mod">
                          <span className="chip chip-stage">{m.member}</span>
                          {m.changes.join('; ')}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        <div className="actions" hidden={stage !== 'plan'}>
          {plan && planCurrent && !loading && plan.dishes.length > 1 && (
            <button type="button" className="btn btn-cook btn-block"
              onClick={() => setWholeMeal(true)}>
              <PlayIcon /> Cook the whole meal
            </button>
          )}
          <button type="button" className="btn btn-solid btn-block"
            onClick={regenerate} disabled={loading}>
            {loading ? 'Generating…' : 'Regenerate'}
          </button>
          <button type="button" className="btn btn-dashed" onClick={() => navigate('/')}>
            Back to family
          </button>
        </div>
      </main>

      <Disclaimer />

      {wholeMeal && plan && (
        <MultiDishCookMode
          dishes={plan.dishes}
          onClose={() => setWholeMeal(false)}
          onStartDish={setCookingDish}
        />
      )}

      {cookingDish && (
        <CookMode dish={cookingDish} onClose={() => setCookingDish(null)} />
      )}
    </div>
  )
}
