import { useEffect, useMemo, useRef, useState } from 'react'
import { fastingYear } from '../lib/fastingRules.js'
import { CONFIDENCE_LABEL, PLACE, YEARS, yearIsCovered } from '../lib/observances.js'
import {
  confirmDate, loadOverrides, moveDate, neighbouringDates, saveOverrides,
} from '../lib/observanceOverrides.js'
import { displayName, joinNames } from '../lib/names.js'
import './FastingCalendar.css'

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const dayKey = (year, month, day) => `${year}-${month}-${day}`

/**
 * The family's fasting year at a glance — twelve mini-months.
 *
 * Lunar observances are computed by the calendar engine and read from the
 * generated observance table; weekly ones (Somvar, Shanivar) are derived from
 * tradition frequency. Both are merged by fastingYear(), which is a loop over
 * the same fastingMonth() the single-month view used.
 *
 * A handful of dates each year carry a question rather than an answer, and
 * those get a prompt above the grid instead of a footnote below it. A family
 * that keeps Ekadashi needs to know BEFORE the day which of two days it is;
 * a caveat under the summary would be read afterwards, if at all.
 *
 * At this scale a fasting day is a dot under the numeral, not a filled cell:
 * twelve months of filled cells reads as noise. There is one shared detail
 * strip instead of a popover per day, because a ~22px hover target is not
 * usable on a phone and 300-odd absolutely positioned tooltips clip at every
 * grid edge.
 */
