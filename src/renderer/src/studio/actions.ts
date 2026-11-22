/**
 * Studio intent -> audio engine + store. The engine owns sound; the store
 * owns what React renders and what gets saved.
 */
import { engine } from '../audio/engine'
import { computePeaks, type WaveformPeaks } from '../audio/analysis'
import { showToast, useStore } from '../state/store'
import { studio } from './engine'
import { randomPatch } from './chaos'
import { chordNotes, chordPads, type SongScale } from './chords'
import { carve, clampShift, clipEnd, splitClip } from './clips'
import { clearHistory, takeRedo, takeUndo, withoutHistory } from './history'
import { BUILTIN_PREFIX, builtinLabel } from './builtinSamples'
import { writeDrumRows } from './drumtext'
import { GROOVES } from './grooves'
import { DRUM_KITS, SYNTH_PRESETS, cloneKit, clonePatch, newPattern, uid } from './presets'
import { SONG_KEYS, pickSong, type SongData } from './song'
import { dropSong, getSong, listSongs, putSong, renameSaved } from './songs'
import { SONG_TEMPLATES, type TemplateId } from './templates'
import {
  ZOOM_MAX,
  ZOOM_MIN,
  patternSteps,
  selPattern,
  selTrack,
  songEnd,
  useStudio,
  type AppView,
  type ArrangeTool,
  type FocusArea,
  type KeyMode
} from './store'
import {
  CHOP_PADS,
  DRUM_VOICES,
  MAX_STEPS,
  STEPS_PER_BAR,
  type ChopSettings,
  type ChopSource,
  type Clip,
  type CycleRange,
  type DrumKit,
  type DrumPattern,
  type DrumVoice,
  type DrumVoiceId,
  type Pattern,
  type PlayMode,
  type StudioTrack,
  type SynthNote,
  type SynthPatch
} from './types'

const get = useStudio.getState
const set = useStudio.setState

const MAX_SYNTH_TRACKS = 8

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

/** Hand the engine the current tracks, patterns and clips (cheap: it keeps references). */
function syncProject(): void {
  const { tracks, patterns, clips } = get()
  studio.setProject({ tracks, patterns, clips })
}

/** Push levels to the engine. While any track is soloed, the others are silenced. */
function syncMixer(): void {
  const { tracks } = get()
  const soloing = tracks.some((t) => t.solo)
  for (const t of tracks) {
    studio.setTrack(t.id, { volume: t.volume, mute: t.mute || (soloing && !t.solo) })
  }
}

function syncCycle(): void {
  const { cycle, cycleOn } = get()
  studio.setCycle(cycleOn ? cycle : null)
}

/** Push the whole song to the engine: sounds, kit, tempo, sample settings, tracks and clips. */
function syncSong(): void {
  const s = get()
  for (const t of s.tracks) if (t.patch) studio.setPatch(t.id, t.patch)
  studio.setKit(s.kit)
  loadKitSamples(s.kit)
  studio.setBpm(s.bpm)
  studio.setSwing(s.swing)
  studio.setChopSettings(s.chop)
  syncProject()
  syncMixer()
  syncCycle()
}

/**
 * Replace the song in the store and the engine (undo, redo, opening a song).
 * Selections that no longer exist are dropped, and the chopper sample is
 * reloaded when the song uses a different one.
 */
function applySong(data: SongData): void {
  releaseAllKeys()
  const before = get().chop
  const clipIds = new Set(data.clips.map((c) => c.id))
  withoutHistory(() =>
    set({
      ...data,
      selectedTrack: data.tracks.some((t) => t.id === get().selectedTrack) ? get().selectedTrack : data.tracks[0].id,
      selectedClips: get().selectedClips.filter((id) => clipIds.has(id))
    })
  )
  syncSong()
  const { trackId, source } = data.chop
  if (trackId !== before.trackId || source !== before.source) {
    if (trackId) {
      void loadChopTrack(trackId, source, true)
    } else {
      chopData.buffer = null
      chopData.peaks = null
      studio.setChopBuffer(null)
    }
  }
}

// ---------- Undo / redo ----------

export function undo(): void {
  const snapshot = takeUndo()
  if (snapshot) applySong(snapshot)
  else showToast('Nothing to undo')
}

export function redo(): void {
  const snapshot = takeRedo()
  if (snapshot) applySong(snapshot)
  else showToast('Nothing to redo')
}

// ---------- Songs ----------

/*
 * The open song saves itself into the library a moment after every change, so
 * the song list is always current and nothing depends on remembering to save.
 * SAVE (⌘S) just does it immediately.
 */

const AUTOSAVE_MS = 800
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
/** Warn once when storage refuses a write, not on every keystroke after. */
let storageWarned = false

function cancelAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = null
}

