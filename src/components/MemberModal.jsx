import { useEffect, useState } from 'react'
import {
  ADVISORY_HEALTH,
  ADVISORY_HEALTH_NOTE,
  CUISINES,
  detectLifeStage,
  DIET_OPTIONS,
  FASTS_BY_RELIGION,
  HEALTH_LABEL,
  HEALTH_OPTIONS,
  LIFE_STAGE_HINT,
  LIFE_STAGE_LABEL,
  RELATIONSHIPS,
  RELIGIONS,
  SPICE_LEVELS,
} from '../data/memberOptions.js'
import {
  ALLIUM_SCOPES, MEAL_COUNTS, baselineFor, lightObservanceEligibility, observanceFor,
} from '../lib/observanceProfile.js'
import { displayName } from '../lib/names.js'
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
  // Sparse by design: a key appears only where this member departs from the
  // tradition's strictest reading. See src/lib/observanceProfile.js.
  observances: {},
  religion: 'none',
  cuisine: 'no_preference',
  spiceLevel: 2,
  likes: '',
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
      // An observance is a variation on a fast; when the fast goes, so does it.
      observances: Object.fromEntries(
        Object.entries(f.observances || {}).filter(([id]) => valid.has(id))),
    }))
  }

  const lifeStage = detectLifeStage(form.age)
  const availableFasts = FASTS_BY_RELIGION[form.religion] || []
  const selectedFasts = availableFasts.filter((f) => form.fasts.includes(f.id))
  const shortName = displayName(form.name?.trim() || 'this member')

  /**
   * Record one field of one fast's observance.
   *
   * Stored sparsely: only what differs from the tradition's baseline is kept,
   * so a family that never opens this carries no observance data at all and a
   * later change to a baseline still reaches them. Writing the resolved values
   * out in full would freeze today's reading into everyone's storage.
   */
  const setObservance = (fastId, patch) => {
    setForm((f) => {
      const base = baselineFor(fastId)
      const next = { ...observanceFor(f, fastId), ...patch }
      const sparse = {}
      if (next.mealCount !== base.mealCount) sparse.mealCount = next.mealCount
      if (next.alliumScope !== base.alliumScope) sparse.alliumScope = next.alliumScope
      if (next.observesLightly) sparse.observesLightly = true

      const observances = { ...(f.observances || {}) }
      if (Object.keys(sparse).length === 0) delete observances[fastId]
      else observances[fastId] = sparse
      return { ...f, observances }
    })
  }

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
      likes: form.likes.trim(),
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
                  <span>
                    {h.label}
                    {h.advisory && <span className="check-note">Not filtered</span>}
                  </span>
                </label>
              ))}
            </div>
            {form.health.some((id) => ADVISORY_HEALTH.includes(id)) && (
              <p className="advisory-note" role="note">
                <strong>
                  {form.health
                    .filter((id) => ADVISORY_HEALTH.includes(id))
                    .map((id) => HEALTH_LABEL[id] || id)
                    .join(', ')}
                </strong>
                {' \u2014 '}{ADVISORY_HEALTH_NOTE} Thali will not exclude any
                dish because of these, and will not tell you a dish is safe
                for them.
              </p>
            )}
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

                {/* How this person keeps each of them.
                    A tradition states the strictest reading; two people
                    keeping the same Ekadashi do not keep it identically, and
                    before this the app said they did. Only fasts that are
                    actually selected get an editor, and it starts on the
                    baseline so a family that has no variation to record never
                    has to touch it. */}
                {selectedFasts.length > 0 && (
                  <div className="observances">
                    <h4 className="observance-head">How {shortName} keeps them</h4>
                    <p className="section-help">
                      Thali starts from the strictest reading of each tradition
                      and cooks the shared meal for whoever is strictest at the
                      table. Anything looser here becomes a suggested addition
                      on {shortName}&rsquo;s own plate &mdash; it never changes
                      what anyone else is served.
                    </p>

                    {selectedFasts.map((f) => {
                      const resolved = observanceFor(form, f.id)
                      const base = baselineFor(f.id)
                      const light = lightObservanceEligibility(form)
                      return (
                        <fieldset key={f.id} className="observance">
                          <legend className="observance-name">{f.label}</legend>

                          <div className="observance-fields">
                            <div className="field">
                              <label htmlFor={`obs-meals-${f.id}`}>Meals that day</label>
                              <select id={`obs-meals-${f.id}`} value={resolved.mealCount}
                                onChange={(e) => setObservance(f.id, { mealCount: e.target.value })}>
                                {MEAL_COUNTS.map((mc) => (
                                  <option key={mc.id} value={mc.id}>
                                    {mc.label}{mc.id === base.mealCount ? ' — usual for this fast' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="field">
                              <label htmlFor={`obs-allium-${f.id}`}>Onion and garlic</label>
                              <select id={`obs-allium-${f.id}`} value={resolved.alliumScope}
                                onChange={(e) => setObservance(f.id, { alliumScope: e.target.value })}>
                                {ALLIUM_SCOPES.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.label}{a.id === base.alliumScope ? ' — usual for this fast' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <p className="observance-note">
                            {MEAL_COUNTS.find((mc) => mc.id === resolved.mealCount)?.note}
                          </p>

                          {light.eligible ? (
                            <label className="observance-light">
                              <input type="checkbox" checked={resolved.observesLightly}
                                onChange={(e) => setObservance(f.id, {
                                  observesLightly: e.target.checked,
                                })} />
                              <span>
                                Keeps this fast lightly on health grounds
                                <span className="check-meta">
                                  The fast&rsquo;s food rules stop applying to
                                  {' '}{shortName}. Everyone else at the table is
                                  still cooked for strictly. Thali offers this
                                  because of {shortName}&rsquo;s recorded{' '}
                                  {light.because}; it is your decision, not
                                  Thali&rsquo;s advice.
                                </span>
                              </span>
                            </label>
                          ) : (
                            <p className="observance-note observance-muted">
                              A health exemption can be recorded here for a member
                              with a condition or life stage that makes going
                              without food risky.
                            </p>
                          )}
                        </fieldset>
                      )
                    })}
                  </div>
                )}
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
              <label htmlFor="f-likes">Likes</label>
              <input id="f-likes" type="text" value={form.likes}
                placeholder="e.g. paneer, rajma chawal, extra lemon"
                onChange={(e) => set({ likes: e.target.value })} />
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
