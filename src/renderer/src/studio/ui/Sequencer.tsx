import { tip } from '../../components/TooltipLayer'
import {
  clearTrack,
  duplicateBars,
  hitChop,
  hitDrum,
  setBars,
  setChopStep,
  setDrumStep,
  shiftRoll
} from '../actions'
import { useStudio } from '../store'
import { CHOP_PADS, DRUM_VOICES, STEPS_PER_BAR } from '../types'
import { DRUM_INFO } from './DrumEditor'
import { Seg } from './Param'
import { PianoRoll } from './PianoRoll'
import { Playhead } from './Playhead'
import { noteName } from './SynthEditor'

const PAD_COLORS = ['#7c5cff', '#39c5ff', '#2ee66b', '#ffd23c', '#ff7a39', '#ff4d6d', '#c084fc', '#22d3ee']
const TRACK_HELP = {
  drums: 'Click a cell to place a hit, drag to paint a row. Alt-click places a soft (ghost) hit. Each column is a 16th note; bright columns are the beats.',
  chops: 'Each row is one chop pad. Place chops on the grid to rearrange the sample into a new beat.',
  synth: 'Piano roll. Click empty grid to place a note, or drag a chord pad in. Drag across the grid to box-select (Shift adds). Drag a note to move the selection, drag either end to trim it, Alt-drag to copy. Arrows nudge (Shift = beat/octave). Delete, double-click or right-click removes.'
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