/** Write the open song into the library now. Returns false when storage refused it. */
function writeOpenSong(): boolean {
  cancelAutosave()
  const s = get()
  const ok = putSong(s.songId, s.songName, pickSong(s))
  if (!ok && !storageWarned) showToast('Could not save — storage is full. Delete some old songs to make room.')
  storageWarned = !ok
  set({ songs: listSongs(), songDirty: !ok })
  return ok
}

useStudio.subscribe((state, prev) => {
  // Switching songs is handled by switchSong; this only watches edits to the open song.
  if (state.songId !== prev.songId) return
  if (state.songName === prev.songName && !SONG_KEYS.some((key) => state[key] !== prev[key])) return
  cancelAutosave()
  autosaveTimer = setTimeout(writeOpenSong, AUTOSAVE_MS)
  if (!state.songDirty) set({ songDirty: true })
})

// Closing the window inside the autosave delay must not lose the last edit.
window.addEventListener('pagehide', () => {
  if (autosaveTimer) writeOpenSong()
})

/** SAVE / ⌘S. */
export function saveSong(): void {
  if (writeOpenSong()) showToast(`Saved “${get().songName}”`)
}

/** Swap the open song for another one. History and playback don't carry over. */
function switchSong(songId: string, songName: string, data: SongData): void {
  if (studio.playing) stopTransport()
  applySong(data)
  clearHistory()
  studio.seek(0)
  set({ songId, songName, songPos: 0, selectedClips: [] })
  // Loading is not an edit: don't re-save the song just opened (it would look "saved just now").
  cancelAutosave()
  set({ songDirty: false, songs: listSongs() })
}

