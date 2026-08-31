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
export default function Pantry({ items, onChange, removedNames = [], matched = [], prepared = [] }) {
  const [draft, setDraft] = useState('')
  const has = (name) => items.some((i) => i.toLowerCase() === name.toLowerCase())
  // Ticked and actually used by this meal, as opposed to ticked and irrelevant
  // to it — the pantry outlives any one plan, so most ticks are the latter.
  const matchedSet = new Set(matched.map((m) => m.toLowerCase()))
  const isMatched = (name) => matchedSet.has(name.toLowerCase())
  // Having tomatoes is not the same as having them chopped. Where the recipe
  // wanted a prepared form, the work that is left travels with the name.
  const prepFor = new Map(prepared.map((p) => [p.name.toLowerCase(), p.prep]))
  const prepForChip = new Map(prepared.map((p) => [p.item.toLowerCase(), p.prep]))

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

      {removedNames.length > 0 && (
        // Names the lines that were taken off, not the ticked entries that did
        // it: one entry can clear two lines, and a count that disagreed with
        // the names beside it would read like a bug.
        <p className="pantry-saved">
          <strong>{removedNames.length}</strong>{' '}
          {removedNames.length === 1 ? 'item' : 'items'} already in your pantry:{' '}
          {removedNames.map((name, i) => {
            const prep = prepFor.get(name.toLowerCase())
            return (
              <span key={name}>
                {i > 0 && ', '}
                {name}
                {prep && <span className="pantry-prep"> ({prep})</span>}
              </span>
            )
          })}
        </p>
      )}

      <div className="pantry-grid">
        {COMMON_PANTRY.map((name) => (
          <label key={name}
            className={`pantry-chip${has(name) ? ' is-on' : ''}${isMatched(name) ? ' is-matched' : ''}`}
            title={isMatched(name)
              ? `${name} was taken off this meal's list${prepForChip.get(name.toLowerCase()) ? ` — ${prepForChip.get(name.toLowerCase())}` : ''}`
              : undefined}>
            <input type="checkbox" checked={has(name)} onChange={() => toggle(name)} />
            <span>{name}</span>
            {isMatched(name) && <span className="pantry-chip-dot" aria-hidden="true" />}
          </label>
        ))}
      </div>

      {custom.length > 0 && (
        <div className="pantry-custom-list">
          {custom.map((name) => (
            <span key={name}
              className={`pantry-custom${isMatched(name) ? ' is-matched' : ''}`}>
              {name}
              {isMatched(name) && <span className="pantry-chip-dot" aria-hidden="true" />}
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
