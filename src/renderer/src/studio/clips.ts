/** Pure timeline maths for clips. Positions are 16th-note steps. */
import { LOOP_STEPS, type Clip } from './types'

export const clipEnd = (clip: Clip): number => clip.start + clip.length

/**
 * Pattern offsets only matter modulo the pattern length, and every pattern
 * length divides LOOP_STEPS, so offsets are kept small by wrapping there.
 */
const wrapOffset = (offset: number): number => ((offset % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS

/** Cut `clip` at timeline step `at`. Returns null unless `at` falls strictly inside it. */
export function splitClip(clip: Clip, at: number, rightId: string): [Clip, Clip] | null {
  if (at <= clip.start || at >= clipEnd(clip)) return null
  const cut = at - clip.start
  return [
    { ...clip, length: cut },
    { ...clip, id: rightId, start: at, length: clip.length - cut, offset: wrapOffset(clip.offset + cut) }
  ]
}

/** Move a clip's left edge by `delta` steps, keeping its content where it was on the timeline. */
export function trimStart(clip: Clip, delta: number): Clip {
  return { ...clip, start: clip.start + delta, length: clip.length - delta, offset: wrapOffset(clip.offset + delta) }
}

/**
 * Put `placed` on the timeline, last one wins: anything else on the same track
 * that they cover is trimmed, split around them, or removed. Clips already in
 * `clips` with the same id as a placed clip are replaced by it.
 */
export function carve(clips: Clip[], placed: Clip[], newId: () => string): Clip[] {
  const placedIds = new Set(placed.map((c) => c.id))
  let rest = clips.filter((c) => !placedIds.has(c.id))
  for (const p of placed) {
    rest = rest.flatMap((c) => {
      if (c.trackId !== p.trackId || clipEnd(c) <= p.start || c.start >= clipEnd(p)) return [c]
      const parts: Clip[] = []
      if (c.start < p.start) parts.push({ ...c, length: p.start - c.start })
      if (clipEnd(c) > clipEnd(p)) {
        parts.push({
          ...c,
          id: parts.length ? newId() : c.id,
          start: clipEnd(p),
          length: clipEnd(c) - clipEnd(p),
          offset: wrapOffset(c.offset + clipEnd(p) - c.start)
        })
      }
      return parts
    })
  }
  return [...rest, ...placed]
}

/** Largest shift toward `delta` that keeps every clip at or after step 0. */
export function clampShift(clips: Clip[], delta: number): number {
  const earliest = clips.reduce((min, c) => Math.min(min, c.start), Infinity)
  return Number.isFinite(earliest) ? Math.max(delta, -earliest) : 0
}
