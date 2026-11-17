/**
 * Chord pads: the music theory behind CHORDS mode. Pure functions only — the
 * live playing lives in ./actions (chordDown/chordUp).
 *
 * Each song key gets nine chords: the seven that are built from its own scale
 * (so any order of them sounds "right"), plus two popular borrowed chords for
 * extra colour.
 */

export type SongScale = 'major' | 'minor'
export type ChordQuality = 'maj' | 'min' | 'dim'

export interface ChordPad {
  /** Root, in semitones above the song key's root. */
  root: number
  quality: ChordQuality
  /** The 7th added when Shift is held, in semitones above the chord root. */
  seventh: number
  /** Roman-numeral base before case/quality marks, e.g. 'IV' or 'bVII'. */
  degree: string
  /** One-line "what does this chord feel like" for the tooltip. */
  feel: string
}

/** Computer keys for the nine chord pads, left to right. */
export const CHORD_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'] as const
export const CHORD_KEY_LABELS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L']

const SCALE_STEPS: Record<SongScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10]
}

const DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

const TRIADS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6]
}

const FEEL: Record<SongScale, string[]> = {
  major: [
    'Home. Songs usually start and end here.',
    'Soft and moving. Loves to lead into V.',
    'Wistful, in-between.',
    'Lifting, hopeful. The classic second chord.',
    'Tension that wants to resolve back home.',
    'The sad-but-pretty one. I–V–vi–IV is a thousand pop songs.',
    'Unstable and tense. Use as a quick passing chord.'
  ],
  minor: [
    'Home. Dark and grounded.',
    'Tense and unsettled. Good right before v or V.',
    'The brighter relative major. Feels like a lift.',
    'Moody and deep. A trap/R&B staple.',
    'Soft tension that floats back to i.',
    'Big and emotional. i–VI–III–VII is the epic minor loop.',
    'Rising, triumphant. Pulls back to i.'
  ]
}

/** Two borrowed chords per scale, for slots K and L. */
const COLOR: Record<SongScale, ChordPad[]> = {
  major: [
    { root: 10, quality: 'maj', seventh: 10, degree: 'bVII', feel: 'Borrowed from minor. Rock/gospel lift: try it right before I.' },
    { root: 5, quality: 'min', seventh: 10, degree: 'IV', feel: 'Borrowed minor iv. Instantly bittersweet; try IV then iv.' }
  ],
  minor: [
    { root: 7, quality: 'maj', seventh: 10, degree: 'V', feel: 'Major V. The strongest pull back to i (classical/flamenco).' },
    { root: 1, quality: 'maj', seventh: 11, degree: 'bII', feel: 'The dark, eerie bII. A trap and film-score favourite.' }
  ]
}

function qualityOf(intervals: number[]): ChordQuality {
  if (intervals[1] === 4) return 'maj'
  return intervals[2] === 6 ? 'dim' : 'min'
}

/** The nine chord pads for a key, in key order (A..L). */
export function chordPads(scale: SongScale): ChordPad[] {
  const steps = SCALE_STEPS[scale]
  const at = (i: number) => steps[i % 7] + 12 * Math.floor(i / 7)
  const diatonic = steps.map((root, d): ChordPad => {
    const intervals = [0, 2, 4].map((k) => at(d + k) - root)
    return {
      root,
      quality: qualityOf(intervals),
      seventh: at(d + 6) - root,
      degree: DEGREES[d],
      feel: FEEL[scale][d]
    }
  })
  return [...diatonic, ...COLOR[scale]]
}

// ---------- Naming ----------

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
/** Key roots whose scales are written with flats. */
const FLAT_KEYS: Record<SongScale, number[]> = {
  major: [1, 3, 5, 6, 8, 10],
  minor: [0, 2, 3, 5, 7, 10]
}

/** Spells pitch classes the way sheet music in this key would. */
export function noteNamer(key: number, scale: SongScale): (pc: number) => string {
  const names = FLAT_KEYS[scale].includes(key) ? FLATS : SHARPS
  return (pc) => names[((pc % 12) + 12) % 12]
}

/** Key picker labels. */
export const KEY_NAMES = ['C', 'C#/Db', 'D', 'Eb', 'E', 'F', 'F#/Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export function chordSuffix(pad: ChordPad, withSeventh: boolean): string {
  if (!withSeventh) return pad.quality === 'min' ? 'm' : pad.quality === 'dim' ? 'dim' : ''
  if (pad.quality === 'dim') return pad.seventh === 9 ? 'dim7' : 'm7b5'
  if (pad.quality === 'min') return pad.seventh === 10 ? 'm7' : 'm(maj7)'
  return pad.seventh === 11 ? 'maj7' : '7'
}

export function chordName(pad: ChordPad, key: number, scale: SongScale, withSeventh: boolean): string {
  return noteNamer(key, scale)(key + pad.root) + chordSuffix(pad, withSeventh)
}

/** Roman numeral: upper case = major, lower = minor, ° = diminished. */
export function chordNumeral(pad: ChordPad, withSeventh: boolean): string {
  const flat = pad.degree.startsWith('b') ? 'b' : ''
  const base = pad.degree.replace(/^b/, '')
  const cased = pad.quality === 'maj' ? base : base.toLowerCase()
  if (pad.quality === 'dim') return `${flat}${cased}${withSeventh ? (pad.seventh === 9 ? '°7' : 'ø7') : '°'}`
  return `${flat}${cased}${withSeventh ? (pad.quality === 'maj' && pad.seventh === 11 ? 'maj7' : '7') : ''}`
}

/**
 * MIDI notes for a pad in root position, rooted in the octave that starts at
 * `baseMidi` — so the whole chord always fits on the on-screen two-octave
 * keyboard and you see exactly what you hear.
 */
export function chordNotes(pad: ChordPad, key: number, baseMidi: number, withSeventh: boolean): number[] {
  const root = baseMidi + ((key + pad.root) % 12)
  const intervals = withSeventh ? [...TRIADS[pad.quality], pad.seventh] : TRIADS[pad.quality]
  return intervals.map((i) => root + i)
}
