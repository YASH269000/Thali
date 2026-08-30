import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { activeFastIdsOn } from '../lib/fastingRules.js'
import { avatarTone, initials } from '../lib/avatar.js'
import { displayName } from '../lib/names.js'
import {
  ADVISORY_HEALTH,
  ADVISORY_HEALTH_NOTE,
  DIET_LABEL,
  FAST_LABEL,
  HEALTH_LABEL,
  LIFE_STAGE_LABEL,
} from '../data/memberOptions.js'
import FastingCalendar from './FastingCalendar.jsx'
import Disclaimer from './Disclaimer.jsx'
import MemberModal from './MemberModal.jsx'
import './FamilyProfile.css'

const STORAGE_KEY = 'thali_family'

/* ------------------------------------------------------------------ *
 * Persistence                                                         *
 * ------------------------------------------------------------------ */

function loadFamily() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupt or unavailable storage (private mode, cleared data) — start empty
    // rather than crash the screen.
    return []
  }
}

function saveFamily(family) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(family))
  } catch {
    // Storage full or blocked. The screen still works for this session.
  }
}

/* ------------------------------------------------------------------ *
 * Presentation helpers                                                *
 * ------------------------------------------------------------------ */

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M13.5 3.9l2.6 2.6M4 16h2.6l8.2-8.2a1.8 1.8 0 000-2.6l0 0a1.8 1.8 0 00-2.6 0L4 13.4V16z"
        fill="none" stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Screen                                                              *
 * ------------------------------------------------------------------ */

