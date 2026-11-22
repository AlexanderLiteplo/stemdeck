import { DRUM_MODELS, type DrumVoice, type DrumVoiceId } from './types'

type VoiceSettings = Pick<DrumVoice, 'model' | 'tune' | 'decay' | 'tone' | 'drive'>
type FilterType = 'lowpass' | 'highpass' | 'bandpass'

const TAU = Math.PI * 2
const METAL_FREQUENCIES = [205.3, 304.4, 369.6, 522.7, 540, 800]
const VOICE_SEEDS: Record<DrumVoiceId, number> = {
  kick: 0x13579bdf,
  snare: 0x2468ace0,
  clap: 0x6d2b79f5,
  hat: 0x1b873593,
  openhat: 0x85ebca6b,
  perc: 0xc2b2ae35,
  crash: 0x27d4eb2f,
  bass808: 0x165667b1
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function attack(t: number, seconds: number): number {
  return seconds <= 0 ? 1 : Math.min(1, t / seconds)
}

function envelope(t: number, tau: number): number {
  return Math.exp(-t / Math.max(0.000001, tau))
}

function decayingOscillator(
  output: Float32Array,
  sampleRate: number,
  wave: 'sine' | 'square' | 'triangle',
  frequency: number,
  pitchAmount: number,
  pitchTau: number,
  amplitudeTau: number,
  level = 1,
  attackSeconds = 0
): void {
  let phase = 0
  let pitchEnvelope = 1
  let amplitudeEnvelope = 1
  const pitchMultiplier = pitchAmount === 0 ? 0 : Math.exp(-1 / (sampleRate * pitchTau))
  const amplitudeMultiplier = Math.exp(-1 / (sampleRate * amplitudeTau))
  const attackSamples = attackSeconds * sampleRate
  for (let i = 0; i < output.length; i++) {
    phase += frequency * (1 + pitchAmount * pitchEnvelope) / sampleRate
    phase -= Math.floor(phase)
    const value = wave === 'sine'
      ? Math.sin(TAU * phase)
      : wave === 'square'
        ? (phase < 0.5 ? 1 : -1)
        : 1 - 4 * Math.abs(phase - 0.5)
    output[i] += value * amplitudeEnvelope * level * (attackSamples > 0 ? Math.min(1, i / attackSamples) : 1)
    pitchEnvelope *= pitchMultiplier
    amplitudeEnvelope *= amplitudeMultiplier
  }
}

function applyDecay(data: Float32Array, sampleRate: number, tau: number, attackSeconds = 0): void {
  let value = 1
  const multiplier = Math.exp(-1 / (sampleRate * tau))
  const attackSamples = attackSeconds * sampleRate
  for (let i = 0; i < data.length; i++) {
    data[i] *= value * (attackSamples > 0 ? Math.min(1, i / attackSamples) : 1)
    value *= multiplier
  }
}

function noise(length: number, random: () => number): Float32Array {
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) output[i] = random() * 2 - 1
  return output
}

function click(length: number, milliseconds: number, sampleRate: number, random: () => number): Float32Array {
  const output = new Float32Array(length)
  const samples = Math.min(length, Math.max(1, Math.ceil(milliseconds * sampleRate / 1000)))
  const tau = Math.max(0.0002, milliseconds / 4000)
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    output[i] = (random() * 2 - 1) * attack(t, 0.0005) * envelope(t, tau)
  }
  return output
}

function filterFrequency(frequency: number, sampleRate: number): number {
  return clamp(frequency, 20, sampleRate * 0.45)
}

function biquad(data: Float32Array, sampleRate: number, type: FilterType, frequency: number, q: number): void {
  const omega = TAU * filterFrequency(frequency, sampleRate) / sampleRate
  const cosine = Math.cos(omega)
  const sine = Math.sin(omega)
  const alpha = sine / (2 * Math.max(0.001, q))
  let b0: number
  let b1: number
  let b2: number
  if (type === 'lowpass') {
    b0 = (1 - cosine) / 2
    b1 = 1 - cosine
    b2 = b0
  } else if (type === 'highpass') {
    b0 = (1 + cosine) / 2
    b1 = -(1 + cosine)
    b2 = b0
  } else {
    b0 = alpha
    b1 = 0
    b2 = -alpha
  }
  const a0 = 1 + alpha
  const a1 = -2 * cosine
  const a2 = 1 - alpha
  b0 /= a0
  b1 /= a0
  b2 /= a0
  const na1 = a1 / a0
  const na2 = a2 / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < data.length; i++) {
    const x = data[i]
    const y = b0 * x + b1 * x1 + b2 * x2 - na1 * y1 - na2 * y2
    data[i] = y
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
  }
}

