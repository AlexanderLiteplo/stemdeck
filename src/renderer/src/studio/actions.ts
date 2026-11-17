/**
 * Studio intent -> audio engine + store. The engine owns sound; the store
 * owns what React renders and what gets saved.
 */
import { engine } from '../audio/engine'
import { computePeaks, type WaveformPeaks } from '../audio/analysis'
import { showToast, useStore } from '../state/store'
import { studio } from './engine'
import { chordNotes, chordPads, type SongScale } from './chords'
import { DRUM_KITS, SYNTH_PRESETS, cloneKit, clonePatch, emptyPattern } from './presets'
import { useStudio, type AppView, type KeyMode } from './store'
import {
  CHOP_PADS,
  DRUM_VOICES,
  STEPS_PER_BAR,
  type ChopSettings,
  type ChopSource,
  type DrumKit,
  type DrumVoice,
  type DrumVoiceId,
  type MixerTrack,
  type Pattern,
  type StudioTrackId,
  type SynthNote,
  type SynthPatch
} from './types'

const get = useStudio.getState
const set = useStudio.setState

// ---------- Setup ----------

/** Chop sample state kept out of React (too big for the store). */
export const chopData: { buffer: AudioBuffer | null; peaks: WaveformPeaks | null } = {
  buffer: null,
  peaks: null
}

/** Last triggered chop, for the waveform's moving playhead. */
export const chopFlash: { pad: number; at: number; rate: number } = { pad: -1, at: 0, rate: 1 }
/** Last trigger time per drum voice / chop pad, for pad flashes. */
export const padFlash = new Map<string, number>()

export function initStudio(): void {
  if (studio.ready) return
  studio.init(engine.ctx, engine.master)
  const s = get()
  studio.setPatch(s.patch)
  studio.setKit(s.kit)
  studio.setPattern(s.pattern)
  studio.setBpm(s.bpm)
  studio.setSwing(s.swing)
  studio.setMetronome(s.metronome)
  studio.setChopSettings(s.chop)
  for (const t of ['drums', 'chops', 'synth'] as const) studio.setTrack(t, s.mixer[t])
  if (s.chop.trackId) void loadChopTrack(s.chop.trackId, s.chop.source, true)
}

export function setView(view: AppView): void {
  if (view === 'decks') releaseAllKeys()
  set({ view })
}

export function selectTrack(track: StudioTrackId): void {
  releaseAllKeys()
  set({ selectedTrack: track })
}

export function cycleTrack(): void {
  const order: StudioTrackId[] = ['drums', 'chops', 'synth']
  selectTrack(order[(order.indexOf(get().selectedTrack) + 1) % order.length])
}

// ---------- Transport ----------

export function togglePlay(): void {
  if (studio.playing) {
    studio.stop()
    set({ playing: false })
  } else {
    void engine.ctx.resume()
    studio.start()
    set({ playing: true })
  }
}

export function toggleRecordArm(): void {
  const next = !get().recordArm
  set({ recordArm: next })
  if (next && !studio.playing) togglePlay()
}

export function setBpm(bpm: number): void {
  if (!Number.isFinite(bpm)) return
  const clamped = Math.round(Math.min(240, Math.max(40, bpm)) * 10) / 10
  studio.setBpm(clamped)
  set({ bpm: clamped })
}

let taps: number[] = []
/** Tap tempo: average of the last few taps; a 2s gap starts over. */
export function tapTempo(): void {
  const now = performance.now()
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = []
  taps.push(now)
  taps = taps.slice(-6)
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1)
    setBpm(60000 / avg)
  }
}

/** Copy a deck's current (pitch-adjusted) BPM into the project. */
export function matchDeckBpm(deckIndex: number): void {
  const deck = useStore.getState().decks[deckIndex]
  if (!deck.baseBpm) {
    showToast(`Deck ${deckIndex === 0 ? 'A' : 'B'} has no BPM to match`)
    return
  }
  setBpm(deck.baseBpm * deck.tempo)
}

export function setSwing(swing: number): void {
  studio.setSwing(swing)
  set({ swing })
}

