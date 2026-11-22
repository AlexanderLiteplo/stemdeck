import { useMemo, useRef } from 'react'
import { tip } from '../../components/TooltipLayer'
import {
  addPattern,
  addPatternToSong,
  applyGroove,
  cycleDrumRoll,
  clearPattern,
  deleteOpenPattern,
  duplicateBars,
  hitChop,
  hitDrum,
  openPattern,
  setBars,
  setChopStep,
  setDrumStep,
  shiftRoll
} from '../actions'
import { selChops, selDrums, selPattern, selTrack, useStudio } from '../store'
import { GROOVES } from '../grooves'
import { CHOP_PADS, DRUM_VOICES, STEPS_PER_BAR } from '../types'
import { dropPatternOnTimeline } from './Arrangement'
import { PAD_COLORS, patternColor } from './colors'
import { DRUM_INFO } from './DrumEditor'
import { Seg } from './Param'
import { PianoRoll } from './PianoRoll'
import { usePatternDrag } from './patternDrag'
import { Playhead } from './Playhead'
import { noteName } from './SynthEditor'

const TRACK_HELP = {
  drums: 'Click a cell to place a hit, drag to paint a row. Alt-click places a soft (ghost) hit. Right-click a hit for a roll (2, 3 or 4 quick hits — trap hi-hats). Each column is a 16th note; bright columns are the beats. GROOVES loads a ready-made beat.',
  chops: 'Each row is one chop pad. Place chops on the grid to rearrange the sample into a new beat.',
  synth: 'Piano roll. Click empty grid to place a note, or drag a chord pad in. Drag across the grid to box-select (Shift adds). Drag a note to move the selection, drag either end to trim it, Alt-drag to copy. Arrows nudge (Shift = beat/octave). Delete, double-click or right-click removes.'
}

export function Sequencer() {
  const kind = useStudio((s) => selTrack(s).kind)
  const bars = useStudio((s) => selPattern(s).bars)
  const rollBase = useStudio((s) => s.rollBase)
  const steps = bars * STEPS_PER_BAR

  return (
    <div className="sequencer">
      <div className="seq-head">
        <span className="instrument-name" {...tip('Pattern', TRACK_HELP[kind])}>
          {kind === 'synth' ? 'PIANO ROLL' : 'STEPS'}
        </span>
        <PatternPicker />
        {kind === 'drums' && <GroovePicker />}
        <Seg
          options={[1, 2, 4] as const}
          value={bars}
          labels={{ '1': '1 BAR', '2': '2 BARS', '4': '4 BARS' }}
          title="Pattern length"
          help="How many bars this pattern is before it repeats. Shortening never deletes anything — the extra bars come back when you lengthen it again. Different tracks can have different lengths."
          onChange={setBars}
        />
        <button className="mini-btn" onClick={duplicateBars} {...tip('Duplicate', 'Copies the first half of the pattern onto the second half — the fastest way to turn 1 bar into 2, or 2 into 4. Then tweak the ending.')}>
          DUPLICATE
        </button>
        <button className="mini-btn" onClick={clearPattern} {...tip('Clear', 'Erase everything in this pattern. Other patterns and other tracks are untouched.')}>
          CLEAR
        </button>
        {kind === 'synth' && (
          <span className="roll-octave" {...tip('Piano roll range', 'Scroll the visible notes up or down an octave.')}>
            <button className="mini-btn" onClick={() => shiftRoll(-12)}>▼ OCT</button>
            <span className="mono">{noteName(rollBase)}–{noteName(rollBase + 23)}</span>
            <button className="mini-btn" onClick={() => shiftRoll(12)}>▲ OCT</button>
          </span>
        )}
      </div>
      {kind === 'drums' && <DrumGrid steps={steps} />}
      {kind === 'chops' && <ChopGrid steps={steps} />}
      {kind === 'synth' && <PianoRoll steps={steps} />}
    </div>
  )
}

/** Pointer travel before pressing a pattern letter counts as dragging it to the timeline. */
const CHIP_DRAG_PX = 5

/**
 * The selected track's patterns: pick which one to edit, start a new one,
 * branch a variation — and put the open one into the song, with the button or
 * by dragging its letter onto the track's lane.
 */
