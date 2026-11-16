/**
 * Keyboard "song piano": map number keys to sections of a track, then jump
 * between them without losing the groove. A jump keeps your exact position
 * inside the current bar (or phrase), so hitting a key on beat 3 lands on
 * beat 3 of the target section.
 */
import { engine } from './audio/engine'
import { applyLoop, saveLibrary } from './controller'
import { SECTION_SLOTS, showToast, updateDeck, updateTrack, useStore } from './state/store'

const BEATS_PER_BAR = 4

/** Keys for deck A (top number row) and deck B (QWERTY row), by KeyboardEvent.code. */
export const SECTION_KEYS: string[][] = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']
]
export const SECTION_KEY_LABELS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P']
]

/**
 * Where the current phrase started, per deck. After a jump the landing
 * section becomes the new anchor, so a 4-bar phrase counts from the section
 * you're in rather than from the start of the song.
 */
const phraseAnchor: ({ trackId: string; at: number } | null)[] = [null, null]

function barSeconds(deckIndex: number): number | null {
  const { baseBpm } = useStore.getState().decks[deckIndex]
  return baseBpm > 0 ? (60 / baseBpm) * BEATS_PER_BAR : null
}

function deckTrack(deckIndex: number) {
  const deck = useStore.getState().decks[deckIndex]
  return deck.trackId ? useStore.getState().library.find((t) => t.id === deck.trackId) : undefined
}

/** Store the current playhead (snapped to the nearest bar line) in `slot`. */
export function setSection(deckIndex: number, slot: number): void {
  const deck = useStore.getState().decks[deckIndex]
  const track = deckTrack(deckIndex)
  if (!track || deck.loading) return
  const pos = engine.decks[deckIndex].getPosition()
  const bar = barSeconds(deckIndex)
  let at = pos
  if (bar) {
    at = deck.firstBeat + Math.round((pos - deck.firstBeat) / bar) * bar
    if (at < 0) at += bar
  }
  const sections = [...track.sections]
  sections[slot] = at
  updateTrack(track.id, { sections })
  void saveLibrary()
  if (!bar) showToast('Section saved — but no BPM detected, so jumps won’t be beat-locked')
}

export function clearSection(deckIndex: number, slot: number): void {
  const track = deckTrack(deckIndex)
  if (!track) return
  const sections = [...track.sections]
  sections[slot] = null
  updateTrack(track.id, { sections })
  const deck = useStore.getState().decks[deckIndex]
  if (deck.activeSection === slot) updateDeck(deckIndex, { activeSection: null })
  void saveLibrary()
}

/** Jump to a stored section, phase-locked to the beat when the deck is playing. */
export function jumpToSection(deckIndex: number, slot: number): void {
  const deck = useStore.getState().decks[deckIndex]
  const track = deckTrack(deckIndex)
  const target = track?.sections[slot]
  if (!track || target === null || target === undefined || deck.loading) return
  const deckEngine = engine.decks[deckIndex]
  const bar = barSeconds(deckIndex)
  const phrase = bar ? bar * Math.max(1, deck.sectionPhrase) : 0
  const loop =
    deck.sectionLoop && phrase > 0
      ? { enabled: true, start: target, end: Math.min(target + phrase, deck.duration) }
      : deck.loop.active
        ? { enabled: false, start: deck.loop.start, end: deck.loop.end }
        : null

  if (deck.playing && bar) {
    // Phase is measured against the last landing point (or the beat grid).
    const saved = phraseAnchor[deckIndex]
    const anchor = saved && saved.trackId === track.id ? saved.at : deck.firstBeat
    deckEngine.jumpSection(target, anchor, phrase, loop)
  } else {
    deckEngine.jumpSection(target, 0, 0, loop)
    if (!deck.playing) {
      deckEngine.play()
      updateDeck(deckIndex, { playing: true })
    }
  }
  phraseAnchor[deckIndex] = { trackId: track.id, at: target }
  // The worklet already applied the loop atomically; mirror it into the store.
  if (loop) applyLoop(deckIndex, loop.enabled, loop.start, loop.end)
  updateDeck(deckIndex, { activeSection: slot })
}

/**
 * Pad / key press. Empty slot: save the current spot. Filled slot: jump.
 * `set` overwrites, `clear` erases.
 */
export function sectionPress(deckIndex: number, slot: number, mode: 'trigger' | 'set' | 'clear'): void {
  if (slot < 0 || slot >= SECTION_SLOTS) return
  const track = deckTrack(deckIndex)
  if (!track) return
  if (mode === 'clear') return clearSection(deckIndex, slot)
  if (mode === 'set' || track.sections[slot] === null) return setSection(deckIndex, slot)
  jumpToSection(deckIndex, slot)
}

export function setSectionPhrase(deckIndex: number, bars: number): void {
  updateDeck(deckIndex, { sectionPhrase: bars })
}

export function toggleSectionLoop(deckIndex: number): void {
  const deck = useStore.getState().decks[deckIndex]
  const next = !deck.sectionLoop
  updateDeck(deckIndex, { sectionLoop: next })
  // Turning it off releases a section loop that's currently holding.
  if (!next && deck.loop.active) applyLoop(deckIndex, false, deck.loop.start, deck.loop.end)
}
