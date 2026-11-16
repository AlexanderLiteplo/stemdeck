import { tip } from '../../components/TooltipLayer'
import { PAD_KEY_LABELS } from '../../keyboard'
import {
  deleteUserKit,
  factoryKits,
  hitDrum,
  loadKit,
  saveUserKit,
  updateDrumVoice
} from '../actions'
import { useStudio } from '../store'
import { DRUM_VOICES, type DrumVoiceId } from '../types'
import { Param, PresetBar, fmt } from './Param'
import { usePadFlash } from './usePadFlash'

export const DRUM_INFO: Record<DrumVoiceId, { label: string; help: string }> = {
  kick: { label: 'KICK', help: 'The thump on the downbeat. A sine wave that drops fast in pitch, plus a click for attack.' },
  snare: { label: 'SNARE', help: 'The backbeat crack: a tuned body plus a burst of bright noise (the snares).' },
  clap: { label: 'CLAP', help: 'Several noise bursts a few ms apart — sounds like a crowd of hands. Huge with reverb.' },
  hat: { label: 'HAT', help: 'Closed hi-hat: short metallic tick that drives the groove. Also chokes (cuts off) the open hat.' },
  openhat: { label: 'OPEN HAT', help: 'Open hi-hat: longer, washier metal. A closed hat cuts it off, like a real drummer closing the pedal.' },
  perc: { label: 'PERC', help: 'Rim/woodblock ping for fills and off-beat accents.' },
  crash: { label: 'CRASH', help: 'Long cymbal wash — marks the start of a new section.' },
  bass808: { label: '808', help: 'The long, booming sub bass hit. Tune it to the song’s key; add drive so it’s heard on small speakers. For melodic sliding 808s use the “Off The Grid 808” synth preset.' }
}

export function DrumEditor() {
  const kit = useStudio((s) => s.kit)
  const userKits = useStudio((s) => s.userKits)
  const selected = useStudio((s) => s.selectedDrum)
  const voice = kit.voices[selected]
  const flashRef = usePadFlash(DRUM_VOICES.map((v) => `drum:${v}`))

  return (
    <div className="instrument drum-editor">
      <div className="instrument-head">
        <span className="instrument-name" {...tip('Drum kit', 'Eight synthesized drums. Click a pad (or hit 1-2-3-4 / Q-W-E-R) to play it and select it for editing. Shape each sound with the knobs on the right, then save it as your own kit.')}>
          DRUMS
        </span>
        <PresetBar
          kind="Kit"
          factory={factoryKits}
          user={userKits}
          current={kit}
          onLoad={loadKit}
          onSave={saveUserKit}
          onDelete={deleteUserKit}
        />
      </div>
      <div className="drum-body">
        <div className="pad-grid cols-4">
          {DRUM_VOICES.map((id, i) => (
            <button
              key={id}
              ref={flashRef(i)}
              className={`pad-big ${selected === id ? 'selected' : ''}`}
              onPointerDown={(e) => hitDrum(id, e.shiftKey ? 0.55 : 1)}
              {...tip(DRUM_INFO[id].label, `${DRUM_INFO[id].help} Key: ${PAD_KEY_LABELS[i]} (Shift = soft hit).`)}
            >
              <span className="pad-key">{PAD_KEY_LABELS[i]}</span>
              {DRUM_INFO[id].label}
            </button>
          ))}
        </div>
        <section className="module">
          <h4 {...tip(DRUM_INFO[selected].label, DRUM_INFO[selected].help)}>{DRUM_INFO[selected].label}</h4>
          <div className="knobs">
            <Param label="TUNE" help="Pitch in semitones. Lower = deeper and longer-feeling; higher = tighter and snappier. Tune the 808 to your song’s key." value={voice.tune} min={-24} max={24} defaultValue={0} format={fmt.st} onChange={(v) => updateDrumVoice(selected, { tune: Math.round(v) })} />
            <Param label="DECAY" curve="log" help="How long the hit rings. ×1 is the natural length; long 808s go ×2–×4." value={voice.decay} min={0.1} max={4} defaultValue={1} format={fmt.x} onChange={(v) => updateDrumVoice(selected, { decay: v })} />
            <Param label="TONE" help="Brightness — more click/sizzle on the right, darker and softer on the left." value={voice.tone} min={0} max={1} defaultValue={0.5} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { tone: v })} />
            <Param label="DRIVE" help="Distortion. Adds harmonics so kicks punch and 808s cut through on small speakers." value={voice.drive} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { drive: v })} />
            <Param label="REVERB" help="How much of this drum goes into the big room. Donda claps live here." value={voice.reverb} min={0} max={1} defaultValue={0.1} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { reverb: v })} />
            <Param label="LEVEL" help="Volume of this drum in the kit." value={voice.level} min={0} max={1} defaultValue={0.8} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { level: v })} />
          </div>
        </section>
      </div>
    </div>
  )
}
