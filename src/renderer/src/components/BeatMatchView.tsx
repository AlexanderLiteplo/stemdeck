import { useEffect, useRef } from 'react'
import { HI_PEAKS_PER_SECOND } from '../audio/analysis'
import { engine } from '../audio/engine'
import { deckHiPeaks, nudgePosition } from '../controller'
import { useStore } from '../state/store'

const WINDOW_SECONDS = 8 // real-time seconds visible across the view
const LANE_GAP = 6
const DECK_COLORS = ['#39c5ff', '#ff7a39']

/**
 * Zoomed dual waveform, both lanes scrolling in REAL time (each deck's
 * source is scaled by its tempo), so beats visually line up exactly when
 * they line up audibly. Drag a lane to nudge that deck.
 */
export function BeatMatchView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decks = useStore((s) => s.decks)
  const decksRef = useRef(decks)
  decksRef.current = decks
  const drag = useRef<{ lane: number; lastX: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const drawLane = (lane: number, laneY: number, laneH: number, w: number): void => {
      const state = decksRef.current[lane]
      const peaks = deckHiPeaks[lane]
      const color = DECK_COLORS[lane]

      ctx.fillStyle = '#0e1119'
      ctx.fillRect(0, laneY, w, laneH)

      if (!state.trackId || !peaks) {
        ctx.fillStyle = '#2a2f3a'
        ctx.font = '11px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`DECK ${lane === 0 ? 'A' : 'B'}`, w / 2, laneY + laneH / 2 + 4)
        return
      }

      const pxPerSec = w / WINDOW_SECONDS
      const rate = state.tempo
      const pos = engine.decks[lane].getPosition()
      const mid = laneY + laneH / 2
      const amp = laneH / 2 - 2

      // Waveform: map each pixel to source time (real offset scaled by tempo)
      ctx.fillStyle = color
      for (let x = 0; x < w; x++) {
        const srcT = pos + ((x - w / 2) / pxPerSec) * rate
        const bucketF = srcT * HI_PEAKS_PER_SECOND
        const bucket = Math.floor(bucketF)
        if (bucket < 0 || bucket >= peaks.buckets - 1) continue
        const frac = bucketF - bucket
        const min =
          peaks.data[bucket * 2] * (1 - frac) + peaks.data[(bucket + 1) * 2] * frac
        const max =
          peaks.data[bucket * 2 + 1] * (1 - frac) + peaks.data[(bucket + 1) * 2 + 1] * frac
        const y1 = mid + min * amp
        const y2 = mid + max * amp
        ctx.fillRect(x, y2, 1, Math.max(1, y1 - y2))
      }

      // Beat grid: ticks at detected beats, downbeats (every 4th) stronger
      if (state.baseBpm > 0) {
        const beatLen = 60 / state.baseBpm
        const windowSrc = (WINDOW_SECONDS / 2) * rate
        const kFrom = Math.ceil((pos - windowSrc - state.firstBeat) / beatLen)
        const kTo = Math.floor((pos + windowSrc - state.firstBeat) / beatLen)
        for (let k = kFrom; k <= kTo; k++) {
          const srcT = state.firstBeat + k * beatLen
          const x = w / 2 + ((srcT - pos) / rate) * pxPerSec
          const downbeat = ((k % 4) + 4) % 4 === 0
          ctx.fillStyle = downbeat ? 'rgba(255, 210, 60, 0.9)' : 'rgba(255, 255, 255, 0.28)'
          ctx.fillRect(x, laneY, downbeat ? 2 : 1, laneH)
        }
      }

      // Effective BPM readout
      ctx.fillStyle = color
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'left'
      const bpmText = state.baseBpm ? `${(state.baseBpm * rate).toFixed(1)}` : '—'
      ctx.fillText(`${lane === 0 ? 'A' : 'B'} ${bpmText}`, 6, laneY + 12)
    }

    const draw = (): void => {
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

      const laneH = (h - LANE_GAP) / 2
      drawLane(0, 0, laneH, w)
      drawLane(1, laneH + LANE_GAP, laneH, w)

      // Shared "now" line down the center of both lanes
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(w / 2 - 1, 0, 2, h)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="beatmatch"
      title="Beatmatch view — drag a lane to nudge that deck"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const lane = e.clientY - rect.top < rect.height / 2 ? 0 : 1
        drag.current = { lane, lastX: e.clientX }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        const rect = e.currentTarget.getBoundingClientRect()
        const dx = e.clientX - drag.current.lastX
        if (dx !== 0) {
          const pxPerSec = rect.width / WINDOW_SECONDS
          // Dragging the waveform right moves the deck back in time
          nudgePosition(drag.current.lane, -dx / pxPerSec)
          drag.current.lastX = e.clientX
        }
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    />
  )
}
