# Thali — Indian Family Meal Planner (Hackathon Project)

## What This Is
Thali is an AI meal planner for Indian joint families. Every family has members with different dietary constraints — one member is diabetic, another is fasting for Ekadashi, a third is Jain (no root vegetables), a toddler needs soft food, etc. Thali generates a single day's meal plan that works for everyone from one kitchen.

## The Killer Feature
Thali is calendar-aware. It knows when Hindu Ekadashi falls, when Jain Paryushana runs, when Ramadan is active. It auto-switches meal plans based on today's date.

## Tech Stack
- React (Vite)
- Plain CSS (no Tailwind, no component libraries — keep it minimal)
- LocalStorage for persistence (no backend for MVP)
- Google Gemini API — model `gemini-3.6-flash` — for meal plan generation
  (free tier: 10 RPM / 1500 RPD / 1M token context.
   Gemini 1.5, 2.0 and 2.5 are retired — 3.6 Flash is current as of Aug 2026.)
  SDK: @google/generative-ai. Server-side only, in api/generate-plan.js.
- Deployed on Vercel

## Style Guide
- Font: system fonts (-apple-system, Segoe UI, Roboto, sans-serif)
- Background: warm off-white (#fafaf7)
- Text: near-black (#1a1a1a) with muted gray (#6b6b66)
- Chips for tags: green for diet, pink for health, amber for fasts, purple for life stage
- Rounded corners: 8px for buttons, 12px for cards
- Border style: 0.5px solid #e5e5e0 (very subtle)
- No emoji anywhere. No gradients. No drop shadows.

## Data Structure
Every family member is a JavaScript object:
{
  id: string (timestamp),
  name: string,
  age: number,
  relationship: string,
  diet: 'vegetarian' | 'eggetarian' | 'non_veg' | 'jain' | 'vegan' | 'sattvic',
  health: array of health condition IDs,
  fasts: array of fasting tradition IDs,
  religion: 'Hindu' | 'Jain' | 'Muslim' | 'Sikh' | 'Buddhist' | 'none',
  cuisine: cuisine preference ID,
  spiceLevel: 0-4,
  dislikes: string,
  lifeStage: 'toddler' | 'school_child' | 'teenager' | 'adult' | 'pregnant' | 'elderly'
}

## Fasting Traditions Supported
Hindu: Ekadashi, Navratri, weekly fasts (Monday-Saturday), Karwa Chauth, Chhath, Shivratri, Janmashtami, Pradosh, Sankashti
Jain: Paryushana, Navpad Oli, Ekasana, Upvas, Chaturdashi. Jain diet also permanently excludes all root vegetables.
Muslim: Ramadan, Ashura, Arafah, Shawwal, Monday/Thursday Sunnah
Sikh: Gurpurab (langar-style, no fasting)
Buddhist: Uposatha, Vesak

## Cook Mode
Voice-guided cooking that turns Thali into a teacher for people who cannot cook.
- Full-screen overlay launched from any dish card ("Start cooking"), and a
  meal-wide timeline from "Cook the whole meal".
- One step at a time, 26px text, 56px+ tap targets for wet or floury hands.
- Read aloud via window.speechSynthesis in 8 languages (English, Hindi, Bengali,
  Tamil, Telugu, Marathi, Gujarati, Kannada). Voice availability is an OS matter:
  if no voice is installed the translated text still shows, with an explanation.
- Non-English steps are translated on demand through the Gemini endpoint and
  cached in component state per {recipeId, stepIndex, language}.
- Time references in a step ("3 whistles", "5-7 minutes", "30 seconds") become
  inline timer buttons. 1 whistle = 2 minutes; a range takes its maximum.
- INDB recipes (hasFullPreparation: false) offer AI-generated steps on request.
- Keyboard: right arrow next, left arrow previous, space read aloud, Esc close.

## Timing Fasts
Traditions that move the meals rather than narrowing the pool live in
`src/lib/timingFasts.js`; times come from `src/lib/times.js`, computed live for
the family's city.
- mealCount answers HOW MANY times someone eats; a timing tradition answers
  WHEN and what the slots are called. `nirjala`/`nirahar` already meant "none of
  the standard three", so there is no tiebreaker and none should be added.
- A slot is a mealType: it needs a `MEAL_TARGET` entry and a `SLOT_SHAPE`, or it
  silently takes dinner's dish count and the whole pool.
- An unknown mealType is a 400, never a coerced dinner.
- Print the city beside every time. Never precompute a time for Delhi.
- A container tradition (Chhath Puja Vrat) expands to its days via
  `expandFasts`. Anything looking up who keeps a slot must expand first, or the
  meal comes back with an empty guest list.
- A window can OPEN at its slot rather than close at it — Kharna and Nirjala
  Ekadashi both do. A tradition with a real fast and no meal (Sandhya Arghya)
  belongs in `WINDOW_ONLY_FASTS` rather than being given an invented occasion.

## Theravada Dates
Vesak, Asalha Puja, Magha Puja and Vassa are `provisional`, not `computed`.
The astronomy is exact; the Theravada calendars intercalate differently from
the Indian rule and are not modelled here, so the divergence is a MONTH. Never
raise their confidence without modelling that calendar — see DATA-ISSUES.md.

## Location
`thali_location` holds one of the eight cities in `panchanga/locations.js`,
default Delhi. `src/lib/location.js` is the only reader.
- Sunrise, sunset and moonrise are local and must be computed for it — moonrise
  differs by 74 minutes between Kolkata and Mumbai on Karva Chauth 2026.
- TITHI DATES STAY DELHI'S. `observancesOn` takes no location and must never
  learn to; a second source of dates is how two screens start disagreeing.
  14 of 352 dates fall a day apart across the eight cities — the generator
  records where, and the family is ASKED through the existing confirmation
  prompt and the existing override slot.
- Print the city beside any time: "Moonrise in Mumbai, 8:56 PM".

## Ingredient Rules
Traditions the nine compliance flags cannot express carry keyword lists in
`src/lib/ingredientRules.js` — Ekadashi/Navratri, Jain/Paryushana/Das Lakshana,
Sawan. Evaluated with the PANTRY matcher (`splitIngredients` →
`parseIngredient` → `matchPantryLine`); never write a second matcher.
- `forbidden` excludes; `swaps` annotates a servable dish. Bare "salt" is a
  swap, not an exclusion — most bare-salt rows are nutrition-database imports.
- No rule may name turmeric or ginger: the canonicaliser strips `fresh`, so
  the keyword matches powdered haldi. See docs/DATA-ISSUES.md before touching
  that — it excluded 31 correctly-flagged recipes.
- A rejection names the tradition the MEMBER keeps (`keptAs`), not the rule
  set's label — one rule set serves Ekadashi and Navratri both.
- Where a rule and a compliance flag disagree, THE RULE WINS AND THE FLAG GETS
  CORRECTED, with the evidence in the flag's own `note`. Never leave a standing
  disagreement: it is how a future reader concludes the flag is authoritative.
  `test/ingredient-rules.test.js` sweeps both fast flags across pulse, grain,
  allium and fermented and fails if any recipe disagrees.

## User-Editable Dates
`thali_observance_dates` holds a family's own answers, one slot per
`observanceId@date`, and exactly one of four mutually exclusive answers:
`confirmed` / `movedTo` / `removed` / `added`. `setAnswer` in
`src/lib/observanceOverrides.js` is the single writer and replaces rather than
merges — that is why a confirmation prompt and a manual edit cannot disagree.
Never add a second store or a merging writer.
- A user date overrides the DATE only. Name, religion, fast ids and food rules
  are cloned from `templateFor(id)`, never supplied by the family.
- The prompt asks about `computed_unstable` AND `provisional` dates, in
  different words — a tithi boundary and a moon sighting are not the same doubt.
- `ObservanceDates.jsx` on the family screen is the add/edit/remove surface.

## Per-Person Observance
A tradition states the strictest baseline; a member varies it per fast, stored
sparsely in `member.observances[fastId]` as `{ mealCount, alliumScope,
observesLightly }`. See `src/lib/observanceProfile.js`.
- The shared meal is generated against the STRICTEST observer present. Looser
  members get additive suggestions on their own plate, never a relaxation of
  the shared dishes. This is structural: `requiredFlags` in mealPlanRules is a
  Set that only ever gets `.add()`, and there is no `.delete()` anywhere. Never
  add one.
- `mealCount` is attendance, not dish logic — it pre-selects the who's-eating
  checkboxes and says why. The checkbox is still the manual override.
- `observesLightly` is a health exemption the family records; it is only
  offered where a condition or life stage warrants it, and it subtracts only
  from its own member's contribution.

## Non-Negotiables
- Every UI action must work on both mobile and desktop
- Data persists in localStorage as 'thali_family'
- No user login required — anyone can use the app immediately
- When the Gemini API is called, always show a loading state
- API keys use the AQ.xxx format (2026). The older AIza... format is legacy;
  never assume a prefix when validating a key.
- Never call the Gemini API from the browser. The API key must never reach client-side
  code, where any visitor can read it. All Gemini calls go through a Vercel serverless
  function (e.g. /api/plan.js) with the key held in a server-side environment variable.
- Every screen must be reachable from a main navigation
- All Gemini work goes through api/generate-plan.js (planning) or
  api/cook-assist.js (translate / generate-steps / sequence). Never from the client.
- Every tithi-derived date comes from the panchanga/ engine, via the generated
  src/data/observances.json (regenerate with `npm run calendar`). Never hand-type
  a lunar date into src/data/fastingTraditions.json — the curated table there is
  only for what no rule decides: Jain sect calendars and Sikh Gurpurabs. Islamic
  dates are arithmetic and marked provisional. Precedence is user override >
  curated > computed, and test/panchanga-source-of-truth.test.js enforces the shape.

## Deployment Target
Vercel free tier. Push to GitHub, connect to Vercel, auto-deploys.

## Hackathon Deadline
September 6, 2026 at 10 PM IST. Prioritize working demo over perfection.
