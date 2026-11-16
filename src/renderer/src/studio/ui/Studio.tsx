import { useEffect, useRef } from 'react'
import { Fader } from '../../components/Fader'
import { tip } from '../../components/TooltipLayer'
import {
  matchDeckBpm,
  selectTrack,
  setBpm,
  setSwing,
  setTrackMixer,
  tapTempo,
  toggleMetronome,
  togglePlay,
  toggleRecordArm
} from '../actions'
import { studio } from '../engine'
import { useStudio } from '../store'
import type { StudioTrackId } from '../types'
import { ChopEditor, NumberInput } from './ChopEditor'
import { DrumEditor } from './DrumEditor'
import { Param, fmt } from './Param'
import { Sequencer } from './Sequencer'
import { SynthEditor } from './SynthEditor'

const TRACKS: { id: StudioTrackId; label: string; icon: string; help: string }[] = [
  { id: 'drums', label: 'DRUMS', icon: '◉', help: 'Synth drum kit. Select to edit the kit and its step pattern; your keyboard plays the pads (1234 / QWER).' },
  { id: 'chops', label: 'CHOPS', icon: '✂', help: 'Sample chopper. Select to slice a song into 16 pads; your keyboard plays them (1234 / QWER / ASDF / ZXCV).' },
  { id: 'synth', label: 'SYNTH', icon: '♪', help: 'Synthesizer. Select to design the sound and write notes in the piano roll; your keyboard becomes a piano (A–; row, Z/X octave).' }
]

export function Studio() {
  return (
    <div className="studio">
      <Transport />
      <div className="studio-body">
        <TrackList />
        <div className="studio-editor">
          <Editor />
          <Sequencer />
        </div>
      </div>
    </div>
  )
}

function Editor() {
  const track = useStudio((s) => s.selectedTrack)
  if (track === 'drums') return <DrumEditor />
  if (track === 'chops') return <ChopEditor />
  return <SynthEditor />
}

/** Bar.beat.16th readout, polled from the engine. */
function Position() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!ref.current) return
      const pos = studio.ready ? studio.getStepPosition() : -1
      if (pos < 0) {
        ref.current.textContent = '1.1.1'
        return
      }
      const step = Math.floor(pos)
      ref.current.textContent = `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}.${(step % 4) + 1}`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <span className="position mono" ref={ref} {...tip('Position', 'Bar . beat . 16th note of the loop.')}>
      1.1.1
    </span>
  )
}

function Transport() {
  const playing = useStudio((s) => s.playing)
  const recordArm = useStudio((s) => s.recordArm)
  const bpm = useStudio((s) => s.bpm)
  const swing = useStudio((s) => s.swing)
  const metronome = useStudio((s) => s.metronome)

  return (
    <div className="transport-bar">
      <button
        className={`big-btn play ${playing ? 'playing' : ''}`}
        onClick={togglePlay}
        {...tip('Play / stop', 'Starts the loop from the top. Shortcut: Space.')}
      >
        {playing ? '■' : '▶'}
      </button>
      <button
        className={`toggle record ${recordArm ? 'active' : ''}`}
        onClick={toggleRecordArm}
        {...tip('Record', 'While the loop plays, anything you play on the keyboard or pads gets written into the pattern, snapped to the nearest 16th note. Press again to stop recording (the loop keeps playing).')}
      >
        ● REC
      </button>
      <Position />
      <div className="field" {...tip('Project tempo', 'Beats per minute for the whole studio: the sequencer, the delay echoes, and chops when FIT BPM is on.')}>
        <label>BPM</label>
        <NumberInput value={bpm} step={0.5} min={40} max={240} onChange={setBpm} />
        <button className="mini-btn" onClick={tapTempo} {...tip('Tap tempo', 'Tap along to the beat 4+ times to set the BPM.')}>
          TAP
        </button>
        <button className="mini-btn" onClick={() => matchDeckBpm(0)} {...tip('Match deck A', 'Set the project BPM to whatever deck A is playing at — handy for jamming over a song.')}>
          =A
        </button>
        <button className="mini-btn" onClick={() => matchDeckBpm(1)} {...tip('Match deck B', 'Set the project BPM to deck B’s current tempo.')}>
          =B
        </button>
      </div>
      <Param
        label="SWING"
        help="Delays every other 16th note for a shuffled, human groove. 0 = straight/robotic, ~20–35% = J Dilla/neo-soul bounce."
        value={swing}
        min={0}
        max={0.6}
        defaultValue={0}
        format={fmt.pct}
        onChange={setSwing}
        size={28}
      />
      <button
        className={`toggle ${metronome ? 'active' : ''}`}
        onClick={toggleMetronome}
        {...tip('Metronome', 'A click on every beat (higher on beat 1) to help you play in time.')}
      >
        CLICK
      </button>
      <span className="spacer" />
      <span className="kbd-hint" {...tip('Keyboard', 'Space = play/stop · Tab = switch track · the selected track decides what your keys play.')}>
        ⌨ Space · Tab
      </span>
    </div>
  )
}

function TrackList() {
  const selected = useStudio((s) => s.selectedTrack)
  const mixer = useStudio((s) => s.mixer)
  return (
    <div className="track-list">
      {TRACKS.map((t) => (
        <div
          key={t.id}
          className={`track-head ${selected === t.id ? 'selected' : ''} ${mixer[t.id].mute ? 'muted' : ''}`}
          onClick={() => selectTrack(t.id)}
          {...tip(t.label, t.help)}
        >
          <div className="track-title">
            <span className="track-icon">{t.icon}</span>
            {t.label}
            <button
              className={`mute-btn ${mixer[t.id].mute ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setTrackMixer(t.id, { mute: !mixer[t.id].mute })
              }}
              {...tip('Mute', `Silence the ${t.label.toLowerCase()} track.`)}
            >
              M
            </button>
          </div>
          <div onClick={(e) => e.stopPropagation()} {...tip('Volume', `Level of the ${t.label.toLowerCase()} track in the mix.`)}>
            <Fader
              orientation="horizontal"
              length={120}
              min={0}
              max={1}
              value={mixer[t.id].volume}
              onChange={(v) => setTrackMixer(t.id, { volume: v })}
              className="mini"
            />
          </div>
        </div>
      ))}
      <p className="track-foot">
        Studio audio goes through the master, so <b>● REC MIX</b> records it — and you can jam it over the decks.
      </p>
    </div>
  )
}
