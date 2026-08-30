// Swapping one dish out of a plan, without spending a model call.
//
// The plan response carries a pool of role-matched alternates that already
// passed the same constraint filter as the dishes on the plate. Swapping is
// therefore local: no network, no Gemini, no bundling the 1.8 MB recipe file
// into the browser.

/** Deterministic shuffle, so "show more options" pages instead of repeating. */
function seededShuffle(items, seed) {
  const out = [...items]
  let h = 0
  for (let i = 0; i < String(seed).length; i += 1) {
    h = (h * 31 + String(seed).charCodeAt(i)) % 2147483647
  }
  let state = h || 1
  const next = () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Alternates for one dish.
 *
 * @param {object[]} pool        role-matched candidates from the plan response
 * @param {object}   opts
 * @param {string[]} opts.excludeIds  recipes already on the plate
 * @param {string[]} opts.recentIds   recipes served in the last 5 meals
 * @param {number}   opts.count       how many to show (default 3)
 * @param {number}   opts.offset      paging cursor for "show more"
 * @param {string}   opts.seed        stable ordering key, usually the dish id
 * @returns {{ options, total, hasMore }}
 */
export function pickAlternatives(pool, {
  excludeIds = [], recentIds = [], count = 3, offset = 0, seed = '',
} = {}) {
  const exclude = new Set(excludeIds)
  const recent = new Set(recentIds)

  const eligible = (pool || []).filter((r) => !exclude.has(r.recipeId))
  // Recently served dishes sink to the back rather than vanishing — on a
  // narrow day they may be the only options left.
  const fresh = eligible.filter((r) => !recent.has(r.recipeId))
  const stale = eligible.filter((r) => recent.has(r.recipeId))
  const ordered = [...seededShuffle(fresh, seed), ...seededShuffle(stale, seed)]

  const start = offset % Math.max(ordered.length, 1)
  const options = ordered.slice(start, start + count)

  return {
    options,
    total: ordered.length,
    hasMore: ordered.length > start + count,
  }
}

/** Replace one dish in a plan's dish list, preserving order. */
export function swapDish(dishes, outgoingId, incoming) {
  return dishes.map((d) => (d.recipeId === outgoingId
    ? { ...incoming, role: incoming.role || d.role, servesMembers: d.servesMembers, excludedMembers: [], substitutes: [] }
    : d))
}
