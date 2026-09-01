# panchanga — a calendar engine

**The app depends on this.** It was standalone until it had been checked, which
is what `docs/CALENDAR-VERIFICATION.md` is; read that first. The isolation test
that used to fail if anything imported this has been replaced by
`test/panchanga-source-of-truth.test.js`, which asserts the opposite invariant:
that this is the ONLY source of tithi-derived dates in the app, so a hand-typed
table cannot drift back in beside it.

## How the app consumes it

Not by calling it. A year of observances costs a little over a second — Newton
iteration on the moon per tithi, three times over for the stability check —
which is too slow to block a calendar render on a phone and too slow to add to
every plan request. So `scripts/generate-observances.mjs` runs the engine and
writes `src/data/observances.json`, and the app reads that.

That would be a hand-typed table again if nothing enforced the link, so the
test regenerates the file and fails on any difference. `src/lib/observances.js`
also imports `TITHI_RULES` from here directly, for the ids and names, which
keeps the vocabulary as well as the dates in one place.

```
node scripts/generate-observances.mjs --write   # after any change to a rule
```

## What it computes

Three calculations of genuinely different character, deliberately not unified:

| | basis | accuracy |
| --- | --- | --- |
| Hindu / Jain / Buddhist | astronomical — tithi from lunar and solar longitude, resolved to a date by local sunrise | measured: 20 s mean, 64 s worst at a tithi boundary |
| Islamic | arithmetic tabular Hijri | **provisional** — the real calendar is sighted, not calculated |
| Christian | computus | exact, closed form |

## Layout

```
julian.js      Julian Day, ΔT, the TT/UT distinction
ephemeris.js   Sun (Meeus ch. 25) and Moon (ch. 47); nutation, obliquity
ayanamsa.js    Lahiri, for sidereal quantities only
riseset.js     sunrise, sunset, moonrise by altitude crossing
tithi.js       tithi, the sunrise rule, Smarta/Vaishnava, other kaal rules
masa.js        lunar months, Adhik Maas, solar ingresses
rules.js       traditions carrying their rule — the curated half
hijri.js       tabular Hijri
computus.js    Easter and Lent
index.js       public API
locations.js   Delhi by default
```

## Two things to know before reading the code

**Tithi is a difference, so ayanamsa and nutation cancel exactly.** No tithi
calculation touches `ayanamsa.js`. Sankranti and month names do, so the module
has two separate error budgets rather than one.

**Sunrise is not the only rule.** Ekadashi and the vrats are decided at
sunrise; Pradosh at sunset, Sankashti and Karwa Chauth at moonrise, Shivaratri
and Janmashtami at nishita, Ganesh Chaturthi at madhyahna. Applying sunrise to
all of them is wrong by a full day on 21 of 234 observances across 2026–2027.

## Regenerating the report

```
node scripts/verify-calendar.mjs           # print
node scripts/verify-calendar.mjs --write   # write docs/CALENDAR-VERIFICATION.md
```

Every figure in the report is computed at run time. Nothing is typed in.
