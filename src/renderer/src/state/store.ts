import { create } from 'zustand'
import type { StemPaths } from '../types'

export interface TrackInfo {
  id: string
  path: string
  name: string
  duration: number
  bpm: number
  firstBeat: number
  analyzing: boolean
  stems: StemPaths | null
  separating: boolean
  stemStatus: string
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

export interface DeckState {
  trackId: string | null
  title: string
  duration: number
  baseBpm: number
  firstBeat: number
  loading: boolean
  playing: boolean
  tempo: number
  pitch: number
  keylock: boolean
  cuePoint: number
  hotCues: (number | null)[]
  loop: LoopState
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
  library: TrackInfo[]
  decks: [DeckState, DeckState]
  mixer: [MixerChannelState, MixerChannelState]
  crossfader: number
  masterGain: number
  recording: boolean
  toast: string | null
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
  pitch: 0,
  keylock: false,
  cuePoint: 0,
  hotCues: [null, null, null, null],
  loop: { active: false, start: 0, end: 0 },
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
  library: [],
  decks: [emptyDeck(), emptyDeck()],
  mixer: [emptyChannel(), emptyChannel()],
  crossfader: 0.5,
  masterGain: 1,
  recording: false,
  toast: null
}))

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
