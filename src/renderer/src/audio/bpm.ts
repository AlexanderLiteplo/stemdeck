/**
 * Offline BPM + beat-phase estimation.
 *
 * Pipeline:
 *  1. Spectral-flux novelty curve (STFT, log-compressed magnitudes) —
 *     picks up onsets that broadband energy misses.
 *  2. Autocorrelation with harmonic reinforcement for coarse tempo
 *     candidates (also resolves the half/double-time octave).
 *  3. Fine comb-filter grid search around each candidate for sub-0.1 BPM
 *     precision, jointly estimating the beat phase.
 */

export interface BpmResult {
  bpm: number
  /** Seconds offset of the first beat, for beat-snapped loops and sync. */
  firstBeat: number
}

const WIN = 1024
const HOP = 256
const MIN_BPM = 60
const MAX_BPM = 200
const ANALYZE_SECONDS = 70

/** In-place iterative radix-2 complex FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const vRe = re[b] * curRe - im[b] * curIm
        const vIm = re[b] * curIm + im[b] * curRe
        re[b] = re[a] - vRe
        im[b] = im[a] - vIm
        re[a] += vRe
        im[a] += vIm
        const nRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nRe
      }
    }
  }
}

interface NoveltyCurves {
  /** Full-spectrum flux: best for tempo. */
  full: Float32Array
  /** Low-frequency (< ~260Hz) flux: kicks/bass, best for beat phase. */
  low: Float32Array
}

function localMeanSubtract(curve: Float32Array, avgWindow: number): Float32Array {
  const out = new Float32Array(curve.length)
  let acc = 0
  for (let i = 0; i < curve.length; i++) {
    acc += curve[i]
    if (i >= avgWindow) acc -= curve[i - avgWindow]
    const mean = acc / Math.min(i + 1, avgWindow)
    out[i] = Math.max(0, curve[i] - mean)
  }
  return out
}

/** Spectral-flux novelty curves, locally mean-subtracted and rectified. */
function noveltyCurve(mono: Float32Array, sampleRate: number): NoveltyCurves {
  const numFrames = Math.floor((mono.length - WIN) / HOP)
  const full = new Float32Array(Math.max(0, numFrames))
  const low = new Float32Array(Math.max(0, numFrames))
  if (numFrames <= 0) return { full, low }

  const hann = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN)

  const re = new Float32Array(WIN)
  const im = new Float32Array(WIN)
  const bins = WIN / 2
  const lowBins = Math.max(3, Math.ceil(260 / (sampleRate / WIN)))
  const prevMag = new Float32Array(bins)
  const mag = new Float32Array(bins)

  for (let f = 0; f < numFrames; f++) {
    const off = f * HOP
    for (let i = 0; i < WIN; i++) {
      re[i] = mono[off + i] * hann[i]
      im[i] = 0
    }
    fft(re, im)
    let flux = 0
    let lowFlux = 0
    for (let b = 1; b < bins; b++) {
      mag[b] = Math.log1p(10 * Math.sqrt(re[b] * re[b] + im[b] * im[b]))
      const d = mag[b] - prevMag[b]
      if (d > 0) {
        flux += d
        if (b <= lowBins) lowFlux += d
      }
      prevMag[b] = mag[b]
    }
    full[f] = flux
    low[f] = lowFlux
  }

  // Subtract a moving local average (~1s) so sustained loudness doesn't count
  const avgWindow = Math.round(sampleRate / HOP)
  return {
    full: localMeanSubtract(full, avgWindow),
    low: localMeanSubtract(low, avgWindow)
  }
}

interface CombResult {
  score: number
  offsetHops: number
}

/** Best comb-filter score for a beat period, over a grid of phases. */
function combScore(novelty: Float32Array, periodHops: number): CombResult {
  const n = novelty.length
  const read = (x: number): number => {
    const i = Math.floor(x)
    if (i < 0 || i >= n - 1) return 0
    const frac = x - i
    return novelty[i] * (1 - frac) + novelty[i + 1] * frac
  }
  const phaseSteps = 48
  let best: CombResult = { score: 0, offsetHops: 0 }
  for (let p = 0; p < phaseSteps; p++) {
    const offset = (p / phaseSteps) * periodHops
    let sum = 0
    let count = 0
    for (let x = offset; x < n; x += periodHops) {
      sum += read(x)
      count++
    }
    if (count > 0 && sum / count > best.score) {
      best = { score: sum / count, offsetHops: offset }
    }
  }
  return best
}

