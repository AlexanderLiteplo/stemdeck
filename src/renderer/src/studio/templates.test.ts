/**
 * Run with `npm test`. Every song template must build into a song the app
 * accepts: tracks, patterns and clips that all point at each other correctly.
 */
import { clipEnd } from './clips'
import { sanitizeSong } from './song'
import { SONG_TEMPLATES } from './templates'
import { STEPS_PER_BAR } from './types'

let checks = 0
function check(ok: boolean, message: string): void {
  checks += 1
  if (!ok) throw new Error(`templates: ${message}`)
}

for (const template of SONG_TEMPLATES) {
  // Building throws when a drum row is written with the wrong number of steps.
  const song = template.build()
  check(sanitizeSong(song) !== null, `${template.id} is not a valid song`)
  check(song.tracks.every((t) => song.patterns[t.patternId]?.trackId === t.id), `${template.id}: a track opens a pattern it does not own`)
  check(song.clips.every((c) => song.patterns[c.patternId].trackId === c.trackId), `${template.id}: a clip plays another track's pattern`)
  check(song.clips.every((c) => c.start >= 0 && c.length > 0), `${template.id}: a clip has no length`)
  for (const track of song.tracks) {
    const lane = song.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
    check(lane.every((c, i) => i === 0 || clipEnd(lane[i - 1]) <= c.start), `${template.id}: clips overlap on ${track.name}`)
  }
  for (const pattern of Object.values(song.patterns)) {
    if (pattern.kind !== 'synth') continue
    const steps = pattern.bars * STEPS_PER_BAR
    check(pattern.notes.every((n) => n.step + n.length <= steps), `${template.id}: a note runs past the end of pattern ${pattern.name}`)
  }
  // Each build is a fresh copy: ids must not be shared between two songs made from one template.
  const again = template.build()
  check(again.clips.every((c) => !song.clips.some((o) => o.id === c.id)), `${template.id}: clip ids are reused across builds`)
}

const jungle = SONG_TEMPLATES.find((t) => t.id === 'jungle')!.build()
check(jungle.bpm === 165, 'jungle tempo')
check(jungle.tracks.filter((t) => t.kind === 'synth').length === 3, 'jungle has bass, pad and stab')

console.log(`templates: ${checks} checks passed`)
