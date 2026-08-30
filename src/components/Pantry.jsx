import { useState } from 'react'
import { COMMON_PANTRY } from '../lib/pantry.js'
import './Pantry.css'

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * What the family already has. Binary by design — see the note in
 * shoppingList.js: no quantities, no depletion tracking.
 */
export default function Pantry({ items, onChange, removedCount }) {
  const [draft, setDraft] = useState('')
  const has = (name) => items.some((i) => i.toLowerCase() === name.toLowerCase())

  const toggle = (name) => {
    onChange(has(name)
      ? items.filter((i) => i.toLowerCase() !== name.toLowerCase())
      : [...items, name])
  }

  const addCustom = (e) => {
    e.preventDefault()
    const value = draft.trim()
    if (!value || has(value)) { setDraft(''); return }
    onChange([...items, value])
    setDraft('')
  }

  const custom = items.filter(
    (i) => !COMMON_PANTRY.some((c) => c.toLowerCase() === i.toLowerCase()),
  )

  return (
    <section className="pantry" aria-labelledby="pantry-heading">
      <div className="pantry-head">
        <div>
          <h2 id="pantry-heading" className="section-heading pantry-title">Your pantry</h2>
          <p className="pantry-sub">
            Tick what you already have. Anything here drops off the shopping list.
          </p>
        </div>
        {items.length > 0 && (
          <button type="button" className="link-btn pantry-clear" onClick={() => onChange([])}>
            Clear pantry
          </button>
        )}
      </div>

      {removedCount > 0 && (
        <p className="pantry-saved">
          <strong>{removedCount}</strong>{' '}
          {removedCount === 1 ? 'item is' : 'items are'} already in your pantry
        </p>
      )}

      <div className="pantry-grid">
        {COMMON_PANTRY.map((name) => (
          <label key={name} className={`pantry-chip${has(name) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={has(name)} onChange={() => toggle(name)} />
            <span>{name}</span>
          </label>
        ))}
      </div>

      {custom.length > 0 && (
        <div className="pantry-custom-list">
          {custom.map((name) => (
            <span key={name} className="pantry-custom">
              {name}
              <button type="button" onClick={() => toggle(name)}
                aria-label={`Remove ${name} from pantry`}>
                <CloseIcon />
              </button>
            </span>
          ))}
        </div>
      )}

      <form className="pantry-add" onSubmit={addCustom}>
        <input type="text" value={draft} placeholder="Add your own — e.g. kasuri methi"
          aria-label="Add a pantry item" autoComplete="off"
          onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn pantry-add-btn" disabled={!draft.trim()}>
          Add
        </button>
      </form>
    </section>
  )
}
