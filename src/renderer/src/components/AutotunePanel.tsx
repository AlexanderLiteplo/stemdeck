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
/**
 * Fewer notes force bigger, more obviously audible jumps. Chromatic barely
 * moves an already-tuned vocal, so it is offered last rather than as a default.
 */
const SCALES = [
  { value: 'minorPentatonic', label: 'MIN PENT', title: '5 notes — biggest jumps, the classic hip-hop sound' },
  { value: 'majorPentatonic', label: 'MAJ PENT', title: '5 notes, brighter' },
  { value: 'minor', label: 'MINOR', title: '7 notes' },
  { value: 'major', label: 'MAJOR', title: '7 notes' },
  { value: 'chromatic', label: 'CHROM', title: 'All 12 notes — subtlest, barely audible on a tuned vocal' }
] as const

function noteName(hz: number): string {
  if (hz <= 0) return '—'
  const midi = Math.round(69 + 12 * Math.log2(hz / 440))
  return `${NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/**
 * Live readout of how far the pitch is actually being moved. Polled outside
 * React state, which updates far faster than a sane render rate.
 */
function PitchReadout({ deckIndex }: { deckIndex: number }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 120)
    return () => clearInterval(id)
  }, [])
  const { detected, target } = deckPitch[deckIndex]
  const cents = detected > 0 && target > 0 ? 1200 * Math.log2(target / detected) : 0
  // Full bar at a semitone in either direction.
  const width = Math.min(100, (Math.abs(cents) / 100) * 100)
  return (
    <span className="autotune-readout" title="Detected pitch → corrected pitch, and how far it moved">
      <span className="autotune-notes">
        {noteName(detected)}
        <span className="dim"> ▸ </span>
        {noteName(target)}
      </span>
      <span className="cents-meter">
        <span
          className={`cents-fill ${cents < 0 ? 'down' : 'up'}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="cents-value">
        {detected > 0 ? `${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢` : '—'}
      </span>
    </span>
  )
}

export function AutotunePanel({ deckIndex }: { deckIndex: number }) {
  const autotune = useStore((s) => s.decks[deckIndex].autotune)
  const usingStems = useStore((s) => s.decks[deckIndex].usingStems)
  const trackId = useStore((s) => s.decks[deckIndex].trackId)
  const track = useStore((s) => s.library.find((t) => t.id === trackId))
  const detectedKey =
    track?.musicalKey != null && track.musicalScale
      ? `${NOTES[track.musicalKey]} ${track.musicalScale === 'minor' ? 'min' : 'maj'}`
      : null

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
        title={
          detectedKey
            ? `Key to snap to — detected ${detectedKey} for this track`
            : 'Key to snap to'
        }
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
        title="Scale — fewer notes means bigger, more obvious pitch jumps"
      >
        {SCALES.map((scale) => (
          <option key={scale.value} value={scale.value} title={scale.title}>
            {scale.label}
          </option>
        ))}
      </select>

      {detectedKey && (
        <span className="detected-key" title="Key detected for this track">
          ♪{detectedKey}
        </span>
      )}

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
