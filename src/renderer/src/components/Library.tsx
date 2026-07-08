import { useState } from 'react'
import {
  addDroppedFiles,
  addRecordingToLibrary,
  addTracksFromDialog,
  addYoutubeTrack,
  createFolder,
  deleteFolder,
  loadTrackToDeck,
  moveTrackToFolder,
  openRecordingsFolder,
  queueSeparation,
  reanalyzeTrack,
  renameFolder,
  revealRecording,
  saveLibrary,
  scaleTrackBpm,
  setActiveFolder
} from '../controller'
import { RECORDINGS_VIEW, useStore } from '../state/store'

const TRACK_DND = 'text/stemdeck-track'

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    undefined,
    { hour: 'numeric', minute: '2-digit' }
  )}`
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

/** A single crate row that can be selected, renamed, deleted, and dropped onto. */
function CrateRow({
  id,
  name,
  count,
  active,
  onSelect
}: {
  id: string | null
  name: string
  count: number
  active: boolean
  onSelect: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [dragOver, setDragOver] = useState(false)
  const isRealCrate = id !== null && id !== RECORDINGS_VIEW
  const acceptsDrop = id !== RECORDINGS_VIEW

  const commit = (): void => {
    setEditing(false)
    if (id !== null) renameFolder(id, draft)
  }

  return (
    <div
      className={`crate-row ${active ? 'active' : ''} ${dragOver ? 'drag-over' : ''}`}
      onClick={onSelect}
      onDragOver={(e) => {
        if (acceptsDrop && e.dataTransfer.types.includes(TRACK_DND)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        if (!acceptsDrop) return
        const trackId = e.dataTransfer.getData(TRACK_DND)
        if (trackId) {
          e.preventDefault()
          moveTrackToFolder(trackId, id)
        }
      }}
    >
      {editing ? (
        <input
          className="crate-rename"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(name)
              setEditing(false)
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="crate-name"
          onDoubleClick={() => {
            if (isRealCrate) {
              setDraft(name)
              setEditing(true)
            }
          }}
          title={isRealCrate ? 'Double-click to rename' : undefined}
        >
          {name}
        </span>
      )}
      <span className="crate-count">{count}</span>
      {isRealCrate && !editing && (
        <button
          className="crate-delete"
          title="Delete crate (tracks stay in your library)"
          onClick={(e) => {
            e.stopPropagation()
            deleteFolder(id)
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

function CrateSidebar() {
  const library = useStore((s) => s.library)
  const folders = useStore((s) => s.folders)
  const activeFolderId = useStore((s) => s.activeFolderId)
  const recordings = useStore((s) => s.recordings)

  return (
    <aside className="crate-sidebar">
      <div className="crate-list">
        <CrateRow
          id={null}
          name="All Tracks"
          count={library.length}
          active={activeFolderId === null}
          onSelect={() => setActiveFolder(null)}
        />
        {folders.map((f) => (
          <CrateRow
            key={f.id}
            id={f.id}
            name={f.name}
            count={library.filter((t) => t.folderId === f.id).length}
            active={activeFolderId === f.id}
            onSelect={() => setActiveFolder(f.id)}
          />
        ))}
        <CrateRow
          id={RECORDINGS_VIEW}
          name="🎙 Recordings"
          count={recordings.length}
          active={activeFolderId === RECORDINGS_VIEW}
          onSelect={() => setActiveFolder(RECORDINGS_VIEW)}
        />
      </div>
      <button className="crate-new" onClick={() => createFolder()}>
        + NEW CRATE
      </button>
    </aside>
  )
}

function RecordingsPane() {
  const recordings = useStore((s) => s.recordings)

  return (
    <>
      <header className="library-header">
        <span className="track-pane-title">Your recorded mixes</span>
        <button className="toggle" onClick={() => void openRecordingsFolder()}>
          📂 OPEN FOLDER
        </button>
        <span className="dim">Saved to ~/Music/StemDeck Recordings</span>
      </header>
      {recordings.length === 0 ? (
        <div className="library-empty">
          No recordings yet — hit <b>● REC MIX</b> up top to capture a set.
        </div>
      ) : (
        <table className="library-table">
          <thead>
            <tr>
              <th>Recording</th>
              <th>Size</th>
              <th>Recorded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recordings.map((rec) => (
              <tr key={rec.path}>
                <td className="track-name">{rec.name}</td>
                <td>{formatSize(rec.size)}</td>
                <td>{formatDate(rec.mtime)}</td>
                <td className="load-buttons">
                  <button
                    className="mini-btn"
                    title="Show this file in Finder"
                    onClick={() => void revealRecording(rec.path)}
                  >
                    Reveal
                  </button>
                  <button
                    className="mini-btn"
                    title="Add this recording to your library so you can mix it"
                    onClick={() => void addRecordingToLibrary(rec.path)}
                  >
                    + Library
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function TrackTable() {
  const library = useStore((s) => s.library)
  const activeFolderId = useStore((s) => s.activeFolderId)
  const folders = useStore((s) => s.folders)
  const stemEngine = useStore((s) => s.stemEngine)

  const tracks = library.filter((t) => activeFolderId === null || t.folderId === activeFolderId)
  const activeCrate = folders.find((f) => f.id === activeFolderId)

  if (library.length === 0) {
    return <div className="library-empty">Your crate is empty — add some MP3s to get mixing 🎶</div>
  }
  if (tracks.length === 0) {
    return (
      <div className="library-empty">
        “{activeCrate?.name}” is empty — drag tracks from All Tracks onto it in the sidebar.
      </div>
    )
  }

  return (
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
        {tracks.map((track) => (
          <tr
            key={track.id}
            draggable={!track.analyzing}
            onDragStart={(e) => {
              e.dataTransfer.setData(TRACK_DND, track.id)
              e.dataTransfer.effectAllowed = 'copyMove'
            }}
            title="Drag onto a deck to load, or onto a crate to file it"
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
  )
}

export function Library() {
  const stemEngine = useStore((s) => s.stemEngine)
  const stemModels = useStore((s) => s.stemModels)
  const selectedModel = useStore((s) => s.selectedModel)
  const autoStems = useStore((s) => s.autoStems)
  const activeFolderId = useStore((s) => s.activeFolderId)
  const viewingRecordings = activeFolderId === RECORDINGS_VIEW

  return (
    <section className="library">
      <CrateSidebar />
      <div
        className="track-pane"
        onDragOver={(e) => {
          if (!viewingRecordings && e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (viewingRecordings) return
          e.preventDefault()
          void addDroppedFiles(e.dataTransfer.files)
        }}
      >
        {viewingRecordings ? (
          <RecordingsPane />
        ) : (
          <>
            <header className="library-header">
              <button className="toggle" onClick={() => void addTracksFromDialog()}>
                + ADD TRACKS
              </button>
              <span className="dim">or drag &amp; drop audio files here</span>
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
            <TrackTable />
          </>
        )}
      </div>
    </section>
  )
}
