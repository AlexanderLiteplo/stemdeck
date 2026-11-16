import { tip } from '../../components/TooltipLayer'
import { PIANO_KEYS } from '../../keyboard'
import {
  deleteUserPatch,
  factoryPatches,
  loadPatch,
  saveUserPatch,
  shiftKeyOctave,
  synthDown,
  synthUp,
  updatePatch
} from '../actions'
import { useStudio } from '../store'
import type { Wave } from '../types'
import { Param, PresetBar, Seg, fmt } from './Param'

const WAVES: readonly Wave[] = ['sine', 'triangle', 'sawtooth', 'square']
const WAVE_LABELS = { sine: 'SIN', triangle: 'TRI', sawtooth: 'SAW', square: 'SQR' }
const WAVE_HELP =
  'Sine = pure and round (808s, subs). Triangle = soft, flute-like. Saw = bright and buzzy (strings, leads, pads). Square = hollow and woody (organs, retro).'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

export function SynthEditor() {
  const patch = useStudio((s) => s.patch)
  const userPatches = useStudio((s) => s.userPatches)

  return (
    <div className="instrument synth-editor">
      <div className="instrument-head">
        <span className="instrument-name" {...tip('Synth', 'A subtractive synthesizer: oscillators make a raw tone, the filter carves it, envelopes shape it over time. Play it with your computer keyboard (A–; row, Z/X = octave) or click the keys below.')}>
          SYNTH
        </span>
        <PresetBar
          kind="Synth"
          factory={factoryPatches}
          user={userPatches}
          current={patch}
          onLoad={loadPatch}
          onSave={saveUserPatch}
          onDelete={deleteUserPatch}
        />
      </div>

      <div className="module-row">
        <section className="module">
          <h4 {...tip('Oscillators', 'The raw sound sources. Two oscillators mixed together, plus a sub (one octave down) and noise.')}>OSC</h4>
          <div className="module-line">
            <span className="mod-label">1</span>
            <Seg options={WAVES} labels={WAVE_LABELS} value={patch.osc1.wave} title="Osc 1 wave" help={WAVE_HELP} onChange={(w) => updatePatch((p) => void (p.osc1.wave = w))} />
          </div>
          <div className="module-line">
            <span className="mod-label">2</span>
            <Seg options={WAVES} labels={WAVE_LABELS} value={patch.osc2.wave} title="Osc 2 wave" help={WAVE_HELP} onChange={(w) => updatePatch((p) => void (p.osc2.wave = w))} />
          </div>
          <div className="knobs">
            <Param label="OSC1" help="Volume of oscillator 1." value={patch.osc1.level} min={0} max={1} defaultValue={0.8} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.osc1.level = v))} />
            <Param label="OSC2" help="Volume of oscillator 2." value={patch.osc2.level} min={0} max={1} defaultValue={0.5} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.osc2.level = v))} />
            <Param label="OCT2" help="Shifts oscillator 2 up or down in octaves. +1 adds brightness (organ drawbar style); -1 adds weight." value={patch.osc2.octave} min={-2} max={2} defaultValue={0} format={fmt.int} onChange={(v) => updatePatch((p) => void (p.osc2.octave = Math.round(v)))} />
            <Param label="DETUNE" help="Slightly mistunes oscillator 2 against 1 in cents. A few cents = a fat, chorused beating sound." value={patch.osc2.detune} min={-50} max={50} defaultValue={0} format={fmt.cents} onChange={(v) => updatePatch((p) => void (p.osc2.detune = v))} />
            <Param label="SUB" help="A pure sine one octave below — adds low-end weight without mud." value={patch.sub} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.sub = v))} />
            <Param label="NOISE" help="White noise mixed in — breath for pads, grit for leads." value={patch.noise} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.noise = v))} />
            <Param label="UNISON" help="Stacks multiple copies of each oscillator. 1 = single voice; 5–7 = huge 'supersaw' choir/pad thickness." value={patch.unison} min={1} max={7} defaultValue={1} format={fmt.int} onChange={(v) => updatePatch((p) => void (p.unison = Math.round(v)))} />
            <Param label="SPREAD" help="How far the unison copies are detuned from each other. More = wider and more shimmery." value={patch.spread} min={0} max={50} defaultValue={12} format={fmt.cents} onChange={(v) => updatePatch((p) => void (p.spread = v))} />
          </div>
        </section>

        <section className="module">
          <h4 {...tip('Filter', 'Removes frequencies to shape the tone. Lowpass (LP) darkens; highpass (HP) thins; bandpass (BP) keeps only the middle.')}>FILTER</h4>
          <div className="module-line">
            <Seg
              options={['lowpass', 'highpass', 'bandpass'] as const}
              labels={{ lowpass: 'LP', highpass: 'HP', bandpass: 'BP' }}
              value={patch.filter.type}
              title="Filter type"
              help="LP lets lows through (warm/dark). HP lets highs through (thin/airy). BP keeps a band around the cutoff (telephone/vocal)."
              onChange={(t) => updatePatch((p) => void (p.filter.type = t))}
            />
          </div>
          <div className="knobs">
            <Param label="CUTOFF" curve="log" help="Where the filter starts cutting. Turn down for darker, muffled; up for bright and open." value={patch.filter.cutoff} min={40} max={18000} defaultValue={2400} format={fmt.hz} onChange={(v) => updatePatch((p) => void (p.filter.cutoff = v))} />
            <Param label="RES" help="Resonance boosts frequencies right at the cutoff — high values whistle and 'squelch'." value={patch.filter.resonance} min={0.1} max={20} defaultValue={1} format={fmt.num} onChange={(v) => updatePatch((p) => void (p.filter.resonance = v))} />
            <Param label="ENV" help="How much the filter envelope opens the cutoff on each note (in octaves). Positive = a 'wow' pluck that starts bright and closes." value={patch.filter.envAmount} min={-4} max={6} defaultValue={0} format={fmt.oct} onChange={(v) => updatePatch((p) => void (p.filter.envAmount = v))} />
            <Param label="KEYTRK" help="Makes the cutoff follow the note you play, so high notes stay as bright as low ones." value={patch.filter.keyTrack} min={0} max={1} defaultValue={0.5} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.filter.keyTrack = v))} />
          </div>
        </section>

        <EnvModule
          title="AMP ENV"
          help="Volume over time. Attack = fade-in, Decay = drop after the hit, Sustain = level while held, Release = fade-out after you let go."
          env={patch.ampEnv}
          onChange={(k, v) => updatePatch((p) => void (p.ampEnv[k] = v))}
        />
        <EnvModule
          title="FILTER ENV"
          help="Moves the filter cutoff over time (scaled by the filter's ENV knob). Short decay + low sustain = plucky; slow attack = swelling."
          env={patch.filterEnv}
          onChange={(k, v) => updatePatch((p) => void (p.filterEnv[k] = v))}
        />

        <section className="module">
          <h4 {...tip('Modulation & mode', 'LFO = a slow wobble that moves pitch (vibrato) or the filter (wah). Mono + glide makes notes slide into each other.')}>LFO / MODE</h4>
          <div className="knobs">
            <Param label="RATE" curve="log" help="LFO speed in Hz. ~5Hz = natural vibrato; below 1Hz = slow sweeps." value={patch.lfo.rate} min={0.05} max={20} defaultValue={5} format={(v) => `${v.toFixed(v < 1 ? 2 : 1)}Hz`} onChange={(v) => updatePatch((p) => void (p.lfo.rate = v))} />
            <Param label="VIBRATO" help="How much the LFO wobbles the pitch, in cents (100 = one semitone)." value={patch.lfo.pitch} min={0} max={100} defaultValue={0} format={fmt.cents} onChange={(v) => updatePatch((p) => void (p.lfo.pitch = v))} />
            <Param label="WAH" help="How much the LFO sweeps the filter cutoff, in octaves." value={patch.lfo.filter} min={0} max={4} defaultValue={0} format={fmt.oct} onChange={(v) => updatePatch((p) => void (p.lfo.filter = v))} />
            <Param label="GLIDE" help="Portamento: time to slide from one note to the next (mono mode). The sliding-808 sound." value={patch.glide} min={0} max={1} defaultValue={0} format={fmt.sec} onChange={(v) => updatePatch((p) => void (p.glide = v))} />
          </div>
          <div className="module-line">
            <button
              className={`toggle mini ${patch.mono ? 'active' : ''}`}
              onClick={() => updatePatch((p) => void (p.mono = !p.mono))}
              {...tip('Mono', 'One note at a time. Holding a note and pressing another slides (with GLIDE) instead of retriggering — essential for 808 slides and leads.')}
            >
              MONO
            </button>
          </div>
        </section>

        <section className="module">
          <h4 {...tip('Effects', 'Drive adds distortion; reverb and delay put the sound in a space.')}>FX</h4>
          <div className="knobs">
            <Param label="DRIVE" help="Saturation/distortion. Makes 808s audible on phone speakers and leads gritty." value={patch.drive} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.drive = v))} />
            <Param label="REVERB" help="Sends the sound into a big hall — the Donda church/stadium space." value={patch.reverb} min={0} max={1} defaultValue={0.2} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.reverb = v))} />
            <Param label="DELAY" help="Tempo-synced echo (dotted 8th). Repeats follow the project BPM." value={patch.delay} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.delay = v))} />
            <Param label="VOLUME" help="Overall level of this sound." value={patch.volume} min={0} max={1} defaultValue={0.7} format={fmt.pct} onChange={(v) => updatePatch((p) => void (p.volume = v))} />
          </div>
        </section>
      </div>

      <PianoKeyboard />
    </div>
  )
}