/** A name not used by any other song: "Jungle starter", "Jungle starter 2", … */
function freeSongName(base: string): string {
  const taken = new Set([get().songName, ...listSongs().map((song) => song.name)])
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** Start a new song from a template and open it. Returns its id. */
export function newSong(templateId: TemplateId): string {
  const template = SONG_TEMPLATES.find((t) => t.id === templateId) ?? SONG_TEMPLATES[0]
  writeOpenSong()
  const id = uid('song')
  switchSong(id, freeSongName(template.name), template.build())
  writeOpenSong()
  return id
}

export function openSong(id: string): void {
  if (id === get().songId) return
  const song = getSong(id)
  if (!song) {
    showToast('That song could not be opened')
    return
  }
  writeOpenSong()
  switchSong(id, song.name, song.data)
}

export function renameSong(id: string, name: string): void {
  const songName = name.trim().slice(0, 60)
  if (!songName) return
  if (id === get().songId) {
    set({ songName })
    writeOpenSong()
  } else {
    renameSaved(id, songName)
    set({ songs: listSongs() })
  }
}

/** Save a copy of a song under "<name> copy". The open song stays open. Returns the copy's id. */
export function duplicateSong(id: string): string | null {
  const s = get()
  const source = id === s.songId ? { name: s.songName, data: structuredClone(pickSong(s)) } : getSong(id)
  if (!source) return null
  const copyId = uid('song')
  const name = freeSongName(`${source.name} copy`)
  if (!putSong(copyId, name, source.data)) {
    showToast('Could not save the copy — storage is full')
    return null
  }
  set({ songs: listSongs() })
  return copyId
}

/** Delete a song for good. Deleting the open one opens the most recent other song (or a blank one). */
export function deleteSong(id: string): void {
  if (id !== get().songId) {
    dropSong(id)
    set({ songs: listSongs() })
    return
  }
  cancelAutosave()
  const next = listSongs().find((song) => song.id !== id)
  const saved = next ? getSong(next.id) : null
  dropSong(id)
  if (next && saved) {
    switchSong(next.id, saved.name, saved.data)
  } else {
    switchSong(uid('song'), 'Untitled', SONG_TEMPLATES[0].build())
    writeOpenSong()
  }
}

export function initStudio(): void {
  if (studio.ready) return
  studio.init(engine.ctx, engine.master)
  const s = get()
  syncSong()
  studio.setMetronome(s.metronome)
  studio.setMode(s.mode)
  studio.seek(s.songPos)
  studio.onSongEnd = () => set({ playing: false, recordArm: false })
  if (s.chop.trackId) void loadChopTrack(s.chop.trackId, s.chop.source, true)
  // A song that has never been written to the library (first run) goes in now, so it is listed.
  if (!listSongs().some((song) => song.id === s.songId)) writeOpenSong()
}

export function setView(view: AppView): void {
  if (view === 'decks') releaseAllKeys()
  set({ view })
}

export function setFocus(focus: FocusArea): void {
  if (get().focus !== focus) set({ focus })
}

// ---------- Tracks ----------

export function selectTrack(id: string): void {
  if (get().selectedTrack === id) return
  releaseAllKeys()
  set({ selectedTrack: id })
}

export function cycleTrack(): void {
  const { tracks, selectedTrack } = get()
  const index = tracks.findIndex((t) => t.id === selectedTrack)
  selectTrack(tracks[(index + 1) % tracks.length].id)
}

function updateTrack(id: string, patch: Partial<StudioTrack>): void {
  set({ tracks: get().tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
}

/** Rename a track (its lane on the timeline). */
export function renameTrack(id: string, name: string): void {
  const trimmed = name.trim().slice(0, 16)
  if (trimmed) updateTrack(id, { name: trimmed })
}

export function setTrackMixer(id: string, patch: Partial<Pick<StudioTrack, 'volume' | 'mute' | 'solo'>>): void {
  updateTrack(id, patch)
  syncMixer()
}

/** Add another synth track with its own sound and an empty first pattern. */
export function addSynthTrack(): void {
  const { tracks, patterns } = get()
  const synths = tracks.filter((t) => t.kind === 'synth')
  if (synths.length >= MAX_SYNTH_TRACKS) {
    showToast(`That's the limit: ${MAX_SYNTH_TRACKS} synth tracks`)
    return
  }
  const id = uid('synth')
  const names = new Set(tracks.map((t) => t.name))
  let number = synths.length + 1
  while (names.has(`SYNTH ${number}`)) number += 1
  // A new track should sound different from the first one, so reach for the loud presets.
  const taken = new Set(synths.map((t) => t.patch?.name))
  const starter =
    SYNTH_PRESETS.find((p) => p.group !== SYNTH_PRESETS[0].group && !taken.has(p.name)) ?? SYNTH_PRESETS[0]
  const pattern = newPattern('synth', id, 'A', 2)
  const patch = clonePatch(starter)
  const track: StudioTrack = {
    id,
    kind: 'synth',
    name: `SYNTH ${number}`,
    volume: 0.8,
    mute: false,
    solo: false,
    patternId: pattern.id,
    patch
  }
  releaseAllKeys()
  studio.setPatch(id, patch)
  set({ tracks: [...tracks, track], patterns: { ...patterns, [pattern.id]: pattern }, selectedTrack: id })
  syncProject()
  syncMixer()
}

/** Delete a synth track with its patterns and clips. Drums, chops and the last synth stay. */
export function removeTrack(id: string): void {
  const { tracks, patterns, clips, selectedTrack, selectedClips } = get()
  const track = tracks.find((t) => t.id === id)
  if (!track || track.kind !== 'synth') return
  if (tracks.filter((t) => t.kind === 'synth').length <= 1) {
    showToast('Keep at least one synth track')
    return
  }
  releaseAllKeys()
  const remaining = tracks.filter((t) => t.id !== id)
  const keptClips = clips.filter((c) => c.trackId !== id)
  const keptIds = new Set(keptClips.map((c) => c.id))
  set({
    tracks: remaining,
    patterns: Object.fromEntries(Object.entries(patterns).filter(([, p]) => p.trackId !== id)),
    clips: keptClips,
    selectedClips: selectedClips.filter((c) => keptIds.has(c)),
    selectedTrack: selectedTrack === id ? remaining[remaining.length - 1].id : selectedTrack
  })
  syncProject()
  syncMixer()
}

// ---------- Transport ----------

function stopTransport(): void {
  studio.stop()
  set({ playing: false })
}

export function togglePlay(): void {
  if (studio.playing) {
    stopTransport()
  } else {
    void engine.ctx.resume()
    studio.start()
    set({ playing: true })
  }
}

/** LOOP repeats the open patterns; SONG plays the timeline. Switching stops playback. */
export function setMode(mode: PlayMode): void {
  if (get().mode === mode) return
  if (studio.playing) stopTransport()
  studio.setMode(mode)
  set({ mode })
}

/** Move the song playhead (also while playing). Switches to SONG mode: you are pointing at the timeline. */
export function seekSong(step: number): void {
  setMode('song')
  movePlayhead(step)
}

/** Move the song playhead without changing play mode (where paste and SPLIT act). */
export function movePlayhead(step: number): void {
  const songPos = Math.max(0, Math.round(step))
  studio.seek(songPos)
  set({ songPos })
}

export function setCycle(cycle: CycleRange | null): void {
  set({ cycle, cycleOn: cycle !== null })
  syncCycle()
}

export function toggleCycle(): void {
  const { cycle, cycleOn, clips } = get()
  if (!cycle) {
    // Nothing marked yet: cycle the whole song (or the first four bars of an empty one).
    setCycle({ start: 0, end: Math.max(songEnd(clips), STEPS_PER_BAR * 4) })
    return
  }
  set({ cycleOn: !cycleOn })
  syncCycle()
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

/** Global playhead in steps (loop mode: within the 4-bar loop; song mode: song position). -1 when stopped. */
export function transportPosition(): number {
  return studio.ready ? studio.getStepPosition() : -1
}

/**
 * Where playback is inside the pattern open in the editor, as a fractional
 * step — or -1 when it isn't sounding (stopped, or in SONG mode while the
 * playhead is outside every clip of that pattern on the selected track).
 */
export function editorPosition(): number {
  const pos = transportPosition()
  if (pos < 0) return -1
  const s = get()
  const track = selTrack(s)
  const steps = patternSteps(s.patterns[track.patternId])
  if (s.mode === 'loop') return pos % steps
  const clip = s.clips.find(
    (c) => c.trackId === track.id && c.patternId === track.patternId && pos >= c.start && pos < clipEnd(c)
  )
  return clip ? (pos - clip.start + clip.offset) % steps : -1
}

// ---------- Patterns ----------

function commitPattern(pattern: Pattern): void {
  set({ patterns: { ...get().patterns, [pattern.id]: pattern } })
  syncProject()
}

export function totalSteps(): number {
  return patternSteps(selPattern(get()))
}

export function setBars(bars: 1 | 2 | 4): void {
  commitPattern({ ...selPattern(get()), bars })
}

export function setDrumStep(voice: DrumVoiceId, step: number, velocity: number): void {
  const p = selPattern(get())
  if (p.kind !== 'drums') return
  const row = [...p.drums[voice]]
  row[step] = velocity
  const next = { ...p, drums: { ...p.drums, [voice]: row } }
  // A step switched off forgets its roll, so switching it back on is a plain hit.
  if (velocity <= 0 && p.rolls?.[voice]?.[step]) next.rolls = withRoll(p.rolls, voice, step, 0)
  commitPattern(next)
}

/** `rolls` with one step changed, copying only the row that changes. */
function withRoll(rolls: DrumPattern['rolls'], voice: DrumVoiceId, step: number, count: number): DrumPattern['rolls'] {
  const row = [...(rolls?.[voice] ?? Array<number>(MAX_STEPS).fill(0))]
  row[step] = count
  return { ...rolls, [voice]: row }
}

/**
 * Right-click a drum step: single hit → roll of 2 → 3 → 4 → single again.
 * An empty step becomes a roll of 2.
 */
export function cycleDrumRoll(voice: DrumVoiceId, step: number): void {
  const p = selPattern(get())
  if (p.kind !== 'drums') return
  const on = (p.drums[voice][step] ?? 0) > 0
  const current = p.rolls?.[voice]?.[step] ?? 0
  const count = !on ? 2 : current >= 4 ? 0 : Math.max(2, current + 1)
  const drums = on ? p.drums : { ...p.drums, [voice]: p.drums[voice].map((v, i) => (i === step ? 0.8 : v)) }
  commitPattern({ ...p, drums, rolls: withRoll(p.rolls, voice, step, count) })
}

/** Replace the open drum pattern with one of the ready-made grooves. */
export function applyGroove(grooveId: string): void {
  const groove = GROOVES.find((g) => g.id === grooveId)
  const p = selPattern(get())
  if (!groove || p.kind !== 'drums') return
  commitPattern(writeDrumRows(newPattern('drums', p.trackId, p.name, groove.bars, p.id) as DrumPattern, groove.rows))
  const { bpm, kit } = get()
  const hints = [Math.abs(bpm - groove.bpm) > 8 ? `~${groove.bpm} BPM` : null, kit.name !== groove.kit ? `the ${groove.kit} kit` : null].filter(Boolean)
  showToast(`${groove.label} groove loaded into pattern ${p.name}${hints.length ? ` — sounds best with ${hints.join(' and ')}` : ''}. ⌘Z to undo.`)
}

export function setChopStep(pad: number, step: number, velocity: number): void {
  const p = selPattern(get())
  if (p.kind !== 'chops') return
  const chops = p.chops.map((row, i) => {
    if (i !== pad) return row
    const next = [...row]
    next[step] = velocity
    return next
  })
  commitPattern({ ...p, chops })
}

/** True when two notes share a pitch and their spans overlap. */
function collides(a: SynthNote, b: SynthNote): boolean {
  return a.note === b.note && a.step < b.step + b.length && b.step < a.step + a.length
}

/**
 * Lay `added` on top of `base`: anything in `base` that they'd overlap on the
 * same pitch is replaced, so no two notes ever stack on one key.
 */
export function layNotes(base: SynthNote[], added: SynthNote[]): SynthNote[] {
  return [...base.filter((n) => !added.some((a) => collides(a, n))), ...added]
}

export function addNote(note: SynthNote): void {
  placeNotes([note])
}

/** Add several notes at once (a dropped chord), replacing whatever they land on. */
export function placeNotes(added: SynthNote[]): void {
  const p = selPattern(get())
  if (p.kind === 'synth') commitPattern({ ...p, notes: layNotes(p.notes, added) })
}

/** Replace the whole note list (piano-roll edits compute it themselves). */
export function setNotes(notes: SynthNote[]): void {
  const p = selPattern(get())
  if (p.kind === 'synth') commitPattern({ ...p, notes })
}

/** Copy the first half of the pattern onto the second (quick way to build 2/4-bar loops). */
export function duplicateBars(): void {
  const p = selPattern(get())
  if (p.bars === 1) {
    showToast('Set the pattern to 2 or 4 bars first, then duplicate')
    return
  }
  const half = patternSteps(p) / 2
  const dup = (row: number[]) => row.map((v, i) => (i >= half && i < half * 2 ? row[i - half] : v))
  if (p.kind === 'drums') {
    const drums = Object.fromEntries(DRUM_VOICES.map((v) => [v, dup(p.drums[v])])) as typeof p.drums
    const rolls = p.rolls && Object.fromEntries(Object.entries(p.rolls).map(([v, row]) => [v, row && dup(row)]))
    commitPattern({ ...p, drums, ...(rolls ? { rolls } : {}) })
  } else if (p.kind === 'chops') {
    commitPattern({ ...p, chops: p.chops.map(dup) })
  } else {
    const first = p.notes.filter((n) => n.step < half)
    commitPattern({ ...p, notes: [...first, ...first.map((n) => ({ ...n, step: n.step + half }))] })
  }
}

/** Erase everything in the open pattern (its clips stay on the timeline, now empty). */
export function clearPattern(): void {
  const p = selPattern(get())
  commitPattern(newPattern(p.kind, p.trackId, p.name, p.bars, p.id))
}

/** Point a track's editor at a pattern. Looking around is not an edit, so it is not an undo step. */
function showPattern(trackId: string, patternId: string): void {
  withoutHistory(() => updateTrack(trackId, { patternId }))
  syncProject()
}

/** Open one of the selected track's patterns in the editor (it is also what LOOP mode plays). */
export function openPattern(patternId: string): void {
  const s = get()
  const pattern = s.patterns[patternId]
  if (!pattern || pattern.trackId !== s.selectedTrack) return
  releaseAllKeys()
  showPattern(s.selectedTrack, patternId)
}

/** First unused letter name among a track's patterns: A, B, … Z, then A2, B2, … */
function nextPatternName(taken: Set<string>): string {
  for (let round = 1; ; round++) {
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i) + (round > 1 ? round : '')
      if (!taken.has(name)) return name
    }
  }
}

function patternNames(patterns: Record<string, Pattern>, trackId: string): Set<string> {
  return new Set(Object.values(patterns).filter((p) => p.trackId === trackId).map((p) => p.name))
}

function clonePatternAs(source: Pattern, name: string): Pattern {
  return { ...structuredClone(source), id: uid('pat'), name }
}

/**
 * Make a new pattern on the selected track and open it: blank, or a copy of
 * the open one to turn into a variation. Clips already on the timeline keep
 * playing the pattern they had.
 */
export function addPattern(copy: boolean): void {
  const s = get()
  const track = selTrack(s)
  const current = s.patterns[track.patternId]
  const name = nextPatternName(patternNames(s.patterns, track.id))
  const pattern = copy ? clonePatternAs(current, name) : newPattern(track.kind, track.id, name, current.bars)
  releaseAllKeys()
  set({ patterns: { ...s.patterns, [pattern.id]: pattern } })
  updateTrack(track.id, { patternId: pattern.id })
  syncProject()
}

/** Delete the open pattern and every clip that plays it. A track always keeps one pattern. */
export function deleteOpenPattern(): void {
  const s = get()
  const track = selTrack(s)
  const siblings = Object.values(s.patterns).filter((p) => p.trackId === track.id && p.id !== track.patternId)
  if (siblings.length === 0) {
    showToast('A track needs at least one pattern — use CLEAR to empty it')
    return
  }
  releaseAllKeys()
  const doomed = track.patternId
  const clips = s.clips.filter((c) => c.patternId !== doomed)
  const kept = new Set(clips.map((c) => c.id))
  const patterns = Object.fromEntries(Object.entries(s.patterns).filter(([id]) => id !== doomed))
  siblings.sort((a, b) => a.name.localeCompare(b.name))
  set({ patterns, clips, selectedClips: s.selectedClips.filter((id) => kept.has(id)) })
  updateTrack(track.id, { patternId: siblings[0].id })
  syncProject()
}

// ---------- Timeline clips ----------

function commitClips(clips: Clip[], selectedClips?: string[]): void {
  const ids = new Set(clips.map((c) => c.id))
  set({ clips, selectedClips: (selectedClips ?? get().selectedClips).filter((id) => ids.has(id)) })
  syncProject()
}

const newClipId = (): string => uid('clip')

/**
 * Select clips. Selecting exactly one also selects its track and opens its
 * pattern, so the editor below always shows what you just clicked.
 */
export function selectClips(ids: string[]): void {
  const s = get()
  set({ selectedClips: ids })
  if (ids.length !== 1) return
  const clip = s.clips.find((c) => c.id === ids[0])
  if (!clip) return
  selectTrack(clip.trackId)
  if (get().tracks.find((t) => t.id === clip.trackId)?.patternId !== clip.patternId) {
    releaseAllKeys()
    showPattern(clip.trackId, clip.patternId)
  }
}

/**
 * Drop a pattern onto its track's lane at `start`, one pattern-length long.
 * Defaults to the pattern open in that track's editor.
 */
export function addClip(trackId: string, start: number, patternId?: string): void {
  const s = get()
  const track = s.tracks.find((t) => t.id === trackId)
  const pattern = s.patterns[patternId ?? track?.patternId ?? '']
  if (!track || !pattern || pattern.kind !== track.kind) return
  const clip: Clip = {
    id: newClipId(),
    trackId,
    patternId: pattern.id,
    start: Math.max(0, start),
    length: patternSteps(pattern),
    offset: 0
  }
  commitClips(carve(s.clips, [clip], newClipId))
  selectClips([clip.id])
}

/**
 * The one-click way to get a pattern into the song: append it to its track,
 * right after that track's last clip (on a bar line).
 */
export function addPatternToSong(patternId: string = selTrack(get()).patternId): void {
  const s = get()
  const pattern = s.patterns[patternId]
  if (!pattern) return
  const end = s.clips.filter((c) => c.trackId === pattern.trackId).reduce((max, c) => Math.max(max, clipEnd(c)), 0)
  const start = Math.ceil(end / STEPS_PER_BAR) * STEPS_PER_BAR
  addClip(pattern.trackId, start, pattern.id)
  showToast(`Pattern ${pattern.name} added to the song at bar ${start / STEPS_PER_BAR + 1}`)
}

/** Replace clips with edited versions of themselves (move / trim); they overwrite what they land on. */
export function placeClips(placed: Clip[]): void {
  if (placed.length) commitClips(carve(get().clips, placed, newClipId))
}

/** Put copies of clips on the timeline (Alt-drag) and select the copies. */
export function copyClips(copies: Clip[]): void {
  if (!copies.length) return
  const fresh = copies.map((c) => ({ ...c, id: newClipId() }))
  commitClips(
    carve(get().clips, fresh, newClipId),
    fresh.map((c) => c.id)
  )
}

/** Repeat the selected clips right after themselves — the fastest way to extend a section. */
export function duplicateClips(): void {
  const s = get()
  const picked = s.clips.filter((c) => s.selectedClips.includes(c.id))
  if (!picked.length) return
  const from = Math.min(...picked.map((c) => c.start))
  const span = Math.max(...picked.map(clipEnd)) - from
  copyClips(picked.map((c) => ({ ...c, start: c.start + span })))
}

/**
 * Cut clips at timeline step `at`. With `onlyIds`, just those; otherwise the
 * selected clips that span it, or — with nothing selected — every clip there.
 */
export function splitClipsAt(at: number, onlyIds?: string[]): void {
  const s = get()
  const wanted = onlyIds ?? s.selectedClips
  const targets = s.clips.filter(
    (c) => at > c.start && at < clipEnd(c) && (wanted.length === 0 || wanted.includes(c.id))
  )
  if (!targets.length) {
    if (!onlyIds) showToast('Nothing to split here — put the playhead inside a clip')
    return
  }
  const targetIds = new Set(targets.map((c) => c.id))
  const selected = [...s.selectedClips]
  const clips = s.clips.flatMap((c) => {
    const halves = targetIds.has(c.id) ? splitClip(c, at, newClipId()) : null
    if (!halves) return [c]
    if (selected.includes(c.id)) selected.push(halves[1].id)
    return halves
  })
  commitClips(clips, selected)
}

/** Clips copied with ⌘C / ⌘X, as they were when copied. */
let clipboard: Clip[] = []

export function copySelectedClips(): void {
  const s = get()
  const picked = s.clips.filter((c) => s.selectedClips.includes(c.id))
  if (!picked.length) return
  clipboard = picked
  showToast(picked.length === 1 ? 'Clip copied — ⌘V pastes it at the playhead' : `${picked.length} clips copied — ⌘V pastes them at the playhead`)
}

export function cutSelectedClips(): void {
  copySelectedClips()
  deleteClips()
}

/**
 * Paste the copied clips at `at`, keeping their spacing and tracks, then move
 * the playhead to the end of what was pasted so pressing ⌘V again continues
 * the row.
 */
export function pasteClips(at: number): void {
  const s = get()
  // The song may have changed since the copy: skip clips whose track or pattern is gone.
  const usable = clipboard.filter((c) => s.patterns[c.patternId] && s.tracks.some((t) => t.id === c.trackId))
  if (!usable.length) {
    showToast('Nothing to paste — select a clip and press ⌘C first')
    return
  }
  const shift = Math.max(0, at) - Math.min(...usable.map((c) => c.start))
  const pasted = usable.map((c) => ({ ...c, start: c.start + shift }))
  copyClips(pasted)
  movePlayhead(Math.max(...pasted.map(clipEnd)))
}

export function deleteClips(ids: string[] = get().selectedClips): void {
  if (ids.length) commitClips(get().clips.filter((c) => !ids.includes(c.id)))
}

/**
 * Give the selected clips their own copy of their pattern, so editing them
 * no longer changes the other clips that shared it.
 */
export function makeClipsUnique(): void {
  const s = get()
  const picked = s.clips.filter((c) => s.selectedClips.includes(c.id))
  if (!picked.length) return
  const patterns = { ...s.patterns }
  const cloneOf = new Map<string, string>()
  for (const clip of picked) {
    if (cloneOf.has(clip.patternId)) continue
    const source = patterns[clip.patternId]
    const clone = clonePatternAs(source, nextPatternName(patternNames(patterns, source.trackId)))
    patterns[clone.id] = clone
    cloneOf.set(clip.patternId, clone.id)
  }
  const pickedIds = new Set(picked.map((c) => c.id))
  const reassign = (patternId: string): string => cloneOf.get(patternId) ?? patternId
  const clips = s.clips.map((c) => (pickedIds.has(c.id) ? { ...c, patternId: reassign(c.patternId) } : c))
  // Open the new copies in their tracks' editors: they are what the user is about to edit.
  const tracks = s.tracks.map((t) => {
    const clip = picked.find((c) => c.trackId === t.id)
    return clip ? { ...t, patternId: reassign(clip.patternId) } : t
  })
  releaseAllKeys()
  set({ patterns, clips, tracks })
  syncProject()
  showToast(picked.length === 1 ? 'Clip now has its own pattern' : `${picked.length} clips now have their own patterns`)
}

/** Nudge the selected clips along the timeline by `delta` steps. */
export function nudgeClips(delta: number): void {
  const s = get()
  const picked = s.clips.filter((c) => s.selectedClips.includes(c.id))
  const shift = clampShift(picked, delta)
  if (shift !== 0) placeClips(picked.map((c) => ({ ...c, start: c.start + shift })))
}

export function setSnap(snap: number): void {
  set({ snap })
}

export function setZoom(zoom: number): void {
  set({ zoom: Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))) })
}

