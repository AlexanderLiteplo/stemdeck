/**
 * Web Audio graph:
 *
 * DeckWorklet -> trim -> EQ(low/mid/high) -> filter(HP -> LP) -> fader -> xfGain -+
 *                                                                                 +-> master -> limiter -> speakers
 * DeckWorklet -> ... -> xfGain -----------------------------------------------------^        \-> analyser
 *                                                                                             \-> recorder tap
 * Deck output 1 -> pitch analyzer -> stretch -> wet gain -+
 *                              \-> dry delay -> dry gain ---+-> trim
 */

// signalsmith-stretch 1.3.2 does not publish TypeScript declarations.
// @ts-expect-error No declaration file is included in the package.
import SignalsmithStretch from 'signalsmith-stretch'
import type { AutotuneSettings } from '../../../worklet/autotune-dsp'

export type { AutotuneSettings } from '../../../worklet/autotune-dsp'

export const STEM_NAMES = ['Vocals', 'Drums', 'Bass', 'Other'] as const

export interface LoadedStem {
  name: string
  buffer: AudioBuffer
}

export type DeckMessage =
  | { type: 'position'; frames: number; playing: boolean }
  | { type: 'ended' }

type AutotuneMessage = {
  type: 'pitch'
  detected: number
  target: number
  semitones: number
}

interface StretchSchedule {
  output: number
  semitones: number
  formantCompensation: boolean
  formantBaseHz: number
}

type StretchNode = AudioNode & {
  latency(): Promise<number>
  schedule(settings: StretchSchedule): Promise<unknown>
  start(when?: number): Promise<unknown>
}

const createStretch = SignalsmithStretch as (
  context: AudioContext,
  options: AudioWorkletNodeOptions
) => Promise<StretchNode>

/** Synthetic hall impulse response: exponentially decaying stereo noise. */
function makeReverbImpulse(ctx: AudioContext, seconds = 2.8, decay = 3.5): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return impulse
}

export class DeckEngine {
  readonly node: AudioWorkletNode
  readonly autotune: AudioWorkletNode
  /** Null when the pitch-shift module failed to load; autotune is then unavailable. */
  readonly stretch: StretchNode | null
  readonly dryDelay: DelayNode
  readonly wetGain: GainNode
  readonly dryGain: GainNode
  readonly trim: GainNode
  readonly eqLow: BiquadFilterNode
  readonly eqMid: BiquadFilterNode
  readonly eqHigh: BiquadFilterNode
  readonly filterHP: BiquadFilterNode
  readonly filterLP: BiquadFilterNode
  readonly fader: GainNode
  readonly xfGain: GainNode
  readonly reverbSend: GainNode
  readonly convolver: ConvolverNode

