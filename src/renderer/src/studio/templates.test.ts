/**
 * Run with `npm test`. Every song template must build into a song the app
 * accepts: tracks, patterns and clips that all point at each other correctly.
 */
import { clipEnd } from './clips'
import { writeDrumRows } from './drumtext'
import { GROOVES } from './grooves'
import { normalizeKit } from './kit'
import { DRUM_KITS, newPattern } from './presets'
import { sanitizeSong } from './song'
import { SONG_TEMPLATES } from './templates'
import { DRUM_TRACK, STEPS_PER_BAR, type DrumPattern, type DrumVoiceId } from './types'

/** JSON with object keys sorted, so two objects compare by content rather than key order. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v
  )

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

// Grooves: every row has the right number of steps (writeDrumRows throws otherwise),
// every groove has a kick or a snare, and rolls only sit on steps that are hit.
for (const groove of GROOVES) {
  const pattern = writeDrumRows(newPattern('drums', DRUM_TRACK, 'A', groove.bars, 'g') as DrumPattern, groove.rows)
  const steps = groove.bars * STEPS_PER_BAR
  check(pattern.drums.kick.some((v) => v > 0) || pattern.drums.snare.some((v) => v > 0), `groove ${groove.id} has no kick or snare`)
  check(DRUM_KITS.some((k) => k.name === groove.kit), `groove ${groove.id} names a kit that does not exist: ${groove.kit}`)
  for (const [voice, row] of Object.entries(pattern.rolls ?? {})) {
    row?.forEach((count, step) => {
      if (count > 1) check(step < steps && pattern.drums[voice as DrumVoiceId][step] > 0, `groove ${groove.id}: roll on an empty ${voice} step ${step}`)
    })
  }
}
check(new Set(GROOVES.map((g) => g.id)).size === GROOVES.length, 'groove ids are unique')

// Every factory kit is complete and already in the current format (normalizing changes nothing).
for (const kit of DRUM_KITS) {
  check(stable(normalizeKit(kit)) === stable(kit), `kit ${kit.name} is not normalized`)
}
check(new Set(DRUM_KITS.map((k) => k.name)).size === DRUM_KITS.length, 'kit names are unique')
// A kit saved by an older version under a factory name is swapped for the new factory kit.
const legacy = { name: 'Donda Stadium', description: '', voices: { kick: { tune: -2, decay: 1.35, tone: 0.35, drive: 0.18, level: 0.95, reverb: 0.18 } } }
check(normalizeKit(legacy, DRUM_KITS).voices.kick.model === DRUM_KITS.find((k) => k.name === 'Donda Stadium')!.voices.kick.model, 'legacy factory kit is upgraded')
// An unknown old kit gets default models and keeps its own settings.
const custom = normalizeKit({ name: 'Mine', voices: { snare: { tune: 5, decay: 2 } } }, DRUM_KITS)
check(custom.voices.snare.model === '808' && custom.voices.snare.tune === 5 && custom.punch === 0.4, 'legacy custom kit gets defaults')

console.log(`templates: ${checks} checks passed`)
