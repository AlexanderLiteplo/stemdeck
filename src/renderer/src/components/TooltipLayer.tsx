import { useEffect, useRef, useState } from 'react'

/**
 * Spread onto any element to give it a styled hover tooltip:
 *   <button {...tip('Swing', 'Delays every other 16th note…')}>
 */
export function tip(title: string, body?: string): Record<string, string> {
  return body ? { 'data-tip-title': title, 'data-tip': body } : { 'data-tip': title }
}

interface TipState {
  title: string | null
  body: string
  x: number
  y: number
  below: boolean
}

const SHOW_DELAY_MS = 350

/**
 * One global tooltip, driven by event delegation: any element with
 * `data-tip` (or a legacy `title`, which gets upgraded on hover) shows a
 * styled explanation after a short hover.
 */
export function TooltipLayer() {
  const [state, setState] = useState<TipState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<Element | null>(null)

  useEffect(() => {
    const hide = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      current.current = null
      setState(null)
    }

    const onOver = (e: PointerEvent) => {
      const start = e.target as Element | null
      if (!start || !start.closest) return
      // Upgrade native titles so they get the same look (and no double tooltip).
      const titled = start.closest('[title]')
      if (titled && !titled.hasAttribute('data-tip')) {
        const t = titled.getAttribute('title')
        if (t) titled.setAttribute('data-tip', t)
        titled.removeAttribute('title')
      }
      const el = start.closest('[data-tip]')
      if (el === current.current) return
      hide()
      if (!el) return
      current.current = el
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return
        const rect = el.getBoundingClientRect()
        const below = rect.top < 140
        setState({
          title: el.getAttribute('data-tip-title'),
          body: el.getAttribute('data-tip') ?? '',
          x: Math.min(Math.max(rect.left + rect.width / 2, 170), window.innerWidth - 170),
          y: below ? rect.bottom + 8 : rect.top - 8,
          below
        })
      }, SHOW_DELAY_MS)
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('blur', hide)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  if (!state) return null
  return (
    <div
      className={`tooltip ${state.below ? 'below' : ''}`}
      style={{ left: state.x, top: state.y }}
      role="tooltip"
    >
      {state.title && <strong>{state.title}</strong>}
      <span>{state.body}</span>
    </div>
  )
}