  private ctx: AudioContext
  private positionFrames = 0
  private tempoValue = 1
  private playingFlag = false
  private lastPositionAt = 0
  private readonly stretchLatencySeconds: number
  private readonly vocalLeadSamples: number
  private autotuneSettings: AutotuneSettings = {
    enabled: false,
    key: 0,
    scale: 'chromatic',
    strength: 1,
    retuneMs: 0,
    mix: 1,
    formant: true
  }
  private lastCorrectionSemitones = 0
  duration = 0
  onEnded: (() => void) | null = null
  onPosition: ((seconds: number) => void) | null = null
  onPitch: ((detected: number, target: number) => void) | null = null

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    reverbImpulse: AudioBuffer,
    stretch: StretchNode | null,
    stretchLatencySeconds: number
  ) {
    this.ctx = ctx
    this.stretch = stretch
    this.stretchLatencySeconds = stretchLatencySeconds
    // The analyzer is a bit-exact pass-through, so it contributes zero signal
    // latency. The stretch node's measured live-input latency is the complete
    // vocal-route delay that the deck must read ahead by.
    this.vocalLeadSamples = Math.round(stretchLatencySeconds * ctx.sampleRate)
    this.node = new AudioWorkletNode(ctx, 'deck-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2]
    })
    this.autotune = new AudioWorkletNode(ctx, 'pitch-analyzer', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    this.dryDelay = ctx.createDelay(Math.max(1, stretchLatencySeconds + 0.1))
    this.dryDelay.delayTime.value = stretchLatencySeconds
    this.wetGain = ctx.createGain()
    this.wetGain.gain.value = this.autotuneSettings.mix
    this.dryGain = ctx.createGain()
    this.dryGain.gain.value = 1 - this.autotuneSettings.mix
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
      .connect(this.trim, 0, 0)
      .connect(this.eqLow)
      .connect(this.eqMid)
      .connect(this.eqHigh)
      .connect(this.filterHP)
      .connect(this.filterLP)
      .connect(this.fader)
      .connect(this.xfGain)
      .connect(destination)
    this.node.connect(this.autotune, 1, 0)
    if (this.stretch) {
      this.autotune.connect(this.stretch).connect(this.wetGain).connect(this.trim)
    }
    this.autotune.connect(this.dryDelay).connect(this.dryGain).connect(this.trim)

    // Reverb: post-filter send mixed back in pre-fader, so the channel
    // fader and crossfader still control the wet tail.
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0
    this.convolver = ctx.createConvolver()
    this.convolver.buffer = reverbImpulse
    this.filterLP.connect(this.reverbSend).connect(this.convolver).connect(this.fader)

    this.node.port.onmessage = (e: MessageEvent<DeckMessage>) => {
      const msg = e.data
      if (msg.type === 'position') {
        this.positionFrames = msg.frames
        this.playingFlag = msg.playing
        this.lastPositionAt = performance.now()
        this.onPosition?.(this.getPosition())
      } else if (msg.type === 'ended') {
        this.playingFlag = false
        this.onEnded?.()
      }
    }
    this.autotune.port.onmessage = (e: MessageEvent<AutotuneMessage>) => {
      const msg = e.data
      if (msg.type === 'pitch') {
        this.lastCorrectionSemitones = msg.semitones
        this.scheduleCorrection(msg.semitones)
        this.onPitch?.(msg.detected, msg.target)
      }
    }
  }

  private scheduleCorrection(semitones: number): void {
    // The analyzer reports a correction for audio which has just entered the
    // stretch node. Scheduling one stretch latency ahead makes that correction
    // land on the same measured audio when it reaches the node's output.
    if (!this.stretch) return
    void this.stretch.schedule({
      output: this.ctx.currentTime + this.stretchLatencySeconds,
      semitones,
      formantCompensation: this.autotuneSettings.formant,
      formantBaseHz: 0
    })
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
    this.playingFlag = true
    this.lastPositionAt = performance.now()
    this.node.port.postMessage({ type: 'play' })
  }

  pause(): void {
    this.playingFlag = false
    this.node.port.postMessage({ type: 'pause' })
  }

  seek(seconds: number): void {
    this.positionFrames = seconds * this.ctx.sampleRate
    this.lastPositionAt = performance.now()
    this.node.port.postMessage({ type: 'seek', frames: this.positionFrames })
  }

  /** Sample-accurate relative jump, resolved inside the worklet. */
  jumpBy(seconds: number): void {
    this.node.port.postMessage({ type: 'jumpBy', frames: seconds * this.ctx.sampleRate })
  }

  setTempo(rate: number): void {
    this.tempoValue = rate
    this.node.port.postMessage({ type: 'tempo', value: rate })
  }

  setPitch(semitones: number): void {
    this.node.port.postMessage({ type: 'pitch', semitones })
  }

  setKeylock(enabled: boolean): void {
    this.node.port.postMessage({ type: 'keylock', enabled })
  }

  setAutotune(settings: Partial<AutotuneSettings>): void {
    const previousFormant = this.autotuneSettings.formant
    this.autotuneSettings = { ...this.autotuneSettings, ...settings }
    this.autotune.port.postMessage({ type: 'settings', settings })
    if (settings.mix !== undefined) {
      const mix = Math.max(0, Math.min(1, settings.mix))
      this.autotuneSettings.mix = mix
      const now = this.ctx.currentTime
      this.wetGain.gain.setTargetAtTime(mix, now, 0.01)
      this.dryGain.gain.setTargetAtTime(1 - mix, now, 0.01)
    }
    if (settings.enabled !== undefined) {
      this.node.port.postMessage({
        type: 'vocalRoute',
        enabled: settings.enabled,
        leadSamples: this.vocalLeadSamples
      })
    }
    if (
      settings.formant !== undefined &&
      settings.formant !== previousFormant &&
      this.autotuneSettings.enabled
    ) {
      this.scheduleCorrection(this.lastCorrectionSemitones)
    }
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

  /** Reverb wet amount in [0, 1]; 0 disables. */
  setReverb(amount: number): void {
    this.reverbSend.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.08)
  }

  setTrim(value: number): void {
    this.trim.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  setFader(value: number): void {
    this.fader.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  /** Playhead in source seconds, extrapolated between worklet updates for smooth UI. */
  getPosition(): number {
    let pos = this.positionFrames / this.ctx.sampleRate
    if (this.playingFlag) {
      pos += ((performance.now() - this.lastPositionAt) / 1000) * this.tempoValue
    }
    return this.duration > 0 ? Math.min(pos, this.duration) : pos
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
  /** Separate tap for video reels: master mix plus an optional mic. */
  private reelDest!: MediaStreamAudioDestinationNode
  private micGain!: GainNode
  private micSource: MediaStreamAudioSourceNode | null = null

  async init(): Promise<void> {
    if (this.ready) return
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    await Promise.all([
      this.ctx.audioWorklet.addModule('worklets/deck-processor.js'),
      this.ctx.audioWorklet.addModule('worklets/autotune-processor.js')
    ])
    // Autotune is optional. If its module cannot load, the deck, mixer and
    // recording must all still work — losing one effect should never cost the
    // whole audio engine.
    let stretches: (StretchNode | null)[] = [null, null]
    try {
      stretches = await Promise.all([
        createStretch(this.ctx, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        }),
        createStretch(this.ctx, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        })
      ])
    } catch (err) {
      console.error('[stemdeck] autotune unavailable — pitch engine failed to load:', err)
    }
    const stretchLatencies = await Promise.all(
      stretches.map(async (stretch) => {
        if (!stretch) return 0
        const latency = await stretch.latency()
        await stretch.start()
        // A non-finite latency would reach createDelay() and throw, taking the
        // whole audio engine down at startup. Fall back to the library's
        // default block length instead.
        return Number.isFinite(latency) && latency > 0 ? latency : 0.12
      })
    )

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

    // The mic reaches the reel tap only — routing it anywhere near the master
    // would put the room back through the speakers.
    this.reelDest = this.ctx.createMediaStreamDestination()
    this.limiter.connect(this.reelDest)
    this.micGain = this.ctx.createGain()
    this.micGain.gain.value = 0
    this.micGain.connect(this.reelDest)

    const impulse = makeReverbImpulse(this.ctx)
    this.decks = [
      new DeckEngine(this.ctx, this.master, impulse, stretches[0], stretchLatencies[0]),
      new DeckEngine(this.ctx, this.master, impulse, stretches[1], stretchLatencies[1])
    ]
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

  /** False when the pitch-shift module failed to load. */
  get autotuneAvailable(): boolean {
    return this.decks.every((deck) => deck.stretch !== null)
  }

  /** Master mix (+ mic when unmuted) for the video recorder. */
  get reelAudioStream(): MediaStream {
    return this.reelDest.stream
  }

  attachMic(stream: MediaStream): void {
    this.detachMic()
    this.micSource = this.ctx.createMediaStreamSource(stream)
    this.micSource.connect(this.micGain)
  }

  detachMic(): void {
    this.micSource?.disconnect()
    this.micSource = null
  }

  /** 0 mutes the mic without dropping the stream, so it can be toggled live. */
  setMicLevel(value: number): void {
    this.micGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02)
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
