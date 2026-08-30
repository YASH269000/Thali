// What this family already has in the kitchen.
//
// Binary by design — see the note beside applyPantry in shoppingList.js.
// Persisted to localStorage rather than sessionStorage: a pantry is a
// property of the household, not of one planning session.

export const PANTRY_KEY = 'thali_pantry'

// Everyday things a household is likely to hold. Deliberately not the same
// list as the automatic staples filter in shoppingList.js: those (water,
// salt, turmeric) are assumed for everyone and never reach the list at all.
// These are worth asking about, because plenty of kitchens are out of them.
export const COMMON_PANTRY = [
  'Rice', 'Atta', 'Toor dal', 'Moong dal', 'Chana dal', 'Besan',
  'Onion', 'Tomato', 'Potato', 'Ginger', 'Garlic', 'Green chilli',
  'Milk', 'Curd', 'Paneer', 'Sugar', 'Tea', 'Coriander leaves',
]

export function loadPantry() {
  try {
    const raw = window.localStorage.getItem(PANTRY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function savePantry(items) {
  try {
    window.localStorage.setItem(PANTRY_KEY, JSON.stringify(items))
  } catch {
    // Storage unavailable — the pantry works for this session only.
  }
}
