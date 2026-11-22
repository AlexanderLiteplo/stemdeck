import { useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import { showToast } from '../../state/store'
import { addNote, layNotes, placeNotes, setNotes } from '../actions'
import { chordNotes, chordPads } from '../chords'
import { studio } from '../engine'
import { selNotes, selPattern, useStudio } from '../store'
import type { SynthNote } from '../types'
import { chordDropTarget, useChordDrag, type ChordDrag } from './chordDrag'
import { Playhead } from './Playhead'
import { noteName } from './SynthEditor'

const ROW_H = 14
const ROWS = 24
const BLACK = [1, 3, 6, 8, 10]
/** How close (px) to a note's end grabs the trim handle instead of the body. */
const EDGE_PX = 7
/** Pointer travel (px) before a press on empty space becomes a selection box. */
const DRAG_PX = 4

/** Notes never stack on one pitch at one step, so this identifies a note. */
const keyOf = (n: SynthNote) => `${n.step}:${n.note}`

function preview(midis: number[], duration = 0.22): void {
  void engine.ctx.resume()
  const now = engine.ctx.currentTime
  const trackId = useStudio.getState().selectedTrack
  for (const midi of midis.slice(0, 6)) studio.playNote(trackId, midi, 0.8, now, duration)
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

type Zone = 'move' | 'start' | 'end'

/**
 * Notes copied with ⌘C / ⌘X. `inPlace` means the next paste lands on the
 * original steps (after a cut, or when pasting into a different pattern);
 * otherwise it lands right after them, so repeated ⌘V walks along the bar.
 */
let noteClipboard: { patternId: string; notes: SynthNote[]; inPlace: boolean } | null = null

/** `source` shifted to start right after itself, on the next beat. Notes that would start past the end are dropped. */
function placeAfter(source: SynthNote[], steps: number): SynthNote[] {
  const first = Math.min(...source.map((n) => n.step))
  const last = Math.max(...source.map((n) => n.step + n.length))
  const shift = Math.max(4, Math.ceil((last - first) / 4) * 4)
  return fitNotes(
    source.map((n) => ({ ...n, step: n.step + shift })),
    steps
  )
}

/** Keep only the notes that start inside the pattern, trimmed to its end. */
function fitNotes(notes: SynthNote[], steps: number): SynthNote[] {
  return notes.filter((n) => n.step < steps).map((n) => ({ ...n, length: Math.min(n.length, steps - n.step) }))
}

/**
 * Move or trim every note in `picked` by `dStep` 16ths / `dPitch` semitones,
 * clamped so the group keeps its shape and stays inside the loop.
 */
function transform(picked: SynthNote[], zone: Zone, dStep: number, dPitch: number, steps: number): SynthNote[] {
  if (zone === 'move') {
    const first = Math.min(...picked.map((n) => n.step))
    const last = Math.max(...picked.map((n) => n.step + n.length))
    const low = Math.min(...picked.map((n) => n.note))
    const high = Math.max(...picked.map((n) => n.note))
    const d = Math.max(-first, Math.min(steps - last, dStep))
    const p = Math.max(-low, Math.min(127 - high, dPitch))
    return picked.map((n) => ({ ...n, step: n.step + d, note: n.note + p }))
  }
  if (zone === 'start') {
    return picked.map((n) => {
      const end = n.step + n.length
      const step = Math.max(0, Math.min(end - 1, n.step + dStep))
      return { ...n, step, length: end - step }
    })
  }
  return picked.map((n) => ({ ...n, length: Math.max(1, Math.min(steps - n.step, n.length + dStep)) }))
}

type RollDrag =
  | {
      kind: 'notes'
      zone: Zone
      /** Pointer position at press, in steps / rows. */
      s0: number
      r0: number
      /** Selected notes as they were at press, and everything else. */
      picked: SynthNote[]
      rest: SynthNote[]
      /** Alt-drag leaves the originals where they were. */
      copy: boolean
      /** The note under the pointer at press. */
      anchor: SynthNote
      /** Click without dragging on a note in a group selects just that note. */
      collapseTo: string | null
      dStep: number
      dPitch: number
    }
  | {
      kind: 'box'
      /** Press position in px, relative to the roll. */
      x0: number
      y0: number
      moved: boolean
      /** Shift/Cmd adds to the existing selection. */
      base: Set<string> | null
      /** What a plain click (no drag) places. */
      place: { step: number; midi: number; velocity: number }
    }

export function PianoRoll({ steps }: { steps: number }) {
  const notes = useStudio(selNotes)
  const patternId = useStudio((s) => selPattern(s).id)
  const rollBase = useStudio((s) => s.rollBase)
  const chordDrag = useChordDrag((s) => s.drag)
  const areaRef = useRef<HTMLDivElement>(null)
  const drag = useRef<RollDrag | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [lastLength, setLastLength] = useState(2)
  const pitches = Array.from({ length: ROWS }, (_, i) => rollBase + ROWS - 1 - i)
  const chordLength = Math.max(4, steps / 4)

  // Latest values for the window/drop listeners registered once below.
  const live = useRef({ notes, selected, steps, rollBase, chordLength, patternId })
  live.current = { notes, selected, steps, rollBase, chordLength, patternId }

  /** Pointer -> grid position. Works outside the roll too (while captured). */
  const locate = (clientX: number, clientY: number) => {
    const rect = areaRef.current!.getBoundingClientRect()
    const { steps, rollBase } = live.current
    const exact = ((clientX - rect.left) / rect.width) * steps
    const rowF = (clientY - rect.top) / ROW_H
    return {
      rect,
      exact,
      rowF,
      step: Math.min(steps - 1, Math.max(0, Math.floor(exact))),
      midi: rollBase + ROWS - 1 - Math.min(ROWS - 1, Math.max(0, Math.floor(rowF))),
      stepPx: rect.width / steps,
      inside:
        clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom
    }
  }

  /** Note under the pointer, and which part of it (body or a trim handle). */
  const hitTest = (at: ReturnType<typeof locate>): { note: SynthNote; zone: Zone } | null => {
    const note = live.current.notes.find(
      (n) => n.step < steps && n.note === at.midi && at.exact >= n.step && at.exact < n.step + n.length
    )
    if (!note) return null
    const widthPx = note.length * at.stepPx
    const edge = Math.min(EDGE_PX, widthPx / 3)
    const fromLeft = (at.exact - note.step) * at.stepPx
    const zone: Zone = fromLeft < edge ? 'start' : widthPx - fromLeft < edge ? 'end' : 'move'
    return { note, zone }
  }

  /** The notes a dragged chord pad would write, or null when it's not over the roll. */
  const chordAt = (d: ChordDrag): SynthNote[] | null => {
    if (!areaRef.current) return null
    const at = locate(d.x, d.y)
    if (!at.inside) return null
    const { songKey, songScale } = useStudio.getState()
    const def = chordPads(songScale)[d.pad]
    if (!def) return null
    const { steps, chordLength } = live.current
    const step = d.fine ? at.step : Math.floor(at.step / 4) * 4
    // Root sits on the highest matching pitch at or below the pointer row,
    // then shifts an octave if that would push the chord off the visible keys.
    const { rollBase } = live.current
    const pc = (songKey + def.root) % 12
    let base = at.midi - ((((at.midi - pc) % 12) + 12) % 12) - pc
    const top = () => Math.max(...chordNotes(def, songKey, base, d.seventh))
    if (base + pc < rollBase) base += 12
    else if (top() >= rollBase + ROWS && base + pc - 12 >= rollBase) base -= 12
    const length = Math.min(chordLength, steps - step)
    return chordNotes(def, songKey, base, d.seventh)
      .filter((m) => m <= 127)
      .map((note) => ({ step, note, length, velocity: 0.8 }))
  }

  // Let chord pads drop onto the roll.
  useEffect(() => {
    chordDropTarget.drop = (d) => {
      const placed = chordAt(d)
      if (!placed) return false
      placeNotes(placed)
      setSelected(new Set(placed.map(keyOf)))
      preview(
        placed.map((n) => n.note),
        0.6
      )
      return true
    }
    return () => {
      chordDropTarget.drop = null
    }
  }, [])

  // A selection belongs to one pattern: opening another must not carry it over.
  useEffect(() => setSelected(new Set()), [patternId])

  // Editing keys: Delete, Escape, ⌘A/C/X/V/D, arrows — only while the editor (not the timeline) has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || drag.current || useStudio.getState().focus !== 'editor') return
      const { notes, selected, steps } = live.current
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.code === 'KeyA') {
        e.preventDefault()
        setSelected(new Set(notes.filter((n) => n.step < steps).map(keyOf)))
        return
      }
      const picked = notes.filter((n) => selected.has(keyOf(n)))
      const rest = notes.filter((n) => !selected.has(keyOf(n)))
      /** Write `added` on top of `base` and leave them selected, ready to drag or nudge. */
      const land = (base: SynthNote[], added: SynthNote[]): boolean => {
        if (added.length === 0) {
          showToast('No room for that here — make the pattern longer (2 or 4 BARS)')
          return false
        }
        setNotes(layNotes(base, added))
        setSelected(new Set(added.map(keyOf)))
        preview(added.map((n) => n.note))
        return true
      }
      if (mod && e.code === 'KeyV') {
        e.preventDefault()
        const clip = noteClipboard
        if (!clip) {
          showToast('Nothing to paste — select some notes and press ⌘C first')
          return
        }
        const { patternId } = live.current
        const inPlace = clip.inPlace || clip.patternId !== patternId
        const pasted = inPlace ? fitNotes(clip.notes, steps) : placeAfter(clip.notes, steps)
        if (land(notes, pasted)) noteClipboard = { patternId, notes: pasted, inPlace: false }
        return
      }
      if (mod && picked.length > 0 && (e.code === 'KeyC' || e.code === 'KeyX')) {
        e.preventDefault()
        const cut = e.code === 'KeyX'
        noteClipboard = { patternId: live.current.patternId, notes: picked, inPlace: cut }
        if (cut) {
          setNotes(rest)
          setSelected(new Set())
        }
        showToast(`${picked.length} note${picked.length === 1 ? '' : 's'} ${cut ? 'cut' : 'copied'} — ⌘V pastes`)
        return
      }
      if (mod && picked.length > 0 && e.code === 'KeyD') {
        e.preventDefault()
        land(notes, placeAfter(picked, steps))
        return
      }
      if (mod || picked.length === 0) return
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault()
        setNotes(rest)
        setSelected(new Set())
        return
      }
      if (e.code === 'Escape') {
        setSelected(new Set())
        return
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [e.shiftKey ? -4 : -1, 0],
        ArrowRight: [e.shiftKey ? 4 : 1, 0],
        ArrowUp: [0, e.shiftKey ? 12 : 1],
        ArrowDown: [0, e.shiftKey ? -12 : -1]
      }
      const nudge = arrows[e.code]
      if (!nudge) return
      e.preventDefault()
      const moved = transform(picked, 'move', nudge[0], nudge[1], steps)
      setNotes(layNotes(rest, moved))
      setSelected(new Set(moved.map(keyOf)))
      if (nudge[1] !== 0) preview(moved.map((n) => n.note))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const at = locate(e.clientX, e.clientY)
    const hit = hitTest(at)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey

    if (e.button === 2) {
      // Right-click deletes the note (or the whole selection it belongs to).
      if (!hit) return
      const k = keyOf(hit.note)
      const doomed = selected.has(k) ? selected : new Set([k])
      setNotes(notes.filter((n) => !doomed.has(keyOf(n))))
      setSelected(new Set())
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)

    if (!hit) {
      drag.current = {
        kind: 'box',
        x0: e.clientX - at.rect.left,
        y0: e.clientY - at.rect.top,
        moved: false,
        base: additive ? new Set(selected) : null,
        place: { step: at.step, midi: at.midi, velocity: e.altKey ? 0.55 : 0.9 }
      }
      return
    }

    const k = keyOf(hit.note)
    let sel = selected
    if (additive) {
      sel = new Set(selected)
      if (sel.has(k)) {
        // Shift-click on a selected note just takes it out of the selection.
        sel.delete(k)
        setSelected(sel)
        return
      }
      sel.add(k)
    } else if (!sel.has(k)) {
      sel = new Set([k])
    }
    setSelected(sel)
    drag.current = {
      kind: 'notes',
      zone: hit.zone,
      s0: at.exact,
      r0: at.rowF,
      picked: notes.filter((n) => sel.has(keyOf(n))),
      rest: notes.filter((n) => !sel.has(keyOf(n))),
      copy: e.altKey && hit.zone === 'move',
      anchor: hit.note,
      collapseTo: !additive && sel.size > 1 ? k : null,
      dStep: 0,
      dPitch: 0
    }
    if (hit.zone === 'move') preview([hit.note.note])
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const at = locate(e.clientX, e.clientY)

    if (!d) {
      // Hover: show what a press would grab.
      const hit = hitTest(at)
      e.currentTarget.style.cursor = !hit ? 'crosshair' : hit.zone === 'move' ? 'grab' : 'ew-resize'
      return
    }

    if (d.kind === 'box') {
      const x = e.clientX - at.rect.left
      const y = e.clientY - at.rect.top
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < DRAG_PX) return
      d.moved = true
      const rect = {
        x: Math.min(d.x0, x),
        y: Math.min(d.y0, y),
        w: Math.abs(x - d.x0),
        h: Math.abs(y - d.y0)
      }
      setBox(rect)
      // Every note the box touches is selected.
      const s0 = rect.x / at.stepPx
      const s1 = (rect.x + rect.w) / at.stepPx
      const r0 = rect.y / ROW_H
      const r1 = (rect.y + rect.h) / ROW_H
      const next = new Set(d.base)
      for (const n of notes) {
        if (n.step >= steps) continue
        const row = rollBase + ROWS - 1 - n.note
        if (n.step < s1 && n.step + n.length > s0 && row + 1 > r0 && row < r1) next.add(keyOf(n))
      }
      setSelected(next)
      return
    }

    const dStep = Math.round(at.exact - d.s0)
    const dPitch = d.zone === 'move' ? -Math.round(at.rowF - d.r0) : 0
    if (dStep === d.dStep && dPitch === d.dPitch) return
    const pitchChanged = dPitch !== d.dPitch
    d.dStep = dStep
    d.dPitch = dPitch
    d.collapseTo = null
    const next = transform(d.picked, d.zone, dStep, dPitch, steps)
    setNotes(layNotes(d.copy ? [...d.rest, ...d.picked] : d.rest, next))
    setSelected(new Set(next.map(keyOf)))
    if (pitchChanged) preview(next.map((n) => n.note))
    if (d.zone !== 'move') {
      const anchor = next[d.picked.indexOf(d.anchor)]
      if (anchor) setLastLength(anchor.length)
    }
    e.currentTarget.style.cursor = d.zone === 'move' ? 'grabbing' : 'ew-resize'
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    setBox(null)
    if (!d) return
    if (d.kind === 'box') {
      if (d.moved || d.base) return
      // Plain click on empty grid: write a note there.
      const { step, midi, velocity } = d.place
      addNote({ step, note: midi, length: Math.min(lastLength, steps - step), velocity })
      setSelected(new Set())
      preview([midi])
      return
    }
    if (d.collapseTo) setSelected(new Set([d.collapseTo]))
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitTest(locate(e.clientX, e.clientY))
    if (!hit) return
    const k = keyOf(hit.note)
    setNotes(notes.filter((n) => keyOf(n) !== k))
    setSelected((s) => {
      const next = new Set(s)
      next.delete(k)
      return next
    })
  }

  const ghost = chordDrag ? chordAt(chordDrag) : null
  const visible = (n: SynthNote) => n.step < steps && n.note >= rollBase && n.note < rollBase + ROWS
  const place = (n: SynthNote) => ({
    top: (rollBase + ROWS - 1 - n.note) * ROW_H + 1,
    height: ROW_H - 2,
    left: `${(n.step / steps) * 100}%`,
    width: `${(Math.min(n.length, steps - n.step) / steps) * 100}%`
  })

  return (
    <div className="piano-roll">
      <div className="roll-keys">
        {pitches.map((m) => (
          <button
            key={m}
            className={`roll-key ${BLACK.includes(m % 12) ? 'black' : ''}`}
            style={{ height: ROW_H }}
            onPointerDown={() => preview([m])}
          >
            {m % 12 === 0 || !BLACK.includes(m % 12) ? noteName(m) : ''}
          </button>
        ))}
      </div>
      <div
        ref={areaRef}
        className={`roll-area ${ghost ? 'drop-hover' : ''}`}
        style={{
          height: ROW_H * ROWS,
          backgroundSize: `${100 / steps}% ${ROW_H}px, ${(100 / steps) * 4}% 100%, ${(100 / steps) * 16}% 100%`
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {pitches.map((m, i) =>
          BLACK.includes(m % 12) ? (
            <div key={m} className="roll-shade" style={{ top: i * ROW_H, height: ROW_H }} />
          ) : null
        )}
        {notes.filter(visible).map((n) => (
          <div
            key={keyOf(n)}
            className={`roll-note ${selected.has(keyOf(n)) ? 'selected' : ''}`}
            style={{ ...place(n), opacity: 0.55 + n.velocity * 0.45 }}
          />
        ))}
        {ghost?.filter(visible).map((n) => <div key={`g${n.note}`} className="roll-note ghost" style={place(n)} />)}
        {box && <div className="roll-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
        {notes.some((n) => n.step < steps && (n.note < rollBase || n.note >= rollBase + ROWS)) && (
          <span className="roll-hint">notes outside this range — use ▲/▼ OCT</span>
        )}
        <Playhead steps={steps} />
      </div>
    </div>
  )
}
