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
