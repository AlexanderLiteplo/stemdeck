import { create } from 'zustand'

/** A chord pad being dragged towards the piano roll. */
export interface ChordDrag {
  /** Index into chordPads(). */
  pad: number
  seventh: boolean
  /** Pointer position, viewport pixels. */
  x: number
  y: number
  /** Alt held: drop on the exact 16th instead of snapping to the beat. */
  fine: boolean
}

export const useChordDrag = create<{ drag: ChordDrag | null }>(() => ({ drag: null }))

/**
 * The piano roll registers itself here while mounted, so a chord pad (which
 * holds pointer capture for the whole drag) can hand it the drop.
 * Returns true when the drop landed on the roll.
 */
export const chordDropTarget: { drop: ((drag: ChordDrag) => boolean) | null } = { drop: null }
