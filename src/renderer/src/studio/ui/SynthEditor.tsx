import { useRef, useState } from 'react'
import { tip } from '../../components/TooltipLayer'
import { PIANO_KEYS } from '../../keyboard'
import {
  chaosPatch,
  deleteUserPatch,
  factoryPatches,
  loadPatch,
  saveUserPatch,
  shiftKeyOctave,
  synthDown,
  synthUp,
  updatePatch
} from '../actions'
import { selPatch, useStudio } from '../store'
import { noteNamer } from '../chords'
import { LFO_DIVISIONS, type DistortionType, type LfoShape, type SynthPatch, type Wave } from '../types'
import { ChordBar } from './ChordPads'
import { Param, PresetBar, Seg, fmt, fromNorm, toNorm } from './Param'

const WAVES: readonly Wave[] = ['sine', 'triangle', 'sawtooth', 'square']
const WAVE_LABELS = { sine: 'SIN', triangle: 'TRI', sawtooth: 'SAW', square: 'SQR' }
const WAVE_HELP =
  'Sine = pure and round (808s, subs). Triangle = soft, flute-like. Saw = bright and buzzy (strings, leads, pads). Square = hollow and woody (organs, retro).'

const LFO_SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'sawtooth', 'square', 'random']
const LFO_SHAPE_LABELS = { sine: 'SIN', triangle: 'TRI', sawtooth: 'SAW', square: 'SQR', random: 'RND' }
const DRIVE_TYPES: readonly DistortionType[] = ['soft', 'hard', 'fold', 'fuzz']
const DRIVE_LABELS = { soft: 'SOFT', hard: 'HARD', fold: 'FOLD', fuzz: 'FUZZ' }

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

const fmtVibrato = (cents: number) => (cents >= 100 ? `${(cents / 100).toFixed(1)}st` : `${Math.round(cents)}¢`)
const fmtRate = (hz: number) => `${hz.toFixed(hz < 1 ? 2 : hz < 10 ? 1 : 0)}Hz`
const lastDivision = LFO_DIVISIONS.length - 1

