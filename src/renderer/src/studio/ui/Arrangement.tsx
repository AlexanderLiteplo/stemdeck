import { useEffect, useMemo, useRef, useState } from 'react'
import { Fader } from '../../components/Fader'
import { tip } from '../../components/TooltipLayer'
import { showToast } from '../../state/store'
import {
  addClip,
  addSynthTrack,
  copyClips,
  copySelectedClips,
  cutSelectedClips,
  deleteClips,
  deleteSong,
  duplicateClips,
  makeClipsUnique,
  newSong,
  nudgeClips,
  openSong,
  pasteClips,
  placeClips,
  removeTrack,
  renameSong,
  seekSong,
  selectClips,
  selectTrack,
  setCycle,
  setFocus,
  setSnap,
  setTool,
  setTrackMixer,
  setZoom,
  splitClipsAt,
  transportPosition
} from '../actions'
import { clampShift, trimStart } from '../clips'
import { patternSteps, songEnd, useStudio } from '../store'
import { SONG_TEMPLATES, type TemplateId } from '../templates'
import {
  CHOP_PADS,
  DRUM_VOICES,
  STEPS_PER_BAR,
  type Clip,
  type CycleRange,
  type Pattern,
  type StudioTrack
} from '../types'
import { patternColor } from './colors'
import { Seg } from './Param'
import { usePatternDrag, type PatternDrag } from './patternDrag'

const HEAD_WIDTH = 196
/** Pixels at each end of a clip that grab its edge instead of its body. */
const EDGE_PX = 7
/** Pointer travel before a press on the ruler counts as dragging out a cycle range. */
const DRAG_PX = 4
/** Always leave this many empty bars after the song so there is room to build. */
const SPARE_BARS = 8
const MIN_BARS = 32

const TRACK_ICONS = { drums: '◉', chops: '✂', synth: '♪' } as const

const stepsToPx = (steps: number, zoom: number) => (steps / STEPS_PER_BAR) * zoom
const pxToSteps = (px: number, zoom: number) => (px / zoom) * STEPS_PER_BAR
const snapTo = (steps: number, snap: number, round: (n: number) => number = Math.round) => round(steps / snap) * snap

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Where a cut at "the playhead" lands: the song position, snapped to the grid. */
function playheadStep(): number {
  const { songPos, snap, mode } = useStudio.getState()
  const live = mode === 'song' ? transportPosition() : -1
  return snapTo(live >= 0 ? live : songPos, snap)
}

/**
 * A pattern chip was released: if it is over its own track's lane, drop the
 * pattern there as a clip. Anywhere else the drag is simply cancelled.
 */
export function dropPatternOnTimeline(drag: PatternDrag): void {
  const lane = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('.lane')
  if (!lane) return
  const { zoom, snap, tracks } = useStudio.getState()
  if (lane.dataset.track !== drag.trackId) {
    const owner = tracks.find((t) => t.id === drag.trackId)?.name ?? 'its own'
    showToast(`Pattern ${drag.name} belongs to the ${owner} track — drop it on that lane`)
    return
  }
  const x = drag.x - lane.getBoundingClientRect().left
  addClip(drag.trackId, snapTo(pxToSteps(x, zoom), snap, Math.floor), drag.patternId)
}

type ClipDrag =
  | { kind: 'move'; id: string; originX: number; copy: boolean; delta: number; collapse: boolean }
  | { kind: 'trim-start' | 'trim-end'; id: string; originX: number; delta: number }

/**
 * GarageBand-style song view: instruments down the left, time across the top,
 * and each track's patterns laid out as clips you can move, loop, cut and copy.
 */
