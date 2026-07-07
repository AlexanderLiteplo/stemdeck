/**
 * Offline BPM + beat-phase estimation via onset-energy autocorrelation.
 * Good enough to beatmatch typical dance/pop/hip-hop material; the pitch
 * fader and nudge buttons cover the rest, like real DJing.
 */

export interface BpmResult {
  bpm: number
  /** Seconds offset of the first beat, for beat-snapped loops. */
  firstBeat: number
}

const HOP = 512
const WIN = 1024
const MIN_BPM = 60
const MAX_BPM = 200

export function detectBpm(mono: Float32Array, sampleRate: number): BpmResult {
  // Analyze up to 120s starting 15s in (skip intros with weak onsets).
  const startSample = Math.min(Math.floor(15 * sampleRate), Math.floor(mono.length / 4))
  const endSample = Math.min(mono.length, startSample + 120 * sampleRate)
  const slice = mono.subarray(startSample, endSample)

  const numHops = Math.max(0, Math.floor((slice.length - WIN) / HOP))
  if (numHops < 200) return { bpm: 0, firstBeat: 0 }

  // Energy envelope
  const env = new Float32Array(numHops)
  for (let i = 0; i < numHops; i++) {
    let sum = 0
    const off = i * HOP
    for (let j = 0; j < WIN; j++) {
      const v = slice[off + j]
      sum += v * v
    }
    env[i] = Math.sqrt(sum / WIN)
  }

  // Onset novelty: half-wave rectified derivative, mean-normalized
  const novelty = new Float32Array(numHops)
  let mean = 0
  for (let i = 1; i < numHops; i++) {
    novelty[i] = Math.max(0, env[i] - env[i - 1])
    mean += novelty[i]
  }
  mean /= numHops
  if (mean <= 0) return { bpm: 0, firstBeat: 0 }
  for (let i = 0; i < numHops; i++) novelty[i] /= mean

  const hopsPerSecond = sampleRate / HOP
  const minLag = Math.floor((60 / MAX_BPM) * hopsPerSecond)
  const maxLag = Math.ceil((60 / MIN_BPM) * hopsPerSecond)

  // Autocorrelation with harmonic reinforcement
  const scores = new Float32Array(maxLag + 1)
  let bestLag = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0
    const n = numHops - lag
    for (let i = 0; i < n; i++) ac += novelty[i] * novelty[i + lag]
    scores[lag] = ac / n
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = scores[lag]
    const double = lag * 2
    if (double <= maxLag) score += 0.5 * scores[double]
    const half = Math.round(lag / 2)
    if (half >= minLag) score += 0.25 * scores[half]
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  // Parabolic refinement around the peak
  let refinedLag = bestLag
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = scores[bestLag - 1]
    const y1 = scores[bestLag]
    const y2 = scores[bestLag + 1]
    const denom = y0 - 2 * y1 + y2
    if (Math.abs(denom) > 1e-9) refinedLag = bestLag + (0.5 * (y0 - y2)) / denom
  }

  let bpm = (60 * hopsPerSecond) / refinedLag
  // Fold into the DJ-typical range
  while (bpm < 70) bpm *= 2
  while (bpm >= 180) bpm /= 2

  // Beat phase: comb-sum novelty at the beat period, best offset wins
  const periodHops = (60 / bpm) * hopsPerSecond
  const combLen = Math.floor(numHops / periodHops) - 1
  let bestOffset = 0
  let bestComb = -Infinity
  const offsetSteps = Math.floor(periodHops)
  for (let o = 0; o < offsetSteps; o++) {
    let sum = 0
    for (let k = 0; k < combLen; k++) sum += novelty[Math.floor(o + k * periodHops)]
    if (sum > bestComb) {
      bestComb = sum
      bestOffset = o
    }
  }
  let firstBeat = (startSample + bestOffset * HOP) / sampleRate
  const beatLen = 60 / bpm
  while (firstBeat - beatLen >= 0) firstBeat -= beatLen

  return { bpm: Math.round(bpm * 100) / 100, firstBeat }
}