export function SynthEditor() {
  const patch = useStudio(selPatch)
  const userPatches = useStudio((s) => s.userPatches)
  const edit = updatePatch

  return (
    <div className="instrument synth-editor">
      <div className="instrument-head">
        <span className="instrument-name" {...tip('Synth', 'A subtractive synthesizer: oscillators make a raw tone, the filter carves it, envelopes shape it over time, and DESTROY wrecks it. Play it with your computer keyboard (A–; row, Z/X = octave) or click the keys below. Press C for CHORDS mode: one in-key chord per key.')}>
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
        <button
          className="chaos-btn"
          onClick={chaosPatch}
          {...tip('Chaos', 'Rolls a completely random aggressive sound. Most rolls are usable, some are unhinged — keep rolling, then SAVE the ones you like.')}
        >
          ⚡ CHAOS
        </button>
      </div>

      <div className="module-row">
        <section className="module">
          <h4 {...tip('Oscillators', 'The raw sound sources. Two oscillators mixed together, plus a sub (one octave down) and noise. FM and RING make the two oscillators collide instead of just mixing.')}>OSC</h4>
          <div className="module-line">
            <span className="mod-label">1</span>
            <Seg options={WAVES} labels={WAVE_LABELS} value={patch.osc1.wave} title="Osc 1 wave" help={WAVE_HELP} onChange={(w) => edit((p) => void (p.osc1.wave = w))} />
            <span className="mod-label">2</span>
            <Seg options={WAVES} labels={WAVE_LABELS} value={patch.osc2.wave} title="Osc 2 wave" help={WAVE_HELP} onChange={(w) => edit((p) => void (p.osc2.wave = w))} />
          </div>
          <div className="knobs">
            <Param label="OSC1" help="Volume of oscillator 1." value={patch.osc1.level} min={0} max={1} defaultValue={0.8} format={fmt.pct} onChange={(v) => edit((p) => void (p.osc1.level = v))} />
            <Param label="OSC2" help="Volume of oscillator 2. FM, RING and filter FM still use oscillator 2 even when this is at zero." value={patch.osc2.level} min={0} max={1} defaultValue={0.5} format={fmt.pct} onChange={(v) => edit((p) => void (p.osc2.level = v))} />
            <Param label="OCT2" help="Shifts oscillator 2 up or down in octaves. +1 adds brightness (organ drawbar style); -1 adds weight." value={patch.osc2.octave} min={-2} max={2} defaultValue={0} format={fmt.int} onChange={(v) => edit((p) => void (p.osc2.octave = Math.round(v)))} />
            <Param label="SEMI2" help="Shifts oscillator 2 in semitones. +7 = a power-chord fifth; odd values make FM and RING clang like metal." value={patch.osc2.semi} min={-12} max={12} defaultValue={0} format={fmt.st} onChange={(v) => edit((p) => void (p.osc2.semi = Math.round(v)))} />
            <Param label="DETUNE" help="Slightly mistunes oscillator 2 against 1 in cents. A few cents = a fat, chorused beating sound." value={patch.osc2.detune} min={-50} max={50} defaultValue={0} format={fmt.cents} onChange={(v) => edit((p) => void (p.osc2.detune = v))} />
            <Param label="SUB" help="A pure sine one octave below — adds low-end weight without mud." value={patch.sub} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.sub = v))} />
            <Param label="NOISE" help="White noise mixed in — breath for pads, grit for leads." value={patch.noise} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.noise = v))} />
            <Param label="UNISON" help="Stacks multiple copies of each oscillator. 1 = single voice; 5–7 = huge 'supersaw' / rave hoover thickness." value={patch.unison} min={1} max={7} defaultValue={1} format={fmt.int} onChange={(v) => edit((p) => void (p.unison = Math.round(v)))} />
            <Param label="SPREAD" help="How far the unison copies are detuned from each other. More = wider and more shimmery; past 30¢ it turns seasick." value={patch.spread} min={0} max={50} defaultValue={12} format={fmt.cents} onChange={(v) => edit((p) => void (p.spread = v))} />
            <Param label="FM" help="Oscillator 2 shakes oscillator 1's pitch thousands of times a second. A little = metallic bite; a lot = screaming, broken-speaker noise. Change OCT2 / SEMI2 to change the flavour." value={patch.fm} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.fm = v))} />
            <Param label="RING" help="Ring modulation: oscillator 1 multiplied by oscillator 2. Clangorous, robotic, bell-like — the classic sci-fi robot voice." value={patch.ring} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.ring = v))} />
          </div>
        </section>

        <section className="module">
          <h4 {...tip('Filter', 'Removes frequencies to shape the tone. Lowpass (LP) darkens; highpass (HP) thins; bandpass (BP) keeps only the middle. 24 dB + high RES + DRIVE is the acid sound.')}>FILTER</h4>
          <div className="module-line">
            <Seg
              options={['lowpass', 'highpass', 'bandpass'] as const}
              labels={{ lowpass: 'LP', highpass: 'HP', bandpass: 'BP' }}
              value={patch.filter.type}
              title="Filter type"
              help="LP lets lows through (warm/dark). HP lets highs through (thin/airy). BP keeps a band around the cutoff (telephone/vocal)."
              onChange={(t) => edit((p) => void (p.filter.type = t))}
            />
            <Seg
              options={[12, 24] as const}
              labels={{ '12': '12dB', '24': '24dB' }}
              value={patch.filter.slope}
              title="Filter slope"
              help="How steeply the filter cuts. 12 dB is gentle and open. 24 dB cuts twice as hard and its resonance screams — the acid / Moog bass sound."
              onChange={(slope) => edit((p) => void (p.filter.slope = slope))}
            />
          </div>
          <div className="knobs">
            <Param label="CUTOFF" curve="log" help="Where the filter starts cutting. Turn down for darker, muffled; up for bright and open." value={patch.filter.cutoff} min={40} max={18000} defaultValue={2400} format={fmt.hz} onChange={(v) => edit((p) => void (p.filter.cutoff = v))} />
            <Param label="RES" curve="sq" help="Resonance boosts frequencies right at the cutoff — high values whistle, squelch and scream." value={patch.filter.resonance} min={0.1} max={30} defaultValue={1} format={fmt.num} onChange={(v) => edit((p) => void (p.filter.resonance = v))} />
            <Param label="ENV" help="How much the filter envelope opens the cutoff on each note (in octaves). Positive = a 'wow' pluck that starts bright and closes." value={patch.filter.envAmount} min={-4} max={6} defaultValue={0} format={fmt.oct} onChange={(v) => edit((p) => void (p.filter.envAmount = v))} />
            <Param label="KEYTRK" help="Makes the cutoff follow the note you play, so high notes stay as bright as low ones." value={patch.filter.keyTrack} min={0} max={1} defaultValue={0.5} format={fmt.pct} onChange={(v) => edit((p) => void (p.filter.keyTrack = v))} />
            <Param label="DRIVE" help="Overdrives the oscillators before they hit the filter, so the resonance growls and barks instead of whistling politely." value={patch.filter.drive} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.filter.drive = v))} />
            <Param label="FM" help="Oscillator 2 wobbles the cutoff at audio speed. With a resonant filter this makes vocal growls and tearing screams." value={patch.filter.fm} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.filter.fm = v))} />
          </div>
        </section>

        <EnvModule
          title="AMP ENV"
          help="Volume over time. Attack = fade-in, Decay = drop after the hit, Sustain = level while held, Release = fade-out after you let go."
          env={patch.ampEnv}
          onChange={(k, v) => edit((p) => void (p.ampEnv[k] = v))}
        />
        <EnvModule
          title="FILTER ENV"
          help="Moves the filter cutoff over time (scaled by the filter's ENV knob). Short decay + low sustain = plucky; slow attack = swelling."
          env={patch.filterEnv}
          onChange={(k, v) => edit((p) => void (p.filterEnv[k] = v))}
        />

        <section className="module">
          <h4 {...tip('Pitch', 'Pitch movement: SWEEP bends every note in from above or below (lasers, hoovers, kick thumps); MONO + GLIDE slides one note into the next.')}>PITCH</h4>
          <div className="knobs">
            <Param label="SWEEP" help="Every note starts this many semitones away and falls (or rises) into pitch. +36 = laser zap, -12 = rave hoover swoop, +12 with a short time = punchy thump." value={patch.pitchEnv.amount} min={-48} max={48} defaultValue={0} format={fmt.st} onChange={(v) => edit((p) => void (p.pitchEnv.amount = Math.round(v)))} />
            <Param label="TIME" curve="log" help="How long the sweep takes to land on the note." value={patch.pitchEnv.decay} min={0.005} max={2} defaultValue={0.1} format={fmt.sec} onChange={(v) => edit((p) => void (p.pitchEnv.decay = v))} />
            <Param label="GLIDE" help="Portamento: time to slide from one note to the next (mono mode). Overlap two notes in the piano roll to make them slide — the acid / sliding-808 sound." value={patch.glide} min={0} max={1} defaultValue={0} format={fmt.sec} onChange={(v) => edit((p) => void (p.glide = v))} />
          </div>
          <div className="module-line">
            <button
              className={`toggle mini ${patch.mono ? 'active' : ''}`}
              onClick={() => edit((p) => void (p.mono = !p.mono))}
              {...tip('Mono', 'One note at a time. Holding a note and pressing another slides (with GLIDE) instead of retriggering — essential for acid lines, 808 slides and leads.')}
            >
              MONO
            </button>
          </div>
        </section>

        <section className="module">
          <h4 {...tip('LFO', 'A repeating wobble. Send it to pitch (VIBRATO), the filter (WAH) or the volume (GATE). SYNC locks it to the tempo; RND jumps to a random value every step for glitchy, broken-machine movement.')}>LFO</h4>
          <div className="module-line">
            <Seg
              options={LFO_SHAPES}
              labels={LFO_SHAPE_LABELS}
              value={patch.lfo.shape}
              title="LFO shape"
              help="Sine/triangle = smooth wobble. Saw = ramps that snap back (chugging bass). Square = on/off (trills, gates). RND = a new random value every cycle (glitch)."
              onChange={(shape) => edit((p) => void (p.lfo.shape = shape))}
            />
            <button
              className={`toggle mini ${patch.lfo.sync ? 'active' : ''}`}
              onClick={() => edit((p) => void (p.lfo.sync = !p.lfo.sync))}
              {...tip('Sync', 'Locks the LFO speed to the project BPM, so wobbles and gates land on the beat. The RATE knob then picks a note length.')}
            >
              SYNC
            </button>
          </div>
          <div className="knobs">
            {patch.lfo.sync ? (
              <Param label="RATE" help="LFO length in notes: 1/16 = four wobbles per beat, 1 BAR = one slow sweep per bar." value={patch.lfo.division} min={0} max={lastDivision} defaultValue={3} format={(v) => LFO_DIVISIONS[Math.round(v)]?.label ?? ''} onChange={(v) => edit((p) => void (p.lfo.division = Math.round(v)))} />
            ) : (
              <Param label="RATE" curve="log" help="LFO speed. Below 1 Hz = slow sweeps; ~5 Hz = natural vibrato; above 20 Hz it stops being a wobble and becomes a growl." value={patch.lfo.rate} min={0.05} max={100} defaultValue={5} format={fmtRate} onChange={(v) => edit((p) => void (p.lfo.rate = v))} />
            )}
            <Param label="VIBRATO" curve="sq" help="How far the LFO bends the pitch. A few cents = vibrato; a full octave or two with RND or SQR = sirens, trills and glitches." value={patch.lfo.pitch} min={0} max={2400} defaultValue={0} format={fmtVibrato} onChange={(v) => edit((p) => void (p.lfo.pitch = v))} />
            <Param label="WAH" help="How far the LFO sweeps the filter cutoff, in octaves. With SYNC this is the wobble-bass knob." value={patch.lfo.filter} min={0} max={5} defaultValue={0} format={fmt.oct} onChange={(v) => edit((p) => void (p.lfo.filter = v))} />
            <Param label="GATE" help="How deeply the LFO chops the volume. SQR + SYNC at 1/16 = a strobing trance gate; SIN = tremolo." value={patch.lfo.amp} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.lfo.amp = v))} />
          </div>
        </section>

        <section className="module destroy">
          <h4 {...tip('Destroy', 'Distortion and digital damage, after the filter. This is where a clean synth turns into a blown speaker.')}>DESTROY</h4>
          <div className="module-line">
            <Seg
              options={DRIVE_TYPES}
              labels={DRIVE_LABELS}
              value={patch.driveType}
              title="Distortion type"
              help="SOFT = warm tube-style saturation. HARD = brick-wall clipping, loud and square. FOLD = the wave folds back on itself: metallic, gnarly, gets wilder the harder you push. FUZZ = lopsided, spitting, broken-amp fuzz."
              onChange={(type) => edit((p) => void (p.driveType = type))}
            />
          </div>
          <div className="knobs">
            <Param label="DRIVE" help="How hard the sound is pushed into the distortion. Chords smear into one angry wall; single notes get louder, brighter and meaner." value={patch.drive} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.drive = v))} />
            <Param label="BITS" help="Bit-crush: throws away resolution so the sound gets grainy and gritty, like an old sampler or a game console." value={patch.crush.bits} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.crush.bits = v))} />
            <Param label="DOWNSMP" help="Sample-rate crush: adds harsh, ringing digital overtones that move against the notes you play. The 'torn speaker' screech." value={patch.crush.rate} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.crush.rate = v))} />
          </div>
        </section>

        <section className="module">
          <h4 {...tip('Effects', 'Phaser swirls the sound, PUMP ducks it on every beat, reverb and delay put it in a space.')}>FX</h4>
          <div className="knobs">
            <Param label="PHASER" help="A sweeping, swirling notch effect — the sound of French house leads and funk guitars." value={patch.phaser.mix} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.phaser.mix = v))} />
            <Param label="PH RATE" curve="log" help="How fast the phaser sweeps." value={patch.phaser.rate} min={0.05} max={8} defaultValue={0.4} format={fmtRate} onChange={(v) => edit((p) => void (p.phaser.rate = v))} />
            <Param label="PUMP" help="Ducks the volume on every beat and lets it swell back, as if sidechained to a kick drum — the breathing French-house pump. Only moves while the transport is playing." value={patch.pump} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.pump = v))} />
            <Param label="REVERB" help="Sends the sound into a big hall — the Donda church/stadium space, or a concrete warehouse." value={patch.reverb} min={0} max={1} defaultValue={0.2} format={fmt.pct} onChange={(v) => edit((p) => void (p.reverb = v))} />
            <Param label="DELAY" help="Tempo-synced echo (dotted 8th). Repeats follow the project BPM." value={patch.delay} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => edit((p) => void (p.delay = v))} />
            <Param label="VOLUME" help="Overall level of this sound." value={patch.volume} min={0} max={1} defaultValue={0.7} format={fmt.pct} onChange={(v) => edit((p) => void (p.volume = v))} />
          </div>
        </section>

        <MayhemPad patch={patch} />
      </div>

      <ChordBar />
      <PianoKeyboard />
    </div>
  )
}