export function toggleMetronome(): void {
  const next = !get().metronome
  studio.setMetronome(next)
  set({ metronome: next })
}

export function setTrackMixer(track: StudioTrackId, patch: Partial<MixerTrack>): void {
  const mixer = { ...get().mixer, [track]: { ...get().mixer[track], ...patch } }
  studio.setTrack(track, mixer[track])
  set({ mixer })
}

// ---------- Pattern editing ----------

function commitPattern(pattern: Pattern): void {
  studio.setPattern(pattern)
  set({ pattern })
}

export function totalSteps(): number {
  return get().pattern.bars * STEPS_PER_BAR
}

export function setBars(bars: 1 | 2 | 4): void {
  commitPattern({ ...get().pattern, bars })
}

export function setDrumStep(voice: DrumVoiceId, step: number, velocity: number): void {
  const p = get().pattern
  const row = [...p.drums[voice]]
  row[step] = velocity
  commitPattern({ ...p, drums: { ...p.drums, [voice]: row } })
}

export function setChopStep(pad: number, step: number, velocity: number): void {
  const p = get().pattern
  const chops = p.chops.map((row, i) => {
    if (i !== pad) return row
    const next = [...row]
    next[step] = velocity
    return next
  })
  commitPattern({ ...p, chops })
}

/** Notes may not overlap on the same pitch: a new note trims/replaces what's under it. */
export function addNote(note: SynthNote): void {
  const p = get().pattern
  const end = note.step + note.length
  const notes = p.notes.filter(
    (n) => n.note !== note.note || n.step + n.length <= note.step || n.step >= end
  )
  commitPattern({ ...p, notes: [...notes, note] })
}

export function removeNote(target: SynthNote): void {
  const p = get().pattern
  commitPattern({ ...p, notes: p.notes.filter((n) => n !== target) })
}

export function resizeNote(target: SynthNote, length: number): void {
  const p = get().pattern
  commitPattern({
    ...p,
    notes: p.notes.map((n) => (n === target ? { ...n, length: Math.max(1, length) } : n))
  })
}

/** Copy the first half of the pattern onto the second (quick way to build 2/4-bar loops). */
export function duplicateBars(): void {
  const p = get().pattern
  if (p.bars === 1) {
    showToast('Set the pattern to 2 or 4 bars first, then duplicate')
    return
  }
  const half = (p.bars * STEPS_PER_BAR) / 2
  const dup = (row: number[]) => row.map((v, i) => (i >= half && i < half * 2 ? row[i - half] : v))
  const drums = Object.fromEntries(
    DRUM_VOICES.map((v) => [v, dup(p.drums[v])])
  ) as Pattern['drums']
  const notes = [
    ...p.notes.filter((n) => n.step < half),
    ...p.notes.filter((n) => n.step < half).map((n) => ({ ...n, step: n.step + half }))
  ]
  commitPattern({ ...p, drums, chops: p.chops.map(dup), notes })
}

export function clearTrack(track: StudioTrackId): void {
  const p = get().pattern
  const blank = emptyPattern(p.bars)
  if (track === 'drums') commitPattern({ ...p, drums: blank.drums })
  else if (track === 'chops') commitPattern({ ...p, chops: blank.chops })
  else commitPattern({ ...p, notes: [] })
}

// ---------- Synth sound design ----------

export function updatePatch(edit: (patch: SynthPatch) => void): void {
  const patch = clonePatch(get().patch)
  edit(patch)
  studio.setPatch(patch)
  set({ patch })
}

export function loadPatch(patch: SynthPatch): void {
  const next = clonePatch(patch)
  studio.allNotesOff()
  studio.setPatch(next)
  set({ patch: next })
}

export function saveUserPatch(name: string): void {
  const patch = { ...clonePatch(get().patch), name }
  const userPatches = [...get().userPatches.filter((p) => p.name !== name), patch]
  set({ patch, userPatches })
  showToast(`Saved synth sound “${name}”`)
}

export function deleteUserPatch(name: string): void {
  set({ userPatches: get().userPatches.filter((p) => p.name !== name) })
}

export const factoryPatches = SYNTH_PRESETS

// ---------- Drum kit design ----------

