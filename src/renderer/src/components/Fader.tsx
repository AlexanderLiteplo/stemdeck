import { useCallback, useRef } from 'react'

interface FaderProps {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onDoubleClick?: () => void
  orientation: 'vertical' | 'horizontal'
  length?: number
  className?: string
}

/** Linear fader with pointer drag; double-click to reset (if provided). */
export function Fader({
  value,
  min,
  max,
  onChange,
  onDoubleClick,
  orientation,
  length = 120,
  className = ''
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const valueFromEvent = useCallback(
    (e: React.PointerEvent): number => {
      const rect = trackRef.current!.getBoundingClientRect()
      const t =
        orientation === 'vertical'
          ? 1 - (e.clientY - rect.top) / rect.height
          : (e.clientX - rect.left) / rect.width
      return Math.min(max, Math.max(min, min + t * (max - min)))
    },
    [max, min, orientation]
  )

  const norm = (value - min) / (max - min)
  const style =
    orientation === 'vertical'
      ? { height: length, width: 28 }
      : { width: length, height: 28 }
  const thumbStyle =
    orientation === 'vertical'
      ? { bottom: `calc(${norm * 100}% - 8px)` }
      : { left: `calc(${norm * 100}% - 10px)` }

  return (
    <div
      ref={trackRef}
      className={`fader ${orientation} ${className}`}
      style={style}
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as Element).setPointerCapture(e.pointerId)
        onChange(valueFromEvent(e))
      }}
      onPointerMove={(e) => {
        if (dragging.current) onChange(valueFromEvent(e))
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
    >
      <div className="fader-track" />
      <div className="fader-thumb" style={thumbStyle} />
    </div>
  )
}