interface PadAxis {
  label: string
  help: string
  /** 0..1 position of the puck for this patch. */
  read: (patch: SynthPatch) => number
  write: (patch: SynthPatch, amount: number) => void
}

const CUTOFF_RANGE = [60, 14000] as const

/** What the pad's vertical axis controls; the horizontal axis is always the filter cutoff. */
const PAD_AXES = {
  res: {
    label: 'RES',
    help: 'Up = more resonance: from smooth to squelching to screaming.',
    read: (p) => toNorm(p.filter.resonance, 0.5, 30, 'sq'),
    write: (p, n) => void (p.filter.resonance = fromNorm(n, 0.5, 30, 'sq'))
  },
  drive: {
    label: 'DRIVE',
    help: 'Up = more distortion.',
    read: (p) => p.drive,
    write: (p, n) => void (p.drive = n)
  },
  crush: {
    label: 'CRUSH',
    help: 'Up = more bit-crush and downsampling together.',
    read: (p) => p.crush.rate / 0.85,
    write: (p, n) => void (p.crush = { rate: n * 0.85, bits: n * 0.45 })
  },
  fm: {
    label: 'FM',
    help: 'Up = oscillator 2 tears into oscillator 1 harder.',
    read: (p) => p.fm,
    write: (p, n) => void (p.fm = n)
  },
  wah: {
    label: 'WAH',
    help: 'Up = the LFO sweeps the filter further.',
    read: (p) => p.lfo.filter / 5,
    write: (p, n) => void (p.lfo.filter = n * 5)
  }
} satisfies Record<string, PadAxis>