export function setTool(tool: ArrangeTool): void {
  set({ tool })
}

// ---------- Synth sound design ----------

function setTrackPatch(trackId: string, patch: SynthPatch): void {
  studio.setPatch(trackId, patch)
  updateTrack(trackId, { patch })
}

/** Edit the selected synth track's sound in place. */
export function updatePatch(edit: (patch: SynthPatch) => void): void {
  const track = selTrack(get())
  if (!track.patch) return
  const patch = clonePatch(track.patch)
  edit(patch)
  setTrackPatch(track.id, patch)
}

export function loadPatch(patch: SynthPatch): void {
  const track = selTrack(get())
  if (track.kind !== 'synth') return
  studio.allNotesOff(track.id)
  setTrackPatch(track.id, clonePatch(patch))
}

/** Roll a random aggressive sound (the CHAOS button). */
export function chaosPatch(): void {
  loadPatch(randomPatch())
}

export function saveUserPatch(name: string): void {
  const track = selTrack(get())
  if (!track.patch) return
  const patch: SynthPatch = { ...clonePatch(track.patch), name, group: undefined }
  set({ userPatches: [...get().userPatches.filter((p) => p.name !== name), patch] })
  setTrackPatch(track.id, patch)
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

/** PUNCH / CRUNCH / ROOM: processing on the whole kit. */
export function updateKitBus(patch: Partial<Pick<DrumKit, 'punch' | 'crunch' | 'room'>>): void {
  const kit = { ...cloneKit(get().kit), ...patch }
  studio.setKit(kit)
  set({ kit })
}

export function loadKit(kit: DrumKit): void {
  const next = cloneKit(kit)
  studio.setKit(next)
  set({ kit: next })
  loadKitSamples(next)
}

// ---------- Drum samples ----------

/** Paths whose audio the engine already holds, and decodes in flight (so a path is only read once). */
const decodedSamples = new Set<string>()
const pendingSamples = new Map<string, Promise<boolean>>()

function ensureSample(path: string): Promise<boolean> {
  if (decodedSamples.has(path)) return Promise.resolve(true)
  const pending =
    pendingSamples.get(path) ??
    (async () => {
      try {
        const buffer = await engine.decode(await readSampleFile(path))
        studio.setDrumSample(path, buffer)
        decodedSamples.add(path)
        return true
      } catch {
        return false
      } finally {
        pendingSamples.delete(path)
      }
    })()
  pendingSamples.set(path, pending)
  return pending
}

/**
 * Bytes of a sample. User samples are absolute paths read through the preload;
 * built-in ones ('builtin:…') live in the app's samples folder next to
 * index.html — fetched over http in development, and read from disk (inside
 * the app archive) in the packaged app, where the page is a file:// URL.
 */
async function readSampleFile(path: string): Promise<ArrayBuffer> {
  if (!path.startsWith(BUILTIN_PREFIX)) return window.stemdeck.readFile(path)
  const url = new URL(`samples/${path.slice(BUILTIN_PREFIX.length)}`, document.baseURI)
  if (url.protocol === 'file:') return window.stemdeck.readFile(decodeURIComponent(url.pathname))
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url.pathname}`)
  return response.arrayBuffer()
}

/** Decode every sample a kit uses. Pads whose file is missing keep playing their built-in sound. */
function loadKitSamples(kit: DrumKit): void {
  const used = DRUM_VOICES.map((id) => kit.voices[id].sample).filter((sample) => sample !== null)
  if (!used.length) return
  void Promise.all(used.map(async (sample) => ((await ensureSample(sample.path)) ? null : sample.name))).then((missing) => {
    const names = missing.filter((name) => name !== null)
    if (names.length) showToast(`Couldn't find ${names.join(', ')} — ${names.length === 1 ? 'that pad plays its' : 'those pads play their'} built-in sound`)
  })
}

