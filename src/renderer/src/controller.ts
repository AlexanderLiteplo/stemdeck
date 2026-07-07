/**
 * Bridges UI intent to the audio engine and keeps the zustand store in sync.
 * The engine owns real-time audio state; the store owns what React renders.
 */
import { engine, type LoadedStem } from './audio/engine'
import { analyzeBpm } from './audio/analysis'
import { computePeaks, type WaveformPeaks } from './audio/analysis'
import {
  emptyDeck,
  showToast,
  updateDeck,
  updateMixer,
  updateTrack,
  useStore,
  type TrackInfo
} from './state/store'
import type { PersistedLibrary, PersistedTrack, StemPaths } from './types'

/** Waveform peak data lives outside the store (too big for React state). */
export const trackPeaks = new Map<string, WaveformPeaks>()
export const deckPeaks: (WaveformPeaks | null)[] = [null, null]

let trackCounter = 0

export async function initApp(): Promise<void> {
  await engine.init()
  engine.decks.forEach((deck, i) => {
    deck.onEnded = () => updateDeck(i, { playing: false })
  })
  const [models, stemEngine] = await Promise.all([
    window.stemdeck.stemModels(),
    window.stemdeck.checkStemEngine()
  ])
  useStore.setState({
    engineReady: true,
    stemModels: models,
    stemEngine: { ...stemEngine, checked: true }
  })
  await restoreLibrary()
  window.stemdeck.onStemProgress(({ trackPath, line }) => {
    const track = useStore.getState().library.find((t) => t.path === trackPath)
    if (track) updateTrack(track.id, { stemStatus: line.slice(0, 120) })
  })
  const youtube = await window.stemdeck.checkYoutube()
  useStore.setState((s) => ({ youtube: { ...s.youtube, available: youtube.ytdlp !== null } }))
  window.stemdeck.onYoutubeProgress(({ line }) => {
    useStore.setState((s) =>
      s.youtube.downloading ? { youtube: { ...s.youtube, status: line.slice(0, 120) } } : s
    )
  })
}

/** Download a YouTube track's audio with yt-dlp and drop it into the library. */
export async function addYoutubeTrack(url: string): Promise<void> {
  const { youtube } = useStore.getState()
  if (youtube.downloading) return
  if (!youtube.available) {
    showToast('yt-dlp not found — install it with: pipx install yt-dlp')
    return
  }
  useStore.setState((s) => ({
    youtube: { ...s.youtube, downloading: true, status: 'Starting download…' }
  }))
  try {
    const paths = await window.stemdeck.downloadYoutube(url)
    await addTrackPaths(paths)
    showToast(`Downloaded ${paths.length} track${paths.length > 1 ? 's' : ''} 🎶`)
  } catch (err) {
    showToast(`YouTube download failed: ${(err as Error).message}`)
  } finally {
    useStore.setState((s) => ({ youtube: { ...s.youtube, downloading: false, status: '' } }))
  }
}

// ---------- Library persistence ----------