function PatternPicker() {
  const trackId = useStudio((s) => s.selectedTrack)
  const openId = useStudio((s) => selTrack(s).patternId)
  const patterns = useStudio((s) => s.patterns)
  const clips = useStudio((s) => s.clips)
  const drag = usePatternDrag((s) => s.drag)
  const press = useRef<{ x: number; y: number } | null>(null)
  const mine = useMemo(
    () =>
      Object.values(patterns)
        .filter((p) => p.trackId === trackId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [patterns, trackId]
  )
  const uses = (id: string) => clips.filter((c) => c.patternId === id).length
  const open = patterns[openId]
  const openUnused = uses(openId) === 0

  return (
    <div className="pattern-picker">
      {mine.map((p) => {
        const count = uses(p.id)
        const color = patternColor(p.name)
        return (
          <button
            key={p.id}
            className={`pattern-chip ${p.id === openId ? 'active' : ''} ${count === 0 ? 'unused' : ''}`}
            style={{ borderColor: color, ...(p.id === openId ? { background: color } : {}) }}
            onClick={() => openPattern(p.id)}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.currentTarget.setPointerCapture(e.pointerId)
              press.current = { x: e.clientX, y: e.clientY }
            }}
            onPointerMove={(e) => {
              const from = press.current
              if (!from) return
              const dragging = usePatternDrag.getState().drag !== null
              if (!dragging && Math.hypot(e.clientX - from.x, e.clientY - from.y) < CHIP_DRAG_PX) return
              usePatternDrag.setState({ drag: { patternId: p.id, trackId, name: p.name, color, x: e.clientX, y: e.clientY } })
            }}
            onPointerUp={() => {
              press.current = null
              const dropped = usePatternDrag.getState().drag
              usePatternDrag.setState({ drag: null })
              if (dropped) dropPatternOnTimeline(dropped)
            }}
            onPointerCancel={() => {
              press.current = null
              usePatternDrag.setState({ drag: null })
            }}
            {...tip(`Pattern ${p.name}`, `${count === 0 ? 'Not in the song yet — press ＋ ADD TO SONG, or drag this letter up onto the track’s lane.' : `Played by ${count} clip${count === 1 ? '' : 's'} on the timeline — editing it changes all of them. Drag this letter onto the lane to place it again.`} The open pattern is what LOOP mode plays.`)}
          >
            {p.name}
          </button>
        )
      })}
      <button className="mini-btn" onClick={() => addPattern(false)} {...tip('New pattern', 'Start an empty pattern on this track — a different beat or melody for another part of the song.')}>
        ＋ NEW
      </button>
      <button className="mini-btn" onClick={() => addPattern(true)} {...tip('Copy as variation', 'Duplicates this pattern under the next letter so you can change it — add a fill, drop the kick — without touching the original.')}>
        COPY
      </button>
      {mine.length > 1 && (
        <button className="mini-btn" onClick={deleteOpenPattern} {...tip('Delete pattern', 'Deletes this pattern and every clip on the timeline that plays it.')}>
          ✕
        </button>
      )}
      <button
        className={`add-to-song ${openUnused ? 'nudge' : ''}`}
        onClick={() => addPatternToSong()}
        {...tip('Add to song', `Puts pattern ${open?.name ?? ''} on the timeline, right after this track’s last clip. Press it again to repeat the pattern. ${openUnused ? 'This pattern is not in the song yet, so SONG mode will not play it until you add it.' : ''} You can also drag the pattern’s letter onto the track’s lane to place it exactly where you want.`)}
      >
        ＋ ADD TO SONG
      </button>
      {drag && (
        <div className="pattern-drag-chip" style={{ left: drag.x, top: drag.y, background: drag.color }}>
          {drag.name}
        </div>
      )}
    </div>
  )
}

/** Load a ready-made groove into the open drum pattern. */
function GroovePicker() {
  return (
    <select
      className="groove-select"
      value=""
      onChange={(e) => {
        if (e.target.value) applyGroove(e.target.value)
        e.target.blur()
      }}
      {...tip('Grooves', 'Replace this pattern with a classic beat from a style — boom bap, trap, house, jungle… — then make it yours. ⌘Z brings back what you had.')}
    >
      <option value="">GROOVES…</option>
      {GROOVES.map((g) => (
        <option key={g.id} value={g.id}>
          {g.label} · {g.bpm} BPM
        </option>
      ))}
    </select>
  )
}

interface Row {
  key: string
  label: string
  color?: string
  values: number[]
  onPreview: () => void
  /** Hits per step (2..4 = a roll); rows without rolls leave it out. */
  rolls?: number[]
  /** Right-click a step: cycle its roll. */
  onRoll?: (step: number) => void
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
              const roll = v > 0 ? (row.rolls?.[step] ?? 0) : 0
              return (
                <div
                  key={step}
                  className={`cell ${step % 4 === 0 ? 'beat' : ''} ${step % 16 === 0 ? 'bar' : ''} ${v > 0 ? 'on' : ''} ${v > 0 && v < 0.75 ? 'soft' : ''} ${roll >= 2 ? 'roll' : ''}`}
                  style={v > 0 && row.color ? { background: row.color } : undefined}
                  onContextMenu={(e) => {
                    if (!row.onRoll) return
                    e.preventDefault()
                    row.onRoll(step)
                    row.onPreview()
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    paint = { value: v > 0 ? 0 : e.altKey ? 0.5 : 1 }
                    onSet(r, step, paint.value)
                    if (paint.value > 0) row.onPreview()
                  }}
                  onPointerEnter={(e) => {
                    if (paint && e.buttons === 1 && v !== paint.value) onSet(r, step, paint.value)
                  }}
                >
                  {roll >= 2 && <span className="roll-ticks">{'|'.repeat(roll)}</span>}
                </div>
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
  const drums = useStudio(selDrums)
  const rolls = useStudio((s) => {
    const p = selPattern(s)
    return p.kind === 'drums' ? p.rolls : undefined
  })
  const rows: Row[] = DRUM_VOICES.map((id) => ({
    key: id,
    label: DRUM_INFO[id].label,
    values: drums[id],
    rolls: rolls?.[id],
    onRoll: (step) => cycleDrumRoll(id, step),
    onPreview: () => hitDrum(id, 0.8)
  }))
  return <StepGrid rows={rows} steps={steps} onSet={(r, step, v) => setDrumStep(DRUM_VOICES[r], step, v)} />
}

function ChopGrid({ steps }: { steps: number }) {
  const chops = useStudio(selChops)
  const rows: Row[] = Array.from({ length: CHOP_PADS }, (_, pad) => ({
    key: String(pad),
    label: `CHOP ${pad + 1}`,
    color: PAD_COLORS[pad % PAD_COLORS.length],
    values: chops[pad],
    onPreview: () => hitChop(pad, 0.8)
  }))
  return <StepGrid rows={rows} steps={steps} onSet={(r, step, v) => setChopStep(r, step, v)} />
}
