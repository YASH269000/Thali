import { displayName } from '../lib/names.js'
import './PerMemberDisplay.css'

/**
 * Who a dish actually serves.
 *
 * Three shapes, in order of how much the reader needs to know:
 *   everyone eligible      -> "Serves everyone (Yash, Vrinda, Sumitra, Binod)"
 *   someone excluded       -> "Serves Yash, Vrinda, Binod · Not for Sumitra (high glycemic load)"
 *   a substitute suggested -> plus a callout naming what they get instead
 */
export default function PerMemberDisplay({ dish }) {
  const serves = dish.servesMembers || []
  const excluded = dish.excludedMembers || []
  const substitutes = dish.substitutes || []

  if (serves.length === 0 && excluded.length === 0) return null

  const servedNames = serves.map((m) => displayName(m.name))
  const nobodyExcluded = excluded.length === 0

  return (
    <div className="pmd">
      <p className="pmd-line">
        {nobodyExcluded ? (
          <>
            <span className="pmd-label">Serves everyone</span>
            {servedNames.length > 0 && (
              <span className="pmd-names"> ({servedNames.join(', ')})</span>
            )}
          </>
        ) : (
          <>
            {servedNames.length > 0 && (
              <>
                <span className="pmd-label">Serves</span>
                <span className="pmd-names"> {servedNames.join(', ')}</span>
              </>
            )}
            {excluded.map((m) => (
              <span key={m.memberId} className="pmd-excluded">
                {servedNames.length > 0 && <span className="pmd-sep"> · </span>}
                Not for {displayName(m.name)}
                {m.reason && <span className="pmd-reason"> ({m.reason})</span>}
              </span>
            ))}
          </>
        )}
      </p>

      {substitutes.map((s) => (
        <p key={s.memberId} className="pmd-substitute">
          <span className="pmd-arrow" aria-hidden="true">&rarr;</span>
          {displayName(s.name)} gets: <strong>{s.substituteDish}</strong>
          {s.note && <span className="pmd-reason"> ({s.note})</span>}
        </p>
      ))}
    </div>
  )
}
