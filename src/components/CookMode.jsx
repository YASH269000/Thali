import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration, parseStep, splitSteps } from '../lib/timerParser.js'
import { LANGUAGES, cancel as cancelSpeech, languageByCode, playChime, speak } from '../lib/speech.js'
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
  const contentRef = useRef(null)

  const baseSteps = useMemo(() => {
    if (dish.hasFullPreparation && dish.preparation) return splitSteps(dish.preparation)
    return generatedSteps || []
  }, [dish, generatedSteps])

  const ingredients = useMemo(() => splitIngredients(dish.ingredients), [dish.ingredients])
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
    const res = await speak(shownStep, language, { onEnd: () => setSpeaking(false) })
    if (!res.ok) {
      setSpeaking(false)
      setNotice(res.reason)
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

      {activeTimer && (
        <TimerOverlay timer={activeTimer} onClose={() => setActiveTimer(null)} />
      )}
    </div>
  )
}