/** Refine a BPM candidate with a two-stage fine grid search. */
function refineCandidate(
  novelty: Float32Array,
  hopsPerSecond: number,
  bpm: number
): { bpm: number; comb: CombResult } {
  let bestBpm = bpm
  let bestComb = combScore(novelty, (60 / bpm) * hopsPerSecond)
  for (const [span, steps] of [
    [0.04, 33],
    [0.004, 21]
  ] as const) {
    const center = bestBpm
    for (let s = 0; s < steps; s++) {
      const candidate = center * (1 - span + (2 * span * s) / (steps - 1))
      const comb = combScore(novelty, (60 / candidate) * hopsPerSecond)
      if (comb.score > bestComb.score) {
        bestComb = comb
        bestBpm = candidate
      }
    }
  }
  return { bpm: bestBpm, comb: bestComb }
}

export function detectBpm(mono: Float32Array, sampleRate: number): BpmResult {
  // Analyze the middle of the track, where the groove is steadiest.
  const analyzeSamples = Math.min(mono.length, ANALYZE_SECONDS * sampleRate)
  const startSample = Math.max(0, Math.floor((mono.length - analyzeSamples) / 2))
  const slice = mono.subarray(startSample, startSample + analyzeSamples)

  const { full: novelty, low: lowNovelty } = noveltyCurve(slice, sampleRate)
  const numHops = novelty.length
  const hopsPerSecond = sampleRate / HOP
  if (numHops < 8 * hopsPerSecond) return { bpm: 0, firstBeat: 0 }

  let mean = 0
  for (let i = 0; i < numHops; i++) mean += novelty[i]
  mean /= numHops
  if (mean <= 1e-6) return { bpm: 0, firstBeat: 0 }

  // Coarse tempo via autocorrelation
  const minLag = Math.floor((60 / MAX_BPM) * hopsPerSecond)
  const maxLag = Math.ceil((60 / MIN_BPM) * hopsPerSecond)
  const ac = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    const n = numHops - lag
    for (let i = 0; i < n; i++) sum += novelty[i] * novelty[i + lag]
    ac[lag] = sum / n
  }
  const harmonicScore = (lag: number): number => {
    let score = ac[lag]
    const double = lag * 2
    if (double <= maxLag) score += 0.5 * ac[double]
    const half = Math.round(lag / 2)
    if (half >= minLag) score += 0.25 * ac[half]
    return score
  }

  // Top local maxima as candidates
  const peaks: { lag: number; score: number }[] = []
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const s = harmonicScore(lag)
    if (s >= harmonicScore(lag - 1) && s > harmonicScore(lag + 1)) {
      peaks.push({ lag, score: s })
    }
  }
  peaks.sort((a, b) => b.score - a.score)

  const candidates: number[] = []
  const pushCandidate = (bpm: number): void => {
    // Fold into the DJ-typical octave
    while (bpm < 70) bpm *= 2
    while (bpm >= 180) bpm /= 2
    if (!candidates.some((c) => Math.abs(c - bpm) / bpm < 0.03)) candidates.push(bpm)
  }
  for (const peak of peaks.slice(0, 4)) pushCandidate((60 * hopsPerSecond) / peak.lag)
  if (candidates.length === 0) return { bpm: 0, firstBeat: 0 }

  // Fine-tune each candidate; the comb score decides
  let best = refineCandidate(novelty, hopsPerSecond, candidates[0])
  for (const candidate of candidates.slice(1)) {
    const refined = refineCandidate(novelty, hopsPerSecond, candidate)
    if (refined.comb.score > best.comb.score) best = refined
  }

  // Beat phase from the low-frequency curve (kicks land on the beat;
  // full-spectrum flux is often dominated by offbeat hats). Fall back to
  // the full-spectrum phase when there's no bass content.
  let lowMean = 0
  for (let i = 0; i < numHops; i++) lowMean += lowNovelty[i]
  lowMean /= numHops
  const periodHops = (60 / best.bpm) * hopsPerSecond
  const phase = lowMean > 1e-6 ? combScore(lowNovelty, periodHops) : best.comb

  const beatLen = 60 / best.bpm
  let firstBeat = startSample / sampleRate + phase.offsetHops / hopsPerSecond
  while (firstBeat - beatLen >= 0) firstBeat -= beatLen

  return { bpm: Math.round(best.bpm * 100) / 100, firstBeat }
}
