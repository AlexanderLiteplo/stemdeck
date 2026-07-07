/** Minimal AudioWorklet global scope typings (not included in lib.dom). */
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void

declare const sampleRate: number
declare const currentFrame: number
