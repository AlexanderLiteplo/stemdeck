import { useState } from 'react'
import {
  addDroppedFiles,
  addTracksFromDialog,
  addYoutubeTrack,
  loadTrackToDeck,
  queueSeparation,
  reanalyzeTrack,
  saveLibrary,
  scaleTrackBpm
} from '../controller'
import { useStore } from '../state/store'

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function YoutubeAdd() {
  const youtube = useStore((s) => s.youtube)
  const [url, setUrl] = useState('')

  const submit = (): void => {
    if (!url.trim() || youtube.downloading) return
    void addYoutubeTrack(url)
    setUrl('')
  }

  return (
    <div className="youtube-add" title={youtube.available ? 'Download audio from one of your YouTube uploads' : 'Install yt-dlp to enable (pipx install yt-dlp)'}>
      <input
        type="text"
        placeholder="Paste a YouTube link to one of your songs…"
        value={url}
        disabled={!youtube.available || youtube.downloading}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button
        className="toggle"
        disabled={!youtube.available || youtube.downloading || !url.trim()}
        onClick={submit}
      >
        {youtube.downloading ? '⬇ DOWNLOADING…' : '⬇ ADD FROM YOUTUBE'}
      </button>
      {youtube.downloading && <span className="yt-status">{youtube.status}</span>}
    </div>
  )
}

export function Library() {
  const library = useStore((s) => s.library)
  const stemEngine = useStore((s) => s.stemEngine)
  const stemModels = useStore((s) => s.stemModels)
  const selectedModel = useStore((s) => s.selectedModel)
  const autoStems = useStore((s) => s.autoStems)

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
        <YoutubeAdd />
        <span className="spacer" />
        <label className="model-select">
          Stem model{' '}
          <select
            value={selectedModel}
            onChange={(e) => {
              useStore.setState({ selectedModel: e.target.value })
              void saveLibrary()
            }}
          >
            {Object.entries(stemModels).map(([file, info]) => (
              <option key={file} value={file}>
                {info.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className="auto-stems"
          title="Automatically split stems for every newly added track (queued one at a time)"
        >
          <input
            type="checkbox"
            checked={autoStems}
            disabled={!stemEngine.available}
            onChange={(e) => {
              useStore.setState({ autoStems: e.target.checked })
              void saveLibrary()
            }}
          />{' '}
          auto-stems
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
              <tr
                key={track.id}
                draggable={!track.analyzing}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/stemdeck-track', track.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                title="Drag onto a deck to load"
              >
                <td className="track-name">{track.name}</td>
                <td
                  title={
                    track.bpmConfidence > 0
                      ? `Beat tracker confidence ${track.bpmConfidence.toFixed(2)} / 5.32`
                      : 'Detected with fallback estimator'
                  }
                >
                  {track.analyzing ? '…' : track.bpm ? track.bpm.toFixed(1) : '—'}{' '}
                  {!track.analyzing && (
                    <>
                      <button
                        className="mini-btn"
                        title="Halve BPM"
                        disabled={!track.bpm}
                        onClick={() => scaleTrackBpm(track.id, 0.5)}
                      >
                        ×½
                      </button>
                      <button
                        className="mini-btn"
                        title="Double BPM"
                        disabled={!track.bpm}
                        onClick={() => scaleTrackBpm(track.id, 2)}
                      >
                        ×2
                      </button>
                      <button
                        className="mini-btn"
                        title="Re-detect BPM"
                        onClick={() => void reanalyzeTrack(track.id)}
                      >
                        ↻
                      </button>
                    </>
                  )}
                </td>
                <td>{formatDuration(track.duration)}</td>
                <td>
                  {track.stems ? (
                    <span className="stems-badge">✓ ready</span>
                  ) : track.separating ? (
                    <span className="stems-badge working" title={track.stemStatus}>
                      splitting {track.stemStatus.match(/(\d{1,3})(?:\.\d+)?%/)?.[1] ?? '…'}
                      {track.stemStatus.match(/(\d{1,3})(?:\.\d+)?%/) ? '%' : ''}
                    </span>
                  ) : (
                    <button
                      className="mini-btn"
                      disabled={!stemEngine.available || track.analyzing}
                      onClick={() => queueSeparation(track.id)}
                    >
                      split
                    </button>
                  )}
                </td>
                <td className="load-buttons">
                  <button
                    className="mini-btn load-a"
                    disabled={track.analyzing}
                    title="Load to deck A (with stems when available)"
                    onClick={() => void loadTrackToDeck(0, track.id)}
                  >
                    A
                  </button>
                  <button
                    className="mini-btn load-b"
                    disabled={track.analyzing}
                    title="Load to deck B (with stems when available)"
                    onClick={() => void loadTrackToDeck(1, track.id)}
                  >
                    B
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
