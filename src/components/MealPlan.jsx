import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadGuests, normaliseGuests, saveGuests } from '../lib/guests.js'
import { displayName } from '../lib/names.js'
import { pickAlternatives, swapDish } from '../lib/dishSwap.js'
import { applyPantry } from '../lib/shoppingList.js'
import { buildShoppingList } from '../lib/shoppingList.js'
import { loadPantry, savePantry } from '../lib/pantry.js'
import { lookupIngredient } from '../lib/ingredientGuide.js'
import CookMode from './CookMode.jsx'
import MultiDishCookMode from './MultiDishCookMode.jsx'
import WhoIsEating from './WhoIsEating.jsx'
import IngredientText from './IngredientPopover.jsx'
import Pantry from './Pantry.jsx'
import PerMemberDisplay from './PerMemberDisplay.jsx'
import './FamilyProfile.css'
import './MealPlan.css'

const STORAGE_KEY = 'thali_family'
const RECENT_KEY = 'thali_recent_meals'
const MEAL_TYPE_KEY = 'thali_meal_type'
const PRESENT_KEY = 'thali_present_members'
const CUISINE_KEY = 'thali_cuisine'
const RECENT_LIMIT = 5
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

const CUISINE_CHOICES = [
  { id: 'indian', label: 'Indian', hint: 'The usual thali' },
  { id: 'Indo-Chinese', label: 'Indo-Chinese', hint: 'Noodles, fried rice, manchurian' },
  { id: 'Italian', label: 'Italian', hint: 'Pasta, pizza, garlic bread' },
  { id: 'Continental', label: 'Continental', hint: 'Burgers, wraps, grills' },
  { id: 'surprise', label: 'Surprise me', hint: 'Pick a cuisine for us' },
]

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
function loadCuisine() {
  try {
    const v = window.sessionStorage.getItem(CUISINE_KEY)
    return CUISINE_CHOICES.some((c) => c.id === v) ? v : 'indian'
  } catch {
    return 'indian'
  }
}

function saveCuisine(v) {
  try { window.sessionStorage.setItem(CUISINE_KEY, v) } catch { /* not fatal */ }
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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.5l10 6.5-10 6.5z" fill="currentColor" />
    </svg>
  )
}

function loadFamily() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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

export default function MealPlan() {
  const navigate = useNavigate()
  const [family] = useState(loadFamily)
  const [mealType, setMealType] = useState(loadMealType)
  // Everyone is present by default — that is the common case; absence is the
  // exception worth a tap.
  const [present, setPresent] = useState(() => loadPresent(family) || family.map((m) => m.id))
  // 'meal' -> 'who' -> 'plan'. Nothing is generated before 'plan'.
  const [stage, setStage] = useState(() =>
    (loadMealType() && loadPresent(family)) ? 'plan' : 'meal')
  // Kept across reopens of the attendance screen, so unchecking one child
  // does not wipe a guest list the user just typed in.
  const [guests, setGuests] = useState(loadGuests)
  const [cuisine, setCuisine] = useState(loadCuisine)
  // Which cuisines today's constraints can actually furnish a meal from.
  const [cuisineInfo, setCuisineInfo] = useState(null)
  const [pantry, setPantry] = useState(loadPantry)
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

  const guestSignature = (list) => normaliseGuests(list)
    .map((g) => `${g.restriction}:${g.count}`).sort().join(',')

  const planKey = (type, ids, list, pick) =>
    `${type}|${[...ids].sort().join(',')}|${guestSignature(list)}|${pick}`

  useEffect(() => {
    if (family.length === 0) {
      navigate('/', { replace: true })
      return undefined
    }
    if (stage !== 'plan' || !mealType || present.length === 0) return undefined
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

  const chooseCuisine = (id) => {
    saveCuisine(id)
    setCuisine(id)
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
  const shopping = applyPantry(plan?.ingredientsAggregated || [], pantry, lookupIngredient)

  const updatePantry = (next) => {
    setPantry(next)
    savePantry(next)
  }

  const presentMembers = family.filter((m) => present.includes(m.id))
  const presentNames = presentMembers.map((m) => displayName(m.name))
  const planGuestCount = plan?.guestCount ?? 0
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
        {plan && <p className="today">{plan.dateLabel}</p>}
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
                  {CUISINE_CHOICES.map((c) => {
                    const offerable = c.id === 'indian' || c.id === 'surprise'
                      ? (c.id === 'indian' || cuisineInfo.offerable.length > 0)
                      : cuisineInfo.offerable.includes(c.id)
                    if (!offerable) return null
                    return (
                      <button key={c.id} type="button"
                        className={`cuisine-chip${cuisine === c.id ? ' is-on' : ''}`}
                        onClick={() => chooseCuisine(c.id)}
                        aria-pressed={cuisine === c.id}>
                        <span className="cuisine-chip-name">{c.label}</span>
                        <span className="cuisine-chip-hint">{c.hint}</span>
                      </button>
                    )
                  })}
                </div>
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

        {stage === 'plan' && loading && (
          <div className="loading-state" role="status" aria-live="polite">
            <p className="loading-title">Thinking through your family&rsquo;s kitchen&hellip;</p>
            <p className="loading-body">
              Checking today&rsquo;s fasts, every diet and every health condition
              against {family.length} {family.length === 1 ? 'member' : 'members'}.
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

        {stage === 'plan' && plan && !loading && (
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

            {plan.ingredientsAggregated?.length > 0 && (
              <>
                <h2 className="section-heading">Shopping list</h2>
                <p className="pantry-note">
                  Not shown: everyday staples (water, salt, oil, basic spices).
                  This list assumes you already have these.
                </p>
                <ul className="shopping-list">
                  {shopping.lines.length > 0
                    ? shopping.lines.map((item, i) => <li key={i}>{item}</li>)
                    : <li className="shopping-empty">Everything is already in your pantry.</li>}
                </ul>

                <Pantry items={pantry} onChange={updatePantry}
                  removedCount={shopping.removed.length} />
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
          {plan && !loading && plan.dishes.length > 1 && (
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
