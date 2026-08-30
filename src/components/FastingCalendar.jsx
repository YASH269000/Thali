import { useEffect, useMemo, useRef, useState } from 'react'
import { fastingYear } from '../lib/fastingRules.js'
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
 * Lunar observances come from the calendar2026 rows in the fasting database;
 * weekly ones (Somvar, Shanivar) are derived from tradition frequency. Both
 * are merged by fastingYear(), which is a loop over the same fastingMonth()
 * the single-month view used — so the weekday-authoritative rules that keep
 * Sawan Somvar on its four Mondays are inherited rather than reimplemented.
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
  const rootRef = useRef(null)

  const year = today.getFullYear()
  const todayMonth = today.getMonth()

  const data = useMemo(() => fastingYear(family, year), [family, year])

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

  return (
    <section className="fc" aria-labelledby="fc-heading" ref={rootRef}>
      <h2 id="fc-heading" className="section-heading">
        Fasting calendar &mdash; {year}
      </h2>

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
                      isToday(mo.month, d.day) ? 'is-today' : '',
                      pinned === key ? 'is-pinned' : '',
                    ].filter(Boolean).join(' ')

                    if (!d.isFasting) {
                      return <span key={d.day} className={cls}>{d.day}</span>
                    }

                    const label = `${longDate(mo.month, d.day)} — ${d.labels.join(', ')} · ${joinNames(d.entries.map((e) => displayName(e.memberName)))}`

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

        {/* The weekly fasts are computed from tradition frequency and so are
            complete. The lunar ones are read from 25 curated calendar rows,
            which is far short of a full lunar year — Ekadashi alone falls
            about twice a month. Saying so is better than letting a sparse
            year read as a broken calendar. */}
        <p className="fc-coverage">
          Weekly fasts are calculated for the whole year. Lunar observances
          &mdash; Ekadashi, Navratri, Ramadan and the rest &mdash; are shown
          from the dated entries in Thali&rsquo;s fasting database, which
          currently covers the major days rather than every occurrence. Check
          your own panchang for dates it does not list.
        </p>
      </div>
    </section>
  )
}
