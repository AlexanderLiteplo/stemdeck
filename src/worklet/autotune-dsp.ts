export type AutotuneScale =
  | 'chromatic'
  | 'major'
  | 'minor'
  | 'majorPentatonic'
  | 'minorPentatonic'

export interface AutotuneSettings {
  enabled: boolean
  /** Root note, 0 = C .. 11 = B */
  key: number
  scale: AutotuneScale
  /** 0 = no correction, 1 = fully snapped to the target note */
  strength: number
  /** Retune time in ms. 0 = instant hard-tune (the T-Pain sound). */
  retuneMs: number
  /** Dry/wet, 0 = dry only, 1 = corrected only */
  mix: number
  /** Preserve the vocal formants while pitch-shifting. */
  formant: boolean
}

const WINDOW_SIZE = 1024
const HOP_SIZE = 256
const YIN_THRESHOLD = 0.15
const RMS_FLOOR = Math.pow(10, -50 / 20)
const MIN_HZ = 70
const MAX_HZ = 1100
const RING_SIZE = 32768
const RING_MASK = RING_SIZE - 1
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]
const MAJOR_PENTATONIC_INTERVALS = [0, 2, 4, 7, 9]
const MINOR_PENTATONIC_INTERVALS = [0, 3, 5, 7, 10]

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

/**
 * Streaming monophonic pitch analysis.
 *
 * YIN detects the input fundamental and the scale logic turns it into a
 * semitone correction for the downstream Signalsmith Stretch node. This
 * class is analysis-only: analyze() never writes to either input buffer.
 */
export class PitchAnalyzer {
  private readonly sampleRate: number
  private settings: AutotuneSettings = {
    enabled: false,
    key: 0,
    scale: 'minorPentatonic',
    strength: 1,
    retuneMs: 0,
    mix: 1,
    formant: true
  }

  private readonly inputL = new Float32Array(RING_SIZE)
  private readonly inputR = new Float32Array(RING_SIZE)
  private readonly yinDifference: Float64Array
  private readonly yinCmnd: Float64Array

