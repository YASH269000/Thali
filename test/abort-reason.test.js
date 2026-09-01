import test from 'node:test'
import assert from 'node:assert/strict'

// The retry loop in MealPlan.jsx has to tell two aborts apart: its own attempt
// timeout, which is transient and worth retrying, and a cancellation, which
// means nobody is on the screen any more. It used to tell them apart with
// `!controller.signal.reason`. These tests pin down why that could never work.

const ABORT_TIMEOUT = 'thali:attempt-timeout'

test('an abort with no argument still populates signal.reason', () => {
  const c = new AbortController()
  c.abort()

  // The premise the old guard rested on. `!signal.reason` was never true, so
  // a cancellation was never recognised and fell through to the retry path.
  assert.ok(c.signal.reason, 'the spec supplies a DOMException when none is given')
  assert.equal(c.signal.reason.name, 'AbortError')
})

test('the spec-supplied reason is the text that leaked to the screen', () => {
  const c = new AbortController()
  c.abort()

  // Whatever the wording, it describes an AbortController rather than a
  // kitchen — which is why the timeout branch now writes its own sentence.
  assert.match(c.signal.reason.message, /abort/i)
})

test('an explicit reason survives and is distinguishable', () => {
  const c = new AbortController()
  c.abort(ABORT_TIMEOUT)

  assert.equal(c.signal.reason, ABORT_TIMEOUT)
  assert.notEqual(new AbortController().signal.reason, ABORT_TIMEOUT)
})

test('the two kinds of abort are now separable', () => {
  const timedOut = new AbortController()
  timedOut.abort(ABORT_TIMEOUT)
  const cancelled = new AbortController()
  cancelled.abort()

  const isTimeout = (c) => c.signal.reason === ABORT_TIMEOUT
  assert.equal(isTimeout(timedOut), true, 'retry this one')
  assert.equal(isTimeout(cancelled), false, 'stop on this one')
})

test('the guard the code actually ships is written the way these tests assume', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../src/components/MealPlan.jsx', import.meta.url), 'utf8')

  assert.match(src, /controller\.abort\(ABORT_TIMEOUT\)/,
    'the attempt timeout must abort with its own reason')
  assert.match(src, /controller\.signal\.reason !== ABORT_TIMEOUT\) throw err/,
    'anything that is not our timeout must be rethrown as a cancellation')
  assert.doesNotMatch(src, /!controller\.signal\.reason/,
    'the guard that could never be true must not come back')
})
