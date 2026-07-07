import type { BpmResult } from './bpm'

export interface WaveformPeaks {
  /** Interleaved [min, max] pairs per bucket, values in [-1, 1]. */
  data: Float32Array
  buckets: number
}

export function computePeaks(buffer: AudioBuffer, buckets = 1200): WaveformPeaks {
  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0
  const data = new Float32Array(buckets * 2)
  const samplesPerBucket = Math.max(1, Math.floor(ch0.length / buckets))
  for (let b = 0; b < buckets; b++) {
    let min = 0
    let max = 0
    const start = b * samplesPerBucket
    const end = Math.min(start + samplesPerBucket, ch0.length)
    for (let i = start; i < end; i += 4) {
      const v = (ch0[i] + ch1[i]) * 0.5
      if (v < min) min = v
      if (v > max) max = v
    }
    data[b * 2] = min
    data[b * 2 + 1] = max
  }
  return { data, buckets }
}

export function mixdownMono(buffer: AudioBuffer): Float32Array {
  const ch0 = buffer.getChannelData(0)
  if (buffer.numberOfChannels === 1) return ch0.slice()
  const ch1 = buffer.getChannelData(1)
  const mono = new Float32Array(ch0.length)
  for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5
  return mono
}

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<string, (result: BpmResult) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./bpm.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<BpmResult & { id: string }>) => {
      const resolve = pending.get(e.data.id)
      if (resolve) {
        pending.delete(e.data.id)
        resolve({ bpm: e.data.bpm, firstBeat: e.data.firstBeat })
      }
    }
  }
  return worker
}

export function analyzeBpm(buffer: AudioBuffer): Promise<BpmResult> {
  const mono = mixdownMono(buffer)
  const id = `bpm-${requestCounter++}`
  return new Promise((resolve) => {
    pending.set(id, resolve)
    getWorker().postMessage({ id, mono, sampleRate: buffer.sampleRate }, [mono.buffer])
  })
}
