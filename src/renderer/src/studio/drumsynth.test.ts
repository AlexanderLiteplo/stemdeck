/**
 * Run with `npm test`. Plain assertions, no test framework: the file is bundled
 * with esbuild and executed by node, and throws on the first failure.
 */
import { renderDrum } from './drumsynth'
import { DRUM_MODELS, DRUM_VOICES, type DrumModel, type DrumVoiceId } from './types'

const sampleRate = 48000
let checks = 0

function assert(condition: boolean, message: string): void {
  checks += 1
  if (!condition) throw new Error(`check ${checks} failed: ${message}`)
}

function settings(model: DrumModel, tune = 0, decay = 1, tone = 0.5, drive = 0) {
  return { model, tune, decay, tone, drive }
}

function peakOf(data: Float32Array): number {
  let peak = 0
  for (const sample of data) peak = Math.max(peak, Math.abs(sample))
  return peak
}

function zeroCrossingRate(data: Float32Array, seconds = 0.1): number {
  const length = Math.min(data.length, Math.floor(sampleRate * seconds))
  let crossings = 0
  for (let i = 1; i < length; i++) {
    if ((data[i - 1] < 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] < 0)) crossings += 1
  }
  return crossings / Math.max(1, length - 1)
}

function checkBuffer(id: DrumVoiceId, model: DrumModel, data: Float32Array): void {
  let finite = true
  for (const sample of data) {
    if (!Number.isFinite(sample)) {
      finite = false
      break
    }
  }
  assert(finite, `${id}/${model}: every sample should be finite`)
  const peak = peakOf(data)
  assert(peak >= 0.5 && peak <= 0.9001, `${id}/${model}: peak ${peak} outside 0.5..0.9001`)
  assert(data.length >= sampleRate * 0.03 && data.length <= sampleRate * 4, `${id}/${model}: invalid length ${data.length}`)
  const tailStart = Math.max(0, data.length - Math.ceil(sampleRate * 0.002))
  let tailPeak = 0
  for (let i = tailStart; i < data.length; i++) tailPeak = Math.max(tailPeak, Math.abs(data[i]))
  assert(tailPeak < 0.02, `${id}/${model}: final 2 ms peak ${tailPeak} is too loud`)
}

function checkDeterminism(id: DrumVoiceId, model: DrumModel, first: Float32Array, second: Float32Array): void {
  assert(first.length === second.length, `${id}/${model}: deterministic renders differ in length`)
  let identical = true
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) {
      identical = false
      break
    }
  }
  assert(identical, `${id}/${model}: deterministic renders differ`)
}

for (const id of DRUM_VOICES) {
  for (const rawModel of DRUM_MODELS[id]) {
    const model = rawModel as DrumModel
    for (const tune of [-24, 0, 24]) {
      for (const decay of [0.1, 1, 4]) {
        const first = renderDrum(id, settings(model, tune, decay), sampleRate)
        const second = renderDrum(id, settings(model, tune, decay), sampleRate)
        checkBuffer(id, model, first)
        checkDeterminism(id, model, first, second)
      }
    }
    for (const tone of [0, 1]) {
      for (const drive of [0, 1]) {
        const first = renderDrum(id, settings(model, 0, 1, tone, drive), sampleRate)
        const second = renderDrum(id, settings(model, 0, 1, tone, drive), sampleRate)
        checkBuffer(id, model, first)
        checkDeterminism(id, model, first, second)
      }
    }
    const short = renderDrum(id, settings(model, 0, 0.1), sampleRate)
    const long = renderDrum(id, settings(model, 0, 4), sampleRate)
    assert(long.length === sampleRate * 4 || long.length > short.length, `${id}/${model}: decay does not increase length`)
  }
}

for (const [id, model] of [['kick', '808'], ['perc', 'tom'], ['bass808', 'clean']] as const) {
  const low = renderDrum(id, settings(model, -12), sampleRate)
  const high = renderDrum(id, settings(model, 12), sampleRate)
  assert(zeroCrossingRate(high) > zeroCrossingRate(low), `${id}/${model}: tune does not raise zero-crossing rate`)
}

const kickRate = zeroCrossingRate(renderDrum('kick', settings('808'), sampleRate))
const snareRate = zeroCrossingRate(renderDrum('snare', settings('909'), sampleRate))
const hatRate = zeroCrossingRate(renderDrum('hat', settings('808'), sampleRate))
assert(kickRate < snareRate && snareRate < hatRate, `character order failed: ${kickRate}, ${snareRate}, ${hatRate}`)

const start = performance.now()
for (const id of DRUM_VOICES) {
  for (const rawModel of DRUM_MODELS[id]) renderDrum(id, settings(rawModel as DrumModel), sampleRate)
}
const elapsed = performance.now() - start
assert(elapsed < 200, `default render sweep took ${elapsed.toFixed(1)} ms`)

console.log(`drumsynth: rendered every model in ${elapsed.toFixed(1)} ms`)
console.log(`drumsynth: ${checks} checks passed`)
