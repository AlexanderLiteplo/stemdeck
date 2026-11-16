import { useEffect, useRef, useState } from 'react'
import { tip } from '../../components/TooltipLayer'
import { PAD_KEY_LABELS } from '../../keyboard'
import { useStore } from '../../state/store'
import {
  chopData,
  chopFlash,
  hitChop,
  loadChopTrack,
  pageChops,
  setChopStart,
  updateChop
} from '../actions'
import { useStudio } from '../store'
import { CHOP_PADS, type ChopSettings, type ChopSource } from '../types'
import { Param, Seg, fmt } from './Param'
import { usePadFlash } from './usePadFlash'

const SOURCES: { id: ChopSource; label: string }[] = [
  { id: 'mix', label: 'FULL' },
  { id: 'vocals', label: 'VOX' },
  { id: 'drums', label: 'DRUMS' },
  { id: 'bass', label: 'BASS' },
  { id: 'other', label: 'MELODY' },
  { id: 'instrumental', label: 'INST' }
]

const SLICES = [0.5, 1, 2, 4, 8] as const
const SLICE_LABELS: Record<string, string> = { '0.5': '⅛', '1': '1 BEAT', '2': '½ BAR', '4': '1 BAR', '8': '2 BARS' }

const PAD_COLORS = ['#7c5cff', '#39c5ff', '#2ee66b', '#ffd23c', '#ff7a39', '#ff4d6d', '#c084fc', '#22d3ee']

function padRegion(c: ChopSettings, pad: number): { start: number; end: number } {
  const beat = 60 / c.bpm
  const start = c.offset + (c.startBeat + pad * c.sliceBeats) * beat
  return { start, end: start + c.sliceBeats * beat }
}

