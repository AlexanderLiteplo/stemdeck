/**
 * Web Audio graph:
 *
 * DeckWorklet -> trim -> EQ(low/mid/high) -> filter(HP -> LP) -> fader -> xfGain -+
 *                                                                                 +-> master -> limiter -> speakers
 * DeckWorklet -> ... -> xfGain -----------------------------------------------------^        \-> analyser
 *                                                                                             \-> recorder tap
 */

export const STEM_NAMES = ['Vocals', 'Drums', 'Bass', 'Other'] as const

export interface LoadedStem {
  name: string
  buffer: AudioBuffer
}

export type DeckMessage =
  | { type: 'position'; frames: number; playing: boolean }
  | { type: 'ended' }

export class DeckEngine {
  readonly node: AudioWorkletNode
  readonly trim: GainNode
  readonly eqLow: BiquadFilterNode
  readonly eqMid: BiquadFilterNode
  readonly eqHigh: BiquadFilterNode
  readonly filterHP: BiquadFilterNode
  readonly filterLP: BiquadFilterNode
  readonly fader: GainNode
  readonly xfGain: GainNode

  private ctx: AudioContext
  private positionFrames = 0
  duration = 0
  onEnded: (() => void) | null = null
  onPosition: ((seconds: number) => void) | null = null

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.node = new AudioWorkletNode(ctx, 'deck-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    this.trim = ctx.createGain()
    this.eqLow = ctx.createBiquadFilter()
    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.value = 320
    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = 1000
    this.eqMid.Q.value = 0.6
    this.eqHigh = ctx.createBiquadFilter()
    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.value = 3200
    this.filterHP = ctx.createBiquadFilter()
    this.filterHP.type = 'highpass'
    this.filterHP.frequency.value = 5
    this.filterHP.Q.value = 0.8
    this.filterLP = ctx.createBiquadFilter()
    this.filterLP.type = 'lowpass'
    this.filterLP.frequency.value = 21000
    this.filterLP.Q.value = 0.8
    this.fader = ctx.createGain()
    this.xfGain = ctx.createGain()

    this.node
      .connect(this.trim)
      .connect(this.eqLow)
      .connect(this.eqMid)
      .connect(this.eqHigh)
      .connect(this.filterHP)
      .connect(this.filterLP)
      .connect(this.fader)
      .connect(this.xfGain)
      .connect(destination)

    this.node.port.onmessage = (e: MessageEvent<DeckMessage>) => {
      const msg = e.data
      if (msg.type === 'position') {
        this.positionFrames = msg.frames
        this.onPosition?.(this.getPosition())
      } else if (msg.type === 'ended') {
        this.onEnded?.()
      }
    }
  }

  load(stems: LoadedStem[]): void {
    const payload = stems.map(({ buffer }) => {
      const l = buffer.getChannelData(0).slice()
      const r = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice()
      return { l, r }
    })
    this.duration = stems.length > 0 ? stems[0].buffer.duration : 0
    this.positionFrames = 0
    const transfers = payload.flatMap((s) => [s.l.buffer, s.r.buffer])
    this.node.port.postMessage({ type: 'load', stems: payload }, transfers)
  }

  unload(): void {
    this.duration = 0
    this.positionFrames = 0
    this.node.port.postMessage({ type: 'unload' })
  }

  play(): void {
    void this.ctx.resume()
    this.node.port.postMessage({ type: 'play' })
  }

  pause(): void {
    this.node.port.postMessage({ type: 'pause' })
  }

  seek(seconds: number): void {
    this.positionFrames = seconds * this.ctx.sampleRate
    this.node.port.postMessage({ type: 'seek', frames: this.positionFrames })
  }

  setTempo(rate: number): void {
    this.node.port.postMessage({ type: 'tempo', value: rate })
  }

  setPitch(semitones: number): void {
    this.node.port.postMessage({ type: 'pitch', semitones })
  }

