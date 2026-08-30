import { useEffect, useRef, useState } from 'react'
import { getSequence } from '../lib/sequenceCache.js'
import './CookMode.css'

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 5.5l10 6.5-10 6.5z" fill="currentColor" />
  </svg>
)

/**
 * Meal-wide cooking timeline. Asks Gemini to sequence the dishes so long
 * hands-off cooking (dal, rice) starts first and shorter work happens in
 * parallel, then lets the user drop into single-dish cook mode from any block.
 */
export default function MultiDishCookMode({ dishes, onClose, onStartDish }) {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const inFlight = useRef(null)

  const [fromCache, setFromCache] = useState(false)

  useEffect(() => {
    if (inFlight.current) inFlight.current.abort()
    const controller = new AbortController()
    inFlight.current = controller

    getSequence(dishes, fetch, { signal: controller.signal })
      .then(({ data, cached }) => {
        if (controller.signal.aborted) return
        setFromCache(cached)
        if (data?.sequence) setPlan(data)
        else setError(data)
      })
      .catch((e) => { if (e.name !== 'AbortError') setError({ error: e.message }) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })

    return () => controller.abort()
  }, [dishes])

  const byName = (name) => dishes.find(
    (d) => d.name?.toLowerCase() === String(name || '').toLowerCase(),
  )

  return (
    <div className="cook-mode">
      <header className="ck-head">
        <div className="ck-title">
          <h1>Cook the whole meal</h1>
          <p className="ck-hindi">
            {dishes.length} dishes, sequenced so everything is ready together
          </p>
        </div>
        <div className="ck-head-actions">
          <button type="button" className="ck-icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
      </header>

      <main className="ck-content ck-content-top">
        {loading && (
          <div className="ck-seq-loading" role="status">
            <p className="ck-generate-title">Working out the cooking order&hellip;</p>
            <p className="ck-generate-body">
              Finding what can cook while something else simmers.
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="ck-seq-loading">
            <p className="ck-generate-title">{error.error || 'Could not build a sequence.'}</p>
            {error.detail && <p className="ck-generate-body">{error.detail}</p>}
          </div>
        )}

        {plan && !loading && (
          <div className="ck-timeline-wrap">
            {fromCache && (
              <p className="ck-cache-note">Reusing the sequence worked out earlier for this meal.</p>
            )}
            {plan.totalTime && (
              <p className="ck-total">
                <strong>{plan.totalTime}</strong> minutes from start to serving
              </p>
            )}

            <ol className="ck-timeline">
              {plan.sequence.map((block, i) => {
                const dish = byName(block.dishName)
                return (
                  <li key={`${block.dishName}-${i}`} className="ck-block">
                    <div className="ck-block-time">
                      <span className="ck-block-at">{block.startAt}</span>
                      {block.durationMin && (
                        <span className="ck-block-dur">{block.durationMin} min</span>
                      )}
                    </div>

                    <div className="ck-block-body">
                      <div className="ck-block-head">
                        <p className="ck-block-dish">{block.dishName}</p>
                        {dish && (
                          <button type="button" className="ck-block-start"
                            onClick={() => onStartDish(dish)}>
                            <PlayIcon /> Start
                          </button>
                        )}
                      </div>

                      {block.parallelWith?.length > 0 && (
                        <p className="ck-parallel">
                          while {block.parallelWith.join(' and ')} {block.parallelWith.length > 1 ? 'cook' : 'cooks'}
                        </p>
                      )}

                      {block.steps?.length > 0 && (
                        <ul className="ck-block-steps">
                          {block.steps.map((s, j) => <li key={j}>{s}</li>)}
                        </ul>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>

            {plan.tips?.length > 0 && (
              <div className="ck-tips">
                <h2>Tips</h2>
                <ul>{plan.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </main>

      <div className="ck-controls">
        <button type="button" className="ck-btn ck-btn-solid ck-btn-nav" onClick={onClose}>
          Back to the plan
        </button>
      </div>
    </div>
  )
}
