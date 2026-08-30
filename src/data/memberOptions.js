import fastingData from './fastingTraditions.json'

/* ------------------------------------------------------------------ *
 * Options derived from the fasting database                           *
 * ------------------------------------------------------------------ */

// masterIndex has no ID column, so derive a stable, readable slug from the name.
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// The database labels Muslim traditions "Islam", and splits regional Hindu
// traditions into "Hindu (Regional)" / "Hindu (Kerala)". The app's religion
// enum (see CLAUDE.md) uses Muslim and a single Hindu, so fold them here.
const RELIGION_ALIASES = { Islam: 'Muslim' }

function appReligion(dbReligion) {
  const base = dbReligion.replace(/\s*\(.*\)\s*$/, '').trim()
  return RELIGION_ALIASES[base] || base
}

export const RELIGIONS = ['Hindu', 'Jain', 'Muslim', 'Sikh', 'Buddhist', 'none']

// { Hindu: [{ id, label, frequency, strictness, description }], ... }
export const FASTS_BY_RELIGION = fastingData.masterIndex.reduce((acc, row) => {
  const religion = appReligion(row.religion)
  const entry = {
    id: slugify(row.fastingTraditionName),
    label: row.fastingTraditionName,
    frequency: row.frequency,
    strictness: row.fastStrictnessLevel,
    description: row.briefDescription,
  }
  ;(acc[religion] = acc[religion] || []).push(entry)
  return acc
}, {})

// id -> label, for rendering chips on saved members.
export const FAST_LABEL = Object.values(FASTS_BY_RELIGION)
  .flat()
  .reduce((acc, f) => {
    acc[f.id] = f.label
    return acc
  }, {})

/* ------------------------------------------------------------------ *
 * Static option sets                                                  *
 * ------------------------------------------------------------------ */

export const DIET_OPTIONS = [
  { id: 'vegetarian', label: 'Vegetarian', description: 'No meat, fish or egg. Dairy is fine.' },
  { id: 'eggetarian', label: 'Eggetarian', description: 'Vegetarian, but eggs are allowed.' },
  { id: 'non_veg', label: 'Non-vegetarian', description: 'Eats meat, fish and egg.' },
  { id: 'jain', label: 'Jain', description: 'No root vegetables, no onion or garlic — always.' },
  { id: 'vegan', label: 'Vegan', description: 'No dairy, egg, honey or any animal product.' },
  { id: 'sattvic', label: 'Sattvic', description: 'No onion, garlic, or stimulants. Fresh and light.' },
]

export const HEALTH_OPTIONS = [
  { id: 'diabetes_t1', label: 'Diabetes (Type 1)' },
  { id: 'diabetes_t2', label: 'Diabetes (Type 2)' },
  { id: 'hypertension', label: 'High blood pressure' },
  { id: 'cholesterol', label: 'High cholesterol' },
  { id: 'pcod', label: 'PCOD / PCOS' },
  { id: 'thyroid', label: 'Thyroid' },
  { id: 'lactose_intolerant', label: 'Lactose intolerant' },
  { id: 'gluten_sensitive', label: 'Gluten sensitive' },
  { id: 'kidney_issues', label: 'Kidney issues' },
  { id: 'nut_allergy', label: 'Nut allergy' },
]

export const HEALTH_LABEL = HEALTH_OPTIONS.reduce((acc, h) => {
  acc[h.id] = h.label
  return acc
}, {})

export const DIET_LABEL = DIET_OPTIONS.reduce((acc, d) => {
  acc[d.id] = d.label
  return acc
}, {})

export const RELATIONSHIPS = [
  'Self', 'Spouse', 'Father', 'Mother', 'Son', 'Daughter',
  'Grandfather', 'Grandmother', 'Brother', 'Sister',
  'Father-in-law', 'Mother-in-law', 'Uncle', 'Aunt', 'Other',
]

export const CUISINES = [
  { id: 'no_preference', label: 'No preference' },
  { id: 'north_indian', label: 'North Indian' },
  { id: 'south_indian', label: 'South Indian' },
  { id: 'gujarati', label: 'Gujarati' },
  { id: 'maharashtrian', label: 'Maharashtrian' },
  { id: 'punjabi', label: 'Punjabi' },
  { id: 'bengali', label: 'Bengali' },
  { id: 'rajasthani', label: 'Rajasthani' },
  { id: 'kerala', label: 'Kerala' },
  { id: 'pan_indian', label: 'Pan-Indian' },
]

export const SPICE_LEVELS = ['None', 'Mild', 'Medium', 'Spicy', 'Very spicy']

export const LIFE_STAGE_LABEL = {
  toddler: 'Toddler',
  school_child: 'School child',
  teenager: 'Teenager',
  adult: 'Adult',
  pregnant: 'Pregnant',
  elderly: 'Elderly',
}

export const LIFE_STAGE_HINT = {
  toddler: 'Soft, low-spice, easily chewable food. Small portions.',
  school_child: 'Growing years — balanced, filling, mild spice.',
  teenager: 'High energy needs. Larger portions, more protein.',
  adult: 'Standard portions and spice tolerance.',
  pregnant: 'Extra iron, calcium and protein. Avoid raw and very spicy food.',
  elderly: 'Softer textures, less oil, lower salt, easy to digest.',
}

export function detectLifeStage(age) {
  // Number('') and Number('   ') are both 0, which would otherwise report an
  // empty age field as a toddler. Reject blank input before converting.
  if (age === null || age === undefined || String(age).trim() === '') return null
  const n = Number(age)
  if (!Number.isFinite(n) || n < 0) return null
  if (n <= 3) return 'toddler'
  if (n <= 12) return 'school_child'
  if (n <= 19) return 'teenager'
  if (n <= 59) return 'adult'
  return 'elderly'
}