function EnvModule({
  title,
  help,
  env,
  onChange
}: {
  title: string
  help: string
  env: { attack: number; decay: number; sustain: number; release: number }
  onChange: (key: 'attack' | 'decay' | 'sustain' | 'release', value: number) => void
}) {
  return (
    <section className="module">
      <h4 {...tip(title, help)}>{title}</h4>
      <EnvGraph env={env} />
      <div className="knobs">
        <Param label="A" curve="log" help="Attack: how long the sound takes to reach full level. Short = punchy, long = swelling pad." value={env.attack} min={0.001} max={4} defaultValue={0.005} format={fmt.sec} onChange={(v) => onChange('attack', v)} size={28} />
        <Param label="D" curve="log" help="Decay: how long it takes to fall from the peak to the sustain level." value={env.decay} min={0.01} max={6} defaultValue={0.3} format={fmt.sec} onChange={(v) => onChange('decay', v)} size={28} />
        <Param label="S" help="Sustain: the level held while the key stays down (0 = plucked, 100% = organ)." value={env.sustain} min={0} max={1} defaultValue={0.7} format={fmt.pct} onChange={(v) => onChange('sustain', v)} size={28} />
        <Param label="R" curve="log" help="Release: how long the sound rings out after you let go." value={env.release} min={0.01} max={8} defaultValue={0.3} format={fmt.sec} onChange={(v) => onChange('release', v)} size={28} />
      </div>
    </section>
  )
}

