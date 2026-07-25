import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import { deckPeaks, moveLoop, resizeLoop, seek } from '../controller'
import { useStore } from '../state/store'

const DECK_COLORS = ['#39c5ff', '#ff7a39']
const LOOP_COLOR = '#4ade80'
/** Click slop around a loop edge, in pixels. */
const HANDLE_PX = 7

type LoopDrag =
  | { mode: 'move'; grabOffset: number }
  | { mode: 'resize'; edge: 'start' | 'end' }

export function Waveform({ deckIndex }: { deckIndex: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const deck = useStore((s) => s.decks[deckIndex])
  const stateRef = useRef(deck)
  stateRef.current = deck
  const dragRef = useRef<LoopDrag | null>(null)

  /** Where the loop sits in canvas pixels, or null when there is nothing to show. */
  const loopPixels = (width: number): { x1: number; x2: number } | null => {
    const state = stateRef.current
    if (!state.loop.active || state.duration === 0) return null
    return {
      x1: (state.loop.start / state.duration) * width,
      x2: (state.loop.end / state.duration) * width
    }
  }

  const hitTest = (x: number, width: number): LoopDrag | null => {
    const px = loopPixels(width)
    if (!px) return null
    const state = stateRef.current
    if (Math.abs(x - px.x1) <= HANDLE_PX) return { mode: 'resize', edge: 'start' }
    if (Math.abs(x - px.x2) <= HANDLE_PX) return { mode: 'resize', edge: 'end' }
    if (x > px.x1 && x < px.x2) {
      const t = (x / width) * state.duration
      return { mode: 'move', grabOffset: t - state.loop.start }
    }
    return null
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0) return
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const state = stateRef.current
      const peaks = deckPeaks[deckIndex]
      if (!peaks || state.duration === 0) {
        ctx.fillStyle = '#2a2f3a'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('NO TRACK LOADED', w / 2, h / 2 + 4)
        return
      }

      const mid = h / 2
      const position = engine.decks[deckIndex].getPosition()
      const playedX = (position / state.duration) * w

      // Bar grid: faint downbeat ticks so a dragged loop reads as on- or off-grid
      if (state.baseBpm > 0) {
        const barLen = (60 / state.baseBpm) * 4
        const pxPerBar = (barLen / state.duration) * w
        // Thin out to whole phrases when bars would be closer than ~6px
        const step = Math.max(1, Math.ceil(6 / Math.max(pxPerBar, 0.01)))
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
        for (let bar = 0; ; bar += step) {
          const x = ((state.firstBeat + bar * barLen) / state.duration) * w
          if (x > w) break
          if (x >= 0) ctx.fillRect(x, 0, 1, h)
        }
      }

      // Loop region
      const px = loopPixels(w)
      if (px) {
        const { x1, x2 } = px
        ctx.fillStyle = 'rgba(74, 222, 128, 0.14)'
        ctx.fillRect(x1, 0, x2 - x1, h)
        ctx.fillStyle = LOOP_COLOR
        ctx.fillRect(x1, 0, 2, h)
        ctx.fillRect(x2 - 2, 0, 2, h)
        // Grab handles, so the region reads as draggable
        ctx.fillRect(x1, 0, 6, 5)
        ctx.fillRect(x2 - 6, 0, 6, 5)
        ctx.fillRect(x1, h - 5, 6, 5)
        ctx.fillRect(x2 - 6, h - 5, 6, 5)

        // Length readout in bars/beats, centred in the region when it fits
        if (state.baseBpm > 0 && x2 - x1 > 44) {
          const beats = (state.loop.end - state.loop.start) / (60 / state.baseBpm)
          const bars = beats / 4
          const label =
            bars >= 1 && Math.abs(bars - Math.round(bars)) < 0.02
              ? `${Math.round(bars)} bar${Math.round(bars) > 1 ? 's' : ''}`
              : `${(Math.round(beats * 2) / 2).toString()} beat${beats === 1 ? '' : 's'}`
          ctx.fillStyle = LOOP_COLOR
          ctx.font = 'bold 9px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(label, (x1 + x2) / 2, 10)
        }
      }

      // Peaks
      const color = DECK_COLORS[deckIndex]
      for (let x = 0; x < w; x++) {
        const bucket = Math.floor((x / w) * peaks.buckets)
        const min = peaks.data[bucket * 2]
        const max = peaks.data[bucket * 2 + 1]
        ctx.fillStyle = x < playedX ? color : '#3d4453'
        const y1 = mid + min * (mid - 2)
        const y2 = mid + max * (mid - 2)
        ctx.fillRect(x, y2, 1, Math.max(1, y1 - y2))
      }

      // Hot cue markers
      state.hotCues.forEach((cue, i) => {
        if (cue === null) return
        const x = (cue / state.duration) * w
        ctx.fillStyle = '#ffd23c'
        ctx.fillRect(x, 0, 2, h)
        ctx.font = 'bold 9px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(String(i + 1), x + 3, 10)
      })

      // Cue point
      const cueX = (state.cuePoint / state.duration) * w
      ctx.fillStyle = '#ff4d6d'
      ctx.fillRect(cueX, 0, 2, h)

      // Playhead
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(playedX, 0, 2, h)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [deckIndex])

  /** Pointer x -> source seconds. */
  const timeAt = (clientX: number, rect: DOMRect): number =>
    ((clientX - rect.left) / rect.width) * stateRef.current.duration

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      title="Click to seek · drag the loop to move it, its edges to resize · hold Shift to ignore the grid"
      onPointerDown={(e) => {
        const state = stateRef.current
        if (state.duration === 0) return
        const rect = e.currentTarget.getBoundingClientRect()
        const drag = hitTest(e.clientX - rect.left, rect.width)
        if (drag) {
          dragRef.current = drag
          e.currentTarget.setPointerCapture(e.pointerId)
          return
        }
        seek(deckIndex, timeAt(e.clientX, rect))
      }}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const drag = dragRef.current
        if (!drag) {
          // Hover affordance: resize at the edges, grab inside the region
          const hover = hitTest(e.clientX - rect.left, rect.width)
          e.currentTarget.style.cursor = !hover
            ? 'crosshair'
            : hover.mode === 'resize'
              ? 'ew-resize'
              : 'grab'
          return
        }
        const t = timeAt(e.clientX, rect)
        if (drag.mode === 'move') moveLoop(deckIndex, t - drag.grabOffset, e.shiftKey)
        else resizeLoop(deckIndex, drag.edge, t, e.shiftKey)
      }}
      onPointerUp={(e) => {
        dragRef.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
    />
  )
}
