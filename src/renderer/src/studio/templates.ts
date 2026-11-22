/** Ready-made songs to start from. Each call builds a fresh copy with its own ids. */
import { DRUM_KITS, SYNTH_PRESETS, blankProject, cloneKit, clonePatch, defaultChopSettings, newPattern, uid } from './presets'
import type { SongData } from './song'
import {
  DRUM_TRACK,
  STEPS_PER_BAR,
  type Clip,
  type DrumPattern,
  type DrumVoiceId,
  type NotePattern,
  type Pattern,
  type StudioTrack,
  type SynthNote
} from './types'

const preset = (name: string) => clonePatch(SYNTH_PRESETS.find((p) => p.name === name) ?? SYNTH_PRESETS[0])
const kit = (name: string) => cloneKit(DRUM_KITS.find((k) => k.name === name) ?? DRUM_KITS[0])

/** Three empty tracks at 140 BPM. */
export function blankSong(): SongData {
  return {
    ...blankProject(),
    bpm: 140,
    swing: 0,
    kit: kit(DRUM_KITS[0].name),
    chop: defaultChopSettings(),
    chopTitle: '',
    songKey: 0,
    songScale: 'minor',
    cycle: null,
    cycleOn: false
  }
}

/** Velocity for each character of a step row: x = full hit, m = medium, o = soft ghost note. */
const HIT: Record<string, number> = { x: 0.95, m: 0.7, o: 0.45 }

/**
 * Write drum rows from text, one character per 16th, bars separated by spaces:
 *   kick: 'x.x.......xx.... x.x.......xx....'
 */
function drumPattern(id: string, name: string, bars: 1 | 2 | 4, rows: Partial<Record<DrumVoiceId, string>>): DrumPattern {
  const pattern = newPattern('drums', DRUM_TRACK, name, bars, id) as DrumPattern
  for (const [voice, text] of Object.entries(rows) as [DrumVoiceId, string][]) {
    const steps = text.replaceAll(' ', '')
    // A row that is a character short silently shifts every later hit; fail loudly instead.
    if (steps.length !== bars * STEPS_PER_BAR) {
      throw new Error(`Pattern ${name} ${voice}: ${steps.length} steps written, ${bars * STEPS_PER_BAR} expected`)
    }
    steps.split('').forEach((char, step) => {
      pattern.drums[voice][step] = HIT[char] ?? 0
    })
  }
  return pattern
}

function notePattern(id: string, trackId: string, name: string, bars: 1 | 2 | 4, notes: [step: number, note: number, length: number, velocity?: number][]): NotePattern {
  const pattern = newPattern('synth', trackId, name, bars, id) as NotePattern
  pattern.notes = notes.map(([step, note, length, velocity = 0.8]): SynthNote => ({ step, note, length, velocity }))
  return pattern
}

const synthTrack = (id: string, name: string, patch: string, volume: number, patternId: string): StudioTrack => ({
  id,
  kind: 'synth',
  name,
  volume,
  mute: false,
  solo: false,
  patternId,
  patch: preset(patch)
})

/**
 * A 36-bar jungle sketch at 165 BPM in F minor: pad intro, a drop built on the
 * Amen-break rhythm with a chopped fill every fourth bar, a breakdown with a
 * beat of silence before the second drop. Everything in it is meant to be
 * pulled apart: the fills are just pattern B, the gap is a trimmed clip.
 */
