import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration, parseStep, splitSteps } from '../lib/timerParser.js'
import { LANGUAGES, cancel as cancelSpeech, languageByCode, playChime, speak } from '../lib/speech.js'
import { createVoiceController, isVoiceSupported } from '../lib/voiceControl.js'
import IngredientText from './IngredientPopover.jsx'
import './CookMode.css'

/* ------------------------------------------------------------------ *
 * Icons — inline SVG, because the style guide forbids emoji           *
 * ------------------------------------------------------------------ */

const Icon = ({ d, filled = false }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={d} fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const PlayIcon = () => <Icon d="M8 5.5l10 6.5-10 6.5z" filled />
const SpeakerIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" />
    <path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)
const CloseIcon = () => <Icon d="M6 6l12 12M18 6L6 18" />
const PrevIcon = () => <Icon d="M14.5 6l-6 6 6 6" />
const NextIcon = () => <Icon d="M9.5 6l6 6-6 6" />
const ChevronUp = () => <Icon d="M6.5 14.5l5.5-5 5.5 5" />

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Ingredients                                                         *
 * ------------------------------------------------------------------ */

// Thali Originals separate with commas (but use commas inside parentheses
// too, as in "2 potatoes (boiled, cubed)"); INDB rows use semicolons.
function splitIngredients(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  if (raw.includes(';')) return raw.split(';').map((s) => s.trim()).filter(Boolean)

  const out = []
  let depth = 0
  let current = ''
  for (const ch of raw) {
    if (ch === '(') depth += 1
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/* ------------------------------------------------------------------ *
 * Countdown overlay                                                   *
 * ------------------------------------------------------------------ */

function TimerOverlay({ timer, onClose }) {
  const [remaining, setRemaining] = useState(timer.seconds)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const started = Date.now()
    const id = setInterval(() => {
      const left = timer.seconds - Math.floor((Date.now() - started) / 1000)
      if (left <= 0) {
        setRemaining(0)
        setDone(true)
        clearInterval(id)
        playChime()
        try {
          if (window.Notification?.permission === 'granted') {
            new window.Notification('Thali timer', { body: `${timer.label} is done.` })
          }
        } catch {
          // Notifications unavailable — the chime is the fallback.
        }
      } else {
        setRemaining(left)
      }
    }, 250)
    return () => clearInterval(id)
  }, [timer])

  const pct = timer.seconds ? ((timer.seconds - remaining) / timer.seconds) * 100 : 100

  return (
    <div className="timer-overlay" role="dialog" aria-label="Cooking timer">
      <div className="timer-box">
        <p className="timer-caption">{timer.label}</p>
        <p className={`timer-clock${done ? ' is-done' : ''}`}>
          {done ? 'Done' : formatDuration(remaining)}
        </p>
        <div className="timer-bar"><span style={{ width: `${pct}%` }} /></div>
        <button type="button" className="ck-btn ck-btn-solid" onClick={onClose}>
          {done ? 'Dismiss' : 'Keep cooking'}
        </button>
        {!done && <p className="timer-hint">The timer keeps running while you cook.</p>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Cook mode                                                           *
 * ------------------------------------------------------------------ */

export default function CookMode({ dish, onClose }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [language, setLanguage] = useState('en-IN')
  const [translations, setTranslations] = useState({})
  const [translating, setTranslating] = useState(false)
  const [notice, setNotice] = useState(null)
  const [speaking, setSpeaking] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [checked, setChecked] = useState(() => new Set())
  const [activeTimer, setActiveTimer] = useState(null)
  const [generatedSteps, setGeneratedSteps] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [handsFree, setHandsFree] = useState(false)
  const [heard, setHeard] = useState(null)
  const contentRef = useRef(null)
  const voiceRef = useRef(null)
  const commandRef = useRef(null)
  const autoReadRef = useRef(false)
  const startTimerRef = useRef(null)

  const baseSteps = useMemo(() => {
    if (dish.hasFullPreparation && dish.preparation) return splitSteps(dish.preparation)
    return generatedSteps || []
  }, [dish, generatedSteps])

  const ingredients = useMemo(() => splitIngredients(dish.ingredients), [dish.ingredients])

  // A borrowed recipe that also carries a change is the case worth shouting
  // about; a plain "same recipe" only needs stating.
  const refHasNotes = Boolean(dish.ref?.prepNote || dish.ref?.modification)
  // The two fields can disagree — D002 says 1 tsp in one and 1/2 tsp in the
  // other. Neither is applied and neither is preferred; the cook is told.
  const amountsIn = (t) => (String(t || '')
    .match(/(?:\d+(?:\.\d+)?|[\u00bd\u00bc\u00be])\s*(?:tsp|tbsp|cups?|g|ml)/gi) || [])
    .map((a) => a.toLowerCase().replace(/\s+/g, ''))
  const refNotesDisagree = (() => {
    const a = amountsIn(dish.ref?.modification)
    const b = amountsIn(dish.ref?.prepNote)
    return a.length > 0 && b.length > 0 && a.join() !== b.join()
  })()
  const total = baseSteps.length
  const isLast = stepIndex >= total - 1
  const englishStep = baseSteps[stepIndex] || ''

  const cacheKey = `${dish.recipeId}|${stepIndex}|${language}`
  const shownStep = language === 'en-IN'
    ? englishStep
    : (translations[cacheKey] ?? englishStep)

  const parsed = useMemo(() => parseStep(shownStep), [shownStep])

  /* ---- translation (cached per recipe + step + language) ---- */
  useEffect(() => {
    if (language === 'en-IN' || !englishStep) return undefined
    if (translations[cacheKey] !== undefined) return undefined

    let cancelled = false
    // Synchronising with an external service (Gemini); the flag is the
    // request's own pending state.
    // oxlint-disable-next-line react/set-state-in-effect
    setTranslating(true)
    fetch('/api/cook-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'translate',
        text: englishStep,
        language: languageByCode(language).geminiName,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d.text) setTranslations((prev) => ({ ...prev, [cacheKey]: d.text }))
        else setNotice(d.error || 'Could not translate this step.')
      })
      .catch((e) => { if (!cancelled) setNotice(e.message) })
      .finally(() => { if (!cancelled) setTranslating(false) })

    return () => { cancelled = true }
  }, [cacheKey, language, englishStep, translations])

  /* ---- speech ---- */
  const readAloud = useCallback(async () => {
    setNotice(null)
    setSpeaking(true)
    // Mute rather than stop: the microphone would otherwise hear the app's
    // own voice and trigger its own commands.
    voiceRef.current?.mute()
    const res = await speak(shownStep, language, {
      onEnd: () => {
        setSpeaking(false)
        voiceRef.current?.unmute()
      },
    })
    if (!res.ok) {
      setSpeaking(false)
      voiceRef.current?.unmute()
      setNotice(res.reason)
    } else if (res.fellBackTo) {
      setNotice(`No ${res.requestedLabel} voice on this device — reading in English. Voice commands still work in ${res.requestedLabel}.`)
    }
  }, [shownStep, language])

  /* ---- navigation: cancel any speech, reset scroll ---- */
  const goTo = useCallback((next) => {
    cancelSpeech()
    setSpeaking(false)
    setStepIndex(Math.min(Math.max(next, 0), Math.max(total - 1, 0)))
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [total])

  const close = useCallback(() => { cancelSpeech(); onClose() }, [onClose])

  /* ---- keyboard: -> next, <- previous, Space read, Esc close ---- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (!isLast) goTo(stepIndex + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(stepIndex - 1) }
      else if (e.key === ' ') { e.preventDefault(); readAloud() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, goTo, readAloud, stepIndex, isLast])

  useEffect(() => () => cancelSpeech(), [])

  /* ---- hands-free voice control ---- */

  const handleCommand = (cmd, transcript) => {
    setHeard(transcript || cmd)
    if (cmd === 'next') {
      if (isLast) close()
      else { autoReadRef.current = true; goTo(stepIndex + 1) }
    } else if (cmd === 'previous') {
      autoReadRef.current = true
      goTo(stepIndex - 1)
    } else if (cmd === 'repeat') {
      readAloud()
    } else if (cmd === 'timer') {
      const first = parsed.timers[0]
      if (first) startTimerRef.current(first)
      else setNotice('This step has no timer.')
    } else if (cmd === 'ingredients') {
      setDrawerOpen((o) => !o)
    } else if (cmd === 'stop') {
      setHandsFree(false)
    }
  }

  // Kept in refs so the recogniser is never rebuilt mid-session, and so the
  // handler always sees the current step rather than a stale closure.
  useEffect(() => { commandRef.current = handleCommand })

  useEffect(() => {
    if (!heard) return undefined
    const id = setTimeout(() => setHeard(null), 2200)
    return () => clearTimeout(id)
  }, [heard])

  useEffect(() => {
    if (!handsFree) {
      voiceRef.current?.stop()
      voiceRef.current = null
      return undefined
    }
    const controller = createVoiceController({
      lang: language,
      onCommand: (cmd, transcript) => commandRef.current?.(cmd, transcript),
      onError: (msg) => { setNotice(msg); setHandsFree(false) },
    })
    voiceRef.current = controller
    controller.start()
    return () => { controller.stop(); voiceRef.current = null }
  }, [handsFree, language])

  // Advancing by voice reads the new step without being asked.
  useEffect(() => {
    if (!handsFree || !autoReadRef.current) return
    autoReadRef.current = false
    readAloud()
  }, [stepIndex, handsFree, readAloud])

  /* ---- generate steps for INDB recipes ---- */
  const generateSteps = async () => {
    setGenerating(true)
    setNotice(null)
    try {
      const r = await fetch('/api/cook-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'generate-steps',
          name: dish.name,
          ingredients: dish.ingredients,
        }),
      })
      const d = await r.json()
      if (d.steps?.length) { setGeneratedSteps(d.steps); setStepIndex(0) }
      else setNotice(d.error || 'Could not generate steps.')
    } catch (e) {
      setNotice(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const startTimer = (timer) => {
    try { window.Notification?.requestPermission?.() } catch { /* ignore */ }
    setActiveTimer(timer)
  }
  useEffect(() => { startTimerRef.current = startTimer })


  const toggleIngredient = (item) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }

  const pct = total ? ((stepIndex + 1) / total) * 100 : 0

  return (
    <div className="cook-mode">
      <header className="ck-head">
        <div className="ck-title">
          <h1>{dish.name}</h1>
          {dish.hindiName && <p className="ck-hindi">{dish.hindiName}</p>}
        </div>
        <div className="ck-head-actions">
          <label className="ck-lang">
            <span className="ck-lang-label">Language</span>
            <select value={language} onChange={(e) => { cancelSpeech(); setLanguage(e.target.value) }}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code === 'en-IN' ? l.label : `${l.native} ${l.label}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button"
            className={`ck-mic-toggle${handsFree ? ' is-on' : ''}`}
            onClick={() => {
              if (!handsFree && !isVoiceSupported()) {
                setNotice('Voice control is not available in this browser. Try Chrome on desktop or Android.')
                return
              }
              setHandsFree((v) => !v)
            }}
            aria-pressed={handsFree}>
            <MicIcon />
            <span className="ck-mic-text">{handsFree ? 'Listening' : 'Hands-free'}</span>
          </button>
          <button type="button" className="ck-icon-btn" onClick={close} aria-label="Close cook mode">
            <CloseIcon />
          </button>
        </div>
      </header>

      {total > 0 && (
        <div className="ck-progress">
          <p className="ck-counter">Step {stepIndex + 1} of {total}</p>
          <div className="ck-bar"><span style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      <main className="ck-content" ref={contentRef}>
        {total === 0 ? (
          <div className="ck-generate">
            <p className="ck-generate-title">
              Full preparation steps aren&rsquo;t available for this dish, but you
              have the ingredients.
            </p>
            <p className="ck-generate-body">
              This recipe comes from the INDB (ICMR-NIN) nutrition database, which
              records ingredients and nutrition but no method. Would you like Thali
              to generate cooking steps using AI?
            </p>
            <button type="button" className="ck-btn ck-btn-solid ck-btn-lg"
              onClick={generateSteps} disabled={generating}>
              {generating ? 'Generating steps…' : 'Generate steps'}
            </button>
            {ingredients.length > 0 && (
              <ul className="ck-generate-ings">
                {ingredients.map((i) => <li key={i}><IngredientText text={i} /></li>)}
              </ul>
            )}
          </div>
        ) : (
          <>
            {/* Above the step, so it is on screen the moment Cook Mode opens
                — which is step 1. A note about skipping the jaggery is no use
                to a diabetic cook who meets it at step 6. */}
            {dish.ref?.resolved && (
              <div className={`ck-ref-note${refHasNotes ? ' is-warning' : ''}`} role="note">
                <p className="ck-ref-head">
                  {refHasNotes ? 'Before you start' : 'Same recipe'}
                </p>
                <p className="ck-ref-body">
                  These steps are {dish.ref.targetName || 'another recipe'}
                  {refHasNotes ? ', with a change:' : ' — the same method.'}
                </p>
                {dish.ref.prepNote && (
                  <p className="ck-ref-line">
                    <span className="ck-ref-label">Method note</span>
                    {dish.ref.prepNote}
                  </p>
                )}
                {dish.ref.modification && (
                  <p className="ck-ref-line">
                    <span className="ck-ref-label">Ingredients note</span>
                    {dish.ref.modification}
                  </p>
                )}
                {refNotesDisagree && (
                  <p className="ck-ref-warn">
                    Those two notes give different amounts. Thali is showing both
                    exactly as the recipe records them rather than choosing one
                    &mdash; use your own judgement, or leave it out.
                  </p>
                )}
              </div>
            )}
            {generatedSteps && (
              <p className="ck-ai-note">These steps were generated by AI from the ingredient list.</p>
            )}
            <p className="ck-step">
              {translating ? (
                <span className="ck-translating">Translating…</span>
              ) : (
                parsed.segments.map((seg, i) => (
                  seg.type === 'text'
                    ? <span key={i}>{seg.text}</span>
                    : (
                      <button key={i} type="button" className="ck-timer-btn"
                        onClick={() => startTimer(seg.timer)}>
                        <PlayIcon />
                        {seg.timer.label}
                      </button>
                    )
                ))
              )}
            </p>
          </>
        )}

        {handsFree && total > 0 && (
          language === 'en-IN' ? (
            <p className="ck-voice-hint">
              Say &ldquo;next&rdquo; for the next step, &ldquo;repeat&rdquo; to hear it again,
              &ldquo;timer&rdquo;, &ldquo;ingredients&rdquo;, or &ldquo;stop&rdquo;.
            </p>
          ) : (
            /* Recognition in Indian languages is unreliable on most devices,
               so this is stated as a design choice rather than left to look
               like a fault. The step text stays in the chosen language. */
            <p className="ck-voice-hint">
              Voice commands work best in English &mdash; say &ldquo;next&rdquo;,
              &ldquo;repeat&rdquo;, &ldquo;timer&rdquo;, &ldquo;ingredients&rdquo;,
              or &ldquo;stop&rdquo;. Your steps stay in {languageByCode(language).label}.
            </p>
          )
        )}

        {notice && <p className="ck-notice" role="status">{notice}</p>}
      </main>

      {total > 0 && (
        <div className="ck-controls">
          <button type="button" className="ck-btn ck-btn-nav"
            onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0}>
            <PrevIcon /> Previous
          </button>

          <button type="button" className="ck-btn ck-btn-read"
            onClick={readAloud} disabled={translating}>
            <SpeakerIcon /> {speaking ? 'Reading…' : 'Read aloud'}
          </button>

          <button type="button" className="ck-btn ck-btn-nav ck-btn-next"
            onClick={() => (isLast ? close() : goTo(stepIndex + 1))}>
            {isLast ? 'Finish' : <>Next <NextIcon /></>}
          </button>
        </div>
      )}

      {ingredients.length > 0 && total > 0 && (
        <div className={`ck-drawer${drawerOpen ? ' is-open' : ''}`}>
          <button type="button" className="ck-drawer-toggle"
            onClick={() => setDrawerOpen((o) => !o)} aria-expanded={drawerOpen}>
            {drawerOpen ? 'Hide ingredients' : 'Show ingredients'}
            <span className={`ck-chev${drawerOpen ? ' is-open' : ''}`}><ChevronUp /></span>
          </button>
          {drawerOpen && (
            <ul className="ck-ing-list">
              {ingredients.map((item) => (
                <li key={item}>
                  <label className={checked.has(item) ? 'is-checked' : ''}>
                    <input type="checkbox" checked={checked.has(item)}
                      onChange={() => toggleIngredient(item)} />
                    <span><IngredientText text={item} /></span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {heard && (
        <div className="ck-heard" role="status" aria-live="polite">
          Heard: {heard}
        </div>
      )}

      {handsFree && (
        <div className="ck-mic-dot" aria-hidden="true">
          <span className={`ck-mic-pulse${speaking ? ' is-muted' : ''}`} />
          <MicIcon />
        </div>
      )}

      {activeTimer && (
        <TimerOverlay timer={activeTimer} onClose={() => setActiveTimer(null)} />
      )}
    </div>
  )
}
