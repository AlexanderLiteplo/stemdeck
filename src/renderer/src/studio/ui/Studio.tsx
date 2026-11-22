import { useEffect, useRef } from 'react'
import { tip } from '../../components/TooltipLayer'
import {
  editorPosition,
  matchDeckBpm,
  redo,
  setBpm,
  setFocus,
  setMode,
  setSwing,
  tapTempo,
  toggleCycle,
  toggleMetronome,
  togglePlay,
  toggleRecordArm,
  transportPosition,
  undo
} from '../actions'
import { useHistory } from '../history'
import { selTrack, useStudio } from '../store'
import { Arrangement } from './Arrangement'
import { ChopEditor, NumberInput } from './ChopEditor'
import { DrumEditor } from './DrumEditor'
import { Param, Seg, fmt } from './Param'
import { Sequencer } from './Sequencer'
import { SynthEditor } from './SynthEditor'

export function Studio() {
  return (
    <div className="studio">
      <Transport />
      <Arrangement />
      <div className="studio-editor" onPointerDownCapture={() => setFocus('editor')}>
        <Editor />
        <Sequencer />
      </div>
    </div>
  )
}

function Editor() {
  const kind = useStudio((s) => selTrack(s).kind)
  if (kind === 'drums') return <DrumEditor />
  if (kind === 'chops') return <ChopEditor />
  return <SynthEditor />
}

const barBeat = (step: number) =>
  `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}.${(step % 4) + 1}`

/** Bar.beat.16th readout: position in the song (SONG mode) or in the open pattern (LOOP mode). */
function Position() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!ref.current) return
      const { mode, songPos } = useStudio.getState()
      const live = mode === 'song' ? transportPosition() : editorPosition()
      const text = barBeat(Math.floor(live >= 0 ? live : mode === 'song' ? songPos : 0))
      if (ref.current.textContent !== text) ref.current.textContent = text
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <span className="position mono" ref={ref} {...tip('Position', 'Bar . beat . 16th note — of the song in SONG mode, of the open pattern in LOOP mode.')}>
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
  const mode = useStudio((s) => s.mode)
  const cycleOn = useStudio((s) => s.cycleOn)
  const history = useHistory()

  return (
    <div className="transport-bar">
      <button
        className={`big-btn play ${playing ? 'playing' : ''}`}
        onClick={togglePlay}
        {...tip('Play / stop', 'LOOP mode repeats the patterns open in each track. SONG mode plays the timeline from the playhead. Shortcut: Space.')}
      >
        {playing ? '■' : '▶'}
      </button>
      <Seg
        options={['loop', 'song'] as const}
        labels={{ loop: '⟳ LOOP', song: '▶ SONG' }}
        value={mode}
        title="Play mode"
        help="LOOP: every track repeats the pattern open in its editor — for writing a beat. SONG: plays the clips on the timeline in order — for arranging the beat into a full track."
        onChange={setMode}
      />
      <button
        className={`toggle ${cycleOn ? 'active' : ''}`}
        onClick={toggleCycle}
        {...tip('Cycle', 'SONG mode: keep repeating one stretch of the song (the yellow strip in the ruler) while you work on it. Drag across the ruler to choose the stretch.')}
      >
        CYCLE
      </button>
      <button
        className={`toggle record ${recordArm ? 'active' : ''}`}
        onClick={toggleRecordArm}
        {...tip('Record', 'While it plays, anything you play on the keyboard or pads gets written into the open pattern, snapped to the nearest 16th note. Press again to stop recording (playback keeps going).')}
      >
        ● REC
      </button>
      <Position />
      <div className="field" {...tip('Project tempo', 'One tempo for everything in the studio: every track and clip in the song, the delay echoes, synced LFOs, and chops when FIT BPM is on.')}>
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
      <button className="mini-btn" disabled={history.undo === 0} onClick={undo} {...tip('Undo · ⌘Z', 'Takes back your last change to the song: notes, steps, clips, knobs, tracks, tempo. Up to 100 steps back.')}>
        ↶ UNDO
      </button>
      <button className="mini-btn" disabled={history.redo === 0} onClick={redo} {...tip('Redo · ⇧⌘Z', 'Puts back what you just undid.')}>
        ↷ REDO
      </button>
      <span
        className="kbd-hint"
        {...tip(
          'Keyboard shortcuts',
          'Space play/stop · Tab next track · Home playhead to bar 1 · ⌘Z undo · ⇧⌘Z redo. Timeline (click it first): ⌘C copy · ⌘X cut · ⌘V paste at playhead · ⌘D duplicate · ⌘T split at playhead · ⌘A select all · ⌫ delete · ← → nudge. Piano roll (click it first): ⌘C / ⌘X / ⌘V / ⌘D for notes · ⌘A select all · arrows nudge · ⌫ delete. Letter keys play the selected track.'
        )}
      >
        ⌨ SHORTCUTS
      </span>
    </div>
  )
}
