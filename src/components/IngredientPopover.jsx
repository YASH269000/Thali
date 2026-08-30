import { useEffect, useRef, useState } from 'react'
import { annotateIngredients } from '../lib/ingredientGuide.js'
import './IngredientPopover.css'

// A small question mark marks the term as something you can ask about —
// the pill alone reads as emphasis, the icon reads as "there is more here".
function HelpIcon() {
  return (
    <svg className="ing-help" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6.3 6.1a1.75 1.75 0 113.4.6c-.2.8-1.2 1-1.5 1.7v.5"
        fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.72" fill="currentColor" />
    </svg>
  )
}

/**
 * Renders an ingredient string, underlining any ingredient the guide knows
 * about. Hover (desktop) or tap (touch) reveals what it is, what to use
 * instead, and where to buy it.
 *
 * One popover is open at a time, tracked here rather than per-word, so two
 * cannot overlap. Closes on Escape or a click elsewhere.
 */
export default function IngredientText({ text, className = '' }) {
  const [openAt, setOpenAt] = useState(null) // index of the open segment
  const [pinned, setPinned] = useState(false) // a tap keeps it open
  const rootRef = useRef(null)

  const segments = annotateIngredients(text)

  useEffect(() => {
    if (openAt === null) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpenAt(null); setPinned(false) }
    }
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) { setOpenAt(null); setPinned(false) }
    }
    // Capture phase, so Escape closes the popover before cook mode sees it.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('touchstart', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('touchstart', onDown)
    }
  }, [openAt])

  if (segments.every((s) => s.type === 'text')) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={`ing-text ${className}`} ref={rootRef}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.text}</span>
        const isOpen = openAt === i
        const { entry } = seg
        return (
          <span key={i} className="ing-wrap">
            <button
              type="button"
              className={`ing-term${isOpen ? ' is-open' : ''}`}
              aria-expanded={isOpen}
              onClick={(e) => {
                e.stopPropagation()
                if (isOpen && pinned) { setOpenAt(null); setPinned(false) }
                else { setOpenAt(i); setPinned(true) }
              }}
              onMouseEnter={() => { if (!pinned) setOpenAt(i) }}
              onMouseLeave={() => { if (!pinned) setOpenAt(null) }}
              onFocus={() => setOpenAt(i)}
            >
              {seg.text}
              <HelpIcon />
            </button>

            {isOpen && (
              <span className="ing-pop" role="tooltip">
                <span className="ing-pop-name">{entry.key}</span>
                {entry.aliases?.length > 0 && (
                  <span className="ing-pop-alias">{entry.aliases.join(' · ')}</span>
                )}
                <span className="ing-pop-body">{entry.explanation}</span>
                {entry.substitutes?.length > 0 && (
                  <span className="ing-pop-row">
                    <span className="ing-pop-key">Substitutes:</span> {entry.substitutes.join(', ')}
                  </span>
                )}
                {entry.whereToFind && (
                  <span className="ing-pop-row">
                    <span className="ing-pop-key">Find at:</span> {entry.whereToFind}
                  </span>
                )}
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
