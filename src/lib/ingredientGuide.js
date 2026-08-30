// Finds Indian ingredients inside free-text ingredient lists so the UI can
// offer an explanation to someone who has never cooked this food before.

import GUIDE from '../data/ingredientSubstitutes.json' with { type: 'json' }

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// term -> dictionary key. Aliases resolve to the same entry.
const TERM_TO_KEY = new Map()
for (const [key, entry] of Object.entries(GUIDE)) {
  TERM_TO_KEY.set(key.toLowerCase(), key)
  for (const alias of entry.aliases || []) TERM_TO_KEY.set(alias.toLowerCase(), key)
}

// Longest first, so "kuttu ka atta" wins over "atta" and "moong dal" over "dal".
const TERMS = [...TERM_TO_KEY.keys()].sort((a, b) => b.length - a.length)

const MATCH_RE = new RegExp(`(?<![\\p{L}])(${TERMS.map(escapeRe).join('|')})(?![\\p{L}])`, 'giu')

export function lookupIngredient(term) {
  const key = TERM_TO_KEY.get(String(term || '').toLowerCase())
  return key ? { key, ...GUIDE[key] } : null
}

/**
 * Split text into plain and recognised-ingredient segments.
 * @returns {Array<{type:'text',text:string}|{type:'match',text:string,entry:object}>}
 */
export function annotateIngredients(text) {
  const raw = String(text || '')
  if (!raw) return []

  const segments = []
  let cursor = 0
  MATCH_RE.lastIndex = 0

  let m = MATCH_RE.exec(raw)
  while (m !== null) {
    const entry = lookupIngredient(m[1])
    if (entry) {
      if (m.index > cursor) segments.push({ type: 'text', text: raw.slice(cursor, m.index) })
      segments.push({ type: 'match', text: m[1], entry })
      cursor = m.index + m[1].length
    }
    m = MATCH_RE.exec(raw)
  }

  if (cursor < raw.length) segments.push({ type: 'text', text: raw.slice(cursor) })
  return segments.length ? segments : [{ type: 'text', text: raw }]
}

/** How many distinct dictionary entries appear in a piece of text. */
export function countKnownIngredients(text) {
  return new Set(
    annotateIngredients(text).filter((s) => s.type === 'match').map((s) => s.entry.key),
  ).size
}
