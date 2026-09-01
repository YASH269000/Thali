# panchanga — a calendar engine

Standalone. **Nothing in the app imports this**, and `test/panchanga-isolation.test.js`
fails if anything starts to. It exists to be checked before it is trusted.

Read `docs/CALENDAR-VERIFICATION.md` first — the report is the deliverable; this
is the thing the report is about.

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
