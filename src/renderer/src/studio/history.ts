/**
 * Undo / redo for the song. Snapshots are cheap: the store is updated
 * immutably, so a snapshot is a handful of references, not a copy.
 *
 * One user gesture is one undo step: everything that changes between a
 * pointer press and the next press (a whole knob drag, a painted row of
 * steps) or during one held key collapses into a single entry.
 */
import { create } from 'zustand'
import { SONG_KEYS, pickSong, type SongData } from './song'
import { useStudio } from './store'

const LIMIT = 100

const undoStack: SongData[] = []
const redoStack: SongData[] = []
let gesture = 0
let recordedGesture = -1
let muted = false

/** How many steps are available each way, for the buttons. */
export const useHistory = create<{ undo: number; redo: number }>(() => ({ undo: 0, redo: 0 }))
const publish = (): void => useHistory.setState({ undo: undoStack.length, redo: redoStack.length })

window.addEventListener('pointerdown', () => (gesture += 1), true)
window.addEventListener('keydown', (e) => !e.repeat && (gesture += 1), true)

useStudio.subscribe((state, previous) => {
  if (muted || !SONG_KEYS.some((key) => state[key] !== previous[key])) return
  if (gesture !== recordedGesture) {
    recordedGesture = gesture
    undoStack.push(pickSong(previous))
    if (undoStack.length > LIMIT) undoStack.shift()
  }
  redoStack.length = 0
  publish()
})

/** Change the song without it counting as an undoable edit (loading, restoring). */
export function withoutHistory(change: () => void): void {
  const was = muted
  muted = true
  try {
    change()
  } finally {
    muted = was
  }
}

/** The song as it was before the last edit, or null. The caller applies it. */
export function takeUndo(): SongData | null {
  const snapshot = undoStack.pop()
  if (!snapshot) return null
  redoStack.push(pickSong(useStudio.getState()))
  recordedGesture = -1
  publish()
  return snapshot
}

export function takeRedo(): SongData | null {
  const snapshot = redoStack.pop()
  if (!snapshot) return null
  undoStack.push(pickSong(useStudio.getState()))
  recordedGesture = -1
  publish()
  return snapshot
}

/** Forget everything — history never crosses from one song into another. */
export function clearHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
  recordedGesture = -1
  publish()
}
