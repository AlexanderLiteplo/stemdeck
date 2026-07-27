/**
 * BPM analysis worker — ensemble of two detectors:
 *
 *  - Essentia's RhythmExtractor2013 (multifeature) proposes a tempo with a
 *    confidence score. Strong on real-world material, but can confidently
 *    make "dotted" (2/3, 3/2) errors.
 *  - The spectral-flux comb detector in ./bpm generates its own candidates,
 *    adds Essentia's proposal to the pool, and lets the comb alignment
 *    score arbitrate. It also supplies the beat phase from low-frequency
 *    (kick/bass) onsets, which Essentia's ticks don't reliably give.
 */
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import { detectBpm } from './bpm'

interface BpmRequest {
  id: string
  mono: Float32Array
  sampleRate: number
}

const ESSENTIA_SR = 44100 // RhythmExtractor2013 requires 44.1kHz input
const ANALYZE_SECONDS = 45
const MIN_CONFIDENCE = 1.5 // multifeature confidence range is [0, 5.32]

type MusicalScale = 'major' | 'minor'

interface KeyAnalysis {
  key: number
  scale: MusicalScale
  keyStrength: number
}

const KEY_NAMES: Readonly<Record<string, number>> = {
  'B#': 0,
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  FB: 4,
  'E#': 5,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
  CB: 11
}

let essentia: Essentia | null = null
let essentiaFailed = false

function getEssentia(): Essentia | null {
  if (essentiaFailed) return null
  if (!essentia) {
    try {
      essentia = new Essentia(EssentiaWASM)
    } catch {
      essentiaFailed = true
      return null
    }
  }
  return essentia
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const outLength = Math.floor((input.length * toRate) / fromRate)
  const out = new Float32Array(outLength)
  const ratio = fromRate / toRate
  for (let i = 0; i < outLength; i++) {
    const x = i * ratio
    const j = Math.floor(x)
    const frac = x - j
    out[i] = j + 1 < input.length ? input[j] * (1 - frac) + input[j + 1] * frac : input[j] ?? 0
  }
  return out
}

function fold(bpm: number): number {
  while (bpm < 70) bpm *= 2
  while (bpm >= 180) bpm /= 2
  return bpm
}

function parseKeyResult(result: {
  key?: unknown
  scale?: unknown
  strength?: unknown
}): KeyAnalysis | null {
  if (typeof result.key !== 'string' || typeof result.scale !== 'string') return null
  const name = result.key.trim().replace(/♯/g, '#').replace(/♭/g, 'b').toUpperCase()
  const key = KEY_NAMES[name]
  const scale = result.scale.trim().toLowerCase()
  const strength = Number(result.strength)
  if (
    key === undefined ||
    (scale !== 'major' && scale !== 'minor') ||
    !Number.isFinite(strength) ||
    strength < 0
  ) {
    return null
  }
  return { key, scale, keyStrength: strength }
}

function essentiaAnalysis(
  mono: Float32Array,
  sampleRate: number
): {
  bpm: { bpm: number; confidence: number } | null
  key: KeyAnalysis | null
} {
  const ess = getEssentia()
  if (!ess) return { bpm: null, key: null }

  const analyzeSamples = Math.min(mono.length, ANALYZE_SECONDS * sampleRate)
  const sliceStart = Math.max(0, Math.floor((mono.length - analyzeSamples) / 2))
  const slice = mono.subarray(sliceStart, sliceStart + analyzeSamples)

  const resampled = resampleLinear(slice, sampleRate, ESSENTIA_SR)
  let vector: { delete?: () => void } | null = null
  try {
    vector = ess.arrayToVector(resampled) as { delete?: () => void }
    let bpm: { bpm: number; confidence: number } | null = null
    let key: KeyAnalysis | null = null
    try {
      const result = ess.RhythmExtractor2013(vector, 208, 'multifeature', 60)
      ;(result.ticks as { delete?: () => void }).delete?.()
      if (result.confidence >= MIN_CONFIDENCE && result.bpm > 0) {
        bpm = { bpm: result.bpm, confidence: result.confidence }
      }
    } catch {
      // Essentia BPM failure is non-fatal; the comb detector still runs below.
    }
    try {
      // The distributed runtime exposes KeyExtractor, but essentia.js's
      // package-level declaration omits it from the default Essentia type.
      const keyExtractor = ess as unknown as {
        KeyExtractor(audio: unknown): { key?: unknown; scale?: unknown; strength?: unknown }
      }
      key = parseKeyResult(keyExtractor.KeyExtractor(vector))
    } catch {
      // Key detection is optional and must not prevent BPM/waveform analysis.
    }
    return { bpm, key }
  } catch {
    return { bpm: null, key: null }
  } finally {
    vector?.delete?.()
  }
}

self.onmessage = (e: MessageEvent<BpmRequest>) => {
  const { id, mono, sampleRate } = e.data
  const { bpm: proposal, key } = essentiaAnalysis(mono, sampleRate)
  const result = detectBpm(mono, sampleRate, proposal ? [proposal.bpm] : [])

  // Attribute Essentia's confidence only if its proposal actually won
  const agreed =
    proposal !== null &&
    result.bpm > 0 &&
    Math.abs(fold(proposal.bpm) - result.bpm) / result.bpm < 0.01

  ;(self as unknown as Worker).postMessage({
    id,
    ...result,
    confidence: agreed ? proposal.confidence : 0,
    engine: agreed ? 'essentia+comb' : 'comb',
    key: key?.key ?? null,
    scale: key?.scale ?? null,
    keyStrength: key?.keyStrength ?? null
  })
}