const AUDIO_FILE = /\.(wav|aiff?|mp3|flac|ogg|m4a|aac)$/i

/**
 * Put a sound on a drum pad (it replaces the synthesized sound until cleared):
 * a user file by absolute path, or a bundled one by its 'builtin:' path.
 */
export async function loadDrumSample(id: DrumVoiceId, path: string): Promise<void> {
  const name = builtinLabel(path) ?? path.split(/[\\/]/).pop() ?? 'sample'
  if (!AUDIO_FILE.test(path)) {
    showToast(`${name} isn't an audio file — drop a WAV, AIFF, MP3, FLAC, OGG or M4A`)
    return
  }
  if (!(await ensureSample(path))) {
    showToast(`Couldn't load ${name}`)
    return
  }
  const voice = get().kit.voices[id]
  // A fresh sample starts neutral — the pad's synth settings (a short decay, a dark tone) would
  // otherwise cut it off or muffle it. They are kept with the sample and come back when it is removed.
  const synth = voice.sample?.synth ?? { tune: voice.tune, decay: voice.decay, tone: voice.tone, drive: voice.drive }
  const neutral = voice.sample ? {} : { tune: 0, decay: 1, tone: 0.5, drive: 0 }
  updateDrumVoice(id, { ...neutral, sample: { path, name, synth } })
  set({ selectedDrum: id })
  void engine.ctx.resume()
  studio.triggerDrum(id, 0.9)
}

