import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import { useStore } from '../state/store'

export function MasterMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineReady = useStore((s) => s.engineReady)

  useEffect(() => {
    if (!engineReady) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const data = new Float32Array(engine.analyser.fftSize)
    let raf = 0
    let peakHold = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      engine.analyser.getFloatTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i])
        if (v > peak) peak = v
      }
      peakHold = Math.max(peak, peakHold * 0.95)
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#1b202b'
      ctx.fillRect(0, 0, w, h)
      const level = Math.min(1, peakHold)
      const grad = ctx.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, '#2ee66b')
      grad.addColorStop(0.75, '#e6d22e')
      grad.addColorStop(1, '#e62e2e')
      ctx.fillStyle = grad
      ctx.fillRect(0, 2, w * level, h - 4)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [engineReady])

  return <canvas ref={canvasRef} className="master-meter" width={160} height={14} />
}
