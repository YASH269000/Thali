// Hands-free cook mode, on the browser's built-in SpeechRecognition.
//
// Free, no external service. Chrome and Safari expose it; Firefox does not,
// so every caller must handle isVoiceSupported() being false and keep the
// manual buttons working.

/** Command vocabulary. Longer phrases first so "next step" is not shadowed. */
export const COMMANDS = [
  {
    id: 'next',
    label: 'next step',
    phrases: ['next step', 'next', 'forward', 'continue', 'go on',
      'अगला स्टेप', 'अगला', 'आगे', 'नेक्स्ट', 'आगे बढ़ो'],
  },
  {
    id: 'previous',
    label: 'previous step',
    phrases: ['previous step', 'go back', 'previous', 'back',
      'पिछला', 'पीछे', 'वापस', 'बैक'],
  },
  {
    id: 'repeat',
    label: 'repeat step',
    phrases: ['read again', 'say again', 'repeat that', 'repeat', 'again', 'read it',
      'फिर से', 'दोबारा', 'दुबारा', 'दोहराओ', 'फिर से बोलो'],
  },
  {
    id: 'timer',
    label: 'start timer',
    phrases: ['start timer', 'set timer', 'timer',
      'टाइमर', 'टाइमर लगाओ', 'टाइमर चालू'],
  },
  {
    id: 'ingredients',
    label: 'ingredients',
    phrases: ['ingredients', 'show ingredients', 'what do i need',
      'सामग्री', 'सामान'],
  },
  {
    id: 'stop',
    label: 'stop listening',
    phrases: ['stop listening', 'stop', 'exit', 'quit', 'turn off',
      'बंद करो', 'बंद', 'रोको', 'रुको'],
  },
]

export function isVoiceSupported() {
  return typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

/**
 * Match a heard phrase to a command, or null.
 *
 * Word-boundary matched for Latin scripts so a passing "connects" does not
 * fire "next". Devanagari has no \b support in every engine, so those are
 * matched by substring — acceptable, since the phrases are distinctive.
 */
export function matchCommand(transcript) {
  const text = String(transcript || '').toLowerCase().trim()
  if (!text) return null
  for (const cmd of COMMANDS) {
    for (const phrase of cmd.phrases) {
      if (/^[\x20-\x7F]+$/.test(phrase)) {
        const re = new RegExp(`(?:^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'i')
        if (re.test(text)) return cmd.id
      } else if (text.includes(phrase)) {
        return cmd.id
      }
    }
  }
  return null
}

/**
 * Continuous recogniser with the restart and mute handling this needs.
 *
 * Two behaviours matter in a kitchen:
 *   - Chrome ends recognition after a pause; it is restarted automatically.
 *   - The microphone would otherwise hear the app's own text-to-speech and
 *     trigger itself, so callers mute() around speaking and unmute() after.
 */
export function createVoiceController({ lang = 'en-IN', onCommand, onStateChange, onError } = {}) {
  const Impl = typeof window !== 'undefined'
    && (window.SpeechRecognition || window.webkitSpeechRecognition)
  if (!Impl) {
    return {
      supported: false,
      start() {
        onError?.('Voice control is not available in this browser. Try Chrome on desktop or Android.')
      },
      stop() {}, mute() {}, unmute() {}, setLang() {}, isActive: () => false,
    }
  }

  let recognition = null
  let active = false
  let muted = false
  let currentLang = lang

  const build = () => {
    const r = new Impl()
    r.continuous = true
    r.interimResults = false
    r.maxAlternatives = 3
    r.lang = currentLang

    r.onresult = (event) => {
      if (muted) return
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result.isFinal) continue
        // Check every alternative: kitchen noise degrades the top pick.
        for (let a = 0; a < result.length; a += 1) {
          const heard = result[a].transcript
          const cmd = matchCommand(heard)
          if (cmd) {
            onCommand?.(cmd, heard.trim())
            return
          }
        }
      }
      // Anything unrecognised is ignored in silence — a kitchen is noisy.
    }

    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        active = false
        onStateChange?.(false)
        onError?.('Microphone permission was refused. Allow it in your browser to use hands-free mode.')
        return
      }
      onError?.(`Voice recognition error: ${e.error}`)
    }

    // Chrome stops after silence; keep it alive while hands-free is on.
    // recognition.lang is only read at start(), so re-apply it here: a
    // language changed mid-session takes effect on this restart.
    r.onend = () => {
      if (!active) return
      try {
        r.lang = currentLang
        r.start()
      } catch {
        // Already starting — the next onend will retry.
      }
    }
    return r
  }

  return {
    supported: true,
    start() {
      if (active) return
      active = true
      recognition = build()
      try {
        recognition.start()
        onStateChange?.(true)
      } catch (e) {
        active = false
        onStateChange?.(false)
        onError?.(e?.message || 'Could not start listening.')
      }
    },
    stop() {
      active = false
      muted = false
      try {
        recognition?.stop()
      } catch {
        // Nothing to stop.
      }
      recognition = null
      onStateChange?.(false)
    },
    // Muting rather than stopping: restarting the recogniser around every
    // spoken step is slow and drops the first word of the next command.
    mute() { muted = true },
    unmute() { muted = false },
    // Applied immediately where the engine allows it, and re-applied on the
    // next restart either way.
    setLang(next) {
      currentLang = next
      if (!active || !recognition) return
      recognition.lang = next
      try {
        recognition.stop() // onend restarts it with the new lang
      } catch {
        // Not running yet; the pending start() already carries currentLang.
      }
    },
    isActive: () => active,
  }
}
