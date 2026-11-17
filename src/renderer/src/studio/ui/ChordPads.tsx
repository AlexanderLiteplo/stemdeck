import { useEffect, useRef, useState } from 'react'
import { tip } from '../../components/TooltipLayer'
import { chordDown, chordUp, matchDeckKey, setKeyMode, setSongKey, updatePatch } from '../actions'
import {
  CHORD_KEY_LABELS,
  KEY_NAMES,
  chordName,
  chordNumeral,
  chordPads,
  noteNamer,
  type SongScale
} from '../chords'
import { useStudio } from '../store'
import { chordDropTarget, useChordDrag } from './chordDrag'
import { Seg } from './Param'

/** True while either Shift key is down, so pads can preview their 7th versions. */
function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const update = (e: KeyboardEvent) => setHeld(e.shiftKey)
    const clear = () => setHeld(false)
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', update)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', update)
      window.removeEventListener('blur', clear)
    }
  }, [])
  return held
}

/** NOTES / CHORDS switch, song key, and — in chord mode — the nine chord pads. */
export function ChordBar() {
  const keyMode = useStudio((s) => s.keyMode)
  const songKey = useStudio((s) => s.songKey)
  const songScale = useStudio((s) => s.songScale)
  const mono = useStudio((s) => s.patch.mono)
  const active = useStudio((s) => s.activeChord)
  const shift = useShiftHeld()
  const dragging = useChordDrag((s) => s.drag)
  /** Where the current pad press started, to tell a tap from a drag. */
  const press = useRef<{ pad: number; x: number; y: number } | null>(null)
  const chords = keyMode === 'chords'
  const pads = chordPads(songScale)
  const spell = noteNamer(songKey, songScale)

  return (
    <div className={`chord-bar ${chords ? 'on' : ''}`}>
      <div className="chord-controls">
        <Seg
          options={['notes', 'chords'] as const}
          labels={{ notes: 'NOTES', chords: 'CHORDS' }}
          value={keyMode}
          title="Key mode (C)"
          help="NOTES: your keyboard is a piano, one note per key. CHORDS: A–L each play a whole chord that fits the song's key, so anything you press sounds right. Press C to switch."
          onChange={setKeyMode}
        />
        <div className="field" {...tip('Song key', 'The key your chords are built from. Match it to the track you are jamming over with =A / =B.')}>
          <label>KEY</label>
          <select
            className="mini-select"
            value={songKey}
            onChange={(e) => setSongKey(Number(e.target.value), songScale)}
          >
            {KEY_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <Seg
            options={['major', 'minor'] as const}
            labels={{ major: 'MAJ', minor: 'MIN' }}
            value={songScale}
            title="Major or minor"
            help="Major = bright and happy. Minor = dark and moody (most trap, drill and R&B)."
            onChange={(s: SongScale) => setSongKey(songKey, s)}
          />
          <button className="mini-btn" onClick={() => matchDeckKey(0)} {...tip('Match deck A', 'Use the key detected for the song on deck A, so your chords fit it.')}>
            =A
          </button>
          <button className="mini-btn" onClick={() => matchDeckKey(1)} {...tip('Match deck B', 'Use the key detected for the song on deck B.')}>
            =B
          </button>
        </div>
        {chords && mono && (
          <button
            className="mini-btn warn"
            onClick={() => updatePatch((p) => void (p.mono = false))}
            {...tip('Mono is on', 'This patch plays one note at a time, so chords collapse to a single note. Click to turn MONO off.')}
          >
            MONO ON · FIX
          </button>
        )}
        {chords && <ChordReadout />}
      </div>

      {chords && (
        <div className="chord-pads">
          {pads.map((pad, i) => {
            const seventh = dragging?.pad === i ? dragging.seventh : active?.pad === i ? active.seventh : shift
            const color = i >= 7
            return (
              <button
                key={i}
                className={`chord-pad ${active?.pad === i || dragging?.pad === i ? 'active' : ''} ${color ? 'color' : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.currentTarget.setPointerCapture(e.pointerId)
                  press.current = { pad: i, x: e.clientX, y: e.clientY }
                  chordDown(i, e.shiftKey)
                }}
                onPointerMove={(e) => {
                  const p = press.current
                  if (!p || p.pad !== i) return
                  if (!useChordDrag.getState().drag) {
                    // A few pixels of travel turns the tap into a drag: stop the sound, pick up the chord.
                    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return
                    chordUp(i)
                  }
                  useChordDrag.setState({
                    drag: { pad: i, seventh: e.shiftKey, x: e.clientX, y: e.clientY, fine: e.altKey }
                  })
                }}
                onPointerUp={() => {
                  press.current = null
                  const drag = useChordDrag.getState().drag
                  if (drag) {
                    useChordDrag.setState({ drag: null })
                    chordDropTarget.drop?.(drag)
                  } else chordUp(i)
                }}
                onPointerCancel={() => {
                  press.current = null
                  useChordDrag.setState({ drag: null })
                  chordUp(i)
                }}
                {...tip(
                  `${chordName(pad, songKey, songScale, seventh)}  ·  ${chordNumeral(pad, seventh)}${color ? '  ·  borrowed' : ''}`,
                  `${pad.feel} Hold Shift for the 7th chord (${chordName(pad, songKey, songScale, true)}): richer, jazzier. Drag it onto the piano roll to write it into the loop.`
                )}
              >
                <span className="cp-key">{CHORD_KEY_LABELS[i]}</span>
                <span className="cp-name">{chordName(pad, songKey, songScale, seventh)}</span>
                <span className="cp-num">{chordNumeral(pad, seventh)}</span>
              </button>
            )
          })}
          <span className="chord-hint">
            Hold <b>Shift</b> for 7ths · <b>Drag</b> a pad onto the piano roll to write it in · <b>{spell(songKey)}</b>{' '}
            {songScale} · K L = borrowed
          </span>
        </div>
      )}
      {dragging && (
        <div className="chord-drag-chip" style={{ left: dragging.x, top: dragging.y }}>
          {chordName(pads[dragging.pad], songKey, songScale, dragging.seventh)}
        </div>
      )}
    </div>
  )
}

/** Name, numeral and spelled-out notes of the chord being held. */
function ChordReadout() {
  const active = useStudio((s) => s.activeChord)
  const songKey = useStudio((s) => s.songKey)
  const songScale = useStudio((s) => s.songScale)
  if (!active) {
    return <span className="chord-readout idle">Hold a chord key. Its notes light up on the piano.</span>
  }
  const pad = chordPads(songScale)[active.pad]
  const spell = noteNamer(songKey, songScale)
  return (
    <span className="chord-readout">
      <b className="cr-name">{chordName(pad, songKey, songScale, active.seventh)}</b>
      <span className="cr-num">{chordNumeral(pad, active.seventh)}</span>
      <span className="cr-notes">{active.notes.map((n) => spell(n)).join(' · ')}</span>
    </span>
  )
}
