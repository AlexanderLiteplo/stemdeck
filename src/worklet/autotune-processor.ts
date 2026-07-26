import { PitchAnalyzer, type AutotuneSettings } from './autotune-dsp'

type AutotuneMessage = {
  type: 'settings'
  settings: Partial<AutotuneSettings>
}

const PITCH_POST_INTERVAL_SAMPLES = 256
const PITCH_POST_THRESHOLD_SEMITONES = 0.02

class PitchAnalyzerProcessor extends AudioWorkletProcessor {
  private readonly analyzer = new PitchAnalyzer(sampleRate)
  private samplesSincePost = 0
  private lastPostedSemitones = 0
  private lastPostedVoiced = false

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<AutotuneMessage>) => {
      if (event.data.type === 'settings') this.analyzer.set(event.data.settings)
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) {
      for (const channel of output) channel.fill(0)
    } else {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].set(input[Math.min(channel, input.length - 1)])
      }
      const left = input[0]
      const right = input.length > 1 ? input[1] : input[0]
      this.analyzer.analyze(left, right)
    }

    const blockLength = output[0]?.length ?? 0
    this.samplesSincePost += blockLength
    const semitones = this.analyzer.semitones
    const voiced = this.analyzer.detectedHz > 0
    const correctionMoved =
      Math.abs(semitones - this.lastPostedSemitones) > PITCH_POST_THRESHOLD_SEMITONES
    const voicedChanged = voiced !== this.lastPostedVoiced
    if (
      this.samplesSincePost >= PITCH_POST_INTERVAL_SAMPLES &&
      (correctionMoved || voicedChanged)
    ) {
      this.samplesSincePost = 0
      this.lastPostedSemitones = semitones
      this.lastPostedVoiced = voiced
      this.port.postMessage({
        type: 'pitch',
        detected: this.analyzer.detectedHz,
        target: this.analyzer.targetHz,
        semitones
      })
    }
    return true
  }
}

registerProcessor('pitch-analyzer', PitchAnalyzerProcessor)
