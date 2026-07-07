import { useCallback, useRef } from 'react'

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (value: number) => void
  size?: number
}

/** Rotary knob: drag vertically to adjust, double-click to reset. */
export function Knob({ label, value, min, max, defaultValue, onChange, size = 44 }: KnobProps) {
  const dragState = useRef<{ startY: number; startValue: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragState.current = { startY: e.clientY, startValue: value }
      ;(e.target as Element).setPointerCapture(e.pointerId)
    },
    [value]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return
      const range = max - min
      const delta = ((dragState.current.startY - e.clientY) / 160) * range
      onChange(Math.min(max, Math.max(min, dragState.current.startValue + delta)))
    },
    [max, min, onChange]
  )

  const onPointerUp = useCallback(() => {
    dragState.current = null
  }, [])

  const norm = (value - min) / (max - min)
  const angle = -135 + norm * 270
  const r = size / 2

  return (
    <div className="knob" style={{ width: size + 12 }}>
      <svg
        width={size}
        height={size}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => onChange(defaultValue)}
      >
        <circle cx={r} cy={r} r={r - 2} className="knob-body" />
        <line
          x1={r}
          y1={r}
          x2={r + (r - 7) * Math.sin((angle * Math.PI) / 180)}
          y2={r - (r - 7) * Math.cos((angle * Math.PI) / 180)}
          className="knob-pointer"
        />
      </svg>
      <span className="knob-label">{label}</span>
    </div>
  )
}
