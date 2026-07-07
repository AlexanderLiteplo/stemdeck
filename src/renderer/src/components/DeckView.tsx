import { useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import {
  beatLoop,
  cuePress,
  cyclePitchRange,
  jumpBars,
  setReverb,
  hotCuePress,
  loopExit,
  loopIn,
  loopOut,
  pitchBend,
  separateTrack,
  setPitch,
  setStemActive,
  setStemVolume,
  setTempo,
  sync,
  toggleKeylock,
  togglePlay
} from '../controller'
import { useStore } from '../state/store'
import { Fader } from './Fader'
import { Knob } from './Knob'
import { Waveform } from './Waveform'

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}

/** Elapsed/remaining clock polled from the engine outside React state. */
function DeckClock({ deckIndex, duration }: { deckIndex: number; duration: number }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])
  const pos = engine.decks[deckIndex]?.getPosition() ?? 0
  return (
    <span className="deck-clock">
      {formatTime(pos)} <span className="dim">/ -{formatTime(duration - pos)}</span>
    </span>
  )
}

export function DeckView({ deckIndex }: { deckIndex: number }) {
  const deck = useStore((s) => s.decks[deckIndex])
  const track = useStore((s) => s.library.find((t) => t.id === deck.trackId))
  const stemEngineAvailable = useStore((s) => s.stemEngine.available)
  const label = deckIndex === 0 ? 'A' : 'B'
  const effectiveBpm = deck.baseBpm ? (deck.baseBpm * deck.tempo).toFixed(1) : '—'
  const tempoPercent = ((deck.tempo - 1) * 100).toFixed(1)

  return (
    <section className={`deck deck-${label.toLowerCase()}`}>
      <header className="deck-header">
        <span className="deck-badge">{label}</span>
        <span className="deck-title" title={deck.title}>
          {deck.loading ? 'Loading…' : deck.title || 'Load a track from the library'}
        </span>
        <span className="deck-bpm">{effectiveBpm} BPM</span>
        {deck.trackId && <DeckClock deckIndex={deckIndex} duration={deck.duration} />}
      </header>

      <Waveform deckIndex={deckIndex} />

      <div className="deck-body">
        <div className="deck-controls">
          <div className="control-row">
            {[0, 1, 2, 3].map((slot) => (
              <button
                key={slot}
                className={`pad hotcue ${deck.hotCues[slot] !== null ? 'set' : ''}`}
                onClick={(e) => hotCuePress(deckIndex, slot, e.shiftKey)}
                title="Click: set/jump · Shift+click: clear"
              >
                {slot + 1}
              </button>
            ))}
            <span className="row-gap" />
            <button className="pad" onClick={() => loopIn(deckIndex)}>
              IN
            </button>
            <button className="pad" onClick={() => loopOut(deckIndex)}>
              OUT
            </button>
            <button
              className={`pad ${deck.loop.active ? 'active' : ''}`}
              onClick={() => loopExit(deckIndex)}
            >
              EXIT
            </button>
            {[1, 2, 4, 8].map((beats) => (
              <button key={beats} className="pad loop-beat" onClick={() => beatLoop(deckIndex, beats)}>
                {beats}
              </button>
            ))}
            <span className="row-gap" />
            {[4, 2, 1].map((bars) => (
              <button
                key={bars}
                className="pad bar-jump"
                onClick={() => jumpBars(deckIndex, -bars)}
                title={`Jump back ${bars} bar${bars > 1 ? 's' : ''}`}
              >
                ◂{bars}
              </button>
            ))}
          </div>

          <div className="control-row transport">
            <button className="big-btn cue" onClick={() => cuePress(deckIndex)}>
              CUE
            </button>
            <button
              className={`big-btn play ${deck.playing ? 'playing' : ''}`}
              onClick={() => togglePlay(deckIndex)}
            >
              {deck.playing ? '❚❚' : '▶'}
            </button>
            <button className="big-btn" onClick={() => sync(deckIndex)}>
              SYNC
            </button>
            <button
              className={`toggle ${deck.keylock ? 'active' : ''}`}
              onClick={() => toggleKeylock(deckIndex)}
              title="Keylock: tempo changes no longer affect pitch"
            >
              KEYLOCK
            </button>
            <Knob
              label="REVERB"
              size={36}
              min={0}
              max={1}
              defaultValue={0}
              value={deck.reverb}
              onChange={(v) => setReverb(deckIndex, v)}
            />
            <div className="key-shift" title="Key shift in semitones (keylock only)">
              <button
                disabled={!deck.keylock}
                onClick={() => setPitch(deckIndex, Math.max(-12, deck.pitch - 1))}
              >
                −
              </button>
              <span>{deck.pitch > 0 ? `+${deck.pitch}` : deck.pitch} st</span>
              <button
                disabled={!deck.keylock}
                onClick={() => setPitch(deckIndex, Math.min(12, deck.pitch + 1))}
              >
                +
              </button>
            </div>
            <div className="bend" title="Pitch bend (hold to nudge)">
              <button
                onPointerDown={() => pitchBend(deckIndex, -0.03)}
                onPointerUp={() => pitchBend(deckIndex, 0)}
                onPointerLeave={() => pitchBend(deckIndex, 0)}
              >
                ◀
              </button>
              <button
                onPointerDown={() => pitchBend(deckIndex, 0.03)}
                onPointerUp={() => pitchBend(deckIndex, 0)}
                onPointerLeave={() => pitchBend(deckIndex, 0)}
              >
                ▶
              </button>
            </div>
          </div>

          <div className="stems-panel">
            {deck.usingStems ? (
              deck.stems.map((stem, i) => (
                <div key={stem.name} className="stem-strip">
                  <button
                    className={`stem-btn ${stem.active ? 'active' : ''}`}
                    onClick={() => setStemActive(deckIndex, i, !stem.active)}
                  >
                    {stem.name.toUpperCase()}
                  </button>
                  <Fader
                    orientation="horizontal"
                    length={70}
                    min={0}
                    max={1}
                    value={stem.volume}
                    onChange={(v) => setStemVolume(deckIndex, i, v)}
                    className="mini"
                  />
                </div>
              ))
            ) : deck.trackId && track ? (
              track.stems ? (
                <span className="stems-hint">Stems ready — reload the track with the ⧉ button</span>
              ) : track.separating ? (
                <span className="stems-hint separating" title={track.stemStatus}>
                  Separating stems… {track.stemStatus}
                </span>
              ) : (
                <button
                  className="toggle"
                  disabled={!stemEngineAvailable}
                  onClick={() => separateTrack(track.id)}
                  title={
                    stemEngineAvailable
                      ? 'Split this track into stems with the AI separator'
                      : 'Install audio-separator to enable (see README)'
                  }
                >
                  ✂ SPLIT STEMS
                </button>
              )
            ) : (
              <span className="stems-hint dim">Stem controls appear here</span>
            )}
          </div>
        </div>

        <div className="pitch-fader">
          <button
            className="mini-btn"
            onClick={() => cyclePitchRange(deckIndex)}
            title="Cycle pitch fader range"
          >
            ±{Math.round(deck.pitchRange * 100)}%
          </button>
          <Fader
            orientation="vertical"
            length={180}
            min={1 - deck.pitchRange}
            max={1 + deck.pitchRange}
            value={deck.tempo}
            onChange={(v) => setTempo(deckIndex, v)}
            onDoubleClick={() => setTempo(deckIndex, 1)}
          />
          <span className="pitch-readout">
            {Number(tempoPercent) > 0 ? '+' : ''}
            {tempoPercent}%
          </span>
        </div>
      </div>
    </section>
  )
}
