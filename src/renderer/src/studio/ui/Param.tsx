import { useState } from 'react'
import { Knob } from '../../components/Knob'
import { tip } from '../../components/TooltipLayer'

interface ParamProps {
  label: string
  /** What the control does — shown on hover. */
  help: string
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (value: number) => void
  /** 'log' for frequencies/times so the knob's travel feels even. */
  curve?: 'lin' | 'log'
  format?: (value: number) => string
  size?: number
}

const toNorm = (v: number, min: number, max: number, curve: 'lin' | 'log') =>
  curve === 'log'
    ? Math.log(Math.max(v, min) / min) / Math.log(max / min)
    : (v - min) / (max - min)

const fromNorm = (n: number, min: number, max: number, curve: 'lin' | 'log') =>
  curve === 'log' ? min * Math.pow(max / min, n) : min + n * (max - min)

export const fmt = {
  pct: (v: number) => `${Math.round(v * 100)}%`,
  hz: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`),
  sec: (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`),
  st: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}st`,
  cents: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}¢`,
  oct: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}oct`,
  x: (v: number) => `×${v.toFixed(2)}`,
  int: (v: number) => String(Math.round(v)),
  num: (v: number) => v.toFixed(1)
}

/** A knob with a live value readout and an explanatory tooltip. */
export function Param({
  label,
  help,
  value,
  min,
  max,
  defaultValue,
  onChange,
  curve = 'lin',
  format = fmt.num,
  size = 34
}: ParamProps) {
  return (
    <div className="param" {...tip(label, help)}>
      <Knob
        label={label}
        size={size}
        min={0}
        max={1}
        defaultValue={toNorm(defaultValue, min, max, curve)}
        value={toNorm(value, min, max, curve)}
        onChange={(n) => onChange(fromNorm(n, min, max, curve))}
      />
      <span className="param-value">{format(value)}</span>
    </div>
  )
}

/** Segmented button group. */
export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  labels,
  help,
  title
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labels?: Partial<Record<string, string>>
  help?: string
  title?: string
}) {
  return (
    <div className="seg" {...(help ? tip(title ?? '', help) : {})}>
      {options.map((o) => (
        <button key={String(o)} className={o === value ? 'active' : ''} onClick={() => onChange(o)}>
          {labels?.[String(o)] ?? String(o)}
        </button>
      ))}
    </div>
  )
}

interface Named {
  name: string
  description: string
}

/** Factory + user preset picker with save-as and delete. */
export function PresetBar<T extends Named>({
  kind,
  factory,
  user,
  current,
  onLoad,
  onSave,
  onDelete
}: {
  kind: string
  factory: T[]
  user: T[]
  current: T
  onLoad: (preset: T) => void
  onSave: (name: string) => void
  onDelete: (name: string) => void
}) {
  const [naming, setNaming] = useState<string | null>(null)
  const isUser = user.some((p) => p.name === current.name)
  const options = [...factory.map((p) => `f:${p.name}`), ...user.map((p) => `u:${p.name}`)]
  const currentKey = isUser
    ? `u:${current.name}`
    : factory.some((p) => p.name === current.name)
      ? `f:${current.name}`
      : ''

  return (
    <div className="preset-bar">
      <select
        value={currentKey}
        onChange={(e) => {
          const [src, ...rest] = e.target.value.split(':')
          const name = rest.join(':')
          const list = src === 'u' ? user : factory
          const found = list.find((p) => p.name === name)
          if (found) onLoad(found)
          e.target.blur()
        }}
        {...tip(`${kind} presets`, current.description || 'Your edited sound.')}
      >
        {currentKey === '' && <option value="">{current.name} (edited)</option>}
        <optgroup label="Donda-inspired">
          {factory.map((p) => (
            <option key={p.name} value={`f:${p.name}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
        {user.length > 0 && (
          <optgroup label="My sounds">
            {user.map((p) => (
              <option key={p.name} value={`u:${p.name}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {options.length > 1 && (
        <>
          <button
            className="mini-btn"
            onClick={() => step(-1)}
            {...tip('Previous preset')}
          >
            ◀
          </button>
          <button className="mini-btn" onClick={() => step(1)} {...tip('Next preset')}>
            ▶
          </button>
        </>
      )}
      {naming === null ? (
        <button
          className="mini-btn"
          onClick={() => setNaming(isUser ? current.name : `My ${current.name}`)}
          {...tip(`Save ${kind.toLowerCase()}`, 'Save the current settings as your own preset. Saved sounds appear under “My sounds”.')}
        >
          SAVE
        </button>
      ) : (
        <form
          className="name-form"
          onSubmit={(e) => {
            e.preventDefault()
            const name = naming.trim()
            if (name) onSave(name)
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
      {isUser && (
        <button
          className="mini-btn"
          onClick={() => onDelete(current.name)}
          {...tip('Delete', 'Remove this saved preset (the current sound stays loaded).')}
        >
          ✕
        </button>
      )}
    </div>
  )

  function step(dir: 1 | -1): void {
    const all = [...factory, ...user]
    const i = all.findIndex((p) => p.name === current.name)
    const next = all[(i + dir + all.length) % all.length]
    if (next) onLoad(next)
  }
}