  private inputWrite = 0
  private nextDetectionEnd = WINDOW_SIZE
  private detectedValue = 0
  private targetValue = 0
  private semitoneValue = 0
  private voiced = false

  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('sampleRate must be a positive finite number')
    }
    this.sampleRate = sampleRate
    const maxTau = Math.ceil(sampleRate / MIN_HZ)
    this.yinDifference = new Float64Array(maxTau + 2)
    this.yinCmnd = new Float64Array(maxTau + 2)
  }

  set(settings: Partial<AutotuneSettings>): void {
    const wasEnabled = this.settings.enabled
    if (settings.enabled !== undefined) this.settings.enabled = settings.enabled
    if (settings.key !== undefined) {
      this.settings.key = ((Math.round(settings.key) % 12) + 12) % 12
    }
    if (settings.scale !== undefined) this.settings.scale = settings.scale
    if (settings.strength !== undefined) {
      this.settings.strength = clamp(settings.strength, 0, 1)
    }
    if (settings.retuneMs !== undefined) {
      this.settings.retuneMs = Math.max(0, settings.retuneMs)
    }
    if (settings.mix !== undefined) this.settings.mix = clamp(settings.mix, 0, 1)
    if (settings.formant !== undefined) this.settings.formant = settings.formant

    if (wasEnabled !== this.settings.enabled) this.clearState()
  }

  /** Analyze a block without modifying either input buffer. */
  analyze(left: Float32Array, right: Float32Array): void {
    if (left.length !== right.length) {
      throw new RangeError('left and right blocks must have the same length')
    }
    if (!this.settings.enabled || left.length === 0) return
    if (left.length > HOP_SIZE) {
      for (let offset = 0; offset < left.length; offset += HOP_SIZE) {
        const end = Math.min(left.length, offset + HOP_SIZE)
        this.analyze(left.subarray(offset, end), right.subarray(offset, end))
      }
      return
    }

    const blockStart = this.inputWrite
    for (let i = 0; i < left.length; i++) {
      const ringIndex = (blockStart + i) & RING_MASK
      this.inputL[ringIndex] = left[i]
      this.inputR[ringIndex] = right[i]
    }
    this.inputWrite += left.length

    while (this.nextDetectionEnd <= this.inputWrite) {
      this.analyseFrame(this.nextDetectionEnd)
      this.nextDetectionEnd += HOP_SIZE
    }
  }

  /** Most recently detected input pitch in Hz, or 0 when unvoiced. */
  get detectedHz(): number {
    return this.detectedValue
  }

  /** Current snapped target pitch in Hz, or 0 when unvoiced. */
  get targetHz(): number {
    return this.targetValue
  }

  /** Smoothed target-minus-detected correction in semitones. */
  get semitones(): number {
    return this.semitoneValue
  }

  reset(): void {
    this.clearState()
  }

  private clearState(): void {
    this.inputL.fill(0)
    this.inputR.fill(0)
    this.inputWrite = 0
    this.nextDetectionEnd = WINDOW_SIZE
    this.detectedValue = 0
    this.targetValue = 0
    this.semitoneValue = 0
    this.voiced = false
  }

  private analyseFrame(frameEnd: number): void {
    const detected = this.detectYin(frameEnd)
    if (detected === 0) {
      this.detectedValue = 0
      this.targetValue = 0
      this.voiced = false
      // Keep the last correction through unvoiced gaps. Resetting it here
      // makes the shifter hunt between words and produces audible warble.
      return
    }

    const target = this.nearestScaleFrequency(detected)
    const detectedMidi = 69 + 12 * Math.log2(detected / 440)
    const targetMidi = 69 + 12 * Math.log2(target / 440)
    const desiredSemitones =
      this.settings.strength === 0
        ? 0
        : (targetMidi - detectedMidi) * this.settings.strength
    const onset = !this.voiced

    this.detectedValue = detected
    this.targetValue = target
    if (onset || this.settings.retuneMs === 0) {
      this.semitoneValue = desiredSemitones
    } else {
      const tauSamples = (this.settings.retuneMs / 1000) * this.sampleRate
      const coefficient = 1 - Math.exp(-HOP_SIZE / Math.max(1, tauSamples))
      this.semitoneValue += (desiredSemitones - this.semitoneValue) * coefficient
    }
    this.voiced = true
  }

  private detectYin(frameEnd: number): number {
    let sumSquares = 0
    const frameStart = frameEnd - WINDOW_SIZE
    for (let i = 0; i < WINDOW_SIZE; i++) {
      const index = (frameStart + i) & RING_MASK
      const mono = (this.inputL[index] + this.inputR[index]) * 0.5
      sumSquares += mono * mono
    }
    if (Math.sqrt(sumSquares / WINDOW_SIZE) < RMS_FLOOR) return 0

    const minTau = Math.max(2, Math.floor(this.sampleRate / MAX_HZ))
    const maxTau = Math.min(
      WINDOW_SIZE - 2,
      Math.ceil(this.sampleRate / MIN_HZ),
      this.yinDifference.length - 2
    )
    this.yinDifference[0] = 0
    for (let tau = 1; tau <= maxTau; tau++) {
      let difference = 0
      const limit = WINDOW_SIZE - tau
      for (let i = 0; i < limit; i++) {
        const aIndex = (frameStart + i) & RING_MASK
        const bIndex = (frameStart + i + tau) & RING_MASK
        const a = (this.inputL[aIndex] + this.inputR[aIndex]) * 0.5
        const b = (this.inputL[bIndex] + this.inputR[bIndex]) * 0.5
        const delta = a - b
        difference += delta * delta
      }
      this.yinDifference[tau] = difference
    }

    this.yinCmnd[0] = 1
    let runningSum = 0
    for (let tau = 1; tau <= maxTau; tau++) {
      runningSum += this.yinDifference[tau]
      this.yinCmnd[tau] =
        runningSum === 0 ? 1 : (this.yinDifference[tau] * tau) / runningSum
    }

    let chosenTau = 0
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (this.yinCmnd[tau] < YIN_THRESHOLD) {
        while (tau + 1 <= maxTau && this.yinCmnd[tau + 1] < this.yinCmnd[tau]) tau++
        chosenTau = tau
        break
      }
    }
    if (chosenTau === 0) return 0

    const before = this.yinCmnd[Math.max(1, chosenTau - 1)]
    const center = this.yinCmnd[chosenTau]
    const after = this.yinCmnd[Math.min(maxTau, chosenTau + 1)]
    const denominator = before - 2 * center + after
    const offset =
      Math.abs(denominator) > 1e-12 ? 0.5 * (before - after) / denominator : 0
    const interpolatedTau = chosenTau + clamp(offset, -1, 1)
    const hz = this.sampleRate / interpolatedTau
    return hz >= MIN_HZ && hz <= MAX_HZ ? hz : 0
  }

  private nearestScaleFrequency(hz: number): number {
    const midi = 69 + 12 * Math.log2(hz / 440)
    let allowed: readonly number[] | null
    switch (this.settings.scale) {
      case 'chromatic':
        allowed = null
        break
      case 'major':
        allowed = MAJOR_INTERVALS
        break
      case 'minor':
        allowed = MINOR_INTERVALS
        break
      case 'majorPentatonic':
        allowed = MAJOR_PENTATONIC_INTERVALS
        break
      case 'minorPentatonic':
        allowed = MINOR_PENTATONIC_INTERVALS
        break
    }
    let nearestMidi = Math.round(midi)
    let nearestDistance = Number.POSITIVE_INFINITY
    const low = Math.floor(midi) - 12
    const high = Math.ceil(midi) + 12
    for (let candidate = low; candidate <= high; candidate++) {
      const pitchClass = ((candidate - this.settings.key) % 12 + 12) % 12
      if (allowed && !allowed.includes(pitchClass)) continue
      const distance = Math.abs(candidate - midi)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestMidi = candidate
      }
    }
    return 440 * Math.pow(2, (nearestMidi - 69) / 12)
  }
}
