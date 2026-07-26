import { AutotuneEngine, type AutotuneSettings } from './autotune-dsp'

type AutotuneMessage = {
  type: 'settings'
  settings: Partial<AutotuneSettings>
}

const PITCH_POST_INTERVAL = 8

class AutotuneProcessor extends AudioWorkletProcessor {
  private readonly engine = new AutotuneEngine(sampleRate)
  private blockCounter = 0

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<AutotuneMessage>) => {
      if (event.data.type === 'settings') this.engine.set(event.data.settings)
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    const left = output[0]
    const right = output.length > 1 ? output[1] : output[0]

    if (!input || input.length === 0) {
      left.fill(0)
      right.fill(0)
    } else {
      left.set(input[0])
      right.set(input.length > 1 ? input[1] : input[0])
      this.engine.process(left, right)
    }

    this.blockCounter++
    if (this.blockCounter >= PITCH_POST_INTERVAL) {
      this.blockCounter = 0
      this.port.postMessage({
        type: 'pitch',
        detected: this.engine.detectedHz,
        target: this.engine.targetHz
      })
    }
    return true
  }
}

registerProcessor('autotune-processor', AutotuneProcessor)