export function jungleSong(): SongData {
  const base = blankProject()
  const chops = base.tracks[1]
  const bass = uid('synth')
  const pad = uid('synth')
  const stab = uid('synth')
  const id = { amen: uid('pat'), fill: uid('pat'), intro: uid('pat'), bass: uid('pat'), pad: uid('pat'), stab: uid('pat') }

  const patterns: Pattern[] = [
    // The Amen break as a drummer plays it: bars 1–2 identical, bar 3 drops a kick, bar 4 stumbles into the turnaround.
    drumPattern(id.amen, 'A', 4, {
      kick: 'x.x.......xx.... x.x.......xx.... x.x.......x..... ..xx......x.....',
      snare: '....x..o.o..x..o ....x..o.o..x..o ....x..o.o....x. .o..x..o.o....x.',
      hat: 'x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x.',
      crash: '................ ................ ................ ..........m.....'
    }),
    // The "chopped" bar pair: same kit, hits shuffled, ending in a snare rush.
    drumPattern(id.fill, 'B', 2, {
      kick: 'x.x.....x.x..... x.x...x...x.....',
      snare: '....x..o....x.oo ....x..o.o..omxx',
      hat: 'x.x.x.x.x.x.x.x. x.x.x.x.x.x.....',
      perc: '......o...o..... ................',
      openhat: '..............m. ................'
    }),
    // Intro / breakdown: hats and a heartbeat kick, no snare.
    drumPattern(id.intro, 'C', 2, {
      kick: 'x............... x.........x.....',
      hat: 'x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x.',
      perc: '....o.......o... ....o.......o.o.',
      openhat: '......m.......m. ......m.......m.'
    }),
    // Sub bass: long notes that touch, so the mono patch slides between them. F1 = 29.
    notePattern(id.bass, bass, 'A', 4, [
      [0, 29, 10], [10, 29, 2], [12, 32, 4],
      [16, 29, 12], [28, 27, 4],
      [32, 29, 10], [42, 29, 2], [44, 36, 4],
      [48, 34, 8], [56, 32, 8]
    ]),
    // Fm9 for two bars, then Dbmaj7.
    notePattern(id.pad, pad, 'A', 4, [
      ...[53, 56, 60, 63, 67].map((note): [number, number, number, number] => [0, note, 32, 0.6]),
      ...[49, 53, 56, 60].map((note): [number, number, number, number] => [32, note, 32, 0.6])
    ]),
    // Off-beat rave stabs, F minor.
    notePattern(id.stab, stab, 'A', 2, [6, 14, 22, 27].flatMap((step, i) =>
      [65, 68, 72].map((note): [number, number, number, number] => [step, note, i % 2 === 0 ? 2 : 1, 0.8])
    ))
  ]
  // The chop track keeps its empty pattern: drop a real drum break on it to take this further.
  patterns.push(base.patterns[chops.patternId])

  const clip = (trackId: string, patternId: string, bar: number, bars: number, steps = bars * STEPS_PER_BAR): Clip => ({
    id: uid('clip'),
    trackId,
    patternId,
    start: bar * STEPS_PER_BAR,
    length: steps,
    offset: 0
  })

  return {
    tracks: [
      { ...base.tracks[0], patternId: id.amen, volume: 0.62 },
      chops,
      synthTrack(bass, 'BASS', 'Reese Sub', 0.5, id.bass),
      synthTrack(pad, 'PAD', 'Rollers Pad', 0.9, id.pad),
      synthTrack(stab, 'STAB', 'Hoover Stab', 0.55, id.stab)
    ],
    patterns: Object.fromEntries(patterns.map((p) => [p.id, p])),
    clips: [
      // Intro (bars 1–8): pad alone, hats join at bar 5.
      clip(pad, id.pad, 0, 36),
      clip(DRUM_TRACK, id.intro, 4, 4),
      // Drop (bars 9–24): six bars of Amen, two of fill, twice. Stabs join for the second half.
      clip(DRUM_TRACK, id.amen, 8, 6),
      clip(DRUM_TRACK, id.fill, 14, 2),
      clip(DRUM_TRACK, id.amen, 16, 6),
      clip(DRUM_TRACK, id.fill, 22, 2),
      clip(bass, id.bass, 8, 16),
      clip(stab, id.stab, 16, 8),
      // Breakdown (bars 25–28): drums thin out and stop one beat early — silence before the drop.
      clip(DRUM_TRACK, id.intro, 24, 4, 4 * STEPS_PER_BAR - 4),
      // Second drop (bars 29–36).
      clip(DRUM_TRACK, id.amen, 28, 6),
      clip(DRUM_TRACK, id.fill, 34, 2),
      clip(bass, id.bass, 28, 8),
      clip(stab, id.stab, 28, 8)
    ],
    bpm: 165,
    swing: 0,
    kit: kit('Jungle Break'),
    chop: defaultChopSettings(),
    chopTitle: '',
    songKey: 5,
    songScale: 'minor',
    cycle: null,
    cycleOn: false
  }
}

export const SONG_TEMPLATES = [
  { id: 'blank', label: 'Blank song', name: 'Untitled', build: blankSong },
  { id: 'jungle', label: 'Jungle starter (165 BPM)', name: 'Jungle starter', build: jungleSong }
] as const

export type TemplateId = (typeof SONG_TEMPLATES)[number]['id']
