import { AUTOTUNE_LATENCY_SAMPLES } from './autotune-latency'

export interface AutotuneSettings {
  enabled: boolean
  /** Root note, 0 = C .. 11 = B */
  key: number
  scale: 'major' | 'minor' | 'chromatic'
  /** 0 = no correction, 1 = fully snapped to the target note */
  strength: number
  /** Retune time in ms. 0 = instant hard-tune (the T-Pain sound). */
  retuneMs: number
  /** Dry/wet, 0 = dry only, 1 = corrected only */
  mix: number
}

const WINDOW_SIZE = 1024
const HOP_SIZE = 256
const YIN_THRESHOLD = 0.15
const RMS_FLOOR = Math.pow(10, -50 / 20)
const MIN_HZ = 70
const MAX_HZ = 1100
const RING_SIZE = 32768
const RING_MASK = RING_SIZE - 1
const MARK_CAPACITY = 4096
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

/**
 * Streaming monophonic pitch correction.
 *
 * YIN supplies pitch-synchronous analysis marks. TD-PSOLA then repeats or
 * skips those grains at synthesis marks whose spacing is the corrected
 * period. Input and output timelines advance together, so duration is
 * preserved. The fixed delay gives the detector enough causal look-ahead to
 * construct complete grains before their output slots are consumed.
 */
export class AutotuneEngine {
  readonly latencySamples: number

  private readonly sampleRate: number
  private settings: AutotuneSettings = {
    enabled: false,
    key: 0,
    scale: 'chromatic',
    strength: 1,
    retuneMs: 0,
    mix: 1
  }

  private readonly inputL = new Float32Array(RING_SIZE)
  private readonly inputR = new Float32Array(RING_SIZE)
  private readonly wetL = new Float32Array(RING_SIZE)
  private readonly wetR = new Float32Array(RING_SIZE)
  private readonly wetWeight = new Float32Array(RING_SIZE)
  private readonly yinDifference: Float64Array
  private readonly yinCmnd: Float64Array

  private inputWrite = 0
  private outputRead = 0
  private nextDetectionEnd = WINDOW_SIZE
  private detectedValue = 0
  private targetValue = 0
  private voiced = false
  private smoothedRatio = 1
  private nextAnalysisMark = Number.NaN
  private nextSynthesisMark = Number.NaN