function add(target: Float32Array, source: Float32Array, level = 1): void {
  const length = Math.min(target.length, source.length)
  for (let i = 0; i < length; i++) target[i] += source[i] * level
}

function applyEnvelope(data: Float32Array, sampleRate: number, amplitude: (t: number) => number): void {
  for (let i = 0; i < data.length; i++) data[i] *= amplitude(i / sampleRate)
}

function saturate(data: Float32Array, gain: number, normalized = false): void {
  const scale = normalized ? 1 / Math.tanh(gain) : 1
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * gain) * scale
}

function delayedCopy(data: Float32Array, sampleRate: number, milliseconds: number, level: number): void {
  const delay = Math.round(milliseconds * sampleRate / 1000)
  for (let i = data.length - 1; i >= delay; i--) data[i] += data[i - delay] * level
}

function metal(
  length: number,
  sampleRate: number,
  tune: number,
  multiplier = 1
): Float32Array {
  const output = new Float32Array(length)
  const phases = new Float64Array(METAL_FREQUENCIES.length)
  const increments = METAL_FREQUENCIES.map((frequency) => frequency * tune * multiplier / sampleRate)
  for (let i = 0; i < length; i++) {
    let value = 0
    for (let oscillator = 0; oscillator < phases.length; oscillator++) {
      phases[oscillator] += increments[oscillator]
      phases[oscillator] -= Math.floor(phases[oscillator])
      value += phases[oscillator] < 0.5 ? 1 : -1
    }
    output[i] = value / phases.length
  }
  return output
}

function longestTau(id: DrumVoiceId, model: string, decay: number): number {
  if (id === 'kick') return (model === 'rumble' ? 0.55 : model === '808' ? 0.42 : model === '909' ? 0.2 : 0.14) * decay
  if (id === 'snare') return (model === '808' ? 0.13 : model === '909' ? 0.18 : model === 'crack' ? 0.09 : 0.22) * decay
  if (id === 'clap') return (model === 'big' ? 0.26 : 0.11) * decay
  if (id === 'hat') return (model === '808' ? 0.022 : model === '909' ? 0.035 : 0.05) * decay
  if (id === 'openhat') return (model === '808' ? 0.28 : 0.4) * decay
  if (id === 'perc') return (model === 'rim' ? 0.009 : model === 'cowbell' ? 0.12 : model === 'conga' ? 0.11 : 0.22) * decay
  if (id === 'crash') return (model === 'ride' ? 0.7 : 0.9) * decay
  return 0.8 * decay
}

function renderKick(
  output: Float32Array,
  model: string,
  sampleRate: number,
  f: number,
  d: number,
  tone: number,
  random: () => number
): void {
  if (model === '808') {
    decayingOscillator(output, sampleRate, 'sine', f * 52, 1.6, 0.02, 0.42 * d, 1, 0.0005)
    saturate(output, 1.4)
    const transient = click(output.length, 2, sampleRate, random)
    biquad(transient, sampleRate, 'highpass', f * (1500 + tone * 3500), 0.707)
    add(output, transient, 0.06 + tone * 0.25)
    return
  }
  if (model === 'boom') {
    decayingOscillator(output, sampleRate, 'sine', f * 62, 1.5, 0.03, 0.14 * d, 1, 0.001)
    const beater = noise(output.length, random)
    biquad(beater, sampleRate, 'bandpass', f * (1200 + tone * 2800), 0.9)
    applyDecay(beater, sampleRate, 0.006)
    add(output, beater, 0.35)
    saturate(output, 2.2)
    biquad(output, sampleRate, 'lowpass', f * (2500 + tone * 6000), 0.7)
    return
  }
  const base = model === 'rumble' ? 50 : 56
  const pitchAmount = model === 'rumble' ? 4 : 4
  decayingOscillator(output, sampleRate, 'sine', f * base, pitchAmount, 0.011, (model === 'rumble' ? 0.16 : 0.2) * d, 1, 0.0005)
  const transient = click(output.length, 4, sampleRate, random)
  biquad(transient, sampleRate, 'highpass', f * 3000, 0.707)
  add(output, transient, 0.15 + tone * 0.5)
  decayingOscillator(output, sampleRate, 'sine', f * 1600, 0, 1, 0.0025, 0.25 + tone * 0.3)
  saturate(output, 1.8)
  if (model === 'rumble') {
    const tail = new Float32Array(output.length)
    decayingOscillator(tail, sampleRate, 'sine', f * 50, 0, 1, 0.55 * d, 1, 0.03)
    saturate(tail, 5)
    biquad(tail, sampleRate, 'lowpass', f * (180 + tone * 400), 0.707)
    add(output, tail, 0.6)
  }
}

