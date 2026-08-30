// Finds time references inside a cooking step so the UI can offer an inline
// timer button exactly where the text mentions it.
//
// Handles the forms that actually appear in this recipe database:
//   "3 whistles"        -> 6 min   (1 whistle ≈ 2 minutes)
//   "10 minutes"        -> 10 min
//   "30 seconds"        -> 30 sec
//   "5-7 minutes"       -> 7 min   (a range takes its maximum)
//   "5-6 hours"         -> 6 hr    (soaking; flagged `long` so the UI can warn)

const UNIT_RE = /(\d+)\s*(?:\s*(?:[-–]|to)\s*(\d+))?\s*(whistles?|seetis?|minutes?|mins?\.?|seconds?|secs?\.?|hours?|hrs?\.?)\b/gi

const WHISTLE_MINUTES = 2
// An hour or more is a soak or a rest, not a countdown someone stands over.
// Those keep their text ("Soak in water for 5-6 hours") but get no button.
const LONG_THRESHOLD_SEC = 60 * 60

function unitKind(raw) {
  const u = raw.toLowerCase()
  if (u.startsWith('whistle') || u.startsWith('seeti')) return 'whistle'
  if (u.startsWith('hour') || u.startsWith('hr')) return 'hour'
  if (u.startsWith('min')) return 'minute'
  return 'second'
}

function toSeconds(kind, value) {
  if (kind === 'whistle') return value * WHISTLE_MINUTES * 60
  if (kind === 'hour') return value * 3600
  if (kind === 'minute') return value * 60
  return value
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Short button label, e.g. "6 min timer (3 whistles)" or "30 sec timer". */
export function timerLabel(timer) {
  const { seconds, kind, value } = timer
  let base
  if (seconds >= 3600) {
    const hrs = seconds / 3600
    base = `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} hr timer`
  } else if (seconds >= 60) {
    base = `${Math.round(seconds / 60)} min timer`
  } else {
    base = `${seconds} sec timer`
  }
  return kind === 'whistle'
    ? `${base} (${value} ${value === 1 ? 'whistle' : 'whistles'})`
    : base
}

/**
 * Split a step into renderable segments, so a timer button can sit inline
 * where the text mentions the time.
 * @returns {{ segments: Array, timers: Array, suppressedTimers: Array }}
 *   segments: [{ type: 'text', text } | { type: 'timer', timer }]
 *   suppressedTimers: durations >= 60 min — text is kept, no button offered.
 */
export function parseStep(stepText) {
  const text = String(stepText || '')
  const segments = []
  const timers = []
  const suppressedTimers = []
  let cursor = 0
  let index = 0

  UNIT_RE.lastIndex = 0
  let m = UNIT_RE.exec(text)
  while (m !== null) {
    const [matched, lowRaw, highRaw, unitRaw] = m
    const kind = unitKind(unitRaw)
    // A range takes its maximum: "5-7 minutes" means don't pull it at 5.
    const value = Math.max(Number(lowRaw), Number(highRaw || lowRaw))
    const seconds = toSeconds(kind, value)

    if (seconds > 0) {
      if (m.index > cursor) {
        segments.push({ type: 'text', text: text.slice(cursor, m.index) })
      }
      const timer = {
        id: `t${index}`,
        seconds,
        kind,
        value,
        matched,
        long: seconds >= LONG_THRESHOLD_SEC,
      }
      timer.label = timerLabel(timer)
      // The wording always survives; only the button is withheld for long waits.
      segments.push({ type: 'text', text: matched })
      if (timer.long) {
        suppressedTimers.push(timer)
      } else {
        segments.push({ type: 'timer', timer })
        timers.push(timer)
      }
      cursor = m.index + matched.length
      index += 1
    }
    m = UNIT_RE.exec(text)
  }

  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
  if (segments.length === 0) segments.push({ type: 'text', text })

  return { segments, timers, suppressedTimers }
}

/** Split a recipe's preparation blob into individual steps. */
export function splitSteps(preparation) {
  if (!preparation) return []
  return String(preparation)
    .split(/STEP\s*\d+\s*:\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}
