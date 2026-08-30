// Shared avatar presentation, so the "who is eating" list and the family
// cards render the same person identically.

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const AVATAR_TONES = 6

/** Deterministic tone per member, so a card keeps its colour across reloads. */
export function avatarTone(seed) {
  const s = String(seed || '')
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 997
  return h % AVATAR_TONES
}
