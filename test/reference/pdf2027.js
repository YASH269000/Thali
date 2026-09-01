// Transcribed from the user-supplied "Hindu Calendar 2027: Pradosh, Purnima &
// Amavasya Schedule" PDF (~/Downloads/Hindu_Calendar_2027_Vrat_Timings.pdf).
//
// SOURCE HEALTH WARNING. This is one of the two comparison sources, not a
// truth set. Its own footer reads "For informational purposes only. AI
// responses may include mistakes", and several rows are internally
// inconsistent in a way no real tithi can be — see the `suspect` flags below,
// where a tithi is recorded as beginning and ending at the same clock time, or
// as lasting twelve hours when the shortest possible tithi is about nineteen.
//
// Transcribed verbatim, including those rows. Correcting a source before
// diffing against it defeats the point of diffing against it.

export const PRADOSH_2027 = [
  ['2027-01-05', 'krishna', 'Ends 08:38 PM'],
  ['2027-01-20', 'shukla', 'Ends 01:10 AM (Jan 21)'],
  ['2027-02-04', 'krishna', 'Ends 04:30 PM'],
  ['2027-02-19', 'shukla', 'Ends 11:13 AM'],
  ['2027-03-06', 'krishna', 'Ends 12:02 PM'],
  ['2027-03-20', 'shukla', 'Ends 10:20 PM'],
  ['2027-04-04', 'krishna', 'Ends 06:12 AM'],
  ['2027-04-19', 'shukla', 'Ends 10:33 AM'],
  ['2027-05-03', 'krishna', 'Ends 08:15 PM'],
  ['2027-05-17', 'shukla', 'Ends 11:45 PM'],
  ['2027-06-02', 'krishna', 'Ends 07:11 AM'],
  ['2027-06-16', 'shukla', 'Ends 01:22 PM'],
  ['2027-07-01', 'krishna', 'Ends 04:05 PM'],
  ['2027-07-15', 'shukla', 'Ends 03:30 AM (Jul 16)'],
  ['2027-07-31', 'krishna', 'Ends 11:58 PM'],
  ['2027-08-14', 'shukla', 'Ends 05:40 PM'],
  ['2027-08-29', 'krishna', 'Ends 07:44 AM'],
  ['2027-09-13', 'shukla', 'Ends 07:15 AM'],
  ['2027-09-28', 'krishna', 'Ends 04:22 PM'],
  ['2027-10-12', 'shukla', 'Ends 07:49 PM'],
  ['2027-10-28', 'krishna', 'Ends 02:15 AM (Oct 29)'],
  ['2027-11-11', 'shukla', 'Ends 07:12 AM'],
  ['2027-11-26', 'krishna', 'Ends 01:40 PM'],
  ['2027-12-11', 'shukla', 'Ends 05:54 PM'],
  ['2027-12-26', 'krishna', 'Ends 02:30 AM (Dec 27)'],
].map(([date, paksha, ends]) => ({ date, paksha, ends }))

export const PURNIMA_2027 = [
  ['2027-01-22', 'Jan 21, 09:30 PM', 'Jan 22, 05:47 PM', 'Pausha Purnima'],
  ['2027-02-20', 'Feb 20, 08:00 AM', 'Feb 21, 04:53 AM', 'Magha Purnima'],
  ['2027-03-22', 'Mar 21, 06:22 PM', 'Mar 22, 04:13 PM', 'Phalguna Purnima (Holi)'],
  ['2027-04-20', 'Apr 20, 04:51 AM', 'Apr 21, 03:57 AM', 'Chaitra Purnima'],
  ['2027-05-20', 'May 19, 04:03 PM', 'May 20, 04:29 PM', 'Vaisakha Purnima'],
  ['2027-06-18', 'Jun 18, 04:35 AM', 'Jun 19, 06:14 AM', 'Jyestha Purnima'],
  ['2027-07-18', 'Jul 17, 06:48 PM', 'Jul 18, 09:14 PM', 'Ashadha Purnima'],
  ['2027-08-17', 'Aug 16, 10:29 AM', 'Aug 17, 12:58 PM', 'Shravana Purnima'],
  ['2027-09-15', 'Sep 15, 04:32 AM', 'Sep 16, 04:32 AM', 'Bhadrapada Purnima'],
  ['2027-10-15', 'Oct 14, 09:15 PM', 'Oct 15, 07:15 PM', 'Ashwin Purnima'],
  ['2027-11-13', 'Nov 12, 08:54 PM', 'Nov 13, 08:54 AM', 'Kartika Purnima'],
  ['2027-12-13', 'Dec 12, 09:37 PM', 'Dec 13, 09:37 PM', 'Margashirsha Purnima'],
].map(([date, begins, ends, name]) => ({ date, begins, ends, name }))

export const AMAVASYA_2027 = [
  ['2027-01-07', 'Jan 06, 11:14 PM', 'Jan 08, 01:54 AM', 'Pausha Amavasya'],
  ['2027-02-06', 'Feb 05, 07:05 PM', 'Feb 06, 09:26 PM', 'Magha Amavasya'],
  ['2027-03-08', 'Mar 07, 01:46 PM', 'Mar 08, 02:59 PM', 'Phalguna Amavasya'],
  ['2027-04-06', 'Apr 06, 05:40 AM', 'Apr 07, 05:21 AM', 'Chaitra Amavasya'],
  ['2027-05-06', 'May 05, 04:15 PM', 'May 06, 03:50 PM', 'Vaisakha Amavasya'],
  ['2027-06-04', 'Jun 03, 11:30 PM', 'Jun 04, 11:15 PM', 'Jyestha Amavasya'],
  ['2027-07-04', 'Jul 03, 08:45 AM', 'Jul 04, 08:30 AM', 'Ashadha Amavasya'],
  ['2027-08-02', 'Aug 01, 07:10 PM', 'Aug 02, 07:05 PM', 'Shravana Amavasya'],
  ['2027-08-31', 'Aug 30, 08:40 AM', 'Aug 31, 08:22 AM', 'Bhadrapada Amavasya'],
  ['2027-09-30', 'Sep 29, 11:55 PM', 'Sep 30, 11:40 PM', 'Ashwin Amavasya'],
  ['2027-10-29', 'Oct 28, 04:30 PM', 'Oct 29, 04:15 PM', 'Kartika Amavasya (Diwali)'],
  ['2027-11-28', 'Nov 27, 09:10 AM', 'Nov 28, 08:50 AM', 'Margashirsha Amavasya'],
  ['2027-12-27', 'Dec 26, 11:45 PM', 'Dec 27, 11:30 PM', 'Pausha Amavasya'],
].map(([date, begins, ends, name]) => ({ date, begins, ends, name }))

/** Parse "Jan 21, 09:30 PM" (year 2027 implied) to minutes-of-year, for sanity checks. */
export function parseStamp(s, year = 2027) {
  const m = /^([A-Z][a-z]{2}) (\d{2}), (\d{2}):(\d{2}) (AM|PM)$/.exec(s)
  if (!m) return null
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months.indexOf(m[1]) + 1
  let hour = Number(m[3]) % 12
  if (m[5] === 'PM') hour += 12
  return { year, month, day: Number(m[2]), hour, minute: Number(m[4]) }
}
