import { useState } from 'react'
import { DIET_LABEL, FAST_LABEL } from '../data/memberOptions.js'
import './WhyThisMeal.css'

/**
 * The constraint work, made visible.
 *
 * Collapsed by default and opened from a link beside the plan header: this is
 * an explanation, not a wall between a family and their food. Everything in it
 * was already decided when the plan was built — see src/lib/explainPlan.js —
 * so opening it costs nothing but a render.
 *
 * It says what Thali did and who it did it for. It makes no claim about
 * anyone's health: "Sumitra needs low-GI food" restates a setting the family
 * entered, and the dish notes describe the food. The plan's disclaimer still
 * applies and is repeated at the foot of the panel.
 */

const SOURCE_LABEL = {
  diet: (v) => DIET_LABEL[v] || v,
  religion: (v) => v,
  fast: (v) => FAST_LABEL[v] || v,
  allergy: (v) => `${v} allergy`,
  health: (v) => v,
}

const SOURCE_CHIP = {
  diet: 'chip-diet',
  religion: 'chip-stage',
  fast: 'chip-fast',
  allergy: 'chip-health',
  health: 'chip-health',
}

function Funnel({ funnel }) {
  const rows = [
    ['In Thali’s recipe book', funnel.catalogue],
    ['Everyone here can eat', funnel.afterConstraints],
    ['Set aside for someone’s constraint', funnel.setAside],
    ['Servable with one change', funnel.needsAChange],
    ['Shaped like this meal', funnel.fitsThisMeal],
    ['Offered to the planner', funnel.offeredToTheModel],
  ].filter(([, n]) => Number.isFinite(n))

  return (
    <ol className="why-funnel">
      {rows.map(([label, n]) => (
        <li key={label}>
          <span className="why-funnel-n">{n.toLocaleString('en-IN')}</span>
          <span className="why-funnel-label">{label}</span>
        </li>
      ))}
    </ol>
  )
}

export default function WhyThisMeal({ explanation }) {
  const [open, setOpen] = useState(false)
  if (!explanation) return null

  const { funnel, constraints = [], reasons = [], moreReasons = 0 } = explanation
  const people = constraints.length
  const constrained = constraints.filter((c) => c.sources.length > 0)

  return (
    <section className="why-panel">
      <button type="button" className="link-btn why-toggle"
        onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Hide why this meal' : 'Why this meal?'}
      </button>

      {open && (
        <div className="why-body">
          <p className="why-lede">
            Thali checked {funnel.catalogue?.toLocaleString('en-IN')} recipes against{' '}
            {people} {people === 1 ? 'person' : 'people'} eating today, then asked the
            planner to build a meal from what was left.
          </p>

          <h3 className="why-heading">What everyone needs today</h3>
          {constrained.length === 0 ? (
            <p className="why-empty">
              Nobody eating today has a diet, allergy, fast or condition recorded,
              so the whole recipe book was available.
            </p>
          ) : (
            <ul className="why-people">
              {constrained.map((c) => (
                <li key={c.memberId}>
                  <span className="why-name">
                    {c.name}
                    {c.isGuest && <span className="why-guest"> (guest)</span>}
                  </span>
                  <span className="why-sources">
                    {c.sources.map((s) => (
                      <span key={`${s.kind}-${s.label}`} className={`chip ${SOURCE_CHIP[s.kind]}`}>
                        {(SOURCE_LABEL[s.kind] || ((v) => v))(s.label)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="why-heading">How the choices narrowed</h3>
          <Funnel funnel={funnel} />

          {reasons.length > 0 && (
            <>
              <h3 className="why-heading">What was set aside, and why</h3>
              <p className="why-note">
                A few examples of each. Where a dish failed more than one
                constraint, only the first is named.
              </p>
              <ul className="why-reasons">
                {reasons.map((r) => (
                  <li key={`${r.memberId}-${r.because}-${r.kind}`}>
                    <p className="why-reason-head">
                      <strong>{r.count.toLocaleString('en-IN')}</strong>{' '}
                      {r.count === 1 ? 'dish' : 'dishes'} &mdash; {r.member} {r.because}
                    </p>
                    <ul className="why-examples">
                      {r.examples.map((x) => (
                        <li key={x.recipeId}>
                          <span className="why-dish">{x.name}</span>
                          {x.detail && <span className="why-detail"> &mdash; {x.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {moreReasons > 0 && (
                <p className="why-note">
                  and {moreReasons} other {moreReasons === 1 ? 'reason' : 'reasons'} with
                  fewer dishes behind them.
                </p>
              )}
            </>
          )}

          <p className="why-disclaimer">
            This explains what Thali did with the settings you entered. It is not
            medical or nutritional advice, and it is not a judgement about any
            dish or anyone eating &mdash; always read the ingredients yourself.
          </p>
        </div>
      )}
    </section>
  )
}