export function ChopEditor() {
  const chop = useStudio((s) => s.chop)
  const title = useStudio((s) => s.chopTitle)
  const loading = useStudio((s) => s.chopLoading)
  const library = useStore((s) => s.library)
  const track = library.find((t) => t.id === chop.trackId)
  const [dropping, setDropping] = useState(false)
  const flashRef = usePadFlash(Array.from({ length: CHOP_PADS }, (_, i) => `chop:${i}`))
  const hasSample = !!chop.trackId && !loading
  const bars = (chop.sliceBeats * CHOP_PADS) / 4

  return (
    <div
      className={`instrument chop-editor ${dropping ? 'drop-target' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/stemdeck-track')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const id = e.dataTransfer.getData('text/stemdeck-track')
        if (id) {
          e.preventDefault()
          void loadChopTrack(id, 'mix')
        }
      }}
    >
      <div className="instrument-head">
        <span className="instrument-name" {...tip('Chopper', 'Slice any song from your library into 16 pads, cut on its beat grid. Drag a track here from the library (or pick one), choose how long each chop is, then play the pads with 1234 / QWER / ASDF / ZXCV or sequence them below.')}>
          CHOPPER
        </span>
        <select
          className="sample-select"
          value={chop.trackId ?? ''}
          onChange={(e) => {
            if (e.target.value) void loadChopTrack(e.target.value, 'mix')
            e.target.blur()
          }}
          {...tip('Sample', 'Any track in your library — including YouTube downloads. Or drag one in from the library below.')}
        >
          <option value="">{library.length ? 'Pick a sample…' : 'Add tracks to the library first'}</option>
          {library.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="seg" {...tip('Stem', 'Chop just one part of the song — e.g. only the vocals or only the drums. Needs the track’s stems split (✂ SPLIT STEMS on a deck).')}>
          {SOURCES.map((s) => {
            const available = s.id === 'mix' || !!track?.stems?.[s.id as Exclude<ChopSource, 'mix'>]
            if (!available && s.id === 'instrumental') return null
            return (
              <button
                key={s.id}
                disabled={!available || !track}
                className={chop.source === s.id ? 'active' : ''}
                onClick={() => track && void loadChopTrack(track.id, s.id)}
              >
                {s.label}
              </button>
            )
          })}
        </div>
        {loading && <span className="dim">Loading…</span>}
      </div>

      <ChopWaveform chop={chop} title={title} />

      <div className="chop-controls">
        <div className="field" {...tip('Sample BPM', 'The sample’s own tempo, detected automatically. If chops sound off-grid, fix it here — ×½ / ×2 fix the common half/double-time mistake.')}>
          <label>BPM</label>
          <NumberInput value={chop.bpm} step={0.1} min={40} max={250} onChange={(bpm) => updateChop({ bpm })} disabled={!hasSample} />
          <button className="mini-btn" disabled={!hasSample} onClick={() => updateChop({ bpm: chop.bpm / 2 })}>×½</button>
          <button className="mini-btn" disabled={!hasSample} onClick={() => updateChop({ bpm: chop.bpm * 2 })}>×2</button>
        </div>
        <div className="field" {...tip('Grid nudge', 'Slides the beat grid so slice lines sit exactly on the hits. ◂ ▸ = 5 ms, ⇤ ⇥ = one whole beat (use these if “beat 1” is on the wrong hit).')}>
          <label>GRID</label>
          <button className="mini-btn" disabled={!hasSample} onClick={() => updateChop({ offset: chop.offset - 60 / chop.bpm })}>⇤</button>
          <button className="mini-btn" disabled={!hasSample} onClick={() => updateChop({ offset: chop.offset - 0.005 })}>◂</button>
          <span className="mono">{(chop.offset * 1000).toFixed(0)}ms</span>
          <button className="mini-btn" disabled={!hasSample} onClick={() => updateChop({ offset: chop.offset + 0.005 })}>▸</button>
          <button className="mini-btn" disabled={!hasSample} onClick={() => updateChop({ offset: chop.offset + 60 / chop.bpm })}>⇥</button>
        </div>
        <div className="field">
          <label>CHOP</label>
          <Seg
            options={SLICES}
            labels={SLICE_LABELS}
            value={chop.sliceBeats as (typeof SLICES)[number]}
            title="Chop length"
            help="How long each pad is: ⅛ note, 1 beat, half a bar, 1 bar or 2 bars. Short chops = choppy stutters; bar chops = loops you can rearrange."
            onChange={(sliceBeats) => updateChop({ sliceBeats })}
          />
        </div>
        <div className="field" {...tip('Pad window', `The 16 pads cover ${bars} bar${bars === 1 ? '' : 's'} of the song. Page through the song here, or click the overview waveform to start the pads at any bar (Shift-click = any beat).`)}>
          <label>PADS</label>
          <button className="mini-btn" disabled={!hasSample} onClick={() => pageChops(-1)}>◀</button>
          <span className="mono">bar {Math.floor(chop.startBeat / 4) + 1}</span>
          <button className="mini-btn" disabled={!hasSample} onClick={() => pageChops(1)}>▶</button>
          <button className="mini-btn" disabled={!hasSample} onClick={() => setChopStart(chop.startBeat - 4)}>−1 bar</button>
          <button className="mini-btn" disabled={!hasSample} onClick={() => setChopStart(chop.startBeat + 4)}>+1 bar</button>
        </div>
        <button
          className={`toggle mini ${chop.fitToTempo ? 'active' : ''}`}
          onClick={() => updateChop({ fitToTempo: !chop.fitToTempo })}
          {...tip('Fit to tempo', 'Speeds up or slows down the chops so they match the project BPM — like a turntable or SP-404, pitch moves with speed. Off = original speed and pitch.')}
        >
          FIT BPM
        </button>
        <button
          className={`toggle mini ${chop.choke ? 'active' : ''}`}
          onClick={() => updateChop({ choke: !chop.choke })}
          {...tip('Choke', 'On: a new pad cuts off the one still playing (classic MPC chop style). Off: chops overlap and ring out.')}
        >
          CHOKE
        </button>
        <Param label="PITCH" help="Transpose all chops in semitones — pitch a soul sample up for that chipmunk-soul sound, or down for dark and heavy." value={chop.pitch} min={-12} max={12} defaultValue={0} format={fmt.st} onChange={(v) => updateChop({ pitch: Math.round(v) })} size={28} />
        <Param label="FADE" help="Tiny fade at the start and end of each chop so cuts don’t click." value={chop.fade} min={0} max={0.05} defaultValue={0.004} format={fmt.sec} onChange={(v) => updateChop({ fade: v })} size={28} />
        <Param label="REVERB" help="Puts the chops in the studio hall reverb." value={chop.reverb} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => updateChop({ reverb: v })} size={28} />
      </div>

      <div className="pad-grid cols-8">
        {Array.from({ length: CHOP_PADS }, (_, pad) => {
          const r = padRegion(chop, pad)
          const valid = hasSample && (!chopData.buffer || r.start < chopData.buffer.duration)
          return (
            <button
              key={pad}
              ref={flashRef(pad)}
              disabled={!valid}
              className="pad-big chop-pad"
              style={{ ['--pad-color' as string]: PAD_COLORS[pad % PAD_COLORS.length] }}
              onPointerDown={(e) => hitChop(pad, e.shiftKey ? 0.55 : 1)}
              {...tip(`Chop ${pad + 1}`, `Plays ${formatTime(r.start)}–${formatTime(r.end)} of the sample. Key: ${PAD_KEY_LABELS[pad]} (Shift = soft).`)}
            >
              <span className="pad-key">{PAD_KEY_LABELS[pad]}</span>
              {pad + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60)
  return `${m}:${(Math.max(0, s) % 60).toFixed(2).padStart(5, '0')}`
}

function NumberInput({
  value,
  onChange,
  step,
  min,
  max,
  disabled
}: {
  value: number
  onChange: (v: number) => void
  step: number
  min: number
  max: number
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = Number(draft)
    if (Number.isFinite(v) && v >= min && v <= max) onChange(v)
    setDraft(null)
  }
  return (
    <input
      className="num-input"
      type="number"
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      value={draft ?? String(Math.round(value * 100) / 100)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          ;(e.target as HTMLInputElement).blur()
        }
        if (e.key === 'Escape') {
          setDraft(null)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export { NumberInput }

/**
 * Overview strip (whole song, click to move the pad window) above a zoomed
 * view of the 16 chops (click a slice to play it).
 */
function ChopWaveform({ chop, title }: { chop: ChopSettings; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chopRef = useRef(chop)
  chopRef.current = chop
  const detailCache = useRef<{ key: string; data: Float32Array } | null>(null)
  const OVERVIEW_H = 36

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w) return
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const c = chopRef.current
      const buffer = chopData.buffer
      const peaks = chopData.peaks
      if (!buffer || !peaks || !c.trackId) {
        ctx.fillStyle = '#4a5266'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Drag a track here from the library to start chopping', w / 2, h / 2 + 4)
        return
      }
      const dur = buffer.duration
      const beat = 60 / c.bpm
      const first = padRegion(c, 0).start
      const last = padRegion(c, CHOP_PADS - 1).end

      // --- Overview ---
      const oh = OVERVIEW_H
      ctx.fillStyle = 'rgba(124, 92, 255, 0.22)'
      ctx.fillRect((first / dur) * w, 0, ((last - first) / dur) * w, oh)
      ctx.fillStyle = '#5b6478'
      for (let x = 0; x < w; x++) {
        const b = Math.floor((x / w) * peaks.buckets)
        const mn = peaks.data[b * 2]
        const mx = peaks.data[b * 2 + 1]
        ctx.fillRect(x, oh / 2 - mx * (oh / 2 - 2), 1, Math.max(1, (mx - mn) * (oh / 2 - 2)))
      }
      ctx.strokeStyle = '#7c5cff'
      ctx.lineWidth = 1
      ctx.strokeRect((first / dur) * w + 0.5, 0.5, Math.max(2, ((last - first) / dur) * w), oh - 1)

      // --- Detail ---
      const top = oh + 6
      const dh = h - top
      const span = last - first
      const key = `${w}|${first.toFixed(4)}|${span.toFixed(4)}|${buffer.length}`
      if (!detailCache.current || detailCache.current.key !== key) {
        const data = new Float32Array(w * 2)
        const ch0 = buffer.getChannelData(0)
        const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0
        const sr = buffer.sampleRate
        for (let x = 0; x < w; x++) {
          const s0 = Math.floor((first + (x / w) * span) * sr)
          const s1 = Math.floor((first + ((x + 1) / w) * span) * sr)
          let mn = 0
          let mx = 0
          const stride = Math.max(1, Math.floor((s1 - s0) / 64))
          for (let s = Math.max(0, s0); s < Math.min(ch0.length, s1); s += stride) {
            const v = (ch0[s] + ch1[s]) * 0.5
            if (v < mn) mn = v
            if (v > mx) mx = v
          }
          data[x * 2] = mn
          data[x * 2 + 1] = mx
        }
        detailCache.current = { key, data }
      }
      const data = detailCache.current.data
      const mid = top + dh / 2
      for (let pad = 0; pad < CHOP_PADS; pad++) {
        const r = padRegion(c, pad)
        const x1 = ((r.start - first) / span) * w
        const x2 = ((r.end - first) / span) * w
        ctx.fillStyle = pad % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.0)'
        ctx.fillRect(x1, top, x2 - x1, dh)
        const color = PAD_COLORS[pad % PAD_COLORS.length]
        ctx.fillStyle = r.start >= dur ? '#2a2f3a' : color
        for (let x = Math.max(0, Math.floor(x1)); x < Math.min(w, Math.ceil(x2)); x++) {
          const mn = data[x * 2]
          const mx = data[x * 2 + 1]
          ctx.fillRect(x, mid - mx * (dh / 2 - 4), 1, Math.max(1, (mx - mn) * (dh / 2 - 4)))
        }
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fillRect(x1, top, 1, dh)
        ctx.fillStyle = '#dfe6f2'
        ctx.font = 'bold 9px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(`${pad + 1}`, x1 + 3, top + 10)
      }
      // Beat ticks inside chops longer than a beat
      if (c.sliceBeats > 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        for (let t = first; t < last; t += beat) {
          const x = ((t - first) / span) * w
          ctx.fillRect(x, top + dh - 6, 1, 6)
        }
      }
      // Moving playhead for the chop that's sounding
      if (chopFlash.pad >= 0) {
        const r = padRegion(c, chopFlash.pad)
        const t = r.start + ((performance.now() - chopFlash.at) / 1000) * chopFlash.rate
        if (t < r.end) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(((t - first) / span) * w, top, 2, dh)
          const ox = (t / dur) * w
          ctx.fillRect(ox, 0, 1, oh)
        }
      }
      ctx.fillStyle = '#7a8499'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(title, w - 6, top + dh - 6)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [title])

  return (
    <canvas
      ref={canvasRef}
      className="chop-wave"
      {...tip('Chop view', 'Top strip: the whole song — click to move the 16 pads to that bar (Shift-click = exact beat). Bottom: the 16 chops, colored — click one to hear it.')}
      onPointerDown={(e) => {
        const c = chopRef.current
        const buffer = chopData.buffer
        if (!buffer) return
        const rect = e.currentTarget.getBoundingClientRect()
        const x = (e.clientX - rect.left) / rect.width
        const y = e.clientY - rect.top
        const beat = 60 / c.bpm
        if (y <= OVERVIEW_H) {
          const t = x * buffer.duration
          const beats = (t - c.offset) / beat
          setChopStart(e.shiftKey ? Math.floor(beats) : Math.floor(beats / 4) * 4)
        } else {
          hitChop(Math.min(CHOP_PADS - 1, Math.floor(x * CHOP_PADS)))
        }
      }}
    />
  )
}