export function updateDrumVoice(id: DrumVoiceId, patch: Partial<DrumVoice>): void {
  const kit = cloneKit(get().kit)
  kit.voices[id] = { ...kit.voices[id], ...patch }
  studio.setKit(kit)
  set({ kit })
}

export function loadKit(kit: DrumKit): void {
  const next = cloneKit(kit)
  studio.setKit(next)
  set({ kit: next })
}

export function saveUserKit(name: string): void {
  const kit = { ...cloneKit(get().kit), name }
  const userKits = [...get().userKits.filter((k) => k.name !== name), kit]
  set({ kit, userKits })
  showToast(`Saved drum kit “${name}”`)
}

export function deleteUserKit(name: string): void {
  set({ userKits: get().userKits.filter((k) => k.name !== name) })
}

export const factoryKits = DRUM_KITS

export function selectDrum(id: DrumVoiceId): void {
  set({ selectedDrum: id })
}

// ---------- Chopper ----------

function stemPath(trackId: string, source: ChopSource): string | null {
  const track = useStore.getState().library.find((t) => t.id === trackId)
  if (!track) return null
  if (source === 'mix') return track.path
  return track.stems?.[source] ?? null
}

/** Decode a library track (or one of its stems) into the chopper. */
export async function loadChopTrack(
  trackId: string,
  source: ChopSource = 'mix',
  restoring = false
): Promise<void> {
  const track = useStore.getState().library.find((t) => t.id === trackId)
  if (!track) {
    if (!restoring) showToast('Track not found in the library')
    return
  }
  const path = stemPath(trackId, source) ?? track.path
  const usedSource: ChopSource = path === track.path ? 'mix' : source
  set({ chopLoading: true })
  try {
    const buffer = await engine.decode(await window.stemdeck.readFile(path))
    chopData.buffer = buffer
    chopData.peaks = computePeaks(buffer, 2400)
    studio.setChopBuffer(buffer)
    const prev = get().chop
    // Keep a hand-tuned grid when only the stem changes; otherwise take the analysis.
    const sameTrack = prev.trackId === trackId
    const chop: ChopSettings = {
      ...prev,
      trackId,
      source: usedSource,
      bpm: sameTrack || restoring ? prev.bpm : track.bpm || prev.bpm,
      offset: sameTrack || restoring ? prev.offset : track.firstBeat,
      startBeat: sameTrack || restoring ? prev.startBeat : 0
    }
    studio.setChopSettings(chop)
    set({ chop, chopTitle: track.name, chopLoading: false })
  } catch (err) {
    set({ chopLoading: false })
    if (!restoring) showToast(`Couldn't load sample: ${(err as Error).message}`)
  }
}

export function updateChop(patch: Partial<ChopSettings>): void {
  const chop = { ...get().chop, ...patch }
  studio.setChopSettings(chop)
  set({ chop })
}

/** Move the 16-pad window to start at `beat` (beats after the grid offset). */
export function setChopStart(beat: number): void {
  updateChop({ startBeat: Math.max(0, Math.round(beat * 2) / 2) })
}

/** Shift the pad window by whole pages of 16 chops. */
export function pageChops(direction: 1 | -1): void {
  const { startBeat, sliceBeats } = get().chop
  setChopStart(startBeat + direction * sliceBeats * CHOP_PADS)
}

// ---------- Live playing (+ recording into the pattern) ----------

function recordStep(): number | null {
  if (!get().recordArm || !studio.playing) return null
  const pos = studio.getStepPosition()
  if (pos < 0) return null
  return Math.round(pos) % totalSteps()
}

export function hitPad(pad: number, velocity = 1): void {
  const track = get().selectedTrack
  if (track === 'drums') hitDrum(DRUM_VOICES[pad], velocity)
  else if (track === 'chops') hitChop(pad, velocity)
}

export function hitDrum(id: DrumVoiceId | undefined, velocity = 1): void {
  if (!id) return
  void engine.ctx.resume()
  studio.triggerDrum(id, velocity)
  padFlash.set(`drum:${id}`, performance.now())
  set({ selectedDrum: id })
  const step = recordStep()
  if (step !== null) setDrumStep(id, step, velocity)
}

