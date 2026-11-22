/** Write drum patterns from text, one character per 16th note. Used by grooves and song templates. */
import { MAX_STEPS, STEPS_PER_BAR, type DrumPattern, type DrumVoiceId } from './types'

/**
 * x = full hit, m = medium, o = soft ghost note, . = rest,
 * 2 / 3 / 4 = a roll: that many quick hits inside the step (trap hi-hats).
 * Spaces are ignored, so bars can be written apart:
 *   hat: 'x.x.x.x.x.x.x3x. x.x.x3x.x.x.2222'
 */
const HIT: Record<string, number> = { x: 0.95, m: 0.7, o: 0.45, '2': 0.75, '3': 0.75, '4': 0.75 }

export type DrumRows = Partial<Record<DrumVoiceId, string>>

/** Fill `pattern` (fresh from newPattern) with `rows`. Throws when a row has the wrong length, so a typo can't shift every hit after it. */
export function writeDrumRows(pattern: DrumPattern, rows: DrumRows): DrumPattern {
  const expected = pattern.bars * STEPS_PER_BAR
  for (const [voice, text] of Object.entries(rows) as [DrumVoiceId, string][]) {
    const steps = text.replaceAll(' ', '')
    if (steps.length !== expected) {
      throw new Error(`Drum row ${pattern.name}/${voice}: ${steps.length} steps written, ${expected} expected`)
    }
    steps.split('').forEach((char, step) => {
      pattern.drums[voice][step] = HIT[char] ?? 0
      const roll = Number(char)
      if (roll >= 2) {
        pattern.rolls ??= {}
        pattern.rolls[voice] ??= Array<number>(MAX_STEPS).fill(0)
        pattern.rolls[voice]![step] = roll
      }
    })
  }
  return pattern
}
