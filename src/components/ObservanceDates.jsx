import { useMemo, useState } from 'react'
import {
  CONFIDENCE, PLACE, YEARS, observedObservanceIds, occurrencesOf,
  resolvedDatesFor, templateFor, yearIsCovered,
} from '../lib/observances.js'
import {
  addDate, clearOverride, confirmDate, moveDate, neighbouringDates, removeDate,
} from '../lib/observanceOverrides.js'
import './ObservanceDates.css'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const longIso = (iso) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]}`
}

/**
 * How a date came to be, in the words a family would use for it.
 *
 * The point of showing this at all: a date the engine computed to the minute
 * and a date somebody typed into a table two years ago should not look alike,
 * and neither should look like a date this household set themselves.
 */
function provenanceOf(entry) {
  if (entry.source === 'removed') {
    return { chip: 'Removed', tone: 'removed', detail: 'You told Thali your family does not keep this one.' }
  }
  if (entry.addedByFamily) {
    return { chip: 'You set this', tone: 'user', detail: 'A date you added. Thali shipped nothing for it.' }
  }
  if (entry.source === 'override') {
    return {
      chip: 'You set this',
      tone: 'user',
      detail: entry.movedFrom
        ? `You moved this from ${longIso(entry.movedFrom)}.`
        : 'You confirmed Thali’s date.',
    }
  }
  if (entry.confidence === CONFIDENCE.PROVISIONAL) {
    return {
      chip: 'Provisional',
      tone: 'question',
      detail: 'The Islamic month begins on a local sighting of the crescent, so this is a planning date — confirm it locally.',
    }
  }
  if (entry.confidence === CONFIDENCE.UNSTABLE) {
    return {
      chip: 'May vary by a day',
      tone: 'question',
      detail: 'This sits on a tithi boundary tight enough that panchangs legitimately differ. Worth checking yours.',
    }
  }
  if (entry.confidence === CONFIDENCE.CURATED) {
    return {
      chip: 'Curated',
      tone: 'shipped',
      detail: entry.resolvedBy
        ? `From Thali’s curated list — ${entry.resolvedBy}.`
        : 'From Thali’s curated list.',
    }
  }
  return {
    chip: 'Verified',
    tone: 'shipped',
    detail: `Calculated for ${PLACE}${entry.tithi ? ` — ${entry.tithi}` : ''}. Stable to the minute.`,
  }
}

/**
 * Every date the family's traditions fall on, and the controls to change them.
 *
 * The safety valve, and deliberately not buried. Two things no calculation can
 * settle reach a household through this screen: an Islamic month begins when
 * the crescent is sighted locally — Eid al-Adha 2026 was kept on 27 May in
 * Jammu & Kashmir and 28 May elsewhere in India — and a tithi that turns near
 * sunrise can put one panchang a day away from another. Both are answered
 * here, in the same slot the confirmation prompt writes to, so a family can
 * never end up holding two contradictory answers about one day.
 *
 * A date set here overrides the DATE. It never touches what the tradition
 * means: the name, the religion, the fasts it activates and its food rules
 * are cloned from the shipped record, so moving Ekadashi does not make it
 * something other than Ekadashi.
 */
export default function ObservanceDates({ family, overrides, onChange, year }) {
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState({})

  const ids = useMemo(() => observedObservanceIds(family), [family])

  if (family.length === 0 || ids.length === 0) return null

  const setDraftFor = (id, patch) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }))

  const submitAdd = (id) => {
    const value = draft[id]?.date
    if (!value) return
    onChange(addDate(overrides, id, value, {
      through: draft[id]?.through || null,
      resolvesTo: resolvedDatesFor(id, overrides),
    }))
    setDraft((d) => ({ ...d, [id]: {} }))
  }

  return (
    <section className="od" aria-labelledby="od-heading">
      <h2 id="od-heading" className="section-heading">Your dates &mdash; {year}</h2>

      <p className="od-intro">
        Every date your family&rsquo;s traditions fall on this year, and where
        each one came from. Thali calculates the lunar dates for {PLACE};
        an Islamic month begins on a local sighting of the crescent, and some
        tithi dates fall close enough to sunrise that panchangs differ. Where
        yours differs, set it here &mdash; your date wins, and only the date
        changes. The fast&rsquo;s food rules stay exactly as they are.
      </p>

      {!yearIsCovered(year) && (
        <p className="od-warn">
          Thali holds calculated dates for {YEARS.join(' and ')}. For {year} you can
          still add your own.
        </p>
      )}

      <ul className="od-list">
        {ids.map((id) => {
          const template = templateFor(id)
          const rows = occurrencesOf(id, year, overrides)
          const open = openId === id
          return (
            <li key={id} className="od-tradition">
              <button type="button" className="od-toggle" aria-expanded={open}
                onClick={() => setOpenId(open ? null : id)}>
                <span className="od-name">{template.name}</span>
                <span className="od-count">
                  {rows.length === 0
                    ? 'no dates yet'
                    : `${rows.length} ${rows.length === 1 ? 'date' : 'dates'}`}
                </span>
                <span className="od-caret" aria-hidden="true">{open ? '−' : '+'}</span>
              </button>

              {open && (
                <div className="od-body">
                  {rows.length === 0 ? (
                    <p className="od-empty">
                      Thali has no date for this tradition &mdash; it is kept on
                      a day the household chooses. Add yours below.
                    </p>
                  ) : (
                    <ul className="od-dates">
                      {rows.map((entry) => {
                        const prov = provenanceOf(entry)
                        const { previous, next } = neighbouringDates(entry.date)
                        const settled = entry.source === 'override'
                        return (
                          <li key={`${entry.date}-${entry.source}`} className="od-date">
                            <span className="od-date-main">
                              <span className="od-date-when">
                                {longIso(entry.date)}
                                {entry.through && entry.through !== entry.date && (
                                  <> &ndash; {longIso(entry.through)}</>
                                )}
                              </span>
                              <span className={`chip od-chip is-${prov.tone}`}>{prov.chip}</span>
                            </span>
                            <span className="od-date-detail">{prov.detail}</span>

                            <span className="od-date-actions">
                              {entry.source === 'removed' ? (
                                <button type="button" className="od-btn"
                                  onClick={() => onChange(clearOverride(overrides, id, entry.date))}>
                                  Put it back
                                </button>
                              ) : (
                                <>
                                  {!settled && (
                                    <button type="button" className="od-btn is-yes"
                                      onClick={() => onChange(confirmDate(overrides, id, entry.date))}>
                                      That&rsquo;s right
                                    </button>
                                  )}
                                  <button type="button" className="od-btn"
                                    onClick={() => onChange(moveDate(
                                      overrides, id, entry.movedFrom || entry.date, previous))}>
                                    Day before
                                  </button>
                                  <button type="button" className="od-btn"
                                    onClick={() => onChange(moveDate(
                                      overrides, id, entry.movedFrom || entry.date, next))}>
                                    Day after
                                  </button>
                                  <button type="button" className="od-btn is-quiet"
                                    onClick={() => onChange(removeDate(
                                      overrides, id, entry.movedFrom || entry.date))}>
                                    We don&rsquo;t keep this
                                  </button>
                                  {settled && (
                                    <button type="button" className="od-btn is-quiet"
                                      onClick={() => onChange(clearOverride(
                                        overrides, id, entry.addedByFamily
                                          ? entry.date
                                          : (entry.movedFrom || entry.date)))}>
                                      {entry.addedByFamily ? 'Delete' : 'Use Thali’s date'}
                                    </button>
                                  )}
                                </>
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="od-add">
                    <label htmlFor={`od-add-${id}`} className="od-add-label">
                      Add a date for {template.name}
                    </label>
                    <div className="od-add-row">
                      <input id={`od-add-${id}`} type="date" className="od-input"
                        value={draft[id]?.date || ''}
                        min={`${year}-01-01`} max={`${year}-12-31`}
                        onChange={(e) => setDraftFor(id, { date: e.target.value })} />
                      <input type="date" className="od-input"
                        aria-label={`Last day, if ${template.name} runs more than one day`}
                        value={draft[id]?.through || ''}
                        min={draft[id]?.date || `${year}-01-01`} max={`${year}-12-31`}
                        placeholder="through"
                        onChange={(e) => setDraftFor(id, { through: e.target.value })} />
                      <button type="button" className="od-btn is-yes"
                        disabled={!draft[id]?.date}
                        onClick={() => submitAdd(id)}>
                        Add
                      </button>
                    </div>
                    <p className="od-add-hint">
                      The second date is optional, for a tradition that runs
                      more than one day. Whatever you add keeps this
                      tradition&rsquo;s own food rules.
                    </p>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
