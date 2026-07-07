import { addDroppedFiles, addTracksFromDialog, loadTrackToDeck, separateTrack } from '../controller'
import { useStore } from '../state/store'

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function Library() {
  const library = useStore((s) => s.library)
  const stemEngine = useStore((s) => s.stemEngine)
  const stemModels = useStore((s) => s.stemModels)
  const selectedModel = useStore((s) => s.selectedModel)

  return (
    <section
      className="library"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void addDroppedFiles(e.dataTransfer.files)
      }}
    >
      <header className="library-header">
        <button className="toggle" onClick={() => void addTracksFromDialog()}>
          + ADD TRACKS
        </button>
        <span className="dim">or drag &amp; drop audio files anywhere here</span>
        <span className="spacer" />
        <label className="model-select">
          Stem model{' '}
          <select
            value={selectedModel}
            onChange={(e) => useStore.setState({ selectedModel: e.target.value })}
          >
            {Object.entries(stemModels).map(([file, info]) => (
              <option key={file} value={file}>
                {info.label}
              </option>
            ))}
          </select>
        </label>
        <span
          className={`engine-status ${stemEngine.available ? 'ok' : 'missing'}`}
          title={stemEngine.available ? `Using ${stemEngine.bin}` : 'pipx install "audio-separator[cpu]"'}
        >
          {!stemEngine.checked ? '…' : stemEngine.available ? '● stem engine ready' : '○ stem engine not installed'}
        </span>
      </header>

      {library.length === 0 ? (
        <div className="library-empty">Your crate is empty — add some MP3s to get mixing 🎶</div>
      ) : (
        <table className="library-table">
          <thead>
            <tr>
              <th>Track</th>
              <th>BPM</th>
              <th>Length</th>
              <th>Stems</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {library.map((track) => (
              <tr key={track.id}>
                <td className="track-name">{track.name}</td>
                <td>{track.analyzing ? '…' : track.bpm ? track.bpm.toFixed(1) : '—'}</td>
                <td>{formatDuration(track.duration)}</td>
                <td>
                  {track.stems ? (
                    <span className="stems-badge">✓ ready</span>
                  ) : track.separating ? (
                    <span className="stems-badge working" title={track.stemStatus}>
                      splitting…
                    </span>
                  ) : (
                    <button
                      className="mini-btn"
                      disabled={!stemEngine.available || track.analyzing}
                      onClick={() => void separateTrack(track.id)}
                    >
                      split
                    </button>
                  )}
                </td>
                <td className="load-buttons">
                  <button
                    className="mini-btn load-a"
                    disabled={track.analyzing}
                    onClick={() => void loadTrackToDeck(0, track.id, false)}
                  >
                    A
                  </button>
                  <button
                    className="mini-btn load-b"
                    disabled={track.analyzing}
                    onClick={() => void loadTrackToDeck(1, track.id, false)}
                  >
                    B
                  </button>
                  {track.stems && (
                    <>
                      <button
                        className="mini-btn load-a"
                        disabled={track.analyzing}
                        title="Load to deck A with stems"
                        onClick={() => void loadTrackToDeck(0, track.id, true)}
                      >
                        A⧉
                      </button>
                      <button
                        className="mini-btn load-b"
                        disabled={track.analyzing}
                        title="Load to deck B with stems"
                        onClick={() => void loadTrackToDeck(1, track.id, true)}
                      >
                        B⧉
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
