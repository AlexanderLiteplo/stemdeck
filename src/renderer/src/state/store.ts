import { create } from 'zustand'
import type { RecordingInfo, StemPaths } from '../types'

/** Sentinel active-view id for the recordings pane (not a real crate). */
export const RECORDINGS_VIEW = '__recordings__'

export interface Folder {
  id: string
  name: string
}

export interface TrackInfo {
  id: string
  path: string
  name: string
  duration: number
  bpm: number
  firstBeat: number
  /** Beat-tracker confidence [0, 5.32]; 0 = fallback detector. */
  bpmConfidence: number
  /** Version of the analysis pipeline that produced bpm/firstBeat. */
  analysisV: number
  analyzing: boolean
  stems: StemPaths | null
  separating: boolean
  stemStatus: string
  /** Crate this track belongs to, or null for uncategorized. */
  folderId: string | null
}

export interface StemUI {
  name: string
  active: boolean
  volume: number
}

export interface LoopState {
  active: boolean
  start: number
  end: number
}

/** Pitch correction applied to the vocal stem. Needs a separated track. */
export interface AutotuneState {
  enabled: boolean
  /** Root note, 0 = C .. 11 = B. */
  key: number
  scale: 'major' | 'minor' | 'chromatic'
  /** 0 = untouched, 1 = fully snapped to the target note. */
  strength: number
  /** Retune time in ms; 0 is the instant, hard-tuned sound. */
  retuneMs: number
  mix: number
  /** Keep the singer's formants while shifting — off sounds chipmunky. */
  formant: boolean
}

export interface DeckState {
  trackId: string | null
  title: string
  duration: number
  baseBpm: number
  firstBeat: number
  loading: boolean
  playing: boolean
  tempo: number
  /** Pitch fader half-range as a fraction, e.g. 0.16 = ±16%. */
  pitchRange: number
  pitch: number
  keylock: boolean
  /** Reverb wet amount in [0, 1]. */
  reverb: number
  cuePoint: number
  hotCues: (number | null)[]
  loop: LoopState
  autotune: AutotuneState
  stems: StemUI[]
  usingStems: boolean
}

export interface MixerChannelState {
  trim: number
  eqLow: number
  eqMid: number
  eqHigh: number
  filter: number
  fader: number
}

export interface AppState {
  engineReady: boolean
  stemEngine: { available: boolean; bin: string | null; checked: boolean }
  stemModels: Record<string, { label: string; stems: number }>
  selectedModel: string
  /** Automatically queue stem separation for newly added tracks. */
  autoStems: boolean
  library: TrackInfo[]
  folders: Folder[]
  /** Selected crate id, RECORDINGS_VIEW, or null for "All Tracks". */
  activeFolderId: string | null
  recordings: RecordingInfo[]
  decks: [DeckState, DeckState]
  mixer: [MixerChannelState, MixerChannelState]
  crossfader: number
  masterGain: number
  recording: boolean
  /** Video reel capture: camera + deck composited for Instagram. */
  reel: {
    recording: boolean
    /** Mic is opt-in per take, so a reel never picks up the room by accident. */
    mic: boolean
    /** Self-view for framing; hidden while recording so it stays out of the capture. */
    preview: boolean
    saving: boolean
  }
  toast: string | null
  youtube: { available: boolean; downloading: boolean; status: string }
}

export const emptyDeck = (): DeckState => ({
  trackId: null,
  title: '',
  duration: 0,
  baseBpm: 0,
  firstBeat: 0,
  loading: false,
  playing: false,
  tempo: 1,
  pitchRange: 0.16,
  pitch: 0,
  keylock: false,
  reverb: 0,
  cuePoint: 0,
  hotCues: [null, null, null, null],
  loop: { active: false, start: 0, end: 0 },
  autotune: {
    enabled: false,
    key: 0,
    scale: 'chromatic',
    strength: 1,
    retuneMs: 0,
    mix: 1,
    formant: true
  },
  stems: [],
  usingStems: false
})

const emptyChannel = (): MixerChannelState => ({
  trim: 1,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  filter: 0,
  fader: 1
})

export const useStore = create<AppState>(() => ({
  engineReady: false,
  stemEngine: { available: false, bin: null, checked: false },
  stemModels: {},
  selectedModel: 'htdemucs_ft.yaml',
  autoStems: true,
  library: [],
  folders: [],
  activeFolderId: null,
  recordings: [],
  decks: [emptyDeck(), emptyDeck()],
  mixer: [emptyChannel(), emptyChannel()],
  crossfader: 0.5,
  masterGain: 1,
  recording: false,
  reel: { recording: false, mic: false, preview: false, saving: false },
  toast: null,
  youtube: { available: false, downloading: false, status: '' }
}))

export function updateReel(patch: Partial<AppState['reel']>): void {
  useStore.setState((state) => ({ reel: { ...state.reel, ...patch } }))
}

export function updateDeck(index: number, patch: Partial<DeckState>): void {
  useStore.setState((state) => {
    const decks = [...state.decks] as [DeckState, DeckState]
    decks[index] = { ...decks[index], ...patch }
    return { decks }
  })
}

export function updateTrack(trackId: string, patch: Partial<TrackInfo>): void {
  useStore.setState((state) => ({
    library: state.library.map((t) => (t.id === trackId ? { ...t, ...patch } : t))
  }))
}

export function updateMixer(index: number, patch: Partial<MixerChannelState>): void {
  useStore.setState((state) => {
    const mixer = [...state.mixer] as [MixerChannelState, MixerChannelState]
    mixer[index] = { ...mixer[index], ...patch }
    return { mixer }
  })
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
export function showToast(message: string): void {
  useStore.setState({ toast: message })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => useStore.setState({ toast: null }), 5000)
}