export default function FastingCalendar({ family, today = new Date() }) {
  // Hover previews; a tap or click pins. The strip shows the preview when
  // there is one, otherwise whatever is pinned, otherwise today.
  const [hovered, setHovered] = useState(null)
  const [pinned, setPinned] = useState(null)
  const [overrides, setOverrides] = useState(loadOverrides)
  const rootRef = useRef(null)

  const year = today.getFullYear()
  const todayMonth = today.getMonth()

  const data = useMemo(() => fastingYear(family, year, overrides), [family, year, overrides])

  const answer = (next) => {
    setOverrides(next)
    saveOverrides(next)
  }

  // key -> the day record, so the detail strip is a lookup rather than a scan.
  const byKey = useMemo(() => {
    const map = new Map()
    for (const mo of data.months) {
      for (const d of mo.days) {
        if (d.isFasting) map.set(dayKey(year, mo.month, d.day), { ...d, month: mo.month })
      }
    }
    return map
  }, [data, year])

  useEffect(() => {
    if (pinned === null) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setPinned(null) }
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setPinned(null) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [pinned])

  if (family.length === 0) return null

  const isToday = (month, day) =>
    day === today.getDate() && month === todayMonth && year === today.getFullYear()

  const shown = byKey.get(hovered) || byKey.get(pinned)
    || byKey.get(dayKey(year, todayMonth, today.getDate())) || null

  const withFasts = data.perMember.filter((p) => p.dayCount > 0)

  const longDate = (month, day) => {
    const d = new Date(year, month, day)
    return `${WEEKDAY_NAMES[d.getDay()]} ${day} ${MONTH_NAMES[month]}`
  }

  // The confirmation rows carry ISO dates rather than a month and a day, and
  // parsing one back through the local Date constructor is how an off-by-one
  // gets in. Split the string instead.
  const longIso = (isoDate) => {
    const [y, m, d] = isoDate.split('-').map(Number)
    return `${longDate(m - 1, d)}${y === year ? '' : ` ${y}`}`
  }

  return (
    <section className="fc" aria-labelledby="fc-heading" ref={rootRef}>
      <h2 id="fc-heading" className="section-heading">
        Fasting calendar &mdash; {year}
      </h2>

      {data.confirmations.length > 0 && (
        <div className="fc-confirm" role="group" aria-labelledby="fc-confirm-head">
          <h3 id="fc-confirm-head" className="fc-confirm-head">
            {data.confirmations.length === 1
              ? 'One date this year is worth confirming'
              : `${data.confirmations.length} dates this year are worth confirming`}
          </h3>
          <p className="fc-confirm-why">
            These fall on a tithi boundary tight enough that a quarter of an hour
            either way moves them to the next day &mdash; far more than the
            calculation could be wrong by, but enough that panchangs legitimately
            differ. Every other date this year is settled. Check yours and tell
            Thali; your answer overrides the calculation from then on.
          </p>
          <ul className="fc-confirm-list">
            {data.confirmations.map((o) => {
              const { previous, next } = neighbouringDates(o.date)
              return (
                <li key={`${o.id}@${o.date}`} className="fc-confirm-row">
                  <span className="fc-confirm-what">
                    <strong>{o.name}</strong>
                    <span className="fc-confirm-date">{longIso(o.date)}</span>
                  </span>
                  <span className="fc-confirm-actions">
                    <button type="button" className="fc-confirm-btn is-yes"
                      onClick={() => answer(confirmDate(overrides, o.id, o.date))}>
                      That&rsquo;s right
                    </button>
                    <button type="button" className="fc-confirm-btn"
                      onClick={() => answer(moveDate(overrides, o.id, o.date, previous))}>
                      Day before
                    </button>
                    <button type="button" className="fc-confirm-btn"
                      onClick={() => answer(moveDate(overrides, o.id, o.date, next))}>
                      Day after
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="fc-card">
        <div className="fc-year" onMouseLeave={() => setHovered(null)}>
          {data.months.map((mo) => {
            const past = mo.month < todayMonth
            const current = mo.month === todayMonth
            const classes = [
              'fc-month',
              past ? 'is-past' : '',
              current ? 'is-current' : '',
            ].filter(Boolean).join(' ')

            return (
              <div key={mo.month} className={classes}>
                <h3 className="fc-month-name">
                  {MONTH_NAMES[mo.month]}
                  {current && <span className="fc-month-tag">This month</span>}
                </h3>

                <div className="fc-mini" role="grid"
                  aria-label={`${MONTH_NAMES[mo.month]} ${year}`}>
                  {WEEKDAY_INITIALS.map((d, i) => (
                    <span key={i} className="fc-weekday" aria-label={WEEKDAY_NAMES[i]}>{d}</span>
                  ))}

                  {Array.from({ length: mo.firstWeekday }, (_, i) => (
                    <span key={`blank-${i}`} className="fc-blank" />
                  ))}

                  {mo.days.map((d) => {
                    const key = dayKey(year, mo.month, d.day)
                    const cls = [
                      'fc-day',
                      d.isFasting ? 'is-fasting' : '',
                      d.needsConfirmation ? 'is-unconfirmed' : '',
                      isToday(mo.month, d.day) ? 'is-today' : '',
                      pinned === key ? 'is-pinned' : '',
                    ].filter(Boolean).join(' ')

                    if (!d.isFasting) {
                      return <span key={d.day} className={cls}>{d.day}</span>
                    }

                    const label = `${longDate(mo.month, d.day)} — ${d.labels.join(', ')} · ${joinNames(d.entries.map((e) => displayName(e.memberName)))}${d.needsConfirmation ? ' · date not yet confirmed' : ''}`

                    return (
                      <button key={d.day} type="button" className={cls}
                        aria-label={label} aria-pressed={pinned === key}
                        data-fast-day={key}
                        onMouseEnter={() => setHovered(key)}
                        onFocus={() => setHovered(key)}
                        onBlur={() => setHovered((cur) => (cur === key ? null : cur))}
                        onClick={() => setPinned((cur) => (cur === key ? null : key))}>
                        {d.day}
                        <span className="fc-dot" aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="fc-detail" role="status" aria-live="polite">
          {shown ? (
            <>
              <span className="fc-detail-date">{longDate(shown.month, shown.day)}</span>
              <span className="fc-detail-fasts">
                {shown.labels.map((l) => (
                  <span key={l} className="chip chip-fast">{l}</span>
                ))}
              </span>
              <span className="fc-detail-who">
                {joinNames(shown.entries.map((e) => displayName(e.memberName)))}
              </span>
              {shown.observances.length > 0 && (
                <span className="fc-detail-basis">
                  {[...new Set(shown.observances.map((o) => (o.source === 'override'
                    ? 'Confirmed by your family'
                    : CONFIDENCE_LABEL[o.confidence] || o.confidence)))].join(' · ')}
                </span>
              )}
            </>
          ) : (
            <span className="fc-detail-empty">
              Hover or tap a marked day to see the fast and who observes it.
            </span>
          )}
        </div>

        <div className="fc-legend">
          <span><span className="fc-swatch is-fasting" aria-hidden="true" /> Fasting day for at least one member</span>
          <span><span className="fc-swatch is-today" aria-hidden="true" /> Today</span>
        </div>
      </div>

      <div className="fc-summary">
        <p className="fc-summary-head">
          {year}: <strong>{data.totalFastingDays}</strong>{' '}
          {data.totalFastingDays === 1 ? 'fasting day' : 'fasting days'} across your family.
        </p>

        {withFasts.length > 0 ? (
          <ul className="fc-summary-list">
            {withFasts.map((p) => (
              <li key={p.memberId}>
                <span className="fc-summary-name">{displayName(p.name)}:</span>{' '}
                {p.dayCount} {p.dayCount === 1 ? 'day' : 'days'}
                {p.breakdown.length > 0 && (
                  <span className="fc-summary-detail">
                    {' '}({p.breakdown.map((b) => `${b.label}${b.count > 1 ? ` × ${b.count}` : ''}`).join(', ')})
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="fc-summary-detail">
            No fasting days in {year} for anyone in the family.
          </p>
        )}

        {/* The sparse-calendar caveat this replaces was true and is not any
            more: the lunar dates came from 25 curated rows, so a year with
            twenty-four Ekadashis showed two of them. Both halves are now
            complete for the years the engine has been run for, and the note
            says what the dates actually rest on instead of apologising for
            what is missing. */}
        <p className="fc-coverage">
          Weekly fasts are calculated for the whole year. Lunar dates &mdash;
          Ekadashi, Navratri, the Chaturthis and the rest &mdash; are computed
          from the moon and the sun for {PLACE}, where a marginal date can
          differ from one further south or east. Jain sect calendars, the Sikh
          Gurpurabs and the Islamic dates are not calculated: the first two are
          set by each order, and an Islamic month begins on a local sighting of
          the crescent, so those are marked as curated or provisional wherever
          they appear.
          {!yearIsCovered(year) && (
            <>
              {' '}Thali holds calculated dates for {YEARS.join(' and ')} only,
              so {year} shows weekly fasts alone &mdash; check your own panchang
              for the rest.
            </>
          )}
        </p>
      </div>
    </section>
  )
}
