/**
 * Global computer-keyboard routing.
 *  Decks view:  1..0 = deck A section keys, Q..P = deck B section keys
 *               (Shift = re-save at playhead, Alt = clear).
 *  Studio view: Space = play/stop, Tab = next track, and the selected track's
 *               instrument: GarageBand-style musical typing for the synth
 *               (or, in CHORDS mode, one in-key chord per A..L key; Shift =
 *               7th chord; C toggles the mode), a 4×4 pad grid
 *               (1234/QWER/ASDF/ZXCV) for drums and chops.
 */
import { SECTION_KEYS, sectionPress } from './sections'
import { CHORD_KEYS } from './studio/chords'
import {
  chordDown,
  chordUp,
  cycleTrack,
  hitPad,
  setKeyMode,
  shiftKeyOctave,
  synthDown,
  synthUp,
  togglePlay as toggleStudio
} from './studio/actions'
import { selTrack, useStudio } from './studio/store'

/** Musical typing: key code -> semitones above the octave's C. */
export const PIANO_KEYS: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17
}

/** 4×4 pad grid, top-left first — matches the on-screen pad layout. */
export const PAD_KEYS = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR',
  'KeyA', 'KeyS', 'KeyD', 'KeyF',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV'
]
export const PAD_KEY_LABELS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V']

/** Which MIDI note each held key started, so octave changes mid-hold still release it. */
const heldPiano = new Map<string, number>()
/** Chord pad started by each held key. */
const heldChord = new Map<string, number>()
const chordPadOf = (code: string) => (CHORD_KEYS as readonly string[]).indexOf(code)

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || isTyping(e.target)) return
  const studio = useStudio.getState()

  if (studio.view === 'decks') {
    for (let deck = 0; deck < 2; deck++) {
      const slot = SECTION_KEYS[deck].indexOf(e.code)
      if (slot === -1) continue
      e.preventDefault()
      if (e.repeat) return
      sectionPress(deck, slot, e.altKey ? 'clear' : e.shiftKey ? 'set' : 'trigger')
      return
    }
    return
  }

  if (e.code === 'Space') {
    e.preventDefault()
    if (!e.repeat) toggleStudio()
    return
  }
  if (e.code === 'Tab') {
    e.preventDefault()
    if (!e.repeat) cycleTrack()
    return
  }

  if (selTrack(studio).kind === 'synth') {
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      e.preventDefault()
      if (!e.repeat) shiftKeyOctave(e.code === 'KeyZ' ? -1 : 1)
      return
    }
    if (e.code === 'KeyC') {
      e.preventDefault()
      if (e.repeat) return
      heldPiano.clear()
      heldChord.clear()
      setKeyMode(studio.keyMode === 'chords' ? 'notes' : 'chords')
      return
    }
    if (studio.keyMode === 'chords') {
      const pad = chordPadOf(e.code)
      if (pad === -1) return
      e.preventDefault()
      if (e.repeat || heldChord.has(e.code)) return
      heldChord.set(e.code, pad)
      chordDown(pad, e.shiftKey)
      return
    }
    const semis = PIANO_KEYS[e.code]
    if (semis === undefined) return
    e.preventDefault()
    if (e.repeat || heldPiano.has(e.code)) return
    const midi = (studio.keyOctave + 1) * 12 + semis
    heldPiano.set(e.code, midi)
    synthDown(midi, e.shiftKey ? 1 : 0.85)
    return
  }

  const pad = PAD_KEYS.indexOf(e.code)
  if (pad === -1) return
  e.preventDefault()
  if (!e.repeat) hitPad(pad, e.shiftKey ? 0.55 : 1)
}

function onKeyUp(e: KeyboardEvent): void {
  const pad = heldChord.get(e.code)
  if (pad !== undefined) {
    heldChord.delete(e.code)
    chordUp(pad)
    return
  }
  const midi = heldPiano.get(e.code)
  if (midi === undefined) return
  heldPiano.delete(e.code)
  synthUp(midi)
}

function releaseAll(): void {
  for (const midi of heldPiano.values()) synthUp(midi)
  heldPiano.clear()
  for (const pad of heldChord.values()) chordUp(pad)
  heldChord.clear()
}

let installed = false
export function installKeyboard(): () => void {
  if (installed) return () => {}
  installed = true
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseAll)
  return () => {
    installed = false
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', releaseAll)
  }
}
