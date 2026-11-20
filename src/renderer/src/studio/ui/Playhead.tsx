import { useEffect, useRef } from 'react'
import { editorPosition } from '../actions'

/** Vertical line that follows playback through the open pattern, positioned without React re-renders. */
export function Playhead({ steps }: { steps: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = ref.current
      if (!el) return
      const pos = editorPosition()
      if (pos < 0) {
        el.style.display = 'none'
        return
      }
      el.style.display = 'block'
      el.style.left = `${((pos % steps) / steps) * 100}%`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [steps])
  return <div ref={ref} className="playhead" />
}
