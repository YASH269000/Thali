// Display-only name formatting. Stored data is never rewritten — people own
// how they typed their own name.

/**
 * "YASH" -> "Yash", "sumitra" -> "Sumitra", "DeSouza" -> "DeSouza".
 *
 * Only all-caps tokens are recased and only leading lowercase is lifted, so
 * deliberate interior capitals (McDonald, DeSouza, D'Souza) survive. A blanket
 * title-case would flatten those into "Mcdonald".
 */
export function displayName(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return s.split(/(\s+)/).map((token) => {
    if (/^\s+$/.test(token) || !token) return token
    const letters = token.replace(/[^A-Za-z]/g, '')
    if (letters.length > 1 && token === token.toUpperCase()) {
      // ALL CAPS: title-case each hyphen/apostrophe part ("RAM-KUMAR" -> "Ram-Kumar")
      return token.toLowerCase().replace(/(^|[-'’])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
    }
    return token.charAt(0).toUpperCase() + token.slice(1)
  }).join('')
}

/** "Yash, Vrinda and Binod" */
export function joinNames(names) {
  const list = names.filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}
