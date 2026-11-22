import { useState } from 'react'
import { tip } from '../../components/TooltipLayer'
import { PAD_KEY_LABELS } from '../../keyboard'
import { useStore } from '../../state/store'
import {
  clearDrumSample,
  deleteUserKit,
  factoryKits,
  hitDrum,
  loadDrumSample,
  loadKit,
  pickDrumSample,
  saveUserKit,
  updateDrumVoice,
  updateKitBus
} from '../actions'
import { useStudio } from '../store'
import { DRUM_MODELS, DRUM_VOICES, type DrumModel, type DrumVoiceId } from '../types'
import { Param, PresetBar, Seg, fmt } from './Param'
import { usePadFlash } from './usePadFlash'

export const DRUM_INFO: Record<DrumVoiceId, { label: string; help: string }> = {
  kick: { label: 'KICK', help: 'The thump on the downbeat.' },
  snare: { label: 'SNARE', help: 'The backbeat crack on beats 2 and 4 (or 3, in half-time styles like trap).' },
  clap: { label: 'CLAP', help: 'Layer it with the snare, or use it instead. Huge with reverb.' },
  hat: { label: 'HAT', help: 'Closed hi-hat: the short tick that drives the groove. It cuts off (chokes) the open hat, like a drummer closing the pedal. Right-click a hat step for trap rolls.' },
  openhat: { label: 'OPEN HAT', help: 'Open hi-hat: longer, washier metal. A closed hat cuts it off.' },
  perc: { label: 'PERC', help: 'Rim, cowbell, conga or tom — for fills and off-beat accents.' },
  crash: { label: 'CYMBAL', help: 'Crash marks the start of a section; ride keeps time on top.' },
  bass808: { label: '808', help: 'The long, booming sub bass hit. Tune it to the song’s key; add drive so it’s heard on small speakers. For melodic sliding 808s use the “Off The Grid 808” synth preset.' }
}

const MODEL_INFO: Record<DrumModel, { label: string; help: string }> = {
  '808': { label: '808', help: 'Roland TR-808: deep, round, electronic.' },
  '909': { label: '909', help: 'Roland TR-909: punchier, brighter, noisier.' },
  boom: { label: 'BOOM', help: 'Round, warm, short kick with a soft beater — 90s boom bap.' },
  rumble: { label: 'RUMBLE', help: 'Punchy kick with a distorted sub tail — warehouse techno.' },
  crack: { label: 'CRACK', help: 'Tight, bright and snappy — breakbeats, drill, trap.' },
  fat: { label: 'FAT', help: 'Thick body and grit, like a sampled vinyl snare — boom bap, rock.' },
  big: { label: 'BIG', help: 'More hands and a room around them — a wide, stacked clap.' },
  shaker: { label: 'SHAKER', help: 'A soft shaker / tambourine instead of metal hats.' },
  rim: { label: 'RIM', help: 'Rimshot: a short woody click.' },
  cowbell: { label: 'COWBELL', help: 'The 808 cowbell.' },
  conga: { label: 'CONGA', help: 'A tuned hand drum — great for rolls and fills.' },
  tom: { label: 'TOM', help: 'A deep tom for fills and techno grooves.' },
  crash: { label: 'CRASH', help: 'A long cymbal wash.' },
  ride: { label: 'RIDE', help: 'A pingy ride bell for steady eighths.' },
  clean: { label: 'CLEAN', help: 'A pure, booming sine 808.' },
  dirty: { label: 'DIRTY', help: 'A distorted, buzzy 808 that cuts through on phone speakers.' }
}

const TRACK_DND = 'text/stemdeck-track'

/** Where a drop on a pad points: a file from Finder, or a track dragged from the library. */
function droppedPath(e: React.DragEvent): string | null {
  const file = e.dataTransfer.files[0]
  if (file) return window.stemdeck.getPathForFile(file)
  const trackId = e.dataTransfer.getData(TRACK_DND)
  return useStore.getState().library.find((t) => t.id === trackId)?.path ?? null
}

const acceptsDrop = (e: React.DragEvent) =>
  e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(TRACK_DND)

