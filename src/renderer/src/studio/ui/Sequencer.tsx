import { useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import { tip } from '../../components/TooltipLayer'
import {
  addNote,
  clearTrack,
  duplicateBars,
  hitChop,
  hitDrum,
  removeNote,
  resizeNote,
  setBars,
  setChopStep,
  setDrumStep,
  shiftRoll
} from '../actions'
import { studio } from '../engine'
import { useStudio } from '../store'
import { CHOP_PADS, DRUM_VOICES, STEPS_PER_BAR, type SynthNote } from '../types'
import { DRUM_INFO } from './DrumEditor'
import { Seg } from './Param'
import { noteName } from './SynthEditor'

const PAD_COLORS = ['#7c5cff', '#39c5ff', '#2ee66b', '#ffd23c', '#ff7a39', '#ff4d6d', '#c084fc', '#22d3ee']
const TRACK_HELP = {
  drums: 'Click a cell to place a hit, drag to paint a row. Alt-click places a soft (ghost) hit. Each column is a 16th note; bright columns are the beats.',
  chops: 'Each row is one chop pad. Place chops on the grid to rearrange the sample into a new beat.',
  synth: 'Piano roll: click to place a note, drag right while placing to make it longer, drag a note’s right edge to resize, click a note to delete it.'
}

/** Vertical line that follows the sequencer, positioned without React re-renders. */
function Playhead({ steps }: { steps: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = ref.current
      if (!el) return
      const pos = studio.ready ? studio.getStepPosition() : -1
      if (pos < 0) {
        el.style.display = 'none'
        return
      }
      el.style.display = 'block'
      el.style.left = `${((pos % steps) / steps) * 100}%`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [steps])
  return <div ref={ref} className="playhead" />
}

export function Sequencer() {
  const track = useStudio((s) => s.selectedTrack)
  const bars = useStudio((s) => s.pattern.bars)
  const rollBase = useStudio((s) => s.rollBase)
  const steps = bars * STEPS_PER_BAR

  return (
    <div className="sequencer">
      <div className="seq-head">
        <span className="instrument-name" {...tip('Pattern', TRACK_HELP[track])}>
          {track === 'synth' ? 'PIANO ROLL' : 'STEPS'}
        </span>
        <Seg
          options={[1, 2, 4] as const}
          value={bars}
          labels={{ '1': '1 BAR', '2': '2 BARS', '4': '4 BARS' }}
          title="Pattern length"
          help="How many bars the loop is. Shortening never deletes anything — the extra bars come back when you lengthen it again."
          onChange={setBars}
        />
        <button className="mini-btn" onClick={duplicateBars} {...tip('Duplicate', 'Copies the first half of the pattern onto the second half — the fastest way to turn 1 bar into 2, or 2 into 4. Then tweak the ending.')}>
          DUPLICATE
        </button>
        <button className="mini-btn" onClick={() => clearTrack(track)} {...tip('Clear', `Erase everything on the ${track} track (the other tracks are untouched).`)}>
          CLEAR
        </button>
        {track === 'synth' && (
          <span className="roll-octave" {...tip('Piano roll range', 'Scroll the visible notes up or down an octave.')}>
            <button className="mini-btn" onClick={() => shiftRoll(-12)}>▼ OCT</button>
            <span className="mono">{noteName(rollBase)}–{noteName(rollBase + 23)}</span>
            <button className="mini-btn" onClick={() => shiftRoll(12)}>▲ OCT</button>
          </span>
        )}
      </div>
      {track === 'drums' && <DrumGrid steps={steps} />}
      {track === 'chops' && <ChopGrid steps={steps} />}
      {track === 'synth' && <PianoRoll steps={steps} />}
    </div>
  )
}

interface Row {
  key: string
  label: string
  color?: string
  values: number[]
  onPreview: () => void
}

/** Shared paint state so a drag keeps adding (or erasing) across cells. */
let paint: { value: number } | null = null
window.addEventListener('pointerup', () => (paint = null))

function StepGrid({
  rows,
  steps,
  onSet
}: {
  rows: Row[]
  steps: number
  onSet: (row: number, step: number, value: number) => void
}) {
  return (
    <div className="step-grid">
      {rows.map((row, r) => (
        <div className="grid-row" key={row.key}>
          <button
            className="row-label"
            style={row.color ? { borderLeftColor: row.color } : undefined}
            onPointerDown={row.onPreview}
          >
            {row.label}
          </button>
          <div className="cells" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
            {Array.from({ length: steps }, (_, step) => {
              const v = row.values[step] ?? 0
              return (
                <div
                  key={step}
                  className={`cell ${step % 4 === 0 ? 'beat' : ''} ${step % 16 === 0 ? 'bar' : ''} ${v > 0 ? 'on' : ''} ${v > 0 && v < 0.75 ? 'soft' : ''}`}
                  style={v > 0 && row.color ? { background: row.color } : undefined}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    paint = { value: v > 0 ? 0 : e.altKey ? 0.5 : 1 }
                    onSet(r, step, paint.value)
                    if (paint.value > 0) row.onPreview()
                  }}
                  onPointerEnter={(e) => {
                    if (paint && e.buttons === 1 && v !== paint.value) onSet(r, step, paint.value)
                  }}
                />
              )
            })}
            <Playhead steps={steps} />
          </div>
        </div>
      ))}
    </div>
  )
}

