import { create } from 'zustand'
import {
  DRUM_KITS,
  SYNTH_PRESETS,
  cloneKit,
  clonePatch,
  defaultChopSettings,
  demoPattern
} from './presets'
import type {
  ChopSettings,
  DrumKit,
  DrumVoiceId,
  MixerTrack,
  Pattern,
  StudioTrackId,
  SynthPatch
} from './types'

export type AppView = 'decks' | 'studio'

export interface StudioState {
  view: AppView
  /** Track whose editor is open — also what the computer keyboard plays. */
  selectedTrack: StudioTrackId
  bpm: number
  swing: number
  metronome: boolean
  playing: boolean
  /** Live playing gets written into the pattern while the transport runs. */
  recordArm: boolean
  pattern: Pattern
  patch: SynthPatch
  userPatches: SynthPatch[]
  kit: DrumKit
  userKits: DrumKit[]
  selectedDrum: DrumVoiceId
  chop: ChopSettings
  chopTitle: string
  chopLoading: boolean
  mixer: Record<StudioTrackId, MixerTrack>
  /** Octave of the computer-keyboard "A" key (C4 = 4). */
  keyOctave: number
  /** Lowest MIDI note shown in the piano roll. */
  rollBase: number
  /** MIDI notes currently held (for keyboard highlighting). */
  heldNotes: number[]
}

const STORAGE_KEY = 'stemdeck.studio.v1'

/** The fields that survive restarts. */
type Persisted = Pick<
  StudioState,
  | 'view'
  | 'selectedTrack'
  | 'bpm'
  | 'swing'
  | 'metronome'
  | 'pattern'
  | 'patch'
  | 'userPatches'
  | 'kit'
  | 'userKits'
  | 'chop'
  | 'chopTitle'
  | 'mixer'
  | 'keyOctave'
  | 'rollBase'
>

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
  } catch {
    return {}
  }
}

const saved = loadPersisted()

export const useStudio = create<StudioState>(() => ({
  view: saved.view ?? 'decks',
  selectedTrack: saved.selectedTrack ?? 'drums',
  bpm: saved.bpm ?? 140,
  swing: saved.swing ?? 0,
  metronome: saved.metronome ?? false,
  playing: false,
  recordArm: false,
  pattern: saved.pattern ?? demoPattern(),
  patch: saved.patch ?? clonePatch(SYNTH_PRESETS[0]),
  userPatches: saved.userPatches ?? [],
  kit: saved.kit ?? cloneKit(DRUM_KITS[0]),
  userKits: saved.userKits ?? [],
  selectedDrum: 'kick',
  chop: { ...defaultChopSettings(), ...saved.chop },
  chopTitle: saved.chopTitle ?? '',
  chopLoading: false,
  mixer: saved.mixer ?? {
    drums: { volume: 0.9, mute: false },
    chops: { volume: 0.9, mute: false },
    synth: { volume: 0.8, mute: false }
  },
  keyOctave: saved.keyOctave ?? 4,
  rollBase: saved.rollBase ?? 48,
  heldNotes: []
}))

// Debounced persistence — patterns change on every click while painting.
let saveTimer: ReturnType<typeof setTimeout> | null = null
useStudio.subscribe((s) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const data: Persisted = {
      view: s.view,
      selectedTrack: s.selectedTrack,
      bpm: s.bpm,
      swing: s.swing,
      metronome: s.metronome,
      pattern: s.pattern,
      patch: s.patch,
      userPatches: s.userPatches,
      kit: s.kit,
      userKits: s.userKits,
      chop: s.chop,
      chopTitle: s.chopTitle,
      mixer: s.mixer,
      keyOctave: s.keyOctave,
      rollBase: s.rollBase
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // storage full/unavailable — the session still works, it just won't persist
    }
  }, 400)
})