function renderSnare(
  output: Float32Array,
  model: string,
  sampleRate: number,
  f: number,
  d: number,
  tone: number,
  random: () => number
): void {
  if (model === '808') {
    decayingOscillator(output, sampleRate, 'sine', f * 238, 0.1, 0.015, 0.07 * d, 0.8)
    decayingOscillator(output, sampleRate, 'sine', f * 476, 0.1, 0.015, 0.045 * d, 0.4)
    const hiss = noise(output.length, random)
    biquad(hiss, sampleRate, 'highpass', f * (900 + tone * 2400), 0.707)
    applyDecay(hiss, sampleRate, 0.13 * d)
    add(output, hiss, 0.45 + tone * 0.4)
    return
  }
  if (model === '909') {
    const lowBody = new Float32Array(output.length)
    const highBody = new Float32Array(output.length)
    decayingOscillator(lowBody, sampleRate, 'sine', f * 185, 0.3, 0.015, 0.085 * d, 0.7)
    decayingOscillator(highBody, sampleRate, 'sine', f * 330, 0.3, 0.015, 0.06 * d, 0.45)
    saturate(lowBody, 1.5)
    saturate(highBody, 1.5)
    add(output, lowBody)
    add(output, highBody)
    const hiss = noise(output.length, random)
    biquad(hiss, sampleRate, 'bandpass', f * (3500 + tone * 4000), 0.6)
    biquad(hiss, sampleRate, 'highpass', f * 1500, 0.707)
    applyDecay(hiss, sampleRate, 0.18 * d)
    add(output, hiss, 0.6 + tone * 0.3)
    add(output, click(output.length, 1.5, sampleRate, random), 0.4)
    return
  }
  if (model === 'crack') {
    decayingOscillator(output, sampleRate, 'sine', f * 220, 0, 1, 0.04 * d, 0.6)
    const hiss = noise(output.length, random)
    biquad(hiss, sampleRate, 'highpass', f * (2000 + tone * 2500), 0.707)
    applyDecay(hiss, sampleRate, 0.09 * d)
    add(output, hiss, 0.9)
    add(output, click(output.length, 1.5, sampleRate, random), 0.6)
    saturate(output, 2)
    return
  }
  decayingOscillator(output, sampleRate, 'sine', f * 180, 0, 1, 0.1 * d, 0.8)
  decayingOscillator(output, sampleRate, 'sine', f * 280, 0, 1, 0.07 * d, 0.5)
  const hiss = noise(output.length, random)
  biquad(hiss, sampleRate, 'highpass', f * 700, 0.707)
  biquad(hiss, sampleRate, 'lowpass', f * (4500 + tone * 5000), 0.707)
  applyDecay(hiss, sampleRate, 0.22 * d)
  add(output, hiss, 0.7)
  saturate(output, 2.4)
  delayedCopy(output, sampleRate, 23, 0.15)
  delayedCopy(output, sampleRate, 11, 0.25)
}

