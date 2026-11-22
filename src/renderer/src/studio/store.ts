import { create } from 'zustand'
import { demoProject, newPattern, uid } from './presets'
import { DEFAULT_PATCH, normalizePatch } from './patch'
import { sanitizeSong, type SongData } from './song'
import { listSongs, type SongMeta } from './songs'
import {
  CHOP_TRACK,
  DRUM_TRACK,
  STEPS_PER_BAR,
  type ChopPattern,
  type Clip,
  type DrumKit,
  type DrumPattern,
  type DrumVoiceId,
  type Pattern,
  type PlayMode,
  type StudioTrack,
  type SynthNote,
  type SynthPatch
} from './types'

export type AppView = 'decks' | 'studio'
/** Timeline pointer tool: select/move clips, or cut them where you click. */
export type ArrangeTool = 'select' | 'split'
/** Which panel keyboard editing shortcuts (Delete, arrows…) apply to. */
export type FocusArea = 'arrange' | 'editor'

export const ZOOM_MIN = 20
export const ZOOM_MAX = 140

export interface StudioState extends SongData {
  view: AppView
  /** The open song's id in the song library, and its name. */
  songId: string
  songName: string
  /** Every song in the library, the open one included (it saves itself as you work). */
  songs: SongMeta[]
  /** The open song has changes not yet written to the library (autosave is a moment behind). */
  songDirty: boolean
  /** Id of the track whose editor is open — also what the computer keyboard plays. */
  selectedTrack: string
  selectedClips: string[]
  metronome: boolean
  playing: boolean
  /** Live playing gets written into the pattern while the transport runs. */
  recordArm: boolean
  mode: PlayMode
  /** Song position (steps) where playback starts and the playhead rests. */
  songPos: number
  /** Timeline grid in steps: 16 = bars, 4 = beats. */
  snap: number
  /** Timeline zoom, pixels per bar. */
  zoom: number
  tool: ArrangeTool
  focus: FocusArea
  userPatches: SynthPatch[]
  userKits: DrumKit[]
  selectedDrum: DrumVoiceId
  chopLoading: boolean
  /** Octave of the computer-keyboard "A" key (C4 = 4). */
  keyOctave: number
  /** Lowest MIDI note shown in the piano roll. */
  rollBase: number
  /** MIDI notes currently held (for keyboard highlighting). */
  heldNotes: number[]
  /** What the synth's computer keys play: single notes, or one chord per key. */
  keyMode: KeyMode
  /** Chord pad currently held, for the chord readout and pad highlight. */
  activeChord: ActiveChord | null
}

export type KeyMode = 'notes' | 'chords'

export interface ActiveChord {
  /** Index into chordPads(). */
  pad: number
  seventh: boolean
  notes: number[]
}

// ---------- Selectors ----------

export const selTrack = (s: StudioState): StudioTrack =>
  s.tracks.find((t) => t.id === s.selectedTrack) ?? s.tracks[0]

/** The pattern open in the selected track's editor. */
export const selPattern = (s: StudioState): Pattern => s.patterns[selTrack(s).patternId]

/** The selected track's sound (a neutral patch when a drum or chop track is selected). */
export const selPatch = (s: StudioState): SynthPatch => selTrack(s).patch ?? DEFAULT_PATCH

const NO_NOTES: SynthNote[] = []
const BLANK_DRUMS = (newPattern('drums', DRUM_TRACK, '', 1, 'blank') as DrumPattern).drums
const BLANK_CHOPS = (newPattern('chops', CHOP_TRACK, '', 1, 'blank') as ChopPattern).chops

/** Content of the open pattern, typed for each editor; empty when another kind of track is selected. */
export const selNotes = (s: StudioState): SynthNote[] => {
  const pattern = selPattern(s)
  return pattern.kind === 'synth' ? pattern.notes : NO_NOTES
}
export const selDrums = (s: StudioState): DrumPattern['drums'] => {
  const pattern = selPattern(s)
  return pattern.kind === 'drums' ? pattern.drums : BLANK_DRUMS
}
export const selChops = (s: StudioState): ChopPattern['chops'] => {
  const pattern = selPattern(s)
  return pattern.kind === 'chops' ? pattern.chops : BLANK_CHOPS
}

export const patternSteps = (pattern: Pattern): number => pattern.bars * STEPS_PER_BAR

/** Where the song ends: the end of the last clip, in steps. */
export const songEnd = (clips: Clip[]): number => clips.reduce((end, c) => Math.max(end, c.start + c.length), 0)

// ---------- Persistence ----------

const STORAGE_KEY = 'stemdeck.studio.v2'
const LEGACY_KEY = 'stemdeck.studio.v1'

