import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import { deckPeaks } from '../controller'
import { seek } from '../controller'
import { useStore } from '../state/store'

const DECK_COLORS = ['#39c5ff', '#ff7a39']

export function Waveform({ deckIndex }: { deckIndex: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const deck = useStore((s) => s.decks[deckIndex])
  const stateRef = useRef(deck)
  stateRef.current = deck

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

      // Loop region
      if (state.loop.active) {
        const x1 = (state.loop.start / state.duration) * w
        const x2 = (state.loop.end / state.duration) * w
        ctx.fillStyle = 'rgba(120, 255, 120, 0.12)'
        ctx.fillRect(x1, 0, x2 - x1, h)
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

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      onPointerDown={(e) => {
        const state = stateRef.current
        if (state.duration === 0) return
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
        const t = (e.clientX - rect.left) / rect.width
        seek(deckIndex, t * state.duration)
      }}
    />
  )
}