  setKeylock(enabled: boolean): void {
    this.node.port.postMessage({ type: 'keylock', enabled })
  }

  setStemGain(index: number, value: number): void {
    this.node.port.postMessage({ type: 'stemGain', index, value })
  }

  setLoop(enabled: boolean, startSeconds: number, endSeconds: number): void {
    this.node.port.postMessage({
      type: 'loop',
      enabled,
      start: startSeconds * this.ctx.sampleRate,
      end: endSeconds * this.ctx.sampleRate
    })
  }

  /** EQ knob value in [-1, 1]; kill on full cut, modest boost on the way up. */
  setEq(band: 'low' | 'mid' | 'high', value: number): void {
    const gainDb = value < 0 ? value * 26 : value * 9
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh
    node.gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.01)
  }

  /** Filter knob in [-1, 1]: negative sweeps the lowpass down, positive sweeps the highpass up. */
  setFilter(value: number): void {
    const t = this.ctx.currentTime
    if (value < -0.02) {
      this.filterLP.frequency.setTargetAtTime(21000 * Math.pow(2, value * 9), t, 0.01)
      this.filterHP.frequency.setTargetAtTime(5, t, 0.01)
    } else if (value > 0.02) {
      this.filterHP.frequency.setTargetAtTime(20 * Math.pow(2, value * 10), t, 0.01)
      this.filterLP.frequency.setTargetAtTime(21000, t, 0.01)
    } else {
      this.filterLP.frequency.setTargetAtTime(21000, t, 0.01)
      this.filterHP.frequency.setTargetAtTime(5, t, 0.01)
    }
  }

  setTrim(value: number): void {
    this.trim.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  setFader(value: number): void {
    this.fader.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  getPosition(): number {
    return this.positionFrames / this.ctx.sampleRate
  }
}

export class AudioEngine {
  ctx!: AudioContext
  decks: DeckEngine[] = []
  master!: GainNode
  limiter!: DynamicsCompressorNode
  analyser!: AnalyserNode
  private recordDest!: MediaStreamAudioDestinationNode
  private recorder: MediaRecorder | null = null
  private recordChunks: Blob[] = []
  private ready = false

  async init(): Promise<void> {
    if (this.ready) return
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    await this.ctx.audioWorklet.addModule('worklets/deck-processor.js')

    this.master = this.ctx.createGain()
    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -3
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.1
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.recordDest = this.ctx.createMediaStreamDestination()

    this.master.connect(this.limiter)
    this.limiter.connect(this.ctx.destination)
    this.limiter.connect(this.analyser)
    this.limiter.connect(this.recordDest)

    this.decks = [new DeckEngine(this.ctx, this.master), new DeckEngine(this.ctx, this.master)]
    this.setCrossfader(0.5)
    this.ready = true
  }

  /** x in [0, 1]; 0 = full deck A, 1 = full deck B. Equal-power curve. */
  setCrossfader(x: number): void {
    const t = this.ctx.currentTime
    this.decks[0].xfGain.gain.setTargetAtTime(Math.cos((x * Math.PI) / 2), t, 0.01)
    this.decks[1].xfGain.gain.setTargetAtTime(Math.cos(((1 - x) * Math.PI) / 2), t, 0.01)
  }

  setMasterGain(value: number): void {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data)
  }

  startRecording(): void {
    if (this.recorder) return
    this.recordChunks = []
    this.recorder = new MediaRecorder(this.recordDest.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 256_000
    })
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordChunks.push(e.data)
    }
    this.recorder.start(1000)
  }

  async stopRecording(): Promise<Blob> {
    const recorder = this.recorder
    if (!recorder) return new Blob([], { type: 'audio/webm' })
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.recordChunks, { type: 'audio/webm' }))
      recorder.stop()
    })
    this.recorder = null
    this.recordChunks = []
    return blob
  }

  get isRecording(): boolean {
    return this.recorder !== null
  }
}

export const engine = new AudioEngine()