/** The LOAD SAMPLE button: pick a file with the system dialog. */
export async function pickDrumSample(id: DrumVoiceId): Promise<void> {
  const [path] = await window.stemdeck.openAudioDialog()
  if (path) await loadDrumSample(id, path)
}

/** Back to the pad's built-in synthesized sound. */
export function clearDrumSample(id: DrumVoiceId): void {
  updateDrumVoice(id, { ...get().kit.voices[id].sample?.synth, sample: null })
}

export function saveUserKit(name: string): void {
  const kit: DrumKit = { ...cloneKit(get().kit), name, group: undefined }
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
    // Reloading a sample for a restored song is not an edit, so it must not become an undo step.
    const commit = (): void => set({ chop, chopTitle: track.name, chopLoading: false })
    if (restoring) withoutHistory(commit)
    else commit()
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

/** Step of the open pattern that a hit played right now should be recorded on, or null when not recording. */
function recordStep(): number | null {
  if (!get().recordArm || !studio.playing) return null
  const pos = editorPosition()
  if (pos < 0) return null
  return Math.round(pos) % totalSteps()
}

export function hitPad(pad: number, velocity = 1): void {
  const kind = selTrack(get()).kind
  if (kind === 'drums') hitDrum(DRUM_VOICES[pad], velocity)
  else if (kind === 'chops') hitChop(pad, velocity)
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

/** Live synth notes by MIDI number: the track sounding them, and where recording started. */
const liveNotes = new Map<number, { trackId: string; startPos: number | null }>()

export function synthDown(midi: number, velocity = 0.9): void {
  if (liveNotes.has(midi)) return
  const track = selTrack(get())
  if (track.kind !== 'synth') return
  void engine.ctx.resume()
  studio.noteOn(track.id, midi, velocity)
  const pos = get().recordArm && studio.playing ? editorPosition() : -1
  liveNotes.set(midi, { trackId: track.id, startPos: pos >= 0 ? pos : null })
  set({ heldNotes: [...get().heldNotes, midi] })
}

export function synthUp(midi: number): void {
  const live = liveNotes.get(midi)
  if (!live) return
  liveNotes.delete(midi)
  studio.noteOff(live.trackId, midi)
  set({ heldNotes: get().heldNotes.filter((n) => n !== midi) })
  if (live.startPos === null || !studio.playing) return
  const endPos = editorPosition()
  if (endPos < 0) return
  const total = totalSteps()
  const step = Math.round(live.startPos) % total
  const held = (endPos - live.startPos + total) % total
  addNote({ step, note: midi, length: Math.max(1, Math.min(total, Math.round(held))), velocity: 0.9 })
}

export function releaseAllKeys(): void {
  for (const midi of [...liveNotes.keys()]) synthUp(midi)
  studio.allNotesOff(get().selectedTrack)
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
