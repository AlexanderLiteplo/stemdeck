import { create } from 'zustand'

/** A pattern chip being dragged from the pattern picker towards the timeline. */
export interface PatternDrag {
  patternId: string
  /** The track the pattern belongs to — the only lane it can be dropped on. */
  trackId: string
  name: string
  color: string
  /** Pointer position, viewport pixels. */
  x: number
  y: number
}

export const usePatternDrag = create<{ drag: PatternDrag | null }>(() => ({ drag: null }))