type PadAxisId = keyof typeof PAD_AXES
const PAD_AXIS_IDS = Object.keys(PAD_AXES) as PadAxisId[]
const PAD_AXIS_LABELS = Object.fromEntries(PAD_AXIS_IDS.map((id) => [id, PAD_AXES[id].label]))

/**
 * Performance pad: hold a note with one hand and drag here with the other.
 * It simply turns two knobs at once, so whatever you land on stays in the patch.
 */
function MayhemPad({ patch }: { patch: SynthPatch }) {
  const [axisId, setAxisId] = useState<PadAxisId>('res')
  const [dragging, setDragging] = useState(false)
  const surface = useRef<HTMLDivElement>(null)
  const axis: PadAxis = PAD_AXES[axisId]
  const x = toNorm(patch.filter.cutoff, ...CUTOFF_RANGE, 'log')
  const y = Math.min(1, Math.max(0, axis.read(patch)))

  const move = (e: React.PointerEvent) => {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect) return
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ny = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height))
    updatePatch((p) => {
      p.filter.cutoff = fromNorm(nx, ...CUTOFF_RANGE, 'log')
      axis.write(p, ny)
    })
  }

  return (
    <section className="module mayhem">
      <h4 {...tip('Mayhem pad', 'Hold a note (or press play) and drag around the pad. Left–right sweeps the filter cutoff; up–down controls whatever you pick below. It just turns the knobs for you, so the sound stays where you let go.')}>MAYHEM PAD</h4>
      <div
        ref={surface}
        className={`xy-pad ${dragging ? 'dragging' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          move(e)
        }}
        onPointerMove={(e) => dragging && move(e)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="xy-line x" style={{ left: `${x * 100}%` }} />
        <div className="xy-line y" style={{ top: `${(1 - y) * 100}%` }} />
        <div className="xy-puck" style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }} />
        <span className="xy-axis x">CUTOFF →</span>
        <span className="xy-axis y">{axis.label} ↑</span>
      </div>
      <Seg
        options={PAD_AXIS_IDS}
        labels={PAD_AXIS_LABELS}
        value={axisId}
        title="Pad vertical axis"
        help={`What dragging up and down controls. ${axis.help}`}
        onChange={setAxisId}
      />
    </section>
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

/**
 * Two-octave clickable keyboard. Held keys light up with their note name, so
 * playing chords doubles as learning their shapes; in NOTES mode each key also
 * shows the computer key that plays it.
 */
function PianoKeyboard() {
  const keyOctave = useStudio((s) => s.keyOctave)
  const held = useStudio((s) => s.heldNotes)
  const chords = useStudio((s) => s.keyMode === 'chords')
  const chordRoot = useStudio((s) => s.activeChord?.notes[0])
  const songKey = useStudio((s) => s.songKey)
  const songScale = useStudio((s) => s.songScale)
  const spell = noteNamer(songKey, songScale)
  const base = (keyOctave + 1) * 12
  const keyLabel = chords
    ? new Map<number, string>()
    : new Map(Object.entries(PIANO_KEYS).map(([code, semi]) => [semi, code.replace('Key', '').replace('Semicolon', ';').replace('Quote', "'")]))
  const lit = (n: number) => (held.includes(n) ? { name: chords ? spell(n) : noteName(n).replace(/-?\d+$/, ''), root: n === chordRoot } : null)
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
          <PianoKey key={n} midi={n} black={false} lit={lit(n)} label={keyLabel.get(n - base)} />
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
                lit={lit(n)}
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
  lit,
  label,
  left
}: {
  midi: number
  black: boolean
  /** Set while the note sounds: its spelled name, and whether it's the chord root. */
  lit: { name: string; root: boolean } | null
  label?: string
  left?: string
}) {
  return (
    <div
      className={`pkey ${black ? 'black' : 'white'} ${lit ? 'held' : ''} ${lit?.root ? 'root' : ''}`}
      style={left ? { left } : undefined}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        synthDown(midi)
      }}
      onPointerUp={() => synthUp(midi)}
      onPointerCancel={() => synthUp(midi)}
    >
      {lit && <span className="pkey-lit">{lit.name}</span>}
      {label && <span className="pkey-label">{label}</span>}
      {midi % 12 === 0 && <span className="pkey-note">{noteName(midi)}</span>}
    </div>
  )
}