function encodePeaks(peaks: WaveformPeaks): string {
  const u8 = new Uint8Array(peaks.data.buffer, peaks.data.byteOffset, peaks.data.byteLength)
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode(...u8.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function decodePeaks(encoded: string): WaveformPeaks {
  const binary = atob(encoded)
  const u8 = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i)
  const data = new Float32Array(u8.buffer)
  return { data, buckets: data.length / 2 }
}

/** Persist the analyzed library so tracks survive app restarts. */
export async function saveLibrary(): Promise<void> {
  const { library, selectedModel } = useStore.getState()
  const tracks: PersistedTrack[] = library
    .filter((t) => !t.analyzing)
    .map((t) => {
      const peaks = trackPeaks.get(t.id)
      return {
        path: t.path,
        name: t.name,
        duration: t.duration,
        bpm: t.bpm,
        firstBeat: t.firstBeat,
        peaks: peaks ? encodePeaks(peaks) : null,
        stems: t.stems
      }
    })
  const data: PersistedLibrary = { version: 1, selectedModel, tracks }
  await window.stemdeck.saveLibrary(data)
}

async function restoreLibrary(): Promise<void> {
  const data = (await window.stemdeck.loadLibrary()) as PersistedLibrary | null
  if (!data || data.version !== 1 || !Array.isArray(data.tracks)) return
  const tracks: TrackInfo[] = []
  for (const saved of data.tracks) {
    const id = `track-${trackCounter++}`
    if (saved.peaks) {
      try {
        trackPeaks.set(id, decodePeaks(saved.peaks))
      } catch {
        // corrupt peaks — waveform will just be empty until re-added
      }
    }
    tracks.push({
      id,
      path: saved.path,
      name: saved.name,
      duration: saved.duration,
      bpm: saved.bpm,
      firstBeat: saved.firstBeat,
      analyzing: false,
      stems: saved.stems,
      separating: false,
      stemStatus: ''
    })
  }
  useStore.setState({
    library: tracks,
    selectedModel: data.selectedModel || useStore.getState().selectedModel
  })
}

// ---------- Library ----------

export async function addTracksFromDialog(): Promise<void> {
  const paths = await window.stemdeck.openAudioDialog()
  await addTrackPaths(paths)
}

export async function addDroppedFiles(files: FileList): Promise<void> {
  const paths: string[] = []
  for (const file of Array.from(files)) {
    if (/\.(mp3|wav|flac|m4a|aac|ogg|aiff)$/i.test(file.name)) {
      paths.push(window.stemdeck.getPathForFile(file))
    }
  }
  await addTrackPaths(paths)
}

async function addTrackPaths(paths: string[]): Promise<void> {
  const { library, selectedModel } = useStore.getState()
  for (const path of paths) {
    if (library.some((t) => t.path === path)) continue
    const id = `track-${trackCounter++}`
    const name = path.split('/').pop() ?? path
    const track: TrackInfo = {
      id,
      path,
      name: name.replace(/\.[^.]+$/, ''),
      duration: 0,
      bpm: 0,
      firstBeat: 0,
      analyzing: true,
      stems: null,
      separating: false,
      stemStatus: ''
    }
    useStore.setState((s) => ({ library: [...s.library, track] }))
    void analyzeTrack(track, selectedModel)
  }
}

async function analyzeTrack(track: TrackInfo, model: string): Promise<void> {
  try {
    const data = await window.stemdeck.readFile(track.path)
    const buffer = await engine.decode(data)
    trackPeaks.set(track.id, computePeaks(buffer))
    const cached = await window.stemdeck.getCachedStems(track.path, model)
    updateTrack(track.id, { duration: buffer.duration, stems: cached })
    const { bpm, firstBeat } = await analyzeBpm(buffer)
    updateTrack(track.id, { bpm, firstBeat, analyzing: false })
    void saveLibrary()
  } catch (err) {
    updateTrack(track.id, { analyzing: false })
    showToast(`Failed to analyze ${track.name}: ${(err as Error).message}`)
  }
}

// ---------- Deck loading ----------

export async function loadTrackToDeck(
  deckIndex: number,
  trackId: string,
  withStems: boolean
): Promise<void> {
  const track = useStore.getState().library.find((t) => t.id === trackId)
  if (!track) return
  const deck = engine.decks[deckIndex]
  const { pitchRange } = useStore.getState().decks[deckIndex]
  updateDeck(deckIndex, { ...emptyDeck(), pitchRange, loading: true, trackId, title: track.name })
  try {
    let stems: LoadedStem[]
    if (withStems && track.stems) {
      const entries = (['vocals', 'drums', 'bass', 'other', 'instrumental'] as const)
        .filter((k) => track.stems![k])
        .map((k) => ({ name: k, path: track.stems![k]! }))
      stems = await Promise.all(
        entries.map(async ({ name, path }) => {
          const data = await window.stemdeck.readFile(path)
          return { name: name[0].toUpperCase() + name.slice(1), buffer: await engine.decode(data) }
        })
      )
    } else {
      const data = await window.stemdeck.readFile(track.path)
      stems = [{ name: 'Mix', buffer: await engine.decode(data) }]
    }
    deck.load(stems)
    deckPeaks[deckIndex] = trackPeaks.get(trackId) ?? null
    deck.setTempo(1)
    deck.setPitch(0)
    deck.setKeylock(false)
    updateDeck(deckIndex, {
      loading: false,
      duration: deck.duration,
      baseBpm: track.bpm,
      firstBeat: track.firstBeat,
      usingStems: withStems && stems.length > 1,
      stems: stems.map((s) => ({ name: s.name, active: true, volume: 1 }))
    })
  } catch (err) {
    updateDeck(deckIndex, { ...emptyDeck() })
    showToast(`Failed to load track: ${(err as Error).message}`)
  }
}

// ---------- Transport ----------

export function togglePlay(deckIndex: number): void {
  const state = useStore.getState().decks[deckIndex]
  if (!state.trackId || state.loading) return
  const deck = engine.decks[deckIndex]
  if (state.playing) {
    deck.pause()
    updateDeck(deckIndex, { playing: false })
  } else {
    deck.play()
    updateDeck(deckIndex, { playing: true })
  }
}

/** CDJ-style: playing -> jump back to cue and stop; paused -> set cue here. */
export function cuePress(deckIndex: number): void {
  const state = useStore.getState().decks[deckIndex]
  if (!state.trackId) return
  const deck = engine.decks[deckIndex]
  if (state.playing) {
    deck.pause()
    deck.seek(state.cuePoint)
    updateDeck(deckIndex, { playing: false })
  } else {
    updateDeck(deckIndex, { cuePoint: deck.getPosition() })
  }
}

export function seek(deckIndex: number, seconds: number): void {
  engine.decks[deckIndex].seek(Math.max(0, seconds))
}

export function hotCuePress(deckIndex: number, slot: number, clear: boolean): void {
  const state = useStore.getState().decks[deckIndex]
  if (!state.trackId) return
  const deck = engine.decks[deckIndex]
  const cues = [...state.hotCues]
  if (clear) {
    cues[slot] = null
    updateDeck(deckIndex, { hotCues: cues })
    return
  }
  const existing = cues[slot]
  if (existing === null) {
    cues[slot] = deck.getPosition()
    updateDeck(deckIndex, { hotCues: cues })
  } else {
    deck.seek(existing)
    if (state.playing) deck.play()
  }
}

// ---------- Tempo / pitch / sync ----------

export function setTempo(deckIndex: number, rate: number): void {
  engine.decks[deckIndex].setTempo(rate)
  updateDeck(deckIndex, { tempo: rate })
}

export function setPitch(deckIndex: number, semitones: number): void {
  engine.decks[deckIndex].setPitch(semitones)
  updateDeck(deckIndex, { pitch: semitones })
}

export function toggleKeylock(deckIndex: number): void {
  const state = useStore.getState().decks[deckIndex]
  const next = !state.keylock
  engine.decks[deckIndex].setKeylock(next)
  if (!next) {
    engine.decks[deckIndex].setPitch(0)
    updateDeck(deckIndex, { keylock: next, pitch: 0 })
  } else {
    updateDeck(deckIndex, { keylock: next })
  }
}

const PITCH_RANGES = [0.08, 0.16, 0.5]

/** Cycle the pitch fader range ±8% → ±16% → ±50%, clamping the current tempo into it. */
export function cyclePitchRange(deckIndex: number): void {
  const state = useStore.getState().decks[deckIndex]
  const idx = PITCH_RANGES.indexOf(state.pitchRange)
  const next = PITCH_RANGES[(idx + 1) % PITCH_RANGES.length]
  const clamped = Math.min(1 + next, Math.max(1 - next, state.tempo))
  if (clamped !== state.tempo) engine.decks[deckIndex].setTempo(clamped)
  updateDeck(deckIndex, { pitchRange: next, tempo: clamped })
}

export function toggleReverb(deckIndex: number): void {
  const state = useStore.getState().decks[deckIndex]
  const next = !state.reverb
  engine.decks[deckIndex].setReverb(next ? 0.45 : 0)
  updateDeck(deckIndex, { reverb: next })
}

/** Momentary pitch bend for beat alignment; call with 0 to release. */
export function pitchBend(deckIndex: number, amount: number): void {
  const state = useStore.getState().decks[deckIndex]
  engine.decks[deckIndex].setTempo(state.tempo * (1 + amount))
}

/** Match this deck's effective BPM (and beat phase, when playing) to the other deck. */
export function sync(deckIndex: number): void {
  const { decks } = useStore.getState()
  const me = decks[deckIndex]
  const other = decks[1 - deckIndex]
  if (!me.baseBpm || !other.baseBpm || !other.trackId) {
    showToast('Sync needs a track with detected BPM on both decks')
    return
  }
  const targetBpm = other.baseBpm * other.tempo
  const rate = targetBpm / me.baseBpm
  setTempo(deckIndex, rate)

  if (me.playing && other.playing) {
    const myDeck = engine.decks[deckIndex]
    const otherDeck = engine.decks[1 - deckIndex]
    const otherBeatLen = 60 / other.baseBpm
    const myBeatLen = 60 / me.baseBpm
    const otherPhase =
      (((otherDeck.getPosition() - other.firstBeat) / otherBeatLen) % 1 + 1) % 1
    const myPos = myDeck.getPosition()
    const myPhase = (((myPos - me.firstBeat) / myBeatLen) % 1 + 1) % 1
    let delta = (otherPhase - myPhase) * myBeatLen
    if (delta > myBeatLen / 2) delta -= myBeatLen
    if (delta < -myBeatLen / 2) delta += myBeatLen
    myDeck.seek(Math.max(0, myPos + delta))
  }
}

// ---------- Loops ----------

function applyLoop(deckIndex: number, active: boolean, start: number, end: number): void {
  engine.decks[deckIndex].setLoop(active, start, end)
  updateDeck(deckIndex, { loop: { active, start, end } })
}

export function loopIn(deckIndex: number): void {
  const pos = engine.decks[deckIndex].getPosition()
  const { loop } = useStore.getState().decks[deckIndex]
  applyLoop(deckIndex, false, pos, loop.end)
}

export function loopOut(deckIndex: number): void {
  const { loop } = useStore.getState().decks[deckIndex]
  const pos = engine.decks[deckIndex].getPosition()
  if (pos > loop.start) applyLoop(deckIndex, true, loop.start, pos)
}

export function loopExit(deckIndex: number): void {
  const { loop } = useStore.getState().decks[deckIndex]
  applyLoop(deckIndex, false, loop.start, loop.end)
}

/** Beat-snapped loop of `beats` starting at the nearest beat before the playhead. */
export function beatLoop(deckIndex: number, beats: number): void {
  const state = useStore.getState().decks[deckIndex]
  if (!state.baseBpm) {
    showToast('Beat loops need a detected BPM')
    return
  }
  const beatLen = 60 / state.baseBpm
  const pos = engine.decks[deckIndex].getPosition()
  const beatsFromFirst = Math.max(0, Math.floor((pos - state.firstBeat) / beatLen))
  const start = state.firstBeat + beatsFromFirst * beatLen
  applyLoop(deckIndex, true, start, start + beats * beatLen)
}

/** Jump backward/forward by musical bars (4 beats each) at the track's own timeline. */
export function jumpBars(deckIndex: number, bars: number): void {
  const state = useStore.getState().decks[deckIndex]
  if (!state.trackId) return
  if (!state.baseBpm) {
    showToast('Bar jumps need a detected BPM')
    return
  }
  const seconds = bars * 4 * (60 / state.baseBpm)
  engine.decks[deckIndex].jumpBy(seconds)
}

// ---------- Stems ----------

export function setStemActive(deckIndex: number, stemIndex: number, active: boolean): void {
  const state = useStore.getState().decks[deckIndex]
  const stems = state.stems.map((s, i) => (i === stemIndex ? { ...s, active } : s))
  engine.decks[deckIndex].setStemGain(stemIndex, active ? stems[stemIndex].volume : 0)
  updateDeck(deckIndex, { stems })
}

export function setStemVolume(deckIndex: number, stemIndex: number, volume: number): void {
  const state = useStore.getState().decks[deckIndex]
  const stems = state.stems.map((s, i) => (i === stemIndex ? { ...s, volume } : s))
  if (stems[stemIndex].active) engine.decks[deckIndex].setStemGain(stemIndex, volume)
  updateDeck(deckIndex, { stems })
}

export async function separateTrack(trackId: string): Promise<void> {
  const { library, selectedModel, stemEngine } = useStore.getState()
  const track = library.find((t) => t.id === trackId)
  if (!track || track.separating) return
  if (!stemEngine.available) {
    showToast('Stem engine not found — install audio-separator (see README)')
    return
  }
  updateTrack(trackId, { separating: true, stemStatus: 'Starting separation…' })
  try {
    const stems: StemPaths = await window.stemdeck.separateStems(track.path, selectedModel)
    updateTrack(trackId, { separating: false, stems, stemStatus: '' })
    void saveLibrary()
    showToast(`Stems ready for ${track.name}`)
  } catch (err) {
    updateTrack(trackId, { separating: false, stemStatus: '' })
    showToast(`Separation failed: ${(err as Error).message}`)
  }
}

// ---------- Mixer ----------

export function setEq(deckIndex: number, band: 'low' | 'mid' | 'high', value: number): void {
  engine.decks[deckIndex].setEq(band, value)
  updateMixer(deckIndex, band === 'low' ? { eqLow: value } : band === 'mid' ? { eqMid: value } : { eqHigh: value })
}

export function setFilter(deckIndex: number, value: number): void {
  engine.decks[deckIndex].setFilter(value)
  updateMixer(deckIndex, { filter: value })
}

export function setTrim(deckIndex: number, value: number): void {
  engine.decks[deckIndex].setTrim(value)
  updateMixer(deckIndex, { trim: value })
}

export function setFader(deckIndex: number, value: number): void {
  engine.decks[deckIndex].setFader(value)
  updateMixer(deckIndex, { fader: value })
}

export function setCrossfader(value: number): void {
  engine.setCrossfader(value)
  useStore.setState({ crossfader: value })
}

export function setMasterGain(value: number): void {
  engine.setMasterGain(value)
  useStore.setState({ masterGain: value })
}

// ---------- Recording ----------

export async function toggleRecording(): Promise<void> {
  if (engine.isRecording) {
    const blob = await engine.stopRecording()
    useStore.setState({ recording: false })
    const data = await blob.arrayBuffer()
    const saved = await window.stemdeck.saveRecording(data)
    if (saved) showToast(`Mix saved to ${saved}`)
  } else {
    engine.startRecording()
    useStore.setState({ recording: true })
  }
}