export function Arrangement() {
  const tracks = useStudio((s) => s.tracks)
  const clips = useStudio((s) => s.clips)
  const patterns = useStudio((s) => s.patterns)
  const selected = useStudio((s) => s.selectedClips)
  const selectedTrack = useStudio((s) => s.selectedTrack)
  const zoom = useStudio((s) => s.zoom)
  const snap = useStudio((s) => s.snap)
  const tool = useStudio((s) => s.tool)
  const bpm = useStudio((s) => s.bpm)
  const focused = useStudio((s) => s.focus === 'arrange')
  const dropTrack = usePatternDrag((s) => s.drag?.trackId)
  const [drag, setDrag] = useState<ClipDrag | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // When one clip becomes selected off-screen (ADD TO SONG, paste), bring it into view.
  const loneClip = selected.length === 1 ? selected[0] : null
  useEffect(() => {
    const view = scroller.current
    const clip = useStudio.getState().clips.find((c) => c.id === loneClip)
    if (!view || !clip) return
    const { zoom } = useStudio.getState()
    const left = stepsToPx(clip.start, zoom)
    const right = stepsToPx(clip.start + clip.length, zoom)
    const visible = view.clientWidth - HEAD_WIDTH
    if (left < view.scrollLeft || right > view.scrollLeft + visible) view.scrollLeft = Math.max(0, left - 80)
  }, [loneClip])

  const end = songEnd(clips)
  const bars = Math.max(MIN_BARS, Math.ceil(end / STEPS_PER_BAR) + SPARE_BARS)
  const width = bars * zoom

  // What the drag would produce if released now; rendered live so you see exactly what you get.
  const preview = useMemo(() => previewDrag(clips, selected, drag, snap), [clips, selected, drag, snap])

  useArrangeKeys()

  const beginDrag = (clip: Clip, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (tool === 'split') {
      const at = snapTo(clip.start + pxToSteps(e.clientX - rect.left, zoom), snap)
      splitClipsAt(at, [clip.id])
      // The two halves are separate pieces now: don't leave them selected to move as one.
      selectClips([])
      return
    }
    const already = selected.includes(clip.id)
    if (e.shiftKey) {
      selectClips(already ? selected.filter((id) => id !== clip.id) : [...selected, clip.id])
      return
    }
    if (!already) selectClips([clip.id])
    e.currentTarget.setPointerCapture(e.pointerId)
    const x = e.clientX - rect.left
    const kind = x < EDGE_PX ? 'trim-start' : x > rect.width - EDGE_PX ? 'trim-end' : 'move'
    setDrag(
      kind === 'move'
        ? { kind, id: clip.id, originX: e.clientX, copy: e.altKey, delta: 0, collapse: already && selected.length > 1 }
        : { kind, id: clip.id, originX: e.clientX, delta: 0 }
    )
  }

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return
    const delta = snapTo(pxToSteps(e.clientX - drag.originX, zoom), snap)
    if (delta !== drag.delta) setDrag({ ...drag, delta })
  }

  const endDrag = () => {
    if (!drag) return
    setDrag(null)
    if (preview.changed.length === 0) {
      // A plain click on one clip of a multi-selection narrows the selection to it.
      if (drag.kind === 'move' && drag.collapse) selectClips([drag.id])
      return
    }
    if (drag.kind === 'move' && drag.copy) copyClips(preview.changed)
    else placeClips(preview.changed)
  }

  return (
    <section className={`arrange ${focused ? 'focused' : ''}`} onPointerDownCapture={() => setFocus('arrange')}>
      <Toolbar bars={Math.ceil(end / STEPS_PER_BAR)} seconds={(end * 60) / bpm / 4} />
      <div className="arrange-body" ref={scroller}>
        <div className="arrange-grid" style={{ width: HEAD_WIDTH + width }}>
          <div className="arrange-row ruler-row">
            <div className="arrange-corner">
              <button
                className="mini-btn"
                onClick={addSynthTrack}
                {...tip('Add synth track', 'Adds another synthesizer with its own sound and its own lane — a bassline under the chords, a lead on top. Each one gets its own presets and piano roll.')}
              >
                ＋ SYNTH TRACK
              </button>
            </div>
            <Ruler bars={bars} zoom={zoom} snap={snap} />
          </div>
          {tracks.map((track) => (
            <div className={`arrange-row ${track.id === selectedTrack ? 'selected' : ''}`} key={track.id}>
              <TrackHead track={track} selected={track.id === selectedTrack} canRemove={track.kind === 'synth' && tracks.filter((t) => t.kind === 'synth').length > 1} />
              <div
                className={`lane ${tool === 'split' ? 'cutting' : ''} ${dropTrack === undefined ? '' : dropTrack === track.id ? 'drop-ok' : 'drop-no'}`}
                data-track={track.id}
                style={{ width, backgroundSize: `${zoom}px 100%, ${zoom / 4}px 100%` }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  selectTrack(track.id)
                  selectClips([])
                }}
                onDoubleClick={(e) => {
                  const x = e.clientX - e.currentTarget.getBoundingClientRect().left
                  addClip(track.id, snapTo(pxToSteps(x, zoom), snap, Math.floor))
                }}
              >
                {preview.clips
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      pattern={patterns[clip.patternId]}
                      zoom={zoom}
                      selected={selected.includes(clip.id)}
                      onPointerDown={(e) => beginDrag(clips.find((c) => c.id === clip.id) ?? clip, e)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                    />
                  ))}
                {preview.ghosts
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => (
                    <ClipView key={`ghost-${clip.id}`} clip={clip} pattern={patterns[clip.patternId]} zoom={zoom} selected ghost />
                  ))}
                {!clips.some((c) => c.trackId === track.id) && (
                  <span className="lane-hint">Empty — press ＋ ADD TO SONG below, or double-click here to drop pattern {patterns[track.patternId]?.name}</span>
                )}
              </div>
            </div>
          ))}
          <SongPlayhead zoom={zoom} scroller={scroller} />
        </div>
      </div>
    </section>
  )
}

