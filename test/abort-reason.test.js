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

  // assert.ok, not assert.match: matching against a 50 KB source file prints
  // the whole file on failure, which buries the one line that matters.
  const has = (re, why) => assert.ok(re.test(src), why)
  const lacks = (re, why) => assert.ok(!re.test(src), why)

  has(/const attemptCtl = new AbortController\(\)/,
    'each attempt needs its own controller: an aborted one stays aborted')
  has(/attemptCtl\.abort\(ABORT_TIMEOUT\)/,
    'the attempt timeout must abort with its own reason')
  has(/signal: attemptCtl\.signal/,
    'the fetch must be tied to the per-attempt controller, not the outer one')
  has(/if \(controller\.signal\.aborted\) throw err/,
    'a cancellation must stop the sequence rather than be retried')
  has(/attemptCtl\.signal\.reason === ABORT_TIMEOUT/,
    'the timeout is recognised from the signal, since a string reason leaves err.name undefined')
  has(/removeEventListener\('abort', relay\)/,
    'the relay must be detached, or every attempt leaves a listener behind')

  lacks(/!controller\.signal\.reason/,
    'the guard that could never be true must not come back')
  lacks(/signal: controller\.signal/,
    'sharing the outer signal is what let one timeout collapse every retry')
})

test('a string reason leaves err.name undefined, so the error cannot be asked', async () => {
  // Why the check moved from the error to the signal. Aborting with a string
  // makes fetch reject with that string, which has no `.name` and no
  // `.message` — the first version of this fix read both and got undefined.
  const c = new AbortController()
  c.abort(ABORT_TIMEOUT)

  const err = await fetch('https://example.invalid', { signal: c.signal }).catch((e) => e)
  assert.equal(err, ABORT_TIMEOUT)
  assert.equal(err.name, undefined)
  assert.equal(err.message, undefined)
  assert.equal(c.signal.reason, ABORT_TIMEOUT, 'the signal still knows')
})
