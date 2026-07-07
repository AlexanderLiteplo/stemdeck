import { detectBpm } from './bpm'

interface BpmRequest {
  id: string
  mono: Float32Array
  sampleRate: number
}

self.onmessage = (e: MessageEvent<BpmRequest>) => {
  const { id, mono, sampleRate } = e.data
  const result = detectBpm(mono, sampleRate)
  ;(self as unknown as Worker).postMessage({ id, ...result })
}
