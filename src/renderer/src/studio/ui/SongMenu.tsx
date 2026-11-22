import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tip } from '../../components/TooltipLayer'
import { deleteSong, duplicateSong, newSong, openSong, renameSong, saveSong } from '../actions'
import { songEnd, useStudio } from '../store'
import { SONG_TEMPLATES } from '../templates'
import { STEPS_PER_BAR } from '../types'

/** "just now", "5 min ago", "3 h ago", then a date. */
function ago(time: number): string {
  const seconds = (Date.now() - time) / 1000
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/**
 * The open song's name (click it for the song list), whether it is saved, and
 * SAVE. Songs save themselves a moment after every change.
 */
export function SongMenu() {
  const songName = useStudio((s) => s.songName)
  const dirty = useStudio((s) => s.songDirty)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <div className="song-menu">
      <span className="instrument-name" {...tip('Song', 'Your whole track. Each lane is an instrument; each block is a clip that plays one of that instrument’s patterns. Build a loop below, then lay it out here: ＋ ADD TO SONG appends the open pattern, or drag a pattern letter onto its lane. Drag a clip to move it (Alt-drag copies); drag its right edge to loop it longer, its left edge to trim the start. Everything follows the one project BPM.')}>
        SONG
      </span>
      <button
        ref={anchor}
        className={`song-button ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        {...tip('Your songs', 'Open another song, start a new one, or rename, copy and delete songs.')}
      >
        <span className="song-button-name">{songName}</span>
        <span className="song-button-caret">▾</span>
      </button>
      <span
        className={`save-state ${dirty ? 'saving' : ''}`}
        {...tip('Autosave', 'Every change saves itself a moment later — you can close the app any time.')}
      >
        {dirty ? 'Saving…' : '✓ Saved'}
      </span>
      <button className="mini-btn" onClick={saveSong} {...tip('Save · ⌘S', 'Saves the song right now. (It also saves itself a moment after every change.)')}>
        SAVE
      </button>
      {open && <SongList anchor={anchor.current} onClose={close} />}
    </div>
  )
}

function SongList({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const songId = useStudio((s) => s.songId)
  const songName = useStudio((s) => s.songName)
  const songs = useStudio((s) => s.songs)
  const dirty = useStudio((s) => s.songDirty)
  const liveBpm = useStudio((s) => s.bpm)
  const liveBars = useStudio((s) => Math.ceil(songEnd(s.clips) / STEPS_PER_BAR))
  const panel = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  // Re-render once a minute so "saved 3 min ago" stays true while the list is open.
  const [, setTick] = useState(0)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!panel.current?.contains(target) && !anchor?.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTyping(e.target)) onClose()
    }
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  // The open song is always listed first, with its live name and size.
  const rows = [
    { id: songId, name: songName, bpm: liveBpm, bars: liveBars, savedAt: Date.now() },
    ...songs.filter((song) => song.id !== songId)
  ]
  const rect = anchor?.getBoundingClientRect()

  const commitRename = () => {
    if (renaming) renameSong(renaming.id, renaming.draft)
    setRenaming(null)
  }

  return createPortal(
    <div ref={panel} className="song-list" style={{ top: (rect?.bottom ?? 0) + 6, left: rect?.left ?? 0 }}>
      <div className="song-list-head">
        <span className="song-list-title">YOUR SONGS · {rows.length}</span>
        <span className="spacer" />
        {SONG_TEMPLATES.map((template) => (
          <button
            key={template.id}
            className="mini-btn new-song"
            onClick={() => {
              const id = newSong(template.id)
              // Straight into naming it: type a name and press Enter.
              setRenaming({ id, draft: useStudio.getState().songName })
            }}
            {...tip(template.label, template.id === 'blank' ? 'Start an empty song. The song you have open now stays saved in this list.' : 'Start from a finished 36-bar jungle track to see how a song is put together. The song you have open now stays saved in this list.')}
          >
            ＋ {template.id === 'blank' ? 'NEW SONG' : 'JUNGLE STARTER'}
          </button>
        ))}
      </div>
      <div className="song-rows">
        {rows.map((song) => {
          const current = song.id === songId
          const meta = [
            song.bars === 0 ? 'empty' : song.bars ? `${song.bars} ${song.bars === 1 ? 'bar' : 'bars'}` : null,
            song.bpm ? `${Math.round(song.bpm)} BPM` : null,
            current ? (dirty ? 'saving…' : 'open now') : `saved ${ago(song.savedAt)}`
          ].filter(Boolean)
          return (
            <div key={song.id} className={`song-row ${current ? 'current' : ''}`}>
              {renaming?.id === song.id ? (
                <form
                  className="song-rename"
                  onSubmit={(e) => {
                    e.preventDefault()
                    commitRename()
                  }}
                >
                  <input
                    autoFocus
                    maxLength={60}
                    value={renaming.draft}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setRenaming({ id: song.id, draft: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    onBlur={commitRename}
                  />
                </form>
              ) : (
                <button
                  className="song-open"
                  onClick={() => {
                    if (!current) openSong(song.id)
                    onClose()
                  }}
                  {...tip(song.name, current ? 'This is the song you have open.' : 'Click to open this song. The one you have open now stays saved here.')}
                >
                  <span className="song-row-name">
                    {current && <span className="song-row-dot">●</span>}
                    {song.name}
                  </span>
                  <span className="song-row-meta">{meta.join(' · ')}</span>
                </button>
              )}
              <div className="song-row-actions">
                <button className="mini-btn" onClick={() => setRenaming({ id: song.id, draft: song.name })} {...tip('Rename')}>
                  RENAME
                </button>
                <button
                  className="mini-btn"
                  onClick={() => duplicateSong(song.id)}
                  {...tip('Copy', `Saves a copy called “${song.name} copy” — try a different version without touching this one.`)}
                >
                  COPY
                </button>
                <button
                  className="mini-btn danger"
                  onClick={() => {
                    if (window.confirm(`Delete “${song.name}” for good?\n\nThis can't be undone.`)) deleteSong(song.id)
                  }}
                  {...tip('Delete', 'Deletes this song permanently.')}
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>,
    document.body
  )
}
