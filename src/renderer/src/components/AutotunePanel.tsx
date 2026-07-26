import { useEffect, useState } from 'react'
import { deckPitch, setAutotune } from '../controller'
import { useStore } from '../state/store'
import { Knob } from './Knob'

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
/** Retune presets: instant is the hard-tuned sound, softer glides between notes. */
const SPEEDS = [
  { label: 'HARD', ms: 0, title: 'Instant snap — the classic hard-tuned effect' },
  { label: 'TIGHT', ms: 25, title: 'Fast but audible glide' },
  { label: 'SOFT', ms: 90, title: 'Gentle correction that keeps the natural performance' }
]

function noteName(hz: number): string {
  if (hz <= 0) return '—'
  const midi = Math.round(69 + 12 * Math.log2(hz / 440))
  return `${NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/** Polled outside React state — pitch updates far faster than a sane render rate. */
function PitchReadout({ deckIndex }: { deckIndex: number }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 120)
    return () => clearInterval(id)
  }, [])
  const { detected, target } = deckPitch[deckIndex]
  return (
    <span className="autotune-readout" title="Detected pitch → corrected pitch">
      {noteName(detected)}
      <span className="dim"> ▸ </span>
      {noteName(target)}
    </span>
  )
}

export function AutotunePanel({ deckIndex }: { deckIndex: number }) {
  const autotune = useStore((s) => s.decks[deckIndex].autotune)
  const usingStems = useStore((s) => s.decks[deckIndex].usingStems)

  return (
    <div className={`autotune-row ${autotune.enabled ? 'on' : ''}`}>
      <button
        className={`toggle ${autotune.enabled ? 'active' : ''}`}
        disabled={!usingStems}
        onClick={() => setAutotune(deckIndex, { enabled: !autotune.enabled })}
        title={
          usingStems
            ? 'Pitch-correct the vocal stem'
            : 'Split this track into stems first — autotune runs on the vocal stem'
        }
      >
        AUTOTUNE
      </button>

      <select
        className="mini-select"
        value={autotune.key}
        disabled={!usingStems}
        onChange={(e) => setAutotune(deckIndex, { key: Number(e.target.value) })}
        title="Key to snap to"
      >
        {NOTES.map((note, i) => (
          <option key={note} value={i}>
            {note}
          </option>
        ))}
      </select>

      <select
        className="mini-select"
        value={autotune.scale}
        disabled={!usingStems}
        onChange={(e) =>
          setAutotune(deckIndex, { scale: e.target.value as typeof autotune.scale })
        }
        title="Scale — chromatic snaps to any semitone"
      >
        <option value="chromatic">CHROM</option>
        <option value="major">MAJOR</option>
        <option value="minor">MINOR</option>
      </select>

      <span className="speed-picker">
        {SPEEDS.map((speed) => (
          <button
            key={speed.label}
            className={`mini-btn ${autotune.retuneMs === speed.ms ? 'active' : ''}`}
            disabled={!usingStems}
            onClick={() => setAutotune(deckIndex, { retuneMs: speed.ms })}
            title={speed.title}
          >
            {speed.label}
          </button>
        ))}
      </span>

      <button
        className={`mini-btn ${autotune.formant ? 'active' : ''}`}
        disabled={!usingStems}
        onClick={() => setAutotune(deckIndex, { formant: !autotune.formant })}
        title="Formant correction — keeps the singer's character instead of going chipmunky. Turn off for a more synthetic sound."
      >
        FRMNT
      </button>

      <Knob
        label="AMT"
        size={30}
        min={0}
        max={1}
        defaultValue={1}
        value={autotune.strength}
        onChange={(v) => setAutotune(deckIndex, { strength: v })}
      />
      <Knob
        label="MIX"
        size={30}
        min={0}
        max={1}
        defaultValue={1}
        value={autotune.mix}
        onChange={(v) => setAutotune(deckIndex, { mix: v })}
      />
      {autotune.enabled && usingStems && <PitchReadout deckIndex={deckIndex} />}
    </div>
  )
}