function renderClap(
  output: Float32Array,
  model: string,
  sampleRate: number,
  f: number,
  d: number,
  tone: number,
  random: () => number
): void {
  const big = model === 'big'
  const filtered = noise(output.length, random)
  biquad(filtered, sampleRate, 'bandpass', f * 1100 * (0.7 + tone * 0.9), big ? 0.8 : 1.2)
  biquad(filtered, sampleRate, 'highpass', f * 500, 0.707)
  const starts = big ? [0, 0.009, 0.019, 0.03, 0.041] : [0, 0.011, 0.021, 0.032]
  const levels = big ? [0.9, 0.8, 0.75, 0.72, 1] : [0.9, 0.8, 0.75, 1]
  const tailStart = starts[starts.length - 1]
  for (let i = 0; i < output.length; i++) {
    const t = i / sampleRate
    let amp = 0
    for (let burst = 0; burst < starts.length; burst++) {
      const local = t - starts[burst]
      if (local >= 0) amp += levels[burst] * attack(local, 0.0003) * envelope(local, 0.0045)
    }
    if (t >= tailStart) amp += envelope(t - tailStart, (big ? 0.26 : 0.11) * d)
    output[i] = filtered[i] * amp
  }
  if (big) {
    delayedCopy(output, sampleRate, 37, 0.22)
    delayedCopy(output, sampleRate, 23, 0.35)
  }
}

function renderHat(
  output: Float32Array,
  id: 'hat' | 'openhat',
  model: string,
  sampleRate: number,
  f: number,
  d: number,
  tone: number,
  random: () => number
): void {
  const tau = id === 'openhat' ? (model === '808' ? 0.28 : 0.4) : model === '808' ? 0.022 : model === '909' ? 0.035 : 0.05
  if (model === 'shaker') {
    const shaker = noise(output.length, random)
    biquad(shaker, sampleRate, 'bandpass', f * (4500 + tone * 4000), 1.5)
    applyEnvelope(shaker, sampleRate, (t) => Math.min(1, t / 0.006) * envelope(Math.max(0, t - 0.006), tau * d))
    add(output, shaker)
    return
  }
  const metallic = metal(output.length, sampleRate, f)
  biquad(metallic, sampleRate, 'bandpass', f * (7000 + tone * 5000), 1)
  biquad(metallic, sampleRate, 'highpass', f * 7000, 0.707)
  if (model === '909') {
    const hiss = noise(output.length, random)
    biquad(hiss, sampleRate, 'highpass', f * (6000 + tone * 3000), 0.707)
    add(hiss, metallic, 0.4)
    applyDecay(hiss, sampleRate, tau * d)
    add(output, hiss)
  } else {
    applyDecay(metallic, sampleRate, tau * d, 0.0003)
    add(output, metallic)
  }
}

function renderPerc(
  output: Float32Array,
  model: string,
  sampleRate: number,
  f: number,
  d: number,
  tone: number,
  random: () => number
): void {
  if (model === 'rim') {
    decayingOscillator(output, sampleRate, 'sine', f * 455, 0, 1, 0.009 * d, 0.7)
    decayingOscillator(output, sampleRate, 'sine', f * 1667, 0, 1, 0.006 * d, 0.5)
    add(output, click(output.length, 1, sampleRate, random), 0.5)
    biquad(output, sampleRate, 'highpass', f * 300, 0.707)
    return
  }
  if (model === 'cowbell') {
    decayingOscillator(output, sampleRate, 'square', f * 540, 0, 1, 0.012, 0.3)
    decayingOscillator(output, sampleRate, 'square', f * 540, 0, 1, 0.12 * d, 0.2)
    decayingOscillator(output, sampleRate, 'square', f * 800, 0, 1, 0.012, 0.3)
    decayingOscillator(output, sampleRate, 'square', f * 800, 0, 1, 0.12 * d, 0.2)
    biquad(output, sampleRate, 'bandpass', f * (2000 + tone * 1500), 1.5)
    return
  }
  if (model === 'conga') {
    decayingOscillator(output, sampleRate, 'sine', f * 310, 0.3, 0.02, 0.11 * d)
    const transient = click(output.length, 1, sampleRate, random)
    biquad(transient, sampleRate, 'lowpass', f * 4000, 0.707)
    add(output, transient, 0.1 + tone * 0.3)
    return
  }
  decayingOscillator(output, sampleRate, 'sine', f * 140, 0.6, 0.06, 0.22 * d)
  const transient = noise(output.length, random)
  biquad(transient, sampleRate, 'lowpass', f * 2000, 0.707)
  applyDecay(transient, sampleRate, 0.05)
  add(output, transient, 0.15)
}

