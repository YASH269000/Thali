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
 * @property {{fromTithi:number,toTithi:number}} [window] a multi-day observance:
 *   the anchor tithi is the date it is known by, and these two bound the span.
 *   Both are resolved by the same sunrise rule, so a kshaya tithi shortens the
 *   window rather than being papered over with an assumed day count.
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
    id: 'vinayaka_chaturthi',
    name: 'Vinayaka Chaturthi',
    religion: 'Hindu',
    tithi: 4,
    paksha: 'shukla',
    masa: null,
    resolveAt: 'madhyahna',
    note: 'The bright-fortnight Chaturthi, kept monthly. Bhadrapada\u2019s is Ganesh Chaturthi.',
  },
  {
    id: 'masik_durgashtami',
    name: 'Masik Durgashtami',
    religion: 'Hindu',
    tithi: 8,
    paksha: 'shukla',
    masa: null,
  },
  {
    id: 'kalashtami',
    name: 'Kalashtami',
    religion: 'Hindu',
    tithi: 8,
    paksha: 'krishna',
    masa: null,
  },
  {
    id: 'ahoi_ashtami',
    name: 'Ahoi Ashtami',
    religion: 'Hindu',
    tithi: 8,
    paksha: 'krishna',
    masa: 'Ashwin',
    alsoKnownAs: 'Kartika Krishna Ashtami (purnimanta)',
    note: 'Kept until the stars are sighted, so it ends after dark on the date given.',
  },
  {
    id: 'navratri_chaitra',
    name: 'Chaitra Navratri',
    religion: 'Hindu',
    tithi: 1,
    paksha: 'shukla',
    masa: 'Chaitra',
    window: { fromTithi: 1, toTithi: 9 },
    note: 'Nine tithis, which a kshaya tithi can compress into eight civil days \u2014 so the last day is resolved as Navami rather than assumed to be day nine.',
  },
  {
    id: 'navratri_sharad',
    name: 'Sharad Navratri',
    religion: 'Hindu',
    tithi: 1,
    paksha: 'shukla',
    masa: 'Ashwin',
    window: { fromTithi: 1, toTithi: 9 },
  },
  {
    id: 'ram_navami',
    name: 'Ram Navami',
    religion: 'Hindu',
    tithi: 9,
    paksha: 'shukla',
    masa: 'Chaitra',
  },
  {
    id: 'dussehra',
    name: 'Dussehra / Vijayadashami',
    religion: 'Hindu',
    tithi: 10,
    paksha: 'shukla',
    masa: 'Ashwin',
  },
  {
    id: 'hartalika_teej',
    name: 'Hartalika Teej',
    religion: 'Hindu',
    tithi: 3,
    paksha: 'shukla',
    masa: 'Bhadrapada',
  },
  // CHHATH IS FOUR DAYS AND FOUR DIFFERENT RULES, SO IT IS FOUR OBSERVANCES.
  //
  // It was one record with a four-day window, and that could not express what
  // the days actually are: Nahay-Khay is a satvik meal, Kharna is an evening
  // kheer that STARTS a 36-hour nirjala, Sandhya Arghya sits inside that fast
  // with no meal at all, and Usha Arghya breaks it the next morning. One
  // record carrying four sets of rules would have pushed span-awareness into
  // every consumer — each would have had to work out which day of the window
  // it was looking at before it could say anything true.
  //
  // All four resolve from the same Kartika shukla anchor, so they cannot drift
  // apart: consecutive tithis of one fortnight of one month.
  {
    id: 'chhath_nahay_khay',
    name: 'Chhath — Nahay-Khay',
    religion: 'Hindu',
    tithi: 4,
    paksha: 'shukla',
    masa: 'Kartika',
    note: 'Day one. A bath, then one satvik meal — traditionally lauki with rice and chana dal.',
  },
  {
    id: 'chhath_kharna',
    name: 'Chhath — Kharna',
    religion: 'Hindu',
    tithi: 5,
    paksha: 'shukla',
    masa: 'Kartika',
    observedAt: 'sunset',
    note: 'Day two. Fasted through the day, broken after sunset with kheer and roti — and that meal OPENS the 36-hour nirjala rather than ending anything.',
  },
  {
    id: 'chhath_sandhya_arghya',
    name: 'Chhath — Sandhya Arghya',
    religion: 'Hindu',
    tithi: 6,
    paksha: 'shukla',
    masa: 'Kartika',
    observedAt: 'sunset',
    note: 'Day three. The evening arghya to the setting sun, inside the nirjala. No food and no water all day.',
  },
  {
    id: 'chhath_usha_arghya',
    name: 'Chhath — Usha Arghya',
    religion: 'Hindu',
    tithi: 7,
    paksha: 'shukla',
    masa: 'Kartika',
    note: 'Day four. The arghya to the rising sun, after which the fast is broken. Thirty-six hours from the Kharna meal.',
  },
  {
    id: 'diwali',
    name: 'Diwali (Lakshmi Puja)',
    religion: 'Hindu',
    tithi: 15,
    paksha: 'krishna',
    masa: 'Ashwin',
    resolveAt: 'pradosh',
    alsoKnownAs: 'Kartika Krishna Amavasya (purnimanta)',
    note: 'Lakshmi Puja is kept in pradosh kaal, so it is resolved at sunset and not at sunrise like the monthly Amavasya.',
  },
  {
    id: 'mahavir_jayanti',
    name: 'Mahavir Jayanti',
    religion: 'Jain',
    tithi: 13,
    paksha: 'shukla',
    masa: 'Chaitra',
    note: 'Computable from tithi, unlike the sect-specific Jain observances \u2014 Paryushana, Das Lakshana and Navpad Oli \u2014 whose dates each order sets.',
  },
  // THE THREE THERAVADA OBSERVANCES BELOW ARE PROVISIONAL, AND VESAK WAS
  // WRONGLY NOT.
  //
  // Each is a purnima the engine resolves to the minute, and each was
  // therefore marked `computed` — the same confidence as an Ekadashi checked
  // 24 of 24 against Drik Panchang. That is not equivalent evidence. The
  // astronomy is not in question; the CALENDAR is. These are Theravada
  // observances and the Theravada calendars are not modelled here, so nothing
  // has ever checked which month the engine's Ashadha corresponds to in
  // Bangkok or Colombo.
  //
  // 2026 is the year that makes the point. It carries Adhika Jyeshtha, an
  // intercalary month sitting immediately before Ashadha, so a calendar that
  // does not insert a month there puts Asalha Puja around 30 June rather than
  // 29 July. A month apart, from one difference in an intercalation rule.
  {
    id: 'buddha_purnima',
    name: 'Buddha Purnima / Vesak',
    religion: 'Buddhist',
    tithi: 15,
    paksha: 'shukla',
    masa: 'Vaishakha',
    provisional: 'The Theravada calendars — Thai, Burmese, Sri Lankan — intercalate on a different rule from the Indian one. The engine implements the Indian rule (a lunar month with no solar ingress); the Thai calendar inserts a second Ashadha on a fixed cycle. When the two disagree the gap is a MONTH, not a day, and nothing in this repository models the Theravada reckoning to check against.',
  },
  {
    id: 'asalha_puja',
    name: 'Asalha Puja',
    religion: 'Buddhist',
    tithi: 15,
    paksha: 'shukla',
    masa: 'Ashadha',
    provisional: 'The Theravada calendars — Thai, Burmese, Sri Lankan — intercalate on a different rule from the Indian one. The engine implements the Indian rule (a lunar month with no solar ingress); the Thai calendar inserts a second Ashadha on a fixed cycle. When the two disagree the gap is a MONTH, not a day, and nothing in this repository models the Theravada reckoning to check against.',
    note: 'The Ashadha full moon, marking the first sermon. Vassa begins the day after.',
  },
  {
    id: 'magha_puja',
    name: 'Magha Puja',
    religion: 'Buddhist',
    tithi: 15,
    paksha: 'shukla',
    masa: 'Magha',
    provisional: 'The Theravada calendars — Thai, Burmese, Sri Lankan — intercalate on a different rule from the Indian one. The engine implements the Indian rule (a lunar month with no solar ingress); the Thai calendar inserts a second Ashadha on a fixed cycle. When the two disagree the gap is a MONTH, not a day, and nothing in this repository models the Theravada reckoning to check against.',
    note: 'The Magha full moon, marking the spontaneous assembly of 1,250 arahants.',
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
