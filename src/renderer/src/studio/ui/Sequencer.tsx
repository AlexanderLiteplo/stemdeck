import { useMemo } from 'react'
import { tip } from '../../components/TooltipLayer'
import {
  addPattern,
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
import { CHOP_PADS, DRUM_VOICES, STEPS_PER_BAR } from '../types'
import { PAD_COLORS, patternColor } from './colors'
import { DRUM_INFO } from './DrumEditor'
import { Seg } from './Param'
import { PianoRoll } from './PianoRoll'
import { Playhead } from './Playhead'
import { noteName } from './SynthEditor'

const TRACK_HELP = {
  drums: 'Click a cell to place a hit, drag to paint a row. Alt-click places a soft (ghost) hit. Each column is a 16th note; bright columns are the beats.',
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

/** The selected track's patterns: pick which one to edit, start a new one, or branch a variation. */
function PatternPicker() {
  const trackId = useStudio((s) => s.selectedTrack)
  const openId = useStudio((s) => selTrack(s).patternId)
  const patterns = useStudio((s) => s.patterns)
  const clips = useStudio((s) => s.clips)
  const mine = useMemo(
    () =>
      Object.values(patterns)
        .filter((p) => p.trackId === trackId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [patterns, trackId]
  )

  return (
    <div className="pattern-picker">
      {mine.map((p) => {
        const uses = clips.filter((c) => c.patternId === p.id).length
        return (
          <button
            key={p.id}
            className={`pattern-chip ${p.id === openId ? 'active' : ''}`}
            style={{ borderColor: patternColor(p.name), ...(p.id === openId ? { background: patternColor(p.name) } : {}) }}
            onClick={() => openPattern(p.id)}
            {...tip(`Pattern ${p.name}`, `${uses === 0 ? 'Not on the timeline yet.' : `Played by ${uses} clip${uses === 1 ? '' : 's'} on the timeline — editing it changes all of them.`} The open pattern is what LOOP mode plays and what a double-click on the timeline drops in.`)}
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
  const drums = useStudio(selDrums)
  const rows: Row[] = DRUM_VOICES.map((id) => ({
    key: id,
    label: DRUM_INFO[id].label,
    values: drums[id],
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