export default function FamilyProfile() {
  const navigate = useNavigate()
  // Lazy initialiser: reads storage once, before first paint. A useEffect that
  // saves on every change would otherwise overwrite saved data with [] on mount.
  const [family, setFamily] = useState(loadFamily)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  useEffect(() => {
    saveFamily(family)
  }, [family])

  const today = useMemo(() => new Date(), [])

  const stats = useMemo(() => {
    const activeIds = activeFastIdsOn(today)

    const observed = new Set()
    for (const m of family) for (const id of m.fasts || []) observed.add(id)

    const activeToday = [...observed].filter((id) => activeIds.has(id))

    // Distinct constraints the one kitchen has to satisfy at once.
    const constraints = new Set()
    for (const m of family) {
      if (m.diet) constraints.add(`diet:${m.diet}`)
      for (const h of m.health || []) constraints.add(`health:${h}`)
      for (const f of m.fasts || []) constraints.add(`fast:${f}`)
    }

    return {
      members: family.length,
      activeToday: activeToday.length,
      activeLabels: activeToday.map((id) => FAST_LABEL[id] || id),
      constraints: constraints.size,
    }
  }, [family, today])

  const openAdd = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (member) => {
    setEditing(member)
    setModalOpen(true)
  }

  const handleSave = (member) => {
    setFamily((prev) => {
      const exists = prev.some((m) => m.id === member.id)
      return exists ? prev.map((m) => (m.id === member.id ? member : m)) : [...prev, member]
    })
    setModalOpen(false)
    setEditing(null)
  }

  const handleDelete = (id) => {
    setFamily((prev) => prev.filter((m) => m.id !== id))
    setPendingDelete(null)
  }

  const todayLabel = today.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="thali">
      <header className="app-header">
        <div className="brand">
          <span className="logo">Thali</span>
          <p className="tagline">
            Your family&rsquo;s kitchen brain &mdash; one plan for everyone
          </p>
        </div>
        <p className="today">{todayLabel}</p>
      </header>

      <main className="content">
        <section className="stats" aria-label="Family summary">
          <div className="stat-card">
            <span className="stat-value">{stats.members}</span>
            <span className="stat-label">
              {stats.members === 1 ? 'Family member' : 'Family members'}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.activeToday}</span>
            <span className="stat-label">Active fasts today</span>
            {stats.activeToday > 0 && (
              <span className="stat-note">{stats.activeLabels.join(', ')}</span>
            )}
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.constraints}</span>
            <span className="stat-label">Dietary constraints</span>
            <span className="stat-note">Across diets, health and fasts</span>
          </div>
        </section>

        <FastingCalendar family={family} today={today} />

        <section aria-labelledby="family-heading">
          <h2 id="family-heading" className="section-heading">Your family</h2>

          {family.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No one here yet</p>
              <p className="empty-body">
                Add everyone who eats from your kitchen. Thali works out a single
                day&rsquo;s plan that respects every diet, health condition and fast
                in the house.
              </p>
              <button type="button" className="btn btn-solid" onClick={openAdd}>
                Add first member
              </button>
            </div>
          ) : (
            <ul className="member-list">
              {family.map((m) => (
                <li key={m.id} className="member-card">
                  <div className="member-main">
                    <span className={`avatar tone-${avatarTone(m.id || m.name)}`}
                      aria-hidden="true">
                      {initials(m.name)}
                    </span>

                    <div className="member-info">
                      <p className="member-name">{displayName(m.name)}</p>
                      <p className="member-meta">
                        {[m.relationship, m.age != null ? `${m.age} years` : null]
                          .filter(Boolean).join(' · ')}
                      </p>

                      <div className="chips">
                        {m.diet && (
                          <span className="chip chip-diet">
                            {DIET_LABEL[m.diet] || m.diet}
                          </span>
                        )}
                        {m.lifeStage && (
                          <span className="chip chip-stage">
                            {LIFE_STAGE_LABEL[m.lifeStage] || m.lifeStage}
                          </span>
                        )}
                        {(m.health || []).map((h) => (
                          <span key={h}
                            className={`chip chip-health${ADVISORY_HEALTH.includes(h) ? ' chip-advisory' : ''}`}
                            title={ADVISORY_HEALTH.includes(h) ? ADVISORY_HEALTH_NOTE : undefined}>
                            {HEALTH_LABEL[h] || h}
                            {ADVISORY_HEALTH.includes(h) && (
                              <span className="chip-suffix">not filtered</span>
                            )}
                          </span>
                        ))}
                        {(m.fasts || []).map((f) => (
                          <span key={f} className="chip chip-fast">
                            {FAST_LABEL[f] || f}
                          </span>
                        ))}
                      </div>

                      {m.likes && (
                        <p className="member-likes">Likes: {m.likes}</p>
                      )}
                      {m.dislikes && (
                        <p className="member-dislikes">Dislikes: {m.dislikes}</p>
                      )}
                    </div>

                    <div className="member-actions">
                      <button type="button" className="icon-btn" onClick={() => openEdit(m)}
                        aria-label={`Edit ${displayName(m.name)}`}>
                        <PencilIcon />
                      </button>
                      <button type="button" className="icon-btn"
                        onClick={() => setPendingDelete(m.id)}
                        aria-label={`Remove ${displayName(m.name)}`}>
                        <CrossIcon />
                      </button>
                    </div>
                  </div>

                  {pendingDelete === m.id && (
                    <div className="confirm-row">
                      <span>Remove {displayName(m.name)} from the family?</span>
                      <div className="confirm-actions">
                        <button type="button" className="btn btn-ghost btn-small"
                          onClick={() => setPendingDelete(null)}>
                          Keep
                        </button>
                        <button type="button" className="btn btn-danger btn-small"
                          onClick={() => handleDelete(m.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="actions">
          <button type="button" className="btn btn-dashed" onClick={openAdd}>
            Add family member
          </button>
          <button type="button" className="btn btn-solid btn-block"
            onClick={() => navigate('/meal-plan')}
            disabled={family.length === 0}>
            Generate today&rsquo;s meal plan
          </button>
          {family.length === 0 && (
            <p className="actions-note">
              Add at least one family member to generate a plan.
            </p>
          )}
        </div>
      </main>

      <Disclaimer />

      {modalOpen && (
        <MemberModal
          member={editing}
          onSave={handleSave}
          onCancel={() => {
            setModalOpen(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
