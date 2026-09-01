import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The brief for this module was "build it, wire nothing up, and let me decide
// whether it is trustworthy". That instruction is worth more than a comment:
// this test fails if anything under src/ or api/ starts importing the engine,
// so wiring it in becomes a deliberate act with a failing test attached rather
// than something that happens by accident in an unrelated change.

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) yield path
  }
}

test('no application code imports the calendar engine', async () => {
  const offenders = []
  for (const dir of ['src', 'api']) {
    for await (const file of walk(new URL(`../${dir}`, import.meta.url).pathname)) {
      const text = await readFile(file, 'utf8')
      if (/from\s+['"][^'"]*panchanga/.test(text) || /require\(['"][^'"]*panchanga/.test(text)) {
        offenders.push(file)
      }
    }
  }
  assert.deepEqual(offenders, [],
    'the engine is meant to be standalone until it has been reviewed and approved')
})

test('the engine does not reach into application code either', async () => {
  const offenders = []
  for await (const file of walk(new URL('../panchanga', import.meta.url).pathname)) {
    const text = await readFile(file, 'utf8')
    if (/from\s+['"][^'"]*\.\.\/src\//.test(text) || /from\s+['"][^'"]*\.\.\/api\//.test(text)) {
      offenders.push(file)
    }
  }
  assert.deepEqual(offenders, [], 'the engine must stand alone in both directions')
})

test('the engine adds no runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const before = ['@google/generative-ai', 'react', 'react-dom', 'react-router-dom']
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), before.sort(),
    'the ephemeris is implemented in-repo precisely so nothing had to be added')
})
