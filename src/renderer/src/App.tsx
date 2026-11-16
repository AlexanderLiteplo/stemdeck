import { useEffect, useState } from 'react'
import { initApp, setMasterGain, toggleRecording } from './controller'
import { useStore } from './state/store'
import { BeatMatchView } from './components/BeatMatchView'
import { DeckView } from './components/DeckView'
import { Library } from './components/Library'
import { MasterMeter } from './components/MasterMeter'
import { Mixer } from './components/Mixer'
import { Knob } from './components/Knob'
import { ReelControls } from './components/ReelControls'
import { TooltipLayer, tip } from './components/TooltipLayer'
import { installKeyboard } from './keyboard'
import { initStudio, setView } from './studio/actions'
import { useStudio } from './studio/store'
import { Studio } from './studio/ui/Studio'

export default function App() {
  const engineReady = useStore((s) => s.engineReady)
  const recording = useStore((s) => s.recording)
  const masterGain = useStore((s) => s.masterGain)
  const toast = useStore((s) => s.toast)
  const view = useStudio((s) => s.view)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    initApp()
      .then(initStudio)
      .catch((err) => setInitError((err as Error).message))
    return installKeyboard()
  }, [])

  if (initError) {
    return <div className="init-error">Audio engine failed to start: {initError}</div>
  }
  if (!engineReady) {
    return <div className="init-splash">STEMDECK</div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="logo">
          STEM<span>DECK</span>
        </h1>
        <div className="view-switch">
          <button
            className={view === 'decks' ? 'active' : ''}
            onClick={() => setView('decks')}
            {...tip('Decks', 'Two-deck DJ mode. Number keys 1–0 jump between saved sections of deck A, Q–P for deck B — always landing on the beat.')}
          >
            DECKS
          </button>
          <button
            className={view === 'studio' ? 'active' : ''}
            onClick={() => setView('studio')}
            {...tip('Studio', 'Make beats: chop samples, program drums, play and design synths, all in one loop.')}
          >
            STUDIO
          </button>
        </div>
        <button
          className={`toggle record ${recording ? 'active' : ''}`}
          onClick={() => void toggleRecording()}
          {...tip('Record mix', 'Records everything you hear — decks and studio — to ~/Music/StemDeck Recordings.')}
        >
          {recording ? '■ STOP REC' : '● REC MIX'}
        </button>
        <ReelControls />
        <span className="spacer" />
        <MasterMeter />
        <Knob
          label="MASTER"
          min={0}
          max={1.5}
          defaultValue={1}
          value={masterGain}
          onChange={setMasterGain}
          size={36}
        />
      </header>

      {view === 'decks' ? (
        <>
          <main className="decks-row">
            <DeckView deckIndex={0} />
            <Mixer />
            <DeckView deckIndex={1} />
          </main>
          <BeatMatchView />
        </>
      ) : (
        <Studio />
      )}

      <Library />

      {toast && <div className="toast">{toast}</div>}
      <TooltipLayer />
    </div>
  )
}
