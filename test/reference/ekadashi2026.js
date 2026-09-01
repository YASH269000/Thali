// The user-supplied 2026 Ekadashi comparison table.
//
// 24 rows, Delhi/IST, Smarta unless noted, compiled from Drik Panchang,
// ISKCON Bangalore and Indian panchang media. This is the second comparison
// source the brief promised and is treated as a peer, not as ground truth —
// disagreements are reported in both directions.
//
// The month column is transcribed exactly as given. That matters: the source
// labels the dark fortnight inconsistently, and the diff below is what
// surfaced it.

export const EKADASHI_2026 = [
  ['2026-01-14', 'Shattila', 'krishna', 'Pausha', 'HIGH', 'Also Makar Sankranti'],
  ['2026-01-29', 'Jaya', 'shukla', 'Magha', 'HIGH', ''],
  ['2026-02-13', 'Vijaya', 'krishna', 'Magha', 'HIGH', ''],
  ['2026-02-27', 'Amalaki', 'shukla', 'Phalguna', 'HIGH', ''],
  ['2026-03-15', 'Papmochani', 'krishna', 'Phalguna', 'HIGH', ''],
  ['2026-03-29', 'Kamada', 'shukla', 'Chaitra', 'HIGH', ''],
  ['2026-04-13', 'Varuthini', 'krishna', 'Vaishakha', 'HIGH', ''],
  ['2026-04-27', 'Mohini', 'shukla', 'Vaishakha', 'HIGH', ''],
  ['2026-05-13', 'Apara', 'krishna', 'Jyeshtha', 'HIGH', ''],
  ['2026-05-27', 'Padmini', 'shukla', 'Adhika Jyeshtha', 'HIGH',
    'Drik Panchang (New Delhi): tithi 26 May 05:10 → 27 May 06:21, observed 27 May by Udaya Tithi'],
  ['2026-06-11', 'Parama', 'krishna', 'Adhika Jyeshtha', 'MED', 'per AstroSight 2026 list'],
  ['2026-06-25', 'Nirjala', 'shukla', 'Jyeshtha', 'HIGH',
    'Drik Panchang: tithi 24 Jun 18:12 → 25 Jun 20:09, parana 26 Jun 06:00–08:39'],
  ['2026-07-10', 'Yogini', 'krishna', 'Ashadha', 'HIGH', ''],
  ['2026-07-25', 'Devshayani', 'shukla', 'Ashadha', 'HIGH', 'Chaturmas begins'],
  ['2026-08-09', 'Kamika', 'krishna', 'Shravana', 'HIGH', ''],
  ['2026-08-23', 'Shravana Putrada', 'shukla', 'Shravana', 'HIGH', ''],
  ['2026-09-07', 'Aja', 'krishna', 'Bhadrapada', 'HIGH', ''],
  ['2026-09-22', 'Parsva', 'shukla', 'Bhadrapada', 'HIGH', ''],
  ['2026-10-06', 'Indira', 'krishna', 'Ashwina', 'HIGH', ''],
  ['2026-10-22', 'Papankusha', 'shukla', 'Ashwina', 'HIGH', ''],
  ['2026-11-05', 'Rama', 'krishna', 'Kartika', 'HIGH', ''],
  ['2026-11-20', 'Devutthana', 'shukla', 'Kartika', 'HIGH', 'Chaturmas ends'],
  ['2026-12-04', 'Utpanna', 'krishna', 'Margashirsha', 'HIGH', ''],
  ['2026-12-20', 'Mokshada', 'shukla', 'Margashirsha', 'HIGH', 'Gita Jayanti'],
].map(([date, name, paksha, masa, confidence, note]) =>
  ({ date, name, paksha, masa, confidence, note }))

/** Drik Panchang's stated Padmini tithi window, for the reconciliation. */
export const PADMINI_WINDOW = {
  begins: { year: 2026, month: 5, day: 26, hour: 5, minute: 10 },
  ends: { year: 2026, month: 5, day: 27, hour: 6, minute: 21 },
  observed: '2026-05-27',
  rule: 'Udaya Tithi',
}

/** Names differ only in spelling between sources; compare on this. */
export function normaliseName(n) {
  return n.toLowerCase()
    .replace('papamochani', 'papmochani')
    .replace('parivartini', 'parsva')
    .replace('param', 'parama')
    .replace(/\s+/g, ' ')
    .trim()
}
