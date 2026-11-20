import type { SynthPatch } from './types'

/** A neutral sawtooth with every newer module switched off. */
export const DEFAULT_PATCH: SynthPatch = {
  name: 'Init',
  description: 'A plain, neutral sawtooth patch with a simple envelope and open filter, ready to shape into a new sound.',
  osc1: { wave: 'sawtooth', level: 0.75 },
  osc2: { wave: 'sine', level: 0, octave: 0, semi: 0, detune: 0 },
  fm: 0,
  ring: 0,
  sub: 0,
  noise: 0,
  unison: 1,
  spread: 0,
  filter: {
    type: 'lowpass',
    slope: 12,
    cutoff: 12000,
    resonance: 0.7,
    envAmount: 0,
    keyTrack: 0,
    drive: 0,
    fm: 0
  },
  ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.25 },
  filterEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.25 },
  pitchEnv: { amount: 0, decay: 0.1 },
  lfo: { shape: 'sine', rate: 5, sync: false, division: 3, pitch: 0, filter: 0, amp: 0 },
  glide: 0,
  mono: false,
  drive: 0,
  driveType: 'soft',
  crush: { bits: 0, rate: 0 },
  phaser: { mix: 0, rate: 0.4 },
  pump: 0,
  reverb: 0,
  delay: 0,
  volume: 0.75
}

type Plain = Record<string, unknown>

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Recursively lay `over` on top of `base`, keeping base values where `over` has none (or the wrong type). */
function merge<T>(base: T, over: unknown): T {
  if (!isPlain(base)) {
    return over !== undefined && over !== null && typeof over === typeof base ? (over as T) : base
  }
  const out: Plain = {}
  const source = isPlain(over) ? over : {}
  for (const key of Object.keys(base)) out[key] = merge((base as Plain)[key], source[key])
  return out as T
}

/**
 * Fill in anything a patch is missing. Sounds saved before a module existed
 * (FM, crusher, phaser…) load with that module off, so they sound the same.
 */
export function normalizePatch(patch: unknown): SynthPatch {
  const merged = merge(DEFAULT_PATCH, patch)
  const group = isPlain(patch) && typeof patch.group === 'string' ? patch.group : undefined
  return group ? { ...merged, group } : merged
}