function renderCrash(
  output: Float32Array,
  model: string,
  sampleRate: number,
  f: number,
  d: number,
  tone: number,
  random: () => number
): void {
  const metallic = metal(output.length, sampleRate, f, 2)
  if (model === 'ride') {
    biquad(metallic, sampleRate, 'bandpass', f * (5000 + tone * 2500), 1.5)
    add(output, metallic, 0.8)
    decayingOscillator(output, sampleRate, 'sine', f * 3100, 0, 1, 0.35 * d, 0.3)
    decayingOscillator(output, sampleRate, 'sine', f * 4650, 0, 1, 0.35 * d, 0.3)
    const hiss = noise(output.length, random)
    biquad(hiss, sampleRate, 'highpass', f * 6000, 0.707)
    add(output, hiss, 0.25)
    applyDecay(output, sampleRate, 0.7 * d, 0.001)
    return
  }
  const hiss = noise(output.length, random)
  biquad(hiss, sampleRate, 'highpass', f * (3000 + tone * 3000), 0.707)
  add(hiss, metallic, 0.5)
  biquad(hiss, sampleRate, 'bandpass', f * 8000, 0.5)
  applyDecay(hiss, sampleRate, 0.9 * d, 0.002)
  add(output, hiss)
}

function renderBass(output: Float32Array, model: string, sampleRate: number, f: number, d: number, tone: number): void {
  decayingOscillator(output, sampleRate, 'sine', f * 49, 0.08, 0.04, 0.8 * d, 1, 0.001)
  saturate(output, model === 'dirty' ? 4 : 1.3)
  if (model === 'dirty') biquad(output, sampleRate, 'lowpass', f * (600 + tone * 2400), 0.8)
}

export function renderDrum(id: DrumVoiceId, voice: VoiceSettings, sampleRate: number): Float32Array {
  const rate = clamp(sampleRate, 8000, 192000)
  const available = DRUM_MODELS[id] as readonly string[]
  const model = available.includes(voice.model) ? voice.model : DRUM_MODELS[id][0]
  const tune = 2 ** (clamp(voice.tune, -24, 24) / 12)
  const decay = clamp(voice.decay, 0.1, 4)
  const tone = clamp(voice.tone, 0, 1)
  const seconds = clamp(7 * longestTau(id, model, decay) + 0.005, 0.03, 4)
  const output = new Float32Array(Math.max(1, Math.ceil(seconds * rate)))
  const modelIndex = Math.max(0, available.indexOf(model))
  const random = mulberry32(VOICE_SEEDS[id] ^ Math.imul(modelIndex + 1, 0x9e3779b1))

  if (id === 'kick') renderKick(output, model, rate, tune, decay, tone, random)
  else if (id === 'snare') renderSnare(output, model, rate, tune, decay, tone, random)
  else if (id === 'clap') renderClap(output, model, rate, tune, decay, tone, random)
  else if (id === 'hat' || id === 'openhat') renderHat(output, id, model, rate, tune, decay, tone, random)
  else if (id === 'perc') renderPerc(output, model, rate, tune, decay, tone, random)
  else if (id === 'crash') renderCrash(output, model, rate, tune, decay, tone, random)
  else renderBass(output, model, rate, tune, decay, tone)

  const drive = clamp(voice.drive, 0, 1)
  if (drive >= 0.01) saturate(output, 1 + drive * 7, true)
  let peak = 0
  for (const sample of output) peak = Math.max(peak, Math.abs(sample))
  if (peak > 0) {
    const scale = 0.9 / peak
    for (let i = 0; i < output.length; i++) output[i] *= scale
  }
  const fadeSamples = Math.min(output.length, Math.ceil(rate * 0.005))
  for (let i = 0; i < fadeSamples; i++) {
    output[output.length - fadeSamples + i] *= 1 - i / Math.max(1, fadeSamples - 1)
  }
  const quietTail = Math.min(output.length, Math.ceil(rate * 0.002))
  for (let i = output.length - quietTail; i < output.length; i++) output[i] = 0
  return output
}
