import { useEffect, useState } from 'react'
import { initApp, setMasterGain, toggleRecording } from './controller'
import { useStore } from './state/store'
import { DeckView } from './components/DeckView'
import { Library } from './components/Library'
import { MasterMeter } from './components/MasterMeter'
import { Mixer } from './components/Mixer'
import { Knob } from './components/Knob'

export default function App() {
  const engineReady = useStore((s) => s.engineReady)
  const recording = useStore((s) => s.recording)
  const masterGain = useStore((s) => s.masterGain)
  const toast = useStore((s) => s.toast)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    initApp().catch((err) => setInitError((err as Error).message))
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
        <button
          className={`toggle record ${recording ? 'active' : ''}`}
          onClick={() => void toggleRecording()}
        >
          {recording ? '■ STOP REC' : '● REC MIX'}
        </button>
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

      <main className="decks-row">
        <DeckView deckIndex={0} />
        <Mixer />
        <DeckView deckIndex={1} />
      </main>

      <Library />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