interface DragPreview {
  /** Every clip as it should be drawn right now. */
  clips: Clip[]
  /** Copies being dragged out with Alt (the originals stay put). */
  ghosts: Clip[]
  /** The edited clips to commit on release; empty when the drag changed nothing. */
  changed: Clip[]
}

function previewDrag(clips: Clip[], selected: string[], drag: ClipDrag | null, snap: number): DragPreview {
  if (!drag) return { clips, ghosts: [], changed: [] }
  if (drag.kind === 'move') {
    const picked = clips.filter((c) => selected.includes(c.id))
    const shift = clampShift(picked, drag.delta)
    if (shift === 0) return { clips, ghosts: [], changed: [] }
    const moved = picked.map((c) => ({ ...c, start: c.start + shift }))
    if (drag.copy) return { clips, ghosts: moved, changed: moved }
    const byId = new Map(moved.map((c) => [c.id, c]))
    return { clips: clips.map((c) => byId.get(c.id) ?? c), ghosts: [], changed: moved }
  }
  const clip = clips.find((c) => c.id === drag.id)
  if (!clip) return { clips, ghosts: [], changed: [] }
  const edited =
    drag.kind === 'trim-end'
      ? { ...clip, length: Math.max(snap, clip.length + drag.delta) }
      : trimStart(clip, Math.min(clip.length - snap, Math.max(-clip.start, drag.delta)))
  if (edited.start === clip.start && edited.length === clip.length) return { clips, ghosts: [], changed: [] }
  return { clips: clips.map((c) => (c.id === clip.id ? edited : c)), ghosts: [], changed: [edited] }
}

