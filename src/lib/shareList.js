// Sharing the shopping list to WhatsApp.
//
// wa.me with no phone number opens the app (mobile) or web.whatsapp.com
// (desktop) with the message pre-filled and lets the sender pick the
// recipient. No API, no auth, nothing server-side.

// wa.me passes the text through a URL. Very long lists risk being truncated
// by the browser or the OS handler, so cap and say what was left off rather
// than silently losing lines.
const MAX_MESSAGE_CHARS = 1800

/**
 * @param {string[]} lines      the final list, after pantry removal
 * @param {string}   mealType   'dinner' etc.
 * @param {string}   dateLabel  'Sunday, 30 August 2026'
 */
export function buildShareMessage(lines, mealType, dateLabel) {
  const items = (lines || []).filter((l) => String(l).trim())
  const header = [
    '\u{1F6D2} Thali shopping list',
    [mealType, dateLabel].filter(Boolean).join(', '),
  ].filter(Boolean).join(' — ')

  if (items.length === 0) return `${header}\n\nNothing to buy — it is all in the pantry.`

  const body = []
  let used = header.length + 2
  let dropped = 0
  for (const item of items) {
    const line = `• ${item}`
    if (used + line.length + 1 > MAX_MESSAGE_CHARS) { dropped += 1; continue }
    body.push(line)
    used += line.length + 1
  }
  const tail = dropped > 0 ? `\n\n…and ${dropped} more item${dropped === 1 ? '' : 's'}.` : ''
  return `${header}\n\n${body.join('\n')}${tail}`
}

/** wa.me link with the message encoded. No recipient — the sender chooses. */
export function whatsappUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
