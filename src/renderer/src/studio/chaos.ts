import { normalizePatch } from './patch'
import { LFO_DIVISIONS, type DistortionType, type LfoShape, type SynthPatch, type Wave } from './types'

const between = (min: number, max: number) => min + Math.random() * (max - min)
/** Log-uniform, for frequencies and rates. */
const sweep = (min: number, max: number) => min * (max / min) ** Math.random()
const pick = <T,>(options: readonly T[]): T => options[Math.floor(Math.random() * options.length)]
/** `value()` with probability `odds`, otherwise 0 (module off). */
const maybe = (odds: number, value: () => number) => (Math.random() < odds ? value() : 0)

const WAVES: readonly Wave[] = ['sawtooth', 'sawtooth', 'square', 'square', 'triangle', 'sine']
const SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'sawtooth', 'square', 'random', 'random']
const DRIVES: readonly DistortionType[] = ['soft', 'hard', 'hard', 'fold', 'fuzz']

let rolls = 0

/**
 * Roll a random aggressive patch. Every roll keeps the things that make a
 * sound playable (audible oscillator, fast attack, sane volume) and gambles
 * on everything else, so most results are usable and some are unhinged.
 */
export function randomPatch(): SynthPatch {
  rolls += 1
  return normalizePatch({
    name: `Chaos ${rolls}`,
    description: 'A random monster from the CHAOS button. Roll again, or SAVE it if you like it.',
    osc1: { wave: pick(WAVES), level: between(0.7, 0.85) },
    osc2: {
      wave: pick(WAVES),
      level: maybe(0.7, () => between(0.2, 0.6)),
      octave: pick([-1, 0, 0, 1]),
      semi: pick([0, 0, 0, 0, 7, 5, 12, -5, 3]),
      detune: between(-15, 15)
    },
    fm: maybe(0.4, () => between(0.1, 0.7)),
    ring: maybe(0.3, () => between(0.2, 0.7)),
    sub: maybe(0.4, () => between(0.2, 0.6)),
    noise: maybe(0.3, () => between(0.03, 0.2)),
    unison: pick([1, 1, 1, 2, 3, 5, 7]),
    spread: between(8, 40),
    filter: {
      type: pick(['lowpass', 'lowpass', 'lowpass', 'bandpass', 'highpass'] as const),
      slope: pick([12, 24, 24] as const),
      cutoff: sweep(150, 4000),
      resonance: between(2, 18),
      envAmount: between(0, 4.5),
      keyTrack: between(0.1, 0.6),
      drive: between(0, 0.8),
      fm: maybe(0.35, () => between(0.1, 0.6))
    },
    ampEnv: { attack: 0.002, decay: between(0.1, 0.5), sustain: between(0.4, 0.95), release: between(0.05, 0.3) },
    filterEnv: { attack: 0.002, decay: between(0.08, 0.6), sustain: between(0, 0.5), release: 0.15 },
    pitchEnv: {
      amount: maybe(0.25, () => pick([-24, -12, 12, 24, 36])),
      decay: between(0.03, 0.2)
    },
    lfo: {
      shape: pick(SHAPES),
      sync: Math.random() < 0.7,
      division: 2 + Math.floor(Math.random() * (LFO_DIVISIONS.length - 2)),
      rate: sweep(0.2, 40),
      pitch: maybe(0.25, () => between(5, 600)),
      filter: maybe(0.6, () => between(0.3, 3)),
      amp: maybe(0.2, () => between(0.5, 1))
    },
    glide: between(0, 0.12),
    mono: Math.random() < 0.7,
    drive: between(0.2, 0.9),
    driveType: pick(DRIVES),
    crush: Math.random() < 0.45 ? { bits: between(0, 0.6), rate: between(0, 0.7) } : { bits: 0, rate: 0 },
    phaser: { mix: maybe(0.35, () => between(0.3, 0.9)), rate: sweep(0.1, 2) },
    pump: maybe(0.2, () => between(0.4, 0.9)),
    reverb: between(0, 0.3),
    delay: maybe(0.4, () => between(0.05, 0.3)),
    volume: 0.55
  })
}