/** Editing shortcuts for the timeline, active while it was the last panel clicked. */
function useArrangeKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStudio.getState()
      if (s.view !== 'studio' || s.focus !== 'arrange' || isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const handled = (): void => e.preventDefault()
      if (mod && e.code === 'KeyD') return handled(), duplicateClips()
      if (mod && e.code === 'KeyC') return handled(), copySelectedClips()
      if (mod && e.code === 'KeyX') return handled(), cutSelectedClips()
      if (mod && e.code === 'KeyV') return handled(), pasteClips(playheadStep())
      if (mod && (e.code === 'KeyT' || e.code === 'KeyE')) return handled(), splitClipsAt(playheadStep())
      if (mod && e.code === 'KeyA') return handled(), selectClips(s.clips.map((c) => c.id))
      if (mod || s.selectedClips.length === 0) return
      if (e.code === 'Delete' || e.code === 'Backspace') return handled(), deleteClips()
      if (e.code === 'Escape') return selectClips([])
      if (e.code === 'ArrowLeft') return handled(), nudgeClips(-s.snap)
      if (e.code === 'ArrowRight') return handled(), nudgeClips(s.snap)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Toolbar({ bars, seconds }: { bars: number; seconds: number }) {
  const tool = useStudio((s) => s.tool)
  const snap = useStudio((s) => s.snap)
  const zoom = useStudio((s) => s.zoom)
  const count = useStudio((s) => s.selectedClips.length)
  const none = count === 0
  const time = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

  return (
    <div className="arrange-bar">
      <SongMenu />
      <Seg
        options={['select', 'split'] as const}
        labels={{ select: '↖ MOVE', split: '✂ CUT' }}
        value={tool}
        title="Tool"
        help="MOVE: drag clips around, drag their edges to resize. CUT: click anywhere on a clip to slice it in two at that point — then move, delete or swap the pieces."
        onChange={setTool}
      />
      <Seg
        options={[STEPS_PER_BAR, 4] as const}
        labels={{ [STEPS_PER_BAR]: 'BAR', 4: 'BEAT' }}
        value={snap}
        title="Snap"
        help="What clips and cuts snap to. BAR keeps everything on bar lines; BEAT lets you cut out a single beat for a fill or a drop."
        onChange={setSnap}
      />
      <span className="arrange-actions">
        <button className="mini-btn" onClick={() => splitClipsAt(playheadStep())} {...tip('Split at playhead · ⌘T', 'Cuts the selected clips (or, with nothing selected, every clip) at the playhead.')}>
          SPLIT
        </button>
        <button className="mini-btn" disabled={none} onClick={copySelectedClips} {...tip('Copy · ⌘C', 'Copies the selected clips. ⌘V pastes them at the playhead (click the ruler to move it); ⌘X cuts.')}>
          COPY
        </button>
        <button className="mini-btn" onClick={() => pasteClips(playheadStep())} {...tip('Paste · ⌘V', 'Pastes the copied clips at the playhead, then moves the playhead to the end of them — so pressing it again keeps laying them end to end.')}>
          PASTE
        </button>
        <button className="mini-btn" disabled={none} onClick={duplicateClips} {...tip('Duplicate · ⌘D', 'Repeats the selected clips right after themselves. Select a whole section and press it a few times to build out a song.')}>
          DUPLICATE
        </button>
        <button className="mini-btn" disabled={none} onClick={makeClipsUnique} {...tip('Make unique', 'Clips with the same letter share one pattern, so editing one changes all of them. This gives the selected clips their own copy — use it to make a variation in just one spot.')}>
          UNIQUE
        </button>
        <button className="mini-btn" disabled={none} onClick={() => deleteClips()} {...tip('Delete · ⌫', 'Removes the selected clips from the timeline. Their patterns are kept.')}>
          DELETE
        </button>
      </span>
      <span className="spacer" />
      <span className="arrange-length mono" {...tip('Song length', 'From bar 1 to the end of the last clip, at the current BPM.')}>
        {bars} {bars === 1 ? 'bar' : 'bars'} · {time}
      </span>
      <span className="arrange-zoom" {...tip('Zoom', 'Make bars wider or narrower.')}>
        <button className="mini-btn" onClick={() => setZoom(zoom / 1.3)}>−</button>
        <button className="mini-btn" onClick={() => setZoom(zoom * 1.3)}>＋</button>
      </span>
    </div>
  )
}

/** Which song is open, plus new / rename / delete. Songs save themselves; switching never loses work. */
function SongMenu() {
  const songId = useStudio((s) => s.songId)
  const songName = useStudio((s) => s.songName)
  const songs = useStudio((s) => s.songs)
  const [naming, setNaming] = useState<string | null>(null)
  const others = songs.filter((song) => song.id !== songId)

  return (
    <div className="song-menu">
      <span className="instrument-name" {...tip('Song', 'Your whole track. Each lane is an instrument; each block is a clip that plays one of that instrument’s patterns. Build a loop below, then lay it out here: ＋ ADD TO SONG appends the open pattern, or drag a pattern letter onto its lane. Drag a clip to move it (Alt-drag copies); drag its right edge to loop it longer, its left edge to trim the start. Everything follows the one project BPM.')}>
        SONG
      </span>
      {naming === null ? (
        <select
          className="song-select"
          value={songId}
          onChange={(e) => {
            const value = e.target.value
            if (value.startsWith('new:')) newSong(value.slice(4) as TemplateId)
            else openSong(value)
            e.target.blur()
          }}
          {...tip('Songs', 'Every song saves itself as you work. Pick another one to switch to it, or start a new one — blank, or from the Jungle starter to see how a full track is put together.')}
        >
          <optgroup label="My songs">
            <option value={songId}>{songName}</option>
            {others.map((song) => (
              <option key={song.id} value={song.id}>
                {song.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Start a new song">
            {SONG_TEMPLATES.map((template) => (
              <option key={template.id} value={`new:${template.id}`}>
                ＋ {template.label}
              </option>
            ))}
          </optgroup>
        </select>
      ) : (
        <form
          className="name-form"
          onSubmit={(e) => {
            e.preventDefault()
            renameSong(naming)
            setNaming(null)
          }}
        >
          <input
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
            onBlur={() => setNaming(null)}
          />
        </form>
      )}
      <button className="mini-btn" onClick={() => setNaming(songName)} {...tip('Rename song')}>
        RENAME
      </button>
      <button
        className="mini-btn"
        onClick={() => {
          if (window.confirm(`Delete “${songName}” for good? This cannot be undone.`)) deleteSong()
        }}
        {...tip('Delete song', 'Deletes this song permanently and opens your most recent other song.')}
      >
        ✕
      </button>
    </div>
  )
}

function TrackHead({ track, selected, canRemove }: { track: StudioTrack; selected: boolean; canRemove: boolean }) {
  const kitName = useStudio((s) => s.kit.name)
  const sample = useStudio((s) => s.chopTitle)
  const sound = track.kind === 'drums' ? kitName : track.kind === 'chops' ? sample || 'no sample yet' : track.patch?.name
  const label = track.name.toLowerCase()
  return (
    <div
      className={`arrange-head ${selected ? 'selected' : ''} ${track.mute ? 'muted' : ''}`}
      onClick={() => selectTrack(track.id)}
      {...tip(track.name, 'Click to open this instrument below: its sound, and the pattern editor. Your computer keyboard plays the selected track.')}
    >
      <span className="track-icon">{TRACK_ICONS[track.kind]}</span>
      <div className="head-names">
        <span className="head-name">{track.name}</span>
        <span className="head-sound">{sound}</span>
      </div>
      <div className="head-controls" onClick={(e) => e.stopPropagation()}>
        <div className="head-buttons">
          <button
            className={`mute-btn ${track.mute ? 'active' : ''}`}
            onClick={() => setTrackMixer(track.id, { mute: !track.mute })}
            {...tip('Mute', `Silence the ${label} track.`)}
          >
            M
          </button>
          <button
            className={`mute-btn solo ${track.solo ? 'active' : ''}`}
            onClick={() => setTrackMixer(track.id, { solo: !track.solo })}
            {...tip('Solo', `Hear only the ${label} track (and any other soloed tracks).`)}
          >
            S
          </button>
          {canRemove && (
            <button className="mute-btn" onClick={() => removeTrack(track.id)} {...tip('Delete track', `Removes ${track.name} with its patterns and clips.`)}>
              ✕
            </button>
          )}
        </div>
        <div {...tip('Volume', `Level of the ${label} track in the mix.`)}>
          <Fader
            orientation="horizontal"
            length={78}
            min={0}
            max={1}
            value={track.volume}
            onChange={(v) => setTrackMixer(track.id, { volume: v })}
            className="mini"
          />
        </div>
      </div>
    </div>
  )
}

/** Bar numbers, the cycle strip, and click-to-seek. */
function Ruler({ bars, zoom, snap }: { bars: number; zoom: number; snap: number }) {
  const cycle = useStudio((s) => s.cycle)
  const cycleOn = useStudio((s) => s.cycleOn)
  const [range, setRange] = useState<CycleRange | null>(null)
  const press = useRef<{ x: number; step: number } | null>(null)
  // Label every bar when there is room, otherwise every 2nd / 4th.
  const every = zoom >= 38 ? 1 : zoom >= 24 ? 2 : 4
  const shown = range ?? cycle

  const stepAt = (e: React.PointerEvent<HTMLDivElement>) =>
    Math.max(0, pxToSteps(e.clientX - e.currentTarget.getBoundingClientRect().left, zoom))

  return (
    <div
      className="ruler"
      style={{ width: bars * zoom }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        press.current = { x: e.clientX, step: stepAt(e) }
      }}
      onPointerMove={(e) => {
        const from = press.current
        if (!from || (!range && Math.abs(e.clientX - from.x) < DRAG_PX)) return
        const to = stepAt(e)
        const start = snapTo(Math.min(from.step, to), snap, Math.floor)
        setRange({ start, end: Math.max(start + snap, snapTo(Math.max(from.step, to), snap, Math.ceil)) })
      }}
      onPointerUp={() => {
        const from = press.current
        press.current = null
        if (range) setCycle(range)
        else if (from) seekSong(snapTo(from.step, snap))
        setRange(null)
      }}
      onPointerCancel={() => {
        press.current = null
        setRange(null)
      }}
      {...tip('Timeline', 'Click to move the playhead there (and switch to SONG mode). Drag across a few bars to mark a cycle: that stretch repeats while you work on it. CYCLE in the transport turns it on and off.')}
    >
      {shown && (
        <div
          className={`cycle-strip ${range || cycleOn ? 'on' : ''}`}
          style={{ left: stepsToPx(shown.start, zoom), width: stepsToPx(shown.end - shown.start, zoom) }}
        />
      )}
      {Array.from({ length: Math.ceil(bars / every) }, (_, i) => (
        <span className="ruler-bar" key={i} style={{ left: i * every * zoom }}>
          {i * every + 1}
        </span>
      ))}
    </div>
  )
}

/** Song playhead, moved outside React; flips the view forward when it runs off the right edge while playing. */
function SongPlayhead({ zoom, scroller }: { zoom: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = ref.current
      if (!el) return
      const { mode, songPos, playing } = useStudio.getState()
      // In LOOP mode the timeline is not what is playing, but the playhead still marks where paste and SPLIT act.
      el.classList.toggle('idle', mode !== 'song')
      const live = playing && mode === 'song' ? transportPosition() : -1
      const x = stepsToPx(live >= 0 ? live : songPos, zoom)
      el.style.display = 'block'
      el.style.transform = `translateX(${HEAD_WIDTH + x}px)`
      const view = scroller.current
      if (!view || live < 0) return
      const visible = view.clientWidth - HEAD_WIDTH
      if (x < view.scrollLeft || x > view.scrollLeft + visible - 12) view.scrollLeft = Math.max(0, x - 24)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [zoom, scroller])
  return <div ref={ref} className="song-playhead" />
}

interface Mark {
  /** Step within the pattern. */
  x: number
  /** Width in steps. */
  w: number
  /** Vertical position and height, 0..1 of the clip. */
  y: number
  h: number
}

const marksCache = new WeakMap<Pattern, Mark[]>()

/** A pattern's content as little blocks, for the thumbnail drawn inside its clips. */
function patternMarks(pattern: Pattern): Mark[] {
  const cached = marksCache.get(pattern)
  if (cached) return cached
  const steps = patternSteps(pattern)
  const marks: Mark[] = []
  const grid = (rows: number[][]) => {
    rows.forEach((row, r) => {
      for (let step = 0; step < steps; step++) {
        if ((row[step] ?? 0) > 0) marks.push({ x: step, w: 0.8, y: r / rows.length, h: 0.8 / rows.length })
      }
    })
  }
  if (pattern.kind === 'drums') {
    grid(DRUM_VOICES.map((voice) => pattern.drums[voice]))
  } else if (pattern.kind === 'chops') {
    grid(pattern.chops.slice(0, CHOP_PADS))
  } else {
    const notes = pattern.notes.filter((n) => n.step < steps)
    const low = Math.min(...notes.map((n) => n.note))
    const high = Math.max(...notes.map((n) => n.note))
    // Keep at least an octave of range so a one-note bassline draws as thin lines, not a slab.
    const range = Math.max(12, high - low + 1)
    for (const n of notes) {
      marks.push({
        x: n.step,
        w: Math.max(0.6, Math.min(n.length, steps - n.step) - 0.25),
        y: 1 - (n.note - low + 1) / range,
        h: 1 / range
      })
    }
  }
  marksCache.set(pattern, marks)
  return marks
}

function ClipView({
  clip,
  pattern,
  zoom,
  selected,
  ghost = false,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  clip: Clip
  pattern: Pattern | undefined
  zoom: number
  selected: boolean
  ghost?: boolean
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp?: () => void
}) {
  if (!pattern) return null
  const steps = patternSteps(pattern)
  const offset = ((clip.offset % steps) + steps) % steps
  const marks = patternMarks(pattern)
  // The pattern repeats for as long as the clip lasts; draw each pass that is at least partly inside it.
  const passes = Math.ceil((offset + clip.length) / steps)
  const color = patternColor(pattern.name)

  return (
    <div
      className={`clip ${selected ? 'selected' : ''} ${ghost ? 'ghost' : ''}`}
      style={{
        left: stepsToPx(clip.start, zoom),
        width: stepsToPx(clip.length, zoom),
        background: `color-mix(in srgb, ${color} 34%, #10131c)`,
        borderColor: color
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span className="clip-name" style={{ background: color }}>
        {pattern.name}
      </span>
      <svg className="clip-art" viewBox={`0 0 ${clip.length} 1`} preserveAspectRatio="none">
        {Array.from({ length: passes }, (_, pass) => {
          const shift = pass * steps - offset
          return (
            <g key={pass}>
              {pass > 0 && shift > 0 && <line className="clip-loop" x1={shift} x2={shift} y1={0} y2={1} />}
              {marks.map((m, i) =>
                m.x + shift + m.w <= 0 || m.x + shift >= clip.length ? null : (
                  <rect key={i} x={m.x + shift} y={m.y} width={m.w} height={m.h} />
                )
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