  private readonly markTimes = new Float64Array(MARK_CAPACITY)
  private readonly markPeriods = new Float64Array(MARK_CAPACITY)
  private markHead = 0
  private markCount = 0

  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('sampleRate must be a positive finite number')
    }
    this.sampleRate = sampleRate
    // Two windows is deliberately fixed rather than dependent on pitch or
    // settings, which keeps automation and dry/wet alignment stable.
    // Single source of truth: the deck processor reads the vocal stem this far
    // ahead to cancel exactly this delay.
    this.latencySamples = AUTOTUNE_LATENCY_SAMPLES
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

    if (wasEnabled !== this.settings.enabled) this.clearState()
  }

  /** Process one block in place. left/right are same-length Float32Arrays. */
  process(left: Float32Array, right: Float32Array): void {
    if (left.length !== right.length) {
      throw new RangeError('left and right blocks must have the same length')
    }
    // The disabled path deliberately touches nothing: bypass is bit-exact.
    if (!this.settings.enabled || left.length === 0) return
    // AudioWorklet blocks are small, but keeping the plain DSP API robust for
    // larger callers also prevents an oversized block from lapping the ring.
    if (left.length > HOP_SIZE) {
      for (let offset = 0; offset < left.length; offset += HOP_SIZE) {
        const end = Math.min(left.length, offset + HOP_SIZE)
        this.process(left.subarray(offset, end), right.subarray(offset, end))
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
      this.analyse(this.nextDetectionEnd)
      this.nextDetectionEnd += HOP_SIZE
    }

    const mix = this.settings.mix
    for (let i = 0; i < left.length; i++) {
      const outputTime = this.outputRead + i
      const dryTime = outputTime - this.latencySamples
      let dryL = 0
      let dryR = 0
      if (dryTime >= 0 && dryTime < this.inputWrite) {
        const dryIndex = dryTime & RING_MASK
        dryL = this.inputL[dryIndex]
        dryR = this.inputR[dryIndex]
      }

      const wetIndex = outputTime & RING_MASK
      const weight = this.wetWeight[wetIndex]
      const shiftedL = weight > 1e-6 ? this.wetL[wetIndex] / weight : dryL
      const shiftedR = weight > 1e-6 ? this.wetR[wetIndex] / weight : dryR
      left[i] = dryL + (shiftedL - dryL) * mix
      right[i] = dryR + (shiftedR - dryR) * mix

      this.wetL[wetIndex] = 0
      this.wetR[wetIndex] = 0
      this.wetWeight[wetIndex] = 0
    }
    this.outputRead += left.length
  }

  /** Most recently detected input pitch in Hz, or 0 when unvoiced. */
  get detectedHz(): number {
    return this.detectedValue
  }

  /** Current target pitch in Hz, or 0 when not correcting. */
  get targetHz(): number {
    return this.targetValue
  }

  reset(): void {
    this.clearState()
  }

  private clearState(): void {
    this.inputL.fill(0)
    this.inputR.fill(0)
    this.wetL.fill(0)
    this.wetR.fill(0)
    this.wetWeight.fill(0)
    this.inputWrite = 0
    this.outputRead = 0
    this.nextDetectionEnd = WINDOW_SIZE
    this.detectedValue = 0
    this.targetValue = 0
    this.voiced = false
    this.smoothedRatio = 1
    this.nextAnalysisMark = Number.NaN
    this.nextSynthesisMark = Number.NaN
    this.markHead = 0
    this.markCount = 0
  }

  private analyse(frameEnd: number): void {
    const frameCenter = frameEnd - WINDOW_SIZE / 2
    const detected = this.detectYin(frameEnd)
    if (detected === 0) {
      this.clearWetRange(
        Math.floor(frameCenter - HOP_SIZE / 2 + this.latencySamples),
        Math.ceil(frameCenter + HOP_SIZE / 2 + this.latencySamples)
      )
      this.detectedValue = 0
      this.targetValue = 0
      this.voiced = false
      this.smoothedRatio = 1
      this.nextAnalysisMark = Number.NaN
      this.nextSynthesisMark = Number.NaN
      this.markHead = 0
      this.markCount = 0
      return
    }

    const period = this.sampleRate / detected
    const target = this.nearestScaleFrequency(detected)
    const detectedMidi = 69 + 12 * Math.log2(detected / 440)
    const targetMidi = 69 + 12 * Math.log2(target / 440)
    const correctedMidi =
      detectedMidi + (targetMidi - detectedMidi) * this.settings.strength
    const desiredRatio = Math.pow(2, (correctedMidi - detectedMidi) / 12)
    const onset = !this.voiced

    this.detectedValue = detected
    this.targetValue = target
    if (onset || this.settings.retuneMs === 0) {
      this.smoothedRatio = desiredRatio
    } else {
      const tauSamples = (this.settings.retuneMs / 1000) * this.sampleRate
      const coefficient = 1 - Math.exp(-HOP_SIZE / Math.max(1, tauSamples))
      this.smoothedRatio += (desiredRatio - this.smoothedRatio) * coefficient
    }

    if (onset) {
      const firstMark = this.findPitchMark(frameCenter, period)
      this.appendMark(firstMark, period)
      this.nextAnalysisMark = firstMark + period
      this.nextSynthesisMark = firstMark
      this.voiced = true
    }

    while (this.nextAnalysisMark <= frameCenter) {
      const mark = this.findPitchMark(this.nextAnalysisMark, period)
      this.appendMark(mark, period)
      this.nextAnalysisMark = mark + period
    }
    this.scheduleGrains()
  }

  private clearWetRange(start: number, end: number): void {
    for (let time = Math.max(start, this.outputRead); time < end; time++) {
      const index = time & RING_MASK
      this.wetL[index] = 0
      this.wetR[index] = 0
      this.wetWeight[index] = 0
    }
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
    const allowed =
      this.settings.scale === 'chromatic'
        ? null
        : this.settings.scale === 'major'
          ? MAJOR_INTERVALS
          : MINOR_INTERVALS
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

  private findPitchMark(near: number, period: number): number {
    const radius = Math.max(1, Math.floor(period * 0.25))
    const center = Math.round(near)
    let bestTime = center
    let bestValue = Number.NEGATIVE_INFINITY
    for (let time = center - radius; time <= center + radius; time++) {
      if (time < 0 || time >= this.inputWrite) continue
      const index = time & RING_MASK
      const mono = (this.inputL[index] + this.inputR[index]) * 0.5
      if (mono > bestValue) {
        bestValue = mono
        bestTime = time
      }
    }
    return bestTime
  }

  private appendMark(time: number, period: number): void {
    if (this.markCount === MARK_CAPACITY) {
      this.markHead = (this.markHead + 1) % MARK_CAPACITY
      this.markCount--
    }
    const tail = (this.markHead + this.markCount) % MARK_CAPACITY
    this.markTimes[tail] = time
    this.markPeriods[tail] = period
    this.markCount++
  }

  private scheduleGrains(): void {
    while (this.markCount >= 2 && Number.isFinite(this.nextSynthesisMark)) {
      while (
        this.markCount >= 2 &&
        this.markTimes[(this.markHead + 1) % MARK_CAPACITY] <= this.nextSynthesisMark
      ) {
        this.markHead = (this.markHead + 1) % MARK_CAPACITY
        this.markCount--
      }
      if (this.markCount < 2) break

      const first = this.markHead
      const second = (this.markHead + 1) % MARK_CAPACITY
      const firstTime = this.markTimes[first]
      const secondTime = this.markTimes[second]
      const chosen =
        Math.abs(this.nextSynthesisMark - firstTime) <=
        Math.abs(secondTime - this.nextSynthesisMark)
          ? first
          : second
      const sourceCenter = this.markTimes[chosen]
      const period = this.markPeriods[chosen]
      if (sourceCenter + Math.ceil(period) >= this.inputWrite) break

      this.addGrain(sourceCenter, this.nextSynthesisMark + this.latencySamples, period)
      this.nextSynthesisMark += period / this.smoothedRatio
    }
  }

  private addGrain(sourceCenter: number, outputCenter: number, period: number): void {
    const halfLength = Math.max(2, Math.round(period))
    for (let offset = -halfLength; offset <= halfLength; offset++) {
      const normalized = offset / halfLength
      const window = 0.5 + 0.5 * Math.cos(Math.PI * normalized)
      if (window <= 0) continue

      const sourceTime = sourceCenter + offset
      const sourceFloor = Math.floor(sourceTime)
      const sourceFraction = sourceTime - sourceFloor
      const sourceIndex0 = sourceFloor & RING_MASK
      const sourceIndex1 = (sourceFloor + 1) & RING_MASK
      const sampleL =
        this.inputL[sourceIndex0] +
        (this.inputL[sourceIndex1] - this.inputL[sourceIndex0]) * sourceFraction
      const sampleR =
        this.inputR[sourceIndex0] +
        (this.inputR[sourceIndex1] - this.inputR[sourceIndex0]) * sourceFraction

      const destinationTime = outputCenter + offset
      const destinationFloor = Math.floor(destinationTime)
      const destinationFraction = destinationTime - destinationFloor
      this.accumulate(destinationFloor, sampleL, sampleR, window * (1 - destinationFraction))
      this.accumulate(destinationFloor + 1, sampleL, sampleR, window * destinationFraction)
    }
  }

  private accumulate(time: number, left: number, right: number, weight: number): void {
    if (time < this.outputRead || weight <= 0) return
    const index = time & RING_MASK
    this.wetL[index] += left * weight
    this.wetR[index] += right * weight
    this.wetWeight[index] += weight
  }
}