export function hitChop(pad: number, velocity = 1): void {
  if (pad < 0 || pad >= CHOP_PADS) return
  void engine.ctx.resume()
  if (!chopData.buffer || !studio.chopRegion(pad)) return
  studio.triggerChop(pad, velocity)
  const { chop, bpm } = get()
  chopFlash.pad = pad
  chopFlash.at = performance.now()
  chopFlash.rate = (chop.fitToTempo ? bpm / chop.bpm : 1) * Math.pow(2, chop.pitch / 12)
  padFlash.set(`chop:${pad}`, performance.now())
  const step = recordStep()
  if (step !== null) setChopStep(pad, step, velocity)
}

/** Live synth notes, keyed by MIDI, with the step they started on when recording. */
const liveNotes = new Map<number, { startPos: number | null }>()

export function synthDown(midi: number, velocity = 0.9): void {
  if (liveNotes.has(midi)) return
  void engine.ctx.resume()
  studio.noteOn(midi, velocity)
  const pos = get().recordArm && studio.playing ? studio.getStepPosition() : -1
  liveNotes.set(midi, { startPos: pos >= 0 ? pos : null })
  set({ heldNotes: [...get().heldNotes, midi] })
}

export function synthUp(midi: number): void {
  const live = liveNotes.get(midi)
  if (!live) return
  liveNotes.delete(midi)
  studio.noteOff(midi)
  set({ heldNotes: get().heldNotes.filter((n) => n !== midi) })
  if (live.startPos === null || !studio.playing) return
  const total = totalSteps()
  const endPos = studio.getStepPosition()
  const step = Math.round(live.startPos) % total
  const held = (endPos - live.startPos + total) % total
  addNote({ step, note: midi, length: Math.max(1, Math.min(total, Math.round(held))), velocity: 0.9 })
}

export function releaseAllKeys(): void {
  for (const midi of [...liveNotes.keys()]) synthUp(midi)
  studio.allNotesOff()
  set({ heldNotes: [], activeChord: null })
}

// ---------- Chord pads ----------

/** Play chord pad `pad` (0..8) of the current song key; replaces any held chord. */
export function chordDown(pad: number, seventh: boolean, velocity = 0.8): void {
  const { songKey, songScale, keyOctave, activeChord } = get()
  const def = chordPads(songScale)[pad]
  if (!def) return
  if (activeChord) chordUp()
  const notes = chordNotes(def, songKey, (keyOctave + 1) * 12, seventh)
  set({ activeChord: { pad, seventh, notes } })
  for (const midi of notes) synthDown(midi, velocity)
}

/** Release the held chord (no-op when `pad` is given and a different pad is held). */
export function chordUp(pad?: number): void {
  const active = get().activeChord
  if (!active || (pad !== undefined && pad !== active.pad)) return
  set({ activeChord: null })
  for (const midi of active.notes) synthUp(midi)
}

export function setKeyMode(mode: KeyMode): void {
  releaseAllKeys()
  set({ keyMode: mode })
}

export function setSongKey(key: number, scale: SongScale): void {
  releaseAllKeys()
  set({ songKey: ((key % 12) + 12) % 12, songScale: scale })
}

/** Use the key StemDeck detected for the track on a deck. */
export function matchDeckKey(deckIndex: number): void {
  const { decks, library } = useStore.getState()
  const track = library.find((t) => t.id === decks[deckIndex].trackId)
  const label = deckIndex === 0 ? 'A' : 'B'
  if (!track) {
    showToast(`Load a track on deck ${label} first`)
    return
  }
  if (track.musicalKey === null || track.musicalScale === null) {
    showToast(`No key detected for the track on deck ${label}`)
    return
  }
  setSongKey(track.musicalKey, track.musicalScale)
}

export function shiftKeyOctave(delta: number): void {
  releaseAllKeys()
  set({ keyOctave: Math.min(7, Math.max(1, get().keyOctave + delta)) })
}

export function shiftRoll(delta: number): void {
  set({ rollBase: Math.min(96, Math.max(12, get().rollBase + delta)) })
}
