// Thin wrapper over window.speechSynthesis.
//
// Voice availability is an OS matter, not a browser one: macOS ships good
// Indian-language voices, Windows often needs a language pack, and Chrome
// populates the voice list asynchronously. Everything here degrades to a
// clear reason string rather than failing silently, so cook mode can tell
// the user why nothing was spoken.

export const LANGUAGES = [
  { code: 'en-IN', label: 'English', native: 'English', geminiName: 'English' },
  { code: 'hi-IN', label: 'Hindi', native: 'हिन्दी', geminiName: 'Hindi' },
  { code: 'bn-IN', label: 'Bengali', native: 'বাংলা', geminiName: 'Bengali' },
  { code: 'ta-IN', label: 'Tamil', native: 'தமிழ்', geminiName: 'Tamil' },
  { code: 'te-IN', label: 'Telugu', native: 'తెలుగు', geminiName: 'Telugu' },
  { code: 'mr-IN', label: 'Marathi', native: 'मराठी', geminiName: 'Marathi' },
  { code: 'gu-IN', label: 'Gujarati', native: 'ગુજરાતી', geminiName: 'Gujarati' },
  { code: 'kn-IN', label: 'Kannada', native: 'ಕನ್ನಡ', geminiName: 'Kannada' },
]

export function languageByCode(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0]
}

export function isSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * Chrome fills getVoices() asynchronously and returns [] on first call.
 * Resolves once voices arrive, or after `timeout` with whatever exists.
 */
export function loadVoices(timeout = 1500) {
  return new Promise((resolve) => {
    if (!isSupported()) return resolve([])
    const existing = window.speechSynthesis.getVoices()
    if (existing.length) return resolve(existing)

    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.speechSynthesis.onvoiceschanged = null
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.onvoiceschanged = finish
    setTimeout(finish, timeout)
    return undefined
  })
}

/**
 * Best voice for a BCP-47 code: exact match, then same base language
 * (hi-IN falls back to any hi-*), else null.
 */
export function pickVoice(voices, code) {
  if (!voices?.length) return null
  const lower = code.toLowerCase()
  const base = lower.split('-')[0]
  return (
    voices.find((v) => v.lang?.toLowerCase() === lower) ||
    voices.find((v) => v.lang?.toLowerCase().replace('_', '-') === lower) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(`${base}-`)) ||
    voices.find((v) => v.lang?.toLowerCase() === base) ||
    null
  )
}

export function cancel() {
  if (isSupported()) window.speechSynthesis.cancel()
}

/**
 * Speak `text` in `code`.
 * @returns {Promise<{ok: boolean, reason?: string, voice?: string}>}
 *   ok:false with a reason the UI can show verbatim — never throws.
 */
export async function speak(text, code, { onEnd } = {}) {
  if (!isSupported()) {
    return { ok: false, reason: 'This browser does not support speech synthesis.' }
  }
  const clean = String(text || '').trim()
  if (!clean) return { ok: false, reason: 'Nothing to read.' }

  // Starting a new utterance while one is queued makes Chrome stall.
  window.speechSynthesis.cancel()

  const voices = await loadVoices()
  const voice = pickVoice(voices, code)
  const lang = languageByCode(code)

  // No voice for the requested language: speak the text with an English voice
  // rather than staying silent. The words are still the translated ones, so it
  // reads Hindi text with an English mouth — imperfect, but audible, and the
  // microphone keeps listening in the selected language regardless.
  if (!voice) {
    const fallback = pickVoice(voices, 'en-IN') || pickVoice(voices, 'en-US')
      || voices.find((v) => v.lang?.toLowerCase().startsWith('en'))
      || null

    if (!fallback) {
      return {
        ok: false,
        reason: `Voice not available for ${lang.label} on this device. Try installing more voices in your system settings.`,
      }
    }

    console.warn(
      `[Thali] No speech voice installed for ${lang.label} (${code}). ` +
      `Falling back to English voice "${fallback.name}" (${fallback.lang}). ` +
      'Voice recognition stays on ' + code + '.',
    )

    const fb = new window.SpeechSynthesisUtterance(clean)
    fb.voice = fallback
    fb.lang = fallback.lang || 'en-IN'
    fb.rate = 0.92
    fb.pitch = 1
    if (onEnd) {
      fb.onend = onEnd
      fb.onerror = onEnd
    }
    window.speechSynthesis.speak(fb)
    return {
      ok: true,
      voice: fallback.name,
      fellBackTo: fb.lang,
      requested: code,
      requestedLabel: lang.label,
    }
  }

  const utter = new window.SpeechSynthesisUtterance(clean)
  utter.voice = voice
  utter.lang = voice.lang || code
  utter.rate = 0.92 // a little slower than default; these are instructions
  utter.pitch = 1
  if (onEnd) {
    utter.onend = onEnd
    utter.onerror = onEnd
  }
  window.speechSynthesis.speak(utter)
  return { ok: true, voice: voice.name }
}

/** Which of LANGUAGES have a usable voice installed right now. */
export async function availableLanguages() {
  const voices = await loadVoices()
  return LANGUAGES.map((l) => ({ ...l, hasVoice: Boolean(pickVoice(voices, l.code)) }))
}

/** Short chime for timer completion — no asset file needed. */
export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return false
    const ctx = new Ctx()
    const now = ctx.currentTime
    // Two soft tones rather than one harsh beep.
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.28
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.6)
    })
    setTimeout(() => ctx.close?.(), 1600)
    return true
  } catch {
    return false
  }
}
