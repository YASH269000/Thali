import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { RISK_MINUTES, STABILITY_SHIFT_MINUTES, TITHI_RULES } from '../panchanga/index.js'
import { buildObservances, serialise, YEARS } from '../scripts/generate-observances.mjs'
import { OBSERVANCE_FASTS, TITHI_DERIVED_IDS } from '../src/lib/observances.js'
import { slugify } from '../src/data/memberOptions.js'
import committed from '../src/data/observances.json' with { type: 'json' }
import fastingData from '../src/data/fastingTraditions.json' with { type: 'json' }

// This file replaces test/panchanga-isolation.test.js, which failed if any
// application code imported the engine. That test was guarding a decision —
// "build it, wire nothing up, and let me decide whether it is trustworthy" —
// and the decision has now been taken the other way. Deleting it without
// replacement would leave the opposite hole: nothing to stop a hand-typed date
// drifting back into the app beside the computed one, which is exactly the
// state this work removed. So the invariant is inverted rather than dropped.
//
// The engine is now the ONLY source of tithi-derived dates. Everything below
// is a way of saying that so it cannot quietly stop being true.

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) yield path
  }
}

const dirOf = (name) => new URL(`../${name}`, import.meta.url).pathname

test('the app imports the engine — the wiring is real, not a copied table', async () => {
  const importers = []
  for await (const file of walk(dirOf('src'))) {
    const text = await readFile(file, 'utf8')
    if (/from\s+['"][^'"]*panchanga\//.test(text)) importers.push(file)
  }
  assert.ok(importers.length > 0,
    'no file under src/ imports panchanga/. If the engine has been unwired, the '
    + 'generated dates are a hand-maintained table again and this whole file is theatre.')
})

// ~20 SECONDS, AND HERE IS WHY, so the next person does not rediscover it.
//
// The generator solves a year of tithis per city — eight cities, two years,
// about 1.2 s each — because it records where a date falls on a different day
// than it does in Delhi. That cross-city pass is the whole cost; a Delhi-only
// regeneration is about 2.5 s.
//
// It is worth paying while it stays around this long. If it grows past roughly
// a minute — a third year, or more cities — split the cross-city pass behind a
// flag: generate with it always, and have this test compare only the Delhi
// dates unless an env var asks for the full diff. The invariant that matters
// most (the committed file is what the engine produces) survives that split;
// only the variance table would go unchecked on an ordinary run.
test('the committed observance table is exactly what the engine produces', async () => {
  const fresh = serialise(buildObservances())
  const onDisk = await readFile(new URL('../src/data/observances.json', import.meta.url), 'utf8')
  assert.equal(fresh, onDisk,
    'src/data/observances.json disagrees with a fresh engine run. It is a generated '
    + 'file: run `node scripts/generate-observances.mjs --write` rather than editing it. '
    + 'If the engine changed on purpose, regenerating is the commit.')
})

test('the generated table carries the engine\'s own thresholds', () => {
  assert.equal(committed.riskMinutes, RISK_MINUTES)
  assert.equal(committed.stabilityShiftMinutes, STABILITY_SHIFT_MINUTES)
  assert.deepEqual(committed.years, YEARS)
})

test('no curated row holds a date the engine has a rule for', () => {
  const trespassing = fastingData.curatedDates
    .filter((row) => TITHI_DERIVED_IDS.has(row.observanceId))
    .map((row) => row.observanceId)
  assert.deepEqual(trespassing, [],
    'a curated row is carrying a date for an observance the engine computes. '
    + 'Two sources for one date is how the five wrong rows survived: whichever '
    + 'one is read wins, and nothing says which.')
})

test('the curated table holds only what no rule decides', () => {
  // Islamic dates are computed — the tabular Hijri is arithmetic — but they are
  // provisional by nature and live in the generated file's own section, marked
  // as such. What is left here is genuinely un-ruled: the Jain sect calendars,
  // set by each order, and the Sikh Gurpurabs.
  const religions = [...new Set(fastingData.curatedDates.map((r) => r.religion))].sort()
  assert.deepEqual(religions, ['Jain', 'Sikh'])
  for (const row of fastingData.curatedDates) {
    assert.ok(row.note, `${row.observanceId} is curated without saying why`)
    assert.ok(row.source, `${row.observanceId} is curated without naming a source`)
    assert.equal(row.confidence, 'curated')
  }
})

test('no hand-typed date has crept back into the fasting database', () => {
  // Anywhere but the curated table, a date-shaped string is a date that will be
  // wrong next year. Prose that names a month is fine; "Sep 7" and "2026-09-07"
  // are not.
  const shaped = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b|\d{4}-\d{2}-\d{2}/
  const offenders = []
  const visit = (value, path) => {
    if (typeof value === 'string') {
      if (shaped.test(value)) offenders.push(`${path}: ${value.slice(0, 60)}`)
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`))
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`)
    }
  }
  for (const [key, value] of Object.entries(fastingData)) {
    if (key === 'curatedDates') continue
    visit(value, key)
  }
  assert.deepEqual(offenders, [])
})

test('every engine rule reaches the app, or is unmapped on purpose', () => {
  // The two vocabularies were written apart and mostly differ, so a mapping
  // miss looks exactly like "the engine computed nothing" — 2 Ekadashi dots
  // instead of 24, and nothing on screen to say why. Totality is asserted so
  // that adding a rule to the engine and forgetting the app is a test failure.
  const missing = TITHI_RULES.map((r) => r.id).filter((id) => !(id in OBSERVANCE_FASTS))
  assert.deepEqual(missing, [],
    'engine rule(s) with no entry in OBSERVANCE_FASTS. Map them, or map them to '
    + '[] with a reason — but decide.')

  const known = new Set(fastingData.masterIndex.map((r) => slugify(r.fastingTraditionName)))
  const unknown = Object.entries(OBSERVANCE_FASTS)
    .flatMap(([oid, ids]) => ids.filter((id) => !known.has(id)).map((id) => `${oid} -> ${id}`))
  assert.deepEqual(unknown, [],
    'OBSERVANCE_FASTS names a fasting tradition that does not exist. A member '
    + 'cannot select it, so the observance would mark nobody.')
})

test('every observance in the data has a mapping', () => {
  const ids = new Set([
    ...committed.observances.map((o) => o.id),
    ...committed.provisional.map((o) => o.id),
    ...fastingData.curatedDates.map((r) => r.observanceId),
  ])
  const unmapped = [...ids].filter((id) => !(id in OBSERVANCE_FASTS)).sort()
  assert.deepEqual(unmapped, [])
})

test('the engine still does not reach into application code', async () => {
  const offenders = []
  for await (const file of walk(dirOf('panchanga'))) {
    const text = await readFile(file, 'utf8')
    if (/from\s+['"][^'"]*\.\.\/src\//.test(text) || /from\s+['"][^'"]*\.\.\/api\//.test(text)) {
      offenders.push(file)
    }
  }
  assert.deepEqual(offenders, [],
    'the engine depends on the app now, so it can no longer be checked on its own')
})

test('the engine adds no runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const before = ['@google/generative-ai', 'react', 'react-dom', 'react-router-dom']
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), before.sort(),
    'the ephemeris is implemented in-repo precisely so nothing had to be added')
})
