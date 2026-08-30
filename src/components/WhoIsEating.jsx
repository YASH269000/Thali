import { avatarTone, initials } from '../lib/avatar.js'
import { GUEST_RESTRICTIONS, describeGuests, guestHeadcount } from '../lib/guests.js'
import { DIET_LABEL, FAST_LABEL, HEALTH_LABEL, LIFE_STAGE_LABEL } from '../data/memberOptions.js'
import { displayName } from '../lib/names.js'
import './WhoIsEating.css'

/**
 * Who is actually home for this meal.
 *
 * Real families are not all present every night, and planning for absent
 * people wastes food. Everyone is checked by default because that is the
 * common case; unchecking is the exception.
 */
export default function WhoIsEating({
  family, mealType, selected, onChange, guests, onGuestsChange, onConfirm, onBack,
}) {
  const count = selected.length
  const guestCount = guestHeadcount(guests)
  const none = count === 0 && guestCount === 0

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  const addGuest = () => {
    onGuestsChange([...guests, {
      id: `g${Date.now()}${guests.length}`,
      name: '',
      restriction: 'none',
      count: 1,
    }])
  }

  const patchGuest = (id, patch) => {
    onGuestsChange(guests.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }

  const removeGuest = (id) => onGuestsChange(guests.filter((g) => g.id !== id))

  const memberLabel = count === 1
    ? displayName(family.find((m) => m.id === selected[0])?.name || 'them')
    : `${count} ${count === 1 ? 'member' : 'members'}`

  const label = guestCount > 0
    ? `Generate meal for ${count} ${count === 1 ? 'member' : 'members'} + ${guestCount} ${guestCount === 1 ? 'guest' : 'guests'} (${count + guestCount} total)`
    : `Generate meal for ${memberLabel}`

  return (
    <section className="who" aria-labelledby="who-heading">
      <div className="who-head">
        <div>
          <h2 id="who-heading" className="who-title">Who is eating {mealType}?</h2>
          <p className="who-sub">Uncheck anyone who&rsquo;s not home today</p>
        </div>
        <div className="who-quick">
          <button type="button" className="who-quick-btn"
            onClick={() => onChange(family.map((m) => m.id))}
            disabled={count === family.length}>
            All in
          </button>
          <button type="button" className="who-quick-btn"
            onClick={() => onChange([])} disabled={none}>
            None
          </button>
        </div>
      </div>

      <ul className="who-list">
        {family.map((m) => {
          const on = selected.includes(m.id)
          return (
            <li key={m.id}>
              <label className={`who-row${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
                <span className={`avatar tone-${avatarTone(m.id || m.name)}`} aria-hidden="true">
                  {initials(m.name)}
                </span>
                <span className="who-info">
                  <span className="who-name">{displayName(m.name)}</span>
                  <span className="who-meta">
                    {[m.relationship, m.age != null ? `${m.age}` : null].filter(Boolean).join(' · ')}
                  </span>
                  <span className="who-chips">
                    {m.diet && (
                      <span className="chip chip-diet">{DIET_LABEL[m.diet] || m.diet}</span>
                    )}
                    {m.lifeStage && (
                      <span className="chip chip-stage">
                        {LIFE_STAGE_LABEL[m.lifeStage] || m.lifeStage}
                      </span>
                    )}
                    {(m.health || []).slice(0, 2).map((h) => (
                      <span key={h} className="chip chip-health">{HEALTH_LABEL[h] || h}</span>
                    ))}
                    {(m.fasts || []).slice(0, 1).map((f) => (
                      <span key={f} className="chip chip-fast">{FAST_LABEL[f] || f}</span>
                    ))}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="guests">
        <div className="guests-head">
          <div>
            <h3 className="guests-title">Any guests?</h3>
            <p className="guests-sub">Add anyone eating with you today</p>
          </div>
          <button type="button" className="who-quick-btn" onClick={addGuest}>
            + Add guest
          </button>
        </div>

        {guests.length === 0 ? (
          <p className="guests-empty">No guests today.</p>
        ) : (
          <>
            <ul className="guest-rows">
              {guests.map((g, i) => (
                <li key={g.id} className="guest-row">
                  <input type="text" className="guest-name" value={g.name}
                    placeholder={`Guest ${i + 1}`} autoComplete="off"
                    aria-label={`Guest ${i + 1} name`}
                    onChange={(e) => patchGuest(g.id, { name: e.target.value })} />

                  <select className="guest-diet" value={g.restriction}
                    aria-label={`Guest ${i + 1} dietary constraint`}
                    onChange={(e) => patchGuest(g.id, { restriction: e.target.value })}>
                    {GUEST_RESTRICTIONS.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>

                  <span className="guest-count">
                    <button type="button" aria-label="One fewer"
                      onClick={() => patchGuest(g.id, { count: Math.max(0, (Number(g.count) || 0) - 1) })}>
                      &minus;
                    </button>
                    <span className="guest-n">{g.count}</span>
                    <button type="button" aria-label="One more"
                      onClick={() => patchGuest(g.id, { count: (Number(g.count) || 0) + 1 })}>
                      +
                    </button>
                  </span>

                  <button type="button" className="guest-remove"
                    aria-label={`Remove guest group ${i + 1}`}
                    onClick={() => removeGuest(g.id)}>
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor"
                        strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>

            {guestCount > 0 && (
              <div className="guest-chips">
                {describeGuests(guests).map((d) => (
                  <span key={d} className="chip chip-stage">{d}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="who-actions">
        <button type="button" className="btn btn-solid btn-block"
          onClick={onConfirm} disabled={none}>
          {none ? 'Generate meal' : label}
        </button>
        {none && <p className="who-hint">Select at least one person</p>}
        {count === 0 && guestCount > 0 && (
          <p className="who-hint">No family member selected — this meal is for guests only.</p>
        )}
        <button type="button" className="link-btn who-back" onClick={onBack}>
          Back to meal type
        </button>
      </div>
    </section>
  )
}