const PERSISTED = [
  'view',
  'songId',
  'songName',
  'selectedTrack',
  'bpm',
  'swing',
  'metronome',
  'tracks',
  'patterns',
  'clips',
  'mode',
  'songPos',
  'cycle',
  'cycleOn',
  'snap',
  'zoom',
  'userPatches',
  'kit',
  'userKits',
  'chop',
  'chopTitle',
  'keyOctave',
  'rollBase',
  'keyMode',
  'songKey',
  'songScale'
] as const satisfies readonly (keyof StudioState)[]

type Persisted = Pick<StudioState, (typeof PERSISTED)[number]>

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

interface LegacyPattern {
  bars: 1 | 2 | 4
  drums: DrumPattern['drums']
  chops: number[][]
  notes: SynthNote[]
}

/**
 * v1 kept one loop for all three tracks. Split it into a pattern per track and
 * lay each non-empty one on the timeline once, so the old beat is bar 1 of the song.
 */
function migrateLegacy(old: Record<string, unknown>): Partial<Persisted> {
  const project = demoProject()
  project.clips = []
  const pattern = old.pattern as LegacyPattern | undefined
  const mixer = old.mixer as Record<string, { volume: number; mute: boolean }> | undefined
  for (const track of project.tracks) {
    const mix = mixer?.[track.id]
    if (mix) Object.assign(track, { volume: mix.volume, mute: mix.mute })
    if (track.kind === 'synth' && old.patch) track.patch = normalizePatch(old.patch)
    const blank = newPattern(track.kind, track.id, 'A', pattern?.bars ?? 2, track.patternId)
    project.patterns[track.patternId] = blank
    if (!pattern) continue
    let used = false
    if (blank.kind === 'drums' && pattern.drums) {
      blank.drums = { ...blank.drums, ...pattern.drums }
      used = Object.values(pattern.drums).some((row) => row.some((v) => v > 0))
    } else if (blank.kind === 'chops' && Array.isArray(pattern.chops)) {
      blank.chops = pattern.chops
      used = pattern.chops.some((row) => row.some((v) => v > 0))
    } else if (blank.kind === 'synth' && Array.isArray(pattern.notes)) {
      blank.notes = pattern.notes
      used = pattern.notes.length > 0
    }
    if (used) {
      project.clips.push({
        id: uid('clip'),
        trackId: track.id,
        patternId: blank.id,
        start: 0,
        length: patternSteps(blank),
        offset: 0
      })
    }
  }
  const { pattern: _pattern, patch: _patch, mixer: _mixer, ...rest } = old
  return { ...(rest as Partial<Persisted>), ...project }
}

function loadPersisted(): Partial<Persisted> {
  const current = readJson(STORAGE_KEY)
  if (current) return current as Partial<Persisted>
  const legacy = readJson(LEGACY_KEY)
  return legacy ? migrateLegacy(legacy) : {}
}

const saved = loadPersisted()
const song = sanitizeSong(saved, demoProject) as SongData

export const useStudio = create<StudioState>(() => ({
  ...song,
  view: saved.view ?? 'decks',
  songId: saved.songId ?? uid('song'),
  songName: saved.songName ?? 'My first song',
  songs: listSongs(),
  songDirty: false,
  selectedTrack: song.tracks.some((t) => t.id === saved.selectedTrack)
    ? (saved.selectedTrack as string)
    : song.tracks[0].id,
  selectedClips: [],
  metronome: saved.metronome ?? false,
  playing: false,
  recordArm: false,
  mode: saved.mode ?? 'loop',
  songPos: saved.songPos ?? 0,
  snap: saved.snap ?? STEPS_PER_BAR,
  zoom: saved.zoom ?? 56,
  tool: 'select',
  focus: 'editor',
  userPatches: (saved.userPatches ?? []).map(normalizePatch),
  userKits: saved.userKits ?? [],
  selectedDrum: 'kick',
  chopLoading: false,
  keyOctave: saved.keyOctave ?? 4,
  rollBase: saved.rollBase ?? 48,
  heldNotes: [],
  keyMode: saved.keyMode ?? 'notes',
  activeChord: null
}))

function persist(): void {
  const s = useStudio.getState()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(PERSISTED.map((key) => [key, s[key]]))))
  } catch {
    // storage full/unavailable — the session still works, it just won't persist
  }
}

// Debounced persistence — patterns change on every click while painting.
let saveTimer: ReturnType<typeof setTimeout> | null = null
useStudio.subscribe(() => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 400)
})
// Don't lose the last edit when the window closes inside the debounce.
window.addEventListener('pagehide', persist)
