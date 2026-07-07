declare module 'essentia.js/dist/essentia.js-core.es.js' {
  export default class Essentia {
    constructor(EssentiaWASM: unknown, isDebug?: boolean)
    arrayToVector(inputArray: Float32Array): unknown
    vectorToArray(inputVector: unknown): Float32Array
    RhythmExtractor2013(
      signal: unknown,
      maxTempo?: number,
      method?: string,
      minTempo?: number
    ): { bpm: number; ticks: unknown; confidence: number; estimates: unknown; bpmIntervals: unknown }
  }
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown
}
