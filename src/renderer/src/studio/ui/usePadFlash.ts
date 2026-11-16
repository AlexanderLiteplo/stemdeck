import { useEffect, useRef } from 'react'
import { padFlash } from '../actions'

const FLASH_MS = 140

/**
 * Lights pads when they fire (from the keyboard, a click, or the sequencer
 * via `padFlash`) by toggling a class directly — no React re-render per hit.
 */
export function usePadFlash(keys: string[]): (index: number) => (el: HTMLElement | null) => void {
  const els = useRef<(HTMLElement | null)[]>([])
  const keysRef = useRef(keys)
  keysRef.current = keys

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      keysRef.current.forEach((key, i) => {
        const el = els.current[i]
        if (!el) return
        const lit = now - (padFlash.get(key) ?? -1e9) < FLASH_MS
        if (el.classList.contains('lit') !== lit) el.classList.toggle('lit', lit)
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (index) => (el) => {
    els.current[index] = el
  }
}
