import { useEffect, useState } from 'react'
import {
  CUISINES,
  detectLifeStage,
  DIET_OPTIONS,
  FASTS_BY_RELIGION,
  HEALTH_OPTIONS,
  LIFE_STAGE_HINT,
  LIFE_STAGE_LABEL,
  RELATIONSHIPS,
  RELIGIONS,
  SPICE_LEVELS,
} from '../data/memberOptions.js'
import './FamilyProfile.css'

/* ------------------------------------------------------------------ *
 * Icons (inline SVG — the style guide forbids emoji)                  *
 * ------------------------------------------------------------------ */

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Modal                                                               *
 * ------------------------------------------------------------------ */

const BLANK = {
  name: '',
  age: '',
  relationship: '',
  diet: 'vegetarian',
  health: [],
  fasts: [],
  religion: 'none',
  cuisine: 'no_preference',
  spiceLevel: 2,
  dislikes: '',
}

export default function MemberModal({ member, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({ ...BLANK, ...(member || {}) }))
  const [errors, setErrors] = useState([])

  // Close on Escape — keyboard parity with the × button.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const toggle = (field, id) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(id)
        ? f[field].filter((x) => x !== id)
        : [...f[field], id],
    }))

  // Changing religion clears fasts that no longer belong to it.
  const changeReligion = (religion) => {
    const valid = new Set((FASTS_BY_RELIGION[religion] || []).map((f) => f.id))
    setForm((f) => ({
      ...f,
      religion,
      fasts: f.fasts.filter((id) => valid.has(id)),
    }))
  }

  const lifeStage = detectLifeStage(form.age)
  const availableFasts = FASTS_BY_RELIGION[form.religion] || []

  const handleSubmit = (e) => {
    e.preventDefault()
    const found = []

    if (!form.name.trim()) found.push('Name is required.')

    // Guard the empty string first: Number('') is 0, which would pass a bare
    // range check and silently save an age-less member as a toddler.
    const ageRaw = String(form.age).trim()
    if (!ageRaw) {
      found.push('Age is required.')
    } else if (!/^\d+$/.test(ageRaw) || Number(ageRaw) > 120) {
      found.push('Age must be a whole number between 0 and 120.')
    }

    if (!form.relationship) found.push('Relationship is required.')

    setErrors(found)
    if (found.length) return

    onSave({
      ...form,
      id: form.id || String(Date.now()),
      name: form.name.trim(),
      age: Number(ageRaw),
      dislikes: form.dislikes.trim(),
      spiceLevel: Number(form.spiceLevel),
      lifeStage: detectLifeStage(ageRaw),
    })
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onCancel()
    }}>
      <div className="modal-card" role="dialog" aria-modal="true"
        aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{member ? 'Edit member' : 'Add family member'}</h2>
          <button type="button" className="icon-btn" onClick={onCancel}
            aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit} noValidate>
          {/* ---------------------------------------------- 1. WHO */}
          <section className="form-section">
            <h3 className="section-label">Who is this</h3>

            <div className="field">
              <label htmlFor="f-name">Name</label>
              <input id="f-name" type="text" value={form.name} autoComplete="off"
                placeholder="e.g. Sunita"
                onChange={(e) => set({ name: e.target.value })} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="f-age">Age</label>
                <input id="f-age" type="number" inputMode="numeric" min="0" max="120"
                  value={form.age} placeholder="e.g. 62"
                  onChange={(e) => set({ age: e.target.value })} />
              </div>

              <div className="field">
                <label htmlFor="f-rel">Relationship</label>
                <select id="f-rel" value={form.relationship}
                  onChange={(e) => set({ relationship: e.target.value })}>
                  <option value="">Select…</option>
                  {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            {lifeStage && (
              <div className="hint-card">
                <span className="chip chip-stage">{LIFE_STAGE_LABEL[lifeStage]}</span>
                <p>
                  Detected from age {form.age}. {LIFE_STAGE_HINT[lifeStage]}
                </p>
              </div>
            )}
          </section>

          {/* ---------------------------------------- 2. DIETARY */}
          <section className="form-section">
            <h3 className="section-label">Dietary identity</h3>
            <div className="radio-grid">
              {DIET_OPTIONS.map((d) => (
                <label key={d.id}
                  className={`choice-card${form.diet === d.id ? ' is-selected' : ''}`}>
                  <input type="radio" name="diet" value={d.id}
                    checked={form.diet === d.id}
                    onChange={() => set({ diet: d.id })} />
                  <span className="choice-body">
                    <span className="choice-title">{d.label}</span>
                    <span className="choice-desc">{d.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* ----------------------------------------- 3. HEALTH */}
          <section className="form-section">
            <h3 className="section-label">Health conditions</h3>
            <p className="section-help">Select any that apply. Leave blank if none.</p>
            <div className="check-grid">
              {HEALTH_OPTIONS.map((h) => (
                <label key={h.id}
                  className={`check-card${form.health.includes(h.id) ? ' is-selected' : ''}`}>
                  <input type="checkbox" checked={form.health.includes(h.id)}
                    onChange={() => toggle('health', h.id)} />
                  <span>{h.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* ------------------------------------------ 4. FASTS */}
          <section className="form-section">
            <h3 className="section-label">Religious fasts</h3>

            <div className="field">
              <label htmlFor="f-religion">Religion</label>
              <select id="f-religion" value={form.religion}
                onChange={(e) => changeReligion(e.target.value)}>
                {RELIGIONS.map((r) => (
                  <option key={r} value={r}>{r === 'none' ? 'Not applicable' : r}</option>
                ))}
              </select>
            </div>

            {form.religion === 'none' ? (
              <p className="section-help">
                No fasting traditions to show. Pick a religion to see its fasts.
              </p>
            ) : (
              <>
                <p className="section-help">
                  {availableFasts.length} {form.religion} traditions. Select the ones
                  this member observes.
                </p>
                <div className="check-grid">
                  {availableFasts.map((f) => (
                    <label key={f.id}
                      className={`check-card${form.fasts.includes(f.id) ? ' is-selected' : ''}`}>
                      <input type="checkbox" checked={form.fasts.includes(f.id)}
                        onChange={() => toggle('fasts', f.id)} />
                      <span>
                        {f.label}
                        <span className="check-meta">{f.frequency}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ------------------------------------------ 5. TASTE */}
          <section className="form-section">
            <h3 className="section-label">Taste preferences</h3>

            <div className="field">
              <label htmlFor="f-cuisine">Cuisine preference</label>
              <select id="f-cuisine" value={form.cuisine}
                onChange={(e) => set({ cuisine: e.target.value })}>
                {CUISINES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="f-spice">
                Spice tolerance
                <span className="slider-value">{SPICE_LEVELS[form.spiceLevel]}</span>
              </label>
              <input id="f-spice" type="range" min="0" max="4" step="1"
                value={form.spiceLevel}
                onChange={(e) => set({ spiceLevel: Number(e.target.value) })} />
              <div className="slider-scale">
                <span>None</span><span>Very spicy</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="f-dislikes">Dislikes</label>
              <input id="f-dislikes" type="text" value={form.dislikes}
                placeholder="e.g. brinjal, karela, too much ginger"
                onChange={(e) => set({ dislikes: e.target.value })} />
            </div>
          </section>

          {errors.length > 0 && (
            <div className="form-error" role="alert">
              {errors.map((msg) => <p key={msg}>{msg}</p>)}
            </div>
          )}

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-solid">
              {member ? 'Save changes' : 'Add member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
