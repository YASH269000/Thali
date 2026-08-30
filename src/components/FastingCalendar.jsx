import { useEffect, useMemo, useRef, useState } from 'react'
import { fastingMonth } from '../lib/fastingRules.js'
import { displayName, joinNames } from '../lib/names.js'
import './FastingCalendar.css'

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Month-at-a-glance of everyone's fasting days.
 *
 * Lunar observances come from the calendar2026 rows in the fasting database;
 * weekly ones (Somvar, Shanivar) are derived from tradition frequency. Both
 * are merged by fastingMonth().
 */
export default function FastingCalendar({ family, today = new Date() }) {
  const [openDay, setOpenDay] = useState(null)
  const rootRef = useRef(null)

  const year = today.getFullYear()
  const month = today.getMonth()

  const data = useMemo(() => fastingMonth(family, year, month), [family, year, month])

  useEffect(() => {
    if (openDay === null) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpenDay(null) }
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpenDay(null) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [openDay])

  if (family.length === 0) return null

  const isToday = (day) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  // Leading blanks so day 1 lands under its weekday column.
  const leading = Array.from({ length: data.firstWeekday }, (_, i) => i)

  const withFasts = data.perMember.filter((p) => p.dayCount > 0)

  return (
    <section className="fc" aria-labelledby="fc-heading" ref={rootRef}>
      <h2 id="fc-heading" className="section-heading">
        Fasting calendar &mdash; {MONTH_NAMES[month]} {year}
      </h2>

      <div className="fc-card">
        <div className="fc-grid" role="grid" aria-label={`${MONTH_NAMES[month]} ${year}`}>
          {WEEKDAY_INITIALS.map((d, i) => (
            <span key={i} className="fc-weekday" aria-label={WEEKDAY_NAMES[i]}>{d}</span>
          ))}

          {leading.map((i) => <span key={`blank-${i}`} className="fc-blank" />)}

          {data.days.map((d) => {
            const open = openDay === d.day
            const classes = [
              'fc-day',
              d.isFasting ? 'is-fasting' : '',
              isToday(d.day) ? 'is-today' : '',
            ].filter(Boolean).join(' ')

            const label = d.isFasting
              ? `${SHORT_MONTHS[month]} ${d.day} — ${d.labels[0]} · ${joinNames(d.entries.map((e) => displayName(e.memberName)))}`
              : `${SHORT_MONTHS[month]} ${d.day}`

            return (
              <span key={d.day} className="fc-cell">
                {d.isFasting ? (
                  <button type="button" className={classes} aria-label={label}
                    aria-expanded={open}
                    onClick={() => setOpenDay(open ? null : d.day)}
                    onMouseEnter={() => setOpenDay(d.day)}
                    onMouseLeave={() => setOpenDay((cur) => (cur === d.day ? null : cur))}>
                    {d.day}
                  </button>
                ) : (
                  <span className={classes}>{d.day}</span>
                )}

                {open && d.isFasting && (
                  <span className="fc-pop" role="tooltip">
                    <span className="fc-pop-date">{SHORT_MONTHS[month]} {d.day}</span>
                    {d.labels.map((l) => <span key={l} className="fc-pop-fast">{l}</span>)}
                    <span className="fc-pop-who">
                      {joinNames(d.entries.map((e) => displayName(e.memberName)))}
                    </span>
                  </span>
                )}
              </span>
            )
          })}
        </div>

        <div className="fc-legend">
          <span><span className="fc-swatch is-fasting" aria-hidden="true" /> Fasting day for at least one member</span>
          <span><span className="fc-swatch is-today" aria-hidden="true" /> Today</span>
        </div>
      </div>

      <div className="fc-summary">
        <p className="fc-summary-head">
          This month: <strong>{data.totalFastingDays}</strong>{' '}
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
            No fasting days this month for anyone in the family.
          </p>
        )}
      </div>
    </section>
  )
}