export function DrumEditor() {
  const kit = useStudio((s) => s.kit)
  const userKits = useStudio((s) => s.userKits)
  const selected = useStudio((s) => s.selectedDrum)
  const voice = kit.voices[selected]
  const flashRef = usePadFlash(DRUM_VOICES.map((v) => `drum:${v}`))
  const [dropTarget, setDropTarget] = useState<DrumVoiceId | null>(null)
  const sampled = voice.sample !== null
  const label = DRUM_INFO[selected].label

  return (
    <div className="instrument drum-editor">
      <div className="instrument-head">
        <span className="instrument-name" {...tip('Drum kit', 'Eight drums. Click a pad (or hit 1-2-3-4 / Q-W-E-R) to play it and pick it for editing. Choose its style (808, 909…), shape it with the knobs, or drop your own sample on it. PUNCH, CRUNCH and ROOM work on the whole kit.')}>
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
        <span className="drum-hint">Drop any WAV / MP3 on a pad to use your own sound</span>
      </div>
      <div className="drum-body">
        <div className="pad-grid cols-4">
          {DRUM_VOICES.map((id, i) => {
            const v = kit.voices[id]
            return (
              <button
                key={id}
                ref={flashRef(i)}
                className={`pad-big ${selected === id ? 'selected' : ''} ${dropTarget === id ? 'drop-over' : ''} ${v.sample ? 'sampled' : ''}`}
                onPointerDown={(e) => hitDrum(id, e.shiftKey ? 0.55 : 1)}
                onDragOver={(e) => {
                  if (!acceptsDrop(e)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  if (dropTarget !== id) setDropTarget(id)
                }}
                onDragLeave={() => setDropTarget((t) => (t === id ? null : t))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDropTarget(null)
                  const path = droppedPath(e)
                  if (path) void loadDrumSample(id, path)
                }}
                {...tip(DRUM_INFO[id].label, `${DRUM_INFO[id].help} Key: ${PAD_KEY_LABELS[i]} (Shift = soft hit). Drop a sound file here to use your own sample.`)}
              >
                <span className="pad-key">{PAD_KEY_LABELS[i]}</span>
                {DRUM_INFO[id].label}
                <span className="pad-sound">{v.sample ? `♫ ${v.sample.name}` : MODEL_INFO[v.model].label}</span>
              </button>
            )
          })}
        </div>

        <section className="module drum-voice">
          <h4 {...tip(label, DRUM_INFO[selected].help)}>{label}</h4>
          <div className={`module-line ${sampled ? 'dimmed' : ''}`}>
            <Seg
              options={DRUM_MODELS[selected] as readonly DrumModel[]}
              labels={Object.fromEntries(DRUM_MODELS[selected].map((m) => [m, MODEL_INFO[m].label]))}
              value={voice.model}
              title={`${label} style`}
              help={`${sampled ? 'A sample is loaded, so it plays instead of these. ' : ''}${DRUM_MODELS[selected].map((m) => `${MODEL_INFO[m].label}: ${MODEL_INFO[m].help}`).join(' ')}`}
              onChange={(model) => {
                updateDrumVoice(selected, { model, sample: null })
                hitDrum(selected, 0.9)
              }}
            />
          </div>
          <div className="knobs">
            <Param label="TUNE" help={sampled ? 'Pitch in semitones — the sample plays faster and higher, or slower and lower.' : 'Pitch in semitones. Lower = deeper; higher = tighter and snappier. Tune the 808 to your song’s key.'} value={voice.tune} min={-24} max={24} defaultValue={0} format={fmt.st} onChange={(v) => updateDrumVoice(selected, { tune: Math.round(v) })} />
            <Param label="DECAY" curve="log" help={sampled ? 'Shortens the sample (×1 plays all of it).' : 'How long the hit rings. ×1 is the natural length; long 808s go ×2–×4.'} value={voice.decay} min={0.1} max={4} defaultValue={1} format={fmt.x} onChange={(v) => updateDrumVoice(selected, { decay: v })} />
            <Param label="TONE" help={sampled ? 'Brightness: left darkens the sample, right adds air; 50 % leaves it as recorded.' : 'Brightness: more click and sizzle to the right, darker and softer to the left.'} value={voice.tone} min={0} max={1} defaultValue={0.5} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { tone: v })} />
            <Param label="DRIVE" help="Distortion. Adds harmonics so kicks punch and 808s cut through on small speakers." value={voice.drive} min={0} max={1} defaultValue={0} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { drive: v })} />
            <Param label="PAN" help="Left / right. Spread hats and percussion a little apart from the kick and snare (which stay centered) to make the kit wider." value={voice.pan} min={-1} max={1} defaultValue={0} format={(v) => (Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`)} onChange={(v) => updateDrumVoice(selected, { pan: v })} />
            <Param label="REVERB" help="How much of this drum goes into the big hall. Claps and snares live here; keep kicks dry." value={voice.reverb} min={0} max={1} defaultValue={0.05} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { reverb: v })} />
            <Param label="LEVEL" help="Volume of this drum in the kit." value={voice.level} min={0} max={1} defaultValue={0.8} format={fmt.pct} onChange={(v) => updateDrumVoice(selected, { level: v })} />
          </div>
          <div className="sample-line">
            {voice.sample ? (
              <>
                <span className="sample-name" {...tip('Sample', voice.sample.path)}>♫ {voice.sample.name}</span>
                <button className="mini-btn" onClick={() => void pickDrumSample(selected)}>REPLACE</button>
                <button className="mini-btn" onClick={() => clearDrumSample(selected)} {...tip('Use the built-in sound', 'Removes the sample from this pad; it goes back to its built-in drum with the settings it had before.')}>
                  ✕ BUILT-IN
                </button>
              </>
            ) : (
              <>
                <span className="sample-empty">Built-in sound</span>
                <button
                  className="mini-btn"
                  onClick={() => void pickDrumSample(selected)}
                  {...tip('Load a sample', 'Use any sound file (a one-shot kick, snare, vocal chop…) on this pad instead of the built-in drum. You can also drag a file from Finder, or a track from your library, straight onto a pad.')}
                >
                  LOAD SAMPLE…
                </button>
              </>
            )}
          </div>
        </section>

        <section className="module">
          <h4 {...tip('Whole kit', 'Mix processing on all the drums together — the difference between separate sounds and a kit that hits as one.')}>KIT</h4>
          <div className="knobs">
            <Param label="PUNCH" help="Compression on the whole kit: glues the drums together and makes every hit jump out. Most beats want 40–70 %." value={kit.punch} min={0} max={1} defaultValue={0.4} format={fmt.pct} onChange={(v) => updateKitBus({ punch: v })} />
            <Param label="CRUNCH" help="Tape / console saturation on the whole kit: warmth at low settings, grit and dirt at high ones." value={kit.crunch} min={0} max={1} defaultValue={0.15} format={fmt.pct} onChange={(v) => updateKitBus({ crunch: v })} />
            <Param label="ROOM" help="A small room around the kit, so it sounds played in a space instead of pasted on top. Separate from each drum’s big REVERB." value={kit.room} min={0} max={1} defaultValue={0.12} format={fmt.pct} onChange={(v) => updateKitBus({ room: v })} />
          </div>
          <p className="kit-tip">Tip: try a GROOVE (above the step grid) to start from a pattern that already works.</p>
        </section>
      </div>
    </div>
  )
}
