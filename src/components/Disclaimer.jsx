import './Disclaimer.css'

/**
 * App-wide statement that Thali is a convenience, not clinical guidance.
 *
 * The per-condition notes in the member form say which individual conditions
 * Thali does not filter for. This says the broader thing those notes imply:
 * even the constraints Thali does enforce are pattern-matching over a recipe
 * table, not dietetics. Deliberately quiet — a permanent footer that shouts
 * gets tuned out, and this needs to still register on the day it matters.
 */
export default function Disclaimer() {
  return (
    <footer className="app-disclaimer">
      <p>
        Thali suggests meals for convenience. It is <strong>not medical or
        nutritional advice</strong>. If anyone eating has a health condition,
        an allergy, or takes medication, check with a doctor or dietitian
        before relying on a plan — and always read the ingredients yourself.
      </p>
    </footer>
  )
}
