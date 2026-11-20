/**
 * Run with `npm test`. Plain assertions, no test framework: the file is bundled
 * with esbuild and executed by node, and throws on the first failure.
 */
import { carve, clampShift, splitClip, trimStart } from './clips'

const clip = (id: string, start: number, length: number, offset = 0, trackId = 't') => ({ id, trackId, patternId: 'p', start, length, offset })
let n = 0
const newId = () => `n${++n}`

let checks = 0
const assert = {
  /** Structural equality, via JSON — every value compared here is plain data. */
  deepEqual(actual: unknown, expected: unknown): void {
    checks += 1
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`check ${checks} failed:\n  actual   ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`)
    }
  },
  equal(actual: unknown, expected: unknown): void {
    assert.deepEqual(actual, expected)
  }
}

// split
assert.equal(splitClip(clip('a', 0, 64), 0, 'r'), null)
assert.equal(splitClip(clip('a', 0, 64), 64, 'r'), null)
assert.deepEqual(splitClip(clip('a', 16, 64, 8), 48, 'r'), [clip('a', 16, 32, 8), clip('r', 48, 32, 40)])
// offsets wrap at 64 so they stay valid for 1/2/4-bar patterns
assert.equal(splitClip(clip('a', 0, 128, 48), 32, 'r')![1].offset, 16)

// trimStart keeps content in place on the timeline
assert.deepEqual(trimStart(clip('a', 16, 64, 0), 16), clip('a', 32, 48, 16))
assert.deepEqual(trimStart(clip('a', 16, 64, 0), -16), clip('a', 0, 80, 48))

// carve: placed clip punches a hole in a longer one
let out = carve([clip('long', 0, 128)], [clip('new', 32, 32)], newId)
assert.deepEqual(out.sort((a, b) => a.start - b.start), [clip('long', 0, 32), clip('new', 32, 32), clip('n1', 64, 64, 0)])
// carve: trims the tail / the head, removes fully covered, ignores other tracks
out = carve([clip('a', 0, 32), clip('b', 32, 32), clip('c', 64, 32), clip('x', 0, 96, 0, 'other')], [clip('new', 16, 64)], newId)
assert.deepEqual(out.sort((a, b) => a.trackId.localeCompare(b.trackId) || a.start - b.start), [
  clip('x', 0, 96, 0, 'other'), clip('a', 0, 16), clip('new', 16, 64), clip('c', 80, 16, 16)
])
// carve: moving a clip replaces its old self, no self-collision
out = carve([clip('a', 0, 32), clip('b', 64, 32)], [clip('a', 16, 32)], newId)
assert.deepEqual(out.sort((a, b) => a.start - b.start), [clip('a', 16, 32), clip('b', 64, 32)])

// clampShift never pushes a clip before step 0
assert.equal(clampShift([clip('a', 16, 32), clip('b', 48, 32)], -64), -16)
assert.equal(clampShift([clip('a', 16, 32)], 32), 32)
assert.equal(clampShift([], -5), 0)
console.log(`clips: ${checks} checks passed`)