function DrumGrid({ steps }: { steps: number }) {
  const drums = useStudio((s) => s.pattern.drums)
  const rows: Row[] = DRUM_VOICES.map((id) => ({
    key: id,
    label: DRUM_INFO[id].label,
    values: drums[id],
    onPreview: () => hitDrum(id, 0.8)
  }))
  return <StepGrid rows={rows} steps={steps} onSet={(r, step, v) => setDrumStep(DRUM_VOICES[r], step, v)} />
}

function ChopGrid({ steps }: { steps: number }) {
  const chops = useStudio((s) => s.pattern.chops)
  const rows: Row[] = Array.from({ length: CHOP_PADS }, (_, pad) => ({
    key: String(pad),
    label: `CHOP ${pad + 1}`,
    color: PAD_COLORS[pad % PAD_COLORS.length],
    values: chops[pad],
    onPreview: () => hitChop(pad, 0.8)
  }))
  return <StepGrid rows={rows} steps={steps} onSet={(r, step, v) => setChopStep(r, step, v)} />
}

const ROW_H = 14
const BLACK = [1, 3, 6, 8, 10]

function preview(midi: number): void {
  void engine.ctx.resume()
  studio.playNote(midi, 0.8, engine.ctx.currentTime, 0.22)
}

type RollDrag =
  | { mode: 'create'; note: SynthNote }
  | { mode: 'resize'; note: SynthNote; moved: boolean }
  | { mode: 'delete'; note: SynthNote; moved: boolean }

function PianoRoll({ steps }: { steps: number }) {
  const notes = useStudio((s) => s.pattern.notes)
  const rollBase = useStudio((s) => s.rollBase)
  const areaRef = useRef<HTMLDivElement>(null)
  const drag = useRef<RollDrag | null>(null)
  const [lastLength, setLastLength] = useState(2)
  const pitches = Array.from({ length: 24 }, (_, i) => rollBase + 23 - i)

  const locate = (e: React.PointerEvent) => {
    const rect = areaRef.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const row = Math.floor((e.clientY - rect.top) / ROW_H)
    return {
      step: Math.min(steps - 1, Math.max(0, Math.floor(x * steps))),
      exact: x * steps,
      midi: rollBase + 23 - Math.min(23, Math.max(0, row)),
      stepPx: rect.width / steps
    }
  }

  return (
    <div className="piano-roll">
      <div className="roll-keys">
        {pitches.map((m) => (
          <button
            key={m}
            className={`roll-key ${BLACK.includes(m % 12) ? 'black' : ''}`}
            style={{ height: ROW_H }}
            onPointerDown={() => preview(m)}
          >
            {m % 12 === 0 || !BLACK.includes(m % 12) ? noteName(m) : ''}
          </button>
        ))}
      </div>
      <div
        ref={areaRef}
        className="roll-area"
        style={{
          height: ROW_H * 24,
          backgroundSize: `${100 / steps}% ${ROW_H}px, ${(100 / steps) * 4}% 100%`
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const at = locate(e)
          const hit = notes.find(
            (n) => n.note === at.midi && at.exact >= n.step && at.exact < n.step + n.length
          )
          if (hit) {
            const edgePx = (hit.step + hit.length - at.exact) * at.stepPx
            drag.current =
              edgePx < 8
                ? { mode: 'resize', note: hit, moved: false }
                : { mode: 'delete', note: hit, moved: false }
            return
          }
          const note: SynthNote = {
            step: at.step,
            note: at.midi,
            length: Math.min(lastLength, steps - at.step),
            velocity: e.altKey ? 0.55 : 0.9
          }
          addNote(note)
          preview(at.midi)
          drag.current = { mode: 'create', note }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const at = locate(e)
          if (d.mode === 'delete') {
            d.moved = true
            return
          }
          const length = Math.max(1, Math.min(steps - d.note.step, Math.ceil(at.exact - d.note.step)))
          if (length === d.note.length) return
          // Find the live object (the store replaces notes on every edit).
          const live = useStudio.getState().pattern.notes.find(
            (n) => n.step === d.note.step && n.note === d.note.note
          )
          if (!live) return
          resizeNote(live, length)
          d.note = { ...live, length }
          if (d.mode === 'resize') d.moved = true
          setLastLength(length)
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (d?.mode === 'delete' && !d.moved) {
            const live = useStudio.getState().pattern.notes.find(
              (n) => n.step === d.note.step && n.note === d.note.note
            )
            if (live) removeNote(live)
          }
        }}
      >
        {pitches.map((m, i) =>
          BLACK.includes(m % 12) ? (
            <div key={m} className="roll-shade" style={{ top: i * ROW_H, height: ROW_H }} />
          ) : null
        )}
        {notes
          .filter((n) => n.step < steps && n.note >= rollBase && n.note < rollBase + 24)
          .map((n) => (
            <div
              key={`${n.step}-${n.note}`}
              className="roll-note"
              style={{
                top: (rollBase + 23 - n.note) * ROW_H + 1,
                height: ROW_H - 2,
                left: `${(n.step / steps) * 100}%`,
                width: `${(Math.min(n.length, steps - n.step) / steps) * 100}%`,
                opacity: 0.55 + n.velocity * 0.45
              }}
            />
          ))}
        {notes.some((n) => n.step < steps && (n.note < rollBase || n.note >= rollBase + 24)) && (
          <span className="roll-hint">notes outside this range — use ▲/▼ OCT</span>
        )}
        <Playhead steps={steps} />
      </div>
    </div>
  )
}