/** Tiny ADSR shape preview. */
function EnvGraph({ env }: { env: { attack: number; decay: number; sustain: number; release: number } }) {
  const w = 120
  const h = 30
  const total = env.attack + env.decay + 0.5 + env.release
  const scale = (t: number) => (Math.sqrt(t / total) * w * 0.98)
  const a = scale(env.attack)
  const d = scale(env.attack + env.decay)
  const s = scale(env.attack + env.decay + 0.5)
  const sy = h - env.sustain * (h - 2)
  return (
    <svg className="env-graph" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={`0,${h} ${a},2 ${d},${sy} ${s},${sy} ${w},${h}`} />
    </svg>
  )
}

/** Two-octave clickable keyboard showing the computer-key mapping. */
function PianoKeyboard() {
  const keyOctave = useStudio((s) => s.keyOctave)
  const held = useStudio((s) => s.heldNotes)
  const base = (keyOctave + 1) * 12
  const keyLabel = new Map(Object.entries(PIANO_KEYS).map(([code, semi]) => [semi, code.replace('Key', '').replace('Semicolon', ';').replace('Quote', "'")]))
  const notes = Array.from({ length: 25 }, (_, i) => base + i)
  const whites = notes.filter((n) => ![1, 3, 6, 8, 10].includes(n % 12))

  return (
    <div className="piano-wrap">
      <div className="octave-ctl" {...tip('Keyboard octave', 'Z / X on your computer keyboard shift the octave down / up.')}>
        <button className="mini-btn" onClick={() => shiftKeyOctave(-1)}>Z −</button>
        <span>C{keyOctave}</span>
        <button className="mini-btn" onClick={() => shiftKeyOctave(1)}>X +</button>
      </div>
      <div className="piano">
        {whites.map((n) => (
          <PianoKey key={n} midi={n} black={false} held={held.includes(n)} label={keyLabel.get(n - base)} />
        ))}
        {notes
          .filter((n) => [1, 3, 6, 8, 10].includes(n % 12))
          .map((n) => {
            const whiteIndex = whites.filter((w) => w < n).length
            return (
              <PianoKey
                key={n}
                midi={n}
                black
                held={held.includes(n)}
                label={keyLabel.get(n - base)}
                left={`calc(${(whiteIndex / whites.length) * 100}% - ${100 / whites.length / 3}%)`}
              />
            )
          })}
      </div>
    </div>
  )
}

function PianoKey({
  midi,
  black,
  held,
  label,
  left
}: {
  midi: number
  black: boolean
  held: boolean
  label?: string
  left?: string
}) {
  return (
    <div
      className={`pkey ${black ? 'black' : 'white'} ${held ? 'held' : ''}`}
      style={left ? { left } : undefined}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        synthDown(midi)
      }}
      onPointerUp={() => synthUp(midi)}
      onPointerCancel={() => synthUp(midi)}
    >
      {label && <span className="pkey-label">{label}</span>}
      {midi % 12 === 0 && <span className="pkey-note">{noteName(midi)}</span>}
    </div>
  )
}
