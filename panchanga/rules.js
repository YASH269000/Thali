// Traditions carry their rule; the engine resolves the date.
//
// The alternative — a hand-typed list of dates per year — is what the app has
// now, and it expires. A rule does not: "Ekadashi is the 11th tithi of both
// fortnights" is as true in 2043 as in 2026, and an Adhik Maas year grows two
// extra Ekadashis without anyone editing a table.
//
// A NOTE ON MONTH RECKONING, because it is the commonest source of a one-month
// error. Months here are AMANTA (new moon to new moon), which is the reckoning
// the intercalation rule needs. Much of North India names months PURNIMANTA
// (full moon to full moon), and the two disagree by one month for the dark
// fortnight only: purnimanta Bhadrapada Krishna is amanta Shravana Krishna.
// So Janmashtami, universally described as Bhadrapada Krishna Ashtami, is
// written below as Shravana krishna. The `alsoKnownAs` field records the
// purnimanta name so the discrepancy is documented rather than discovered.

export const PAKSHA_BOTH = 'both'

/**
 * @typedef {object} TithiRule
 * @property {string} id
 * @property {string} name
 * @property {string} religion
 * @property {number} tithi     1–15 within the paksha
 * @property {string} paksha    'shukla' | 'krishna' | 'both'
 * @property {string|null} masa amanta month name, or null for every month
 */
export const TITHI_RULES = [
  {
    id: 'ekadashi_vrat',
    name: 'Ekadashi Vrat',
    religion: 'Hindu',
    tithi: 11,
    paksha: PAKSHA_BOTH,
    masa: null,
    viddha: 'arunodaya',
    note: 'Twice a lunar month. An Adhik Maas adds a third pair, Padmini and Parama.',
  },
  {
    id: 'pradosh_vrat',
    name: 'Pradosh Vrat',
    religion: 'Hindu',
    tithi: 13,
    paksha: PAKSHA_BOTH,
    masa: null,
    observedAt: 'sunset',
    resolveAt: 'pradosh',
    note: 'Kept in the twilight window from sunset; Trayodashi need only overlap it.',
  },
  {
    id: 'sankashti_chaturthi',
    name: 'Sankashti Chaturthi',
    religion: 'Hindu',
    tithi: 4,
    paksha: 'krishna',
    masa: null,
    observedAt: 'moonrise',
    resolveAt: 'moonrise',
    note: 'Broken at moonrise, so moonrise time is part of the answer, not a detail.',
  },
  {
    id: 'purnima',
    name: 'Purnima',
    religion: 'Hindu',
    tithi: 15,
    paksha: 'shukla',
    masa: null,
  },
  {
    id: 'amavasya',
    name: 'Amavasya',
    religion: 'Hindu',
    tithi: 15,
    paksha: 'krishna',
    masa: null,
  },
  {
    id: 'janmashtami',
    name: 'Krishna Janmashtami',
    religion: 'Hindu',
    tithi: 8,
    paksha: 'krishna',
    masa: 'Shravana',
    resolveAt: 'nishita',
    alsoKnownAs: 'Bhadrapada Krishna Ashtami (purnimanta)',
  },
  {
    id: 'maha_shivaratri',
    name: 'Maha Shivaratri',
    religion: 'Hindu',
    tithi: 14,
    paksha: 'krishna',
    masa: 'Magha',
    resolveAt: 'nishita',
    alsoKnownAs: 'Phalguna Krishna Chaturdashi (purnimanta)',
  },
  {
    id: 'karwa_chauth',
    name: 'Karwa Chauth',
    religion: 'Hindu',
    tithi: 4,
    paksha: 'krishna',
    masa: 'Ashwin',
    observedAt: 'moonrise',
    resolveAt: 'moonrise',
    alsoKnownAs: 'Kartika Krishna Chaturthi (purnimanta)',
  },
  {
    id: 'hariyali_teej',
    name: 'Hariyali Teej',
    religion: 'Hindu',
    tithi: 3,
    paksha: 'shukla',
    masa: 'Shravana',
  },
  {
    id: 'ganesh_chaturthi',
    name: 'Ganesh Chaturthi',
    religion: 'Hindu',
    tithi: 4,
    paksha: 'shukla',
    masa: 'Bhadrapada',
    resolveAt: 'madhyahna',
  },
  {
    id: 'jain_chaturdashi',
    name: 'Jain Chaturdashi',
    religion: 'Jain',
    tithi: 14,
    paksha: PAKSHA_BOTH,
    masa: null,
  },
]

/**
 * The 24 named Ekadashis, plus the two that exist only in an Adhik Maas.
 *
 * Keyed by amanta month and paksha. In amanta reckoning the bright fortnight
 * comes first, so Padmini (shukla) precedes Parama (krishna) inside the same
 * intercalary month.
 */
export const EKADASHI_NAMES = {
  'Chaitra|shukla': 'Kamada', 'Chaitra|krishna': 'Varuthini',
  'Vaishakha|shukla': 'Mohini', 'Vaishakha|krishna': 'Apara',
  'Jyeshtha|shukla': 'Nirjala', 'Jyeshtha|krishna': 'Yogini',
  'Ashadha|shukla': 'Devshayani', 'Ashadha|krishna': 'Kamika',
  'Shravana|shukla': 'Shravana Putrada', 'Shravana|krishna': 'Aja',
  'Bhadrapada|shukla': 'Parsva', 'Bhadrapada|krishna': 'Indira',
  'Ashwin|shukla': 'Papankusha', 'Ashwin|krishna': 'Rama',
  'Kartika|shukla': 'Devutthana', 'Kartika|krishna': 'Utpanna',
  'Margashirsha|shukla': 'Mokshada', 'Margashirsha|krishna': 'Saphala',
  'Pausha|shukla': 'Pausha Putrada', 'Pausha|krishna': 'Shattila',
  'Magha|shukla': 'Jaya', 'Magha|krishna': 'Vijaya',
  'Phalguna|shukla': 'Amalaki', 'Phalguna|krishna': 'Papamochani',
  // Present only when the year has an intercalary month.
  'Adhika|shukla': 'Padmini', 'Adhika|krishna': 'Parama',
}

/** The name of an Ekadashi, given its month and fortnight. */
export function ekadashiName(month, paksha) {
  if (month.adhika) return EKADASHI_NAMES[`Adhika|${paksha}`]
  return EKADASHI_NAMES[`${month.name}|${paksha}`] || null
}
