class CrushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'bits',
        defaultValue: 16,
        minValue: 1,
        maxValue: 16,
        automationRate: 'k-rate'
      },
      {
        name: 'hold',
        defaultValue: 1,
        minValue: 1,
        maxValue: 64,
        automationRate: 'k-rate'
      }
    ]
  }

  private readonly phases: number[] = []
  private readonly held: number[] = []

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    const bits = parameters.bits[0] ?? 16
    const hold = parameters.hold[0] ?? 1
    const quantize = bits < 15.9
    const step = 2 ** (bits - 1)

    for (let channel = 0; channel < output.length; channel++) {
      const outputChannel = output[channel]
      const inputChannel = input?.[Math.min(channel, input.length - 1)]
      let phase = this.phases[channel] ?? 0
      let held = this.held[channel] ?? 0
      for (let i = 0; i < outputChannel.length; i++) {
        phase += 1
        if (phase >= hold) {
          phase -= hold
          held = inputChannel?.[i] ?? 0
        }
        outputChannel[i] = quantize ? Math.round(held * step) / step : held
      }
      this.phases[channel] = phase
      this.held[channel] = held
    }
    return true
  }
}

registerProcessor('crush-processor', CrushProcessor)
