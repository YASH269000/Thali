import { splitSteps } from './timerParser.js'

/* ------------------------------------------------------------------ *
 * Session cache for sequences                                         *
 *                                                                     *
 * Module scope on purpose: the component unmounts when cook mode is
 * closed, so component state would lose the cache the moment the user
 * backed out. Keyed on the sorted recipe ids, so the same meal hits the
 * cache regardless of dish order. Cleared on page reload.
 * ------------------------------------------------------------------ */

const sequenceCache = new Map()

export function sequenceCacheKey(dishes) {
  return dishes.map((d) => d.recipeId).sort().join('|')
}

export function clearSequenceCache() {
  sequenceCache.clear()
}

/**
 * Cached sequence lookup. `fetchImpl` is injectable so the cache behaviour
 * can be tested without a network.
 * @returns {Promise<{data, cached: boolean}>}
 */
export async function getSequence(dishes, fetchImpl = fetch, { signal } = {}) {
  const key = sequenceCacheKey(dishes)
  if (sequenceCache.has(key)) return { data: sequenceCache.get(key), cached: true }

  const res = await fetchImpl('/api/cook-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      task: 'sequence',
      dishes: dishes.map((d) => ({
        recipeId: d.recipeId,
        name: d.name,
        prepTimeMin: d.prepTimeMin,
        cookTimeMin: d.cookTimeMin,
        steps: d.hasFullPreparation ? splitSteps(d.preparation) : [],
        ingredients: String(d.ingredients || '').slice(0, 300),
      })),
    }),
  })
  const data = await res.json()
  // Only successful sequences are cached; an error should be retryable.
  if (data?.sequence) sequenceCache.set(key, data)
  return { data, cached: false }
}
