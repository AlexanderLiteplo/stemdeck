import {
  CHOP_TRACK,
  DRUM_MODELS,
  DRUM_TRACK,
  DRUM_VOICES,
  LOOP_STEPS,
  STEPS_PER_BAR,
  type ChopSettings,
  type CycleRange,
  type DrumKit,
  type DrumVoice,
  type DrumVoiceId,
  type EngineProject,
  type EngineTrack,
  type MixerTrack,
  type Pattern,
  type PlayMode,
  type StudioEngineApi,
  type SynthPatch
} from './types'
import { DEFAULT_PATCH } from './patch'
import { renderDrum } from './drumsynth'
import { SynthInstrument } from './synth'

const EPSILON = 0.0001
const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.12

interface TrackBus {
  dry: GainNode
  reverb: GainNode
  delay: GainNode
}

interface ActiveChop {
  source: AudioBufferSourceNode
  gain: GainNode
  nodes: AudioNode[]
  stopped: boolean
}

interface ActiveDrum {
  source: AudioBufferSourceNode
  output: GainNode
  nodes: AudioNode[]
  stopped: boolean
}

interface RegisteredDrumSample {
  source: AudioBuffer
  prepared: AudioBuffer | null
}

const DEFAULT_CHOPS: ChopSettings = {
  trackId: null,
  source: 'mix',
  bpm: 90,
  offset: 0,
  sliceBeats: 4,
  startBeat: 0,
  fitToTempo: true,
  pitch: 0,
  choke: true,
  fade: 0.004,
  reverb: 0
}

const DEFAULT_DRUM: DrumVoice = {
  model: '808',
  sample: null,
  tune: 0,
  decay: 1,
  tone: 0.5,
  drive: 0,
  level: 0.8,
  pan: 0,
  reverb: 0.1
}

const DEFAULT_KIT: DrumKit = {
  name: 'Default',
  description: 'Balanced synthesized drums.',
  voices: Object.fromEntries(DRUM_VOICES.map((id) => [id, { ...DEFAULT_DRUM, model: DRUM_MODELS[id][0] }])) as Record<
    DrumVoiceId,
    DrumVoice
  >,
  punch: 0.4,
  crunch: 0.15,
  room: 0.12
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min
}

function holdAt(param: AudioParam, when: number): void {
  try {
    param.cancelAndHoldAtTime(when)
  } catch {
    param.cancelScheduledValues(when)
    param.setValueAtTime(Math.max(EPSILON, param.value), when)
  }
}

function makeReverbImpulse(ctx: AudioContext): AudioBuffer {
  const seconds = 2.5
  const length = Math.floor(ctx.sampleRate * seconds)
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2
    }
  }
  return impulse
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

function makeDrumRoomImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.45)
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  let state = 0x4d595df4
  const random = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const pole = Math.exp(-2 * Math.PI * 7000 / ctx.sampleRate)
  const reflectionTimes = [0.007, 0.012, 0.019, 0.027, 0.034, 0.041]
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel)
    let filtered = 0
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate
      const input = random() * 2 - 1
      filtered = (1 - pole) * input + pole * filtered
      data[i] = filtered * Math.exp(-t / 0.08) * 0.3
    }
    for (let i = 0; i < reflectionTimes.length; i++) {
      const offset = (channel === 0 ? (i % 2) * 0.0007 : ((i + 1) % 2) * 0.0009)
      const index = Math.min(length - 1, Math.round((reflectionTimes[i] + offset) * ctx.sampleRate))
      data[index] += (i % 2 === channel ? 1 : -1) * (0.7 / (i + 1))
    }
  }
  return impulse
}

export class StudioEngine implements StudioEngineApi {
  onStep: ((step: number) => void) | null = null
  onSongEnd: (() => void) | null = null

  private ctx: AudioContext | null = null
  private studioMaster: GainNode | null = null
  private drumBus: TrackBus | null = null
  private chopBus: TrackBus | null = null
  private readonly synthBuses = new Map<string, TrackBus>()
  private readonly trackStates = new Map<string, MixerTrack>([
    [DRUM_TRACK, { volume: 1, mute: false }],
    [CHOP_TRACK, { volume: 1, mute: false }]
  ])

  private reverbInput: GainNode | null = null
  private delayInput: GainNode | null = null
  private delayLeft: DelayNode | null = null
  private delayRight: DelayNode | null = null

  private readonly synths = new Map<string, SynthInstrument>()
  private noiseBuffer: AudioBuffer | null = null
  private crusherLoaded = false
  private readonly sampleDriveCurves = new Map<number, Float32Array<ArrayBuffer>>()
  private readonly crunchCurves = new Map<number, Float32Array<ArrayBuffer>>()

  private readonly patches = new Map<string, SynthPatch>()
  private kit: DrumKit = structuredClone(DEFAULT_KIT)
  private readonly drumBuffers = new Map<DrumVoiceId, AudioBuffer>()
  private readonly drumBufferSignatures = new Map<DrumVoiceId, string>()
  private readonly drumBufferSamples = new Map<DrumVoiceId, boolean>()
  private readonly drumSamples = new Map<string, RegisteredDrumSample>()
  private drumInput: GainNode | null = null
  private drumCompressor: DynamicsCompressorNode | null = null
  private drumCrunch: WaveShaperNode | null = null
  private drumMakeup: GainNode | null = null
  private drumRoomInput: GainNode | null = null

  private chopBuffer: AudioBuffer | null = null
  private chopSettings: ChopSettings = { ...DEFAULT_CHOPS }
  private readonly activeChops = new Set<ActiveChop>()
  private openHat: ActiveDrum | null = null
  private active808: ActiveDrum | null = null

  private project: EngineProject | null = null
  private mode: PlayMode = 'loop'
  private cycle: CycleRange | null = null
  private songStart = 0
  private songPlaybackStart = 0
  private bpm = 120
  private swing = 0
  private metronome = false
  private playingFlag = false
  private schedulerTimer: ReturnType<typeof setInterval> | null = null
  private nextStep = 0
  private nextStepTime = 0
  private readonly scheduledSteps: Array<{ step: number; time: number; duration: number }> = []
  private readonly stepTimeouts = new Set<ReturnType<typeof setTimeout>>()
  private songEndTimeout: ReturnType<typeof setTimeout> | null = null

  get ready(): boolean {
    return this.ctx !== null
  }

  get playing(): boolean {
    return this.playingFlag
  }

  init(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return
    this.ctx = ctx
    this.noiseBuffer = makeNoiseBuffer(ctx)

    this.studioMaster = ctx.createGain()
    this.studioMaster.gain.value = 0.85
    this.studioMaster.connect(destination)

    this.reverbInput = ctx.createGain()
    const convolver = ctx.createConvolver()
    convolver.buffer = makeReverbImpulse(ctx)
    const reverbReturn = ctx.createGain()
    reverbReturn.gain.value = 0.62
    this.reverbInput.connect(convolver).connect(reverbReturn).connect(this.studioMaster)

    this.delayInput = ctx.createGain()
    this.delayLeft = ctx.createDelay(4)
    this.delayRight = ctx.createDelay(4)
    const leftPan = ctx.createStereoPanner()
    const rightPan = ctx.createStereoPanner()
    leftPan.pan.value = -0.65
    rightPan.pan.value = 0.65
    const delayReturn = ctx.createGain()
    delayReturn.gain.value = 0.56
    const feedbackLeft = ctx.createGain()
    const feedbackRight = ctx.createGain()
    feedbackLeft.gain.value = 0.35
    feedbackRight.gain.value = 0.35
    const feedbackLowpassLeft = ctx.createBiquadFilter()
    const feedbackLowpassRight = ctx.createBiquadFilter()
    feedbackLowpassLeft.type = 'lowpass'
    feedbackLowpassRight.type = 'lowpass'
    feedbackLowpassLeft.frequency.value = 4000
    feedbackLowpassRight.frequency.value = 4000
    this.delayInput.connect(this.delayLeft)
    this.delayInput.connect(this.delayRight)
    this.delayLeft.connect(leftPan).connect(delayReturn)
    this.delayRight.connect(rightPan).connect(delayReturn)
    this.delayLeft.connect(feedbackLowpassLeft).connect(feedbackLeft).connect(this.delayRight)
    this.delayRight.connect(feedbackLowpassRight).connect(feedbackRight).connect(this.delayLeft)
    delayReturn.connect(this.studioMaster)

    this.drumBus = this.createTrackBus()
    this.chopBus = this.createTrackBus()
    this.createDrumMixBus()
    for (const sample of this.drumSamples.values()) {
      if (!sample.prepared) sample.prepared = this.prepareDrumSample(sample.source)
    }
    this.resolveDrumBuffers()
    this.applyDrumBus()
    this.applyTrack(DRUM_TRACK, this.trackStates.get(DRUM_TRACK)!)
    this.applyTrack(CHOP_TRACK, this.trackStates.get(CHOP_TRACK)!)
    this.reconcileSynths()

    void ctx.audioWorklet.addModule('worklets/crush-processor.js').then(
      () => {
        this.crusherLoaded = true
        for (const synth of this.synths.values()) synth.enableCrusher()
      },
      (error: unknown) => console.warn('Unable to load synth bitcrusher worklet', error)
    )

    this.retuneDelay(ctx.currentTime)
  }

  private createDrumMixBus(): void {
    const ctx = this.ctx
    const bus = this.drumBus
    if (!ctx || !bus) return
    this.drumInput = ctx.createGain()
    this.drumCompressor = ctx.createDynamicsCompressor()
    this.drumCrunch = ctx.createWaveShaper()
    this.drumCrunch.oversample = '2x'
    this.drumMakeup = ctx.createGain()
    this.drumInput.connect(this.drumCompressor).connect(this.drumCrunch).connect(this.drumMakeup).connect(bus.dry)

    this.drumRoomInput = ctx.createGain()
    const room = ctx.createConvolver()
    room.buffer = makeDrumRoomImpulse(ctx)
    const roomReturn = ctx.createGain()
    roomReturn.gain.value = 0.8
    this.drumRoomInput.connect(room).connect(roomReturn).connect(bus.dry)
  }

  private createTrackBus(): TrackBus {
    const ctx = this.ctx
    if (!ctx || !this.studioMaster || !this.reverbInput || !this.delayInput) {
      throw new Error('Studio audio graph is not initialized')
    }
    const dry = ctx.createGain()
    const reverb = ctx.createGain()
    const delay = ctx.createGain()
    dry.connect(this.studioMaster)
    reverb.connect(this.reverbInput)
    delay.connect(this.delayInput)
    return { dry, reverb, delay }
  }

  private reconcileSynths(): void {
    if (!this.ctx || !this.noiseBuffer) return
    const tracks = Array.isArray(this.project?.tracks) ? this.project.tracks : []
    const desired = new Set<string>()
    for (const track of tracks) {
      if (track?.kind === 'synth' && typeof track.id === 'string') desired.add(track.id)
    }
    let unchanged = desired.size === this.synths.size
    if (unchanged) {
      for (const id of desired) {
        if (!this.synths.has(id)) {
          unchanged = false
          break
        }
      }
    }
    if (unchanged) return

    for (const [id, synth] of this.synths) {
      if (desired.has(id)) continue
      synth.allNotesOff()
      synth.dispose()
      this.synths.delete(id)
      const bus = this.synthBuses.get(id)
      bus?.dry.disconnect()
      bus?.reverb.disconnect()
      bus?.delay.disconnect()
      this.synthBuses.delete(id)
    }
    for (const id of desired) {
      if (this.synths.has(id)) continue
      const bus = this.createTrackBus()
      const synth = new SynthInstrument(this.ctx, bus, this.noiseBuffer)
      this.synthBuses.set(id, bus)
      this.synths.set(id, synth)
      synth.setPatch(this.patches.get(id) ?? DEFAULT_PATCH)
      synth.setBpm(this.bpm)
      this.applyTrack(id, this.trackStates.get(id) ?? { volume: 1, mute: false })
      if (this.crusherLoaded) synth.enableCrusher()
    }
  }

  setPatch(trackId: string, patch: SynthPatch): void {
    const remembered = structuredClone(patch)
    this.patches.set(trackId, remembered)
    this.synths.get(trackId)?.setPatch(remembered)
  }

  noteOn(trackId: string, midi: number, velocity = 1, when?: number): void {
    this.synths.get(trackId)?.noteOn(midi, velocity, when)
  }

  noteOff(trackId: string, midi: number, when?: number): void {
    this.synths.get(trackId)?.noteOff(midi, when)
  }

  playNote(trackId: string, midi: number, velocity: number, when: number, duration: number): void {
    this.synths.get(trackId)?.playNote(midi, velocity, when, duration)
  }

  allNotesOff(trackId?: string): void {
    if (trackId !== undefined) {
      this.synths.get(trackId)?.allNotesOff()
      return
    }
    for (const synth of this.synths.values()) synth.allNotesOff()
  }

  setKit(kit: DrumKit): void {
    this.kit = structuredClone(kit)
    this.resolveDrumBuffers()
    this.applyDrumBus()
  }

  private resolveDrumBuffers(ids: readonly DrumVoiceId[] = DRUM_VOICES): void {
    const ctx = this.ctx
    if (!ctx) return
    for (const id of ids) {
      const voice = this.kit.voices[id] ?? { ...DEFAULT_DRUM, model: DRUM_MODELS[id][0] }
      const path = voice.sample?.path
      const registered = path ? this.drumSamples.get(path) : undefined
      const sample = registered?.prepared
      const signature = sample
        ? `sample:${path}`
        : `synth:${path ?? ''}:${voice.model}:${voice.tune}:${voice.decay}:${voice.tone}:${voice.drive}`
      if (this.drumBufferSignatures.get(id) === signature) continue
      if (sample) {
        this.drumBuffers.set(id, sample)
        this.drumBufferSamples.set(id, true)
      } else {
        const rendered = renderDrum(id, voice, ctx.sampleRate)
        const buffer = ctx.createBuffer(1, rendered.length, ctx.sampleRate)
        buffer.getChannelData(0).set(rendered)
        this.drumBuffers.set(id, buffer)
        this.drumBufferSamples.set(id, false)
      }
      this.drumBufferSignatures.set(id, signature)
    }
  }

  setDrumSample(path: string, buffer: AudioBuffer | null): void {
    if (buffer === null) this.drumSamples.delete(path)
    else this.drumSamples.set(path, { source: buffer, prepared: this.ctx ? this.prepareDrumSample(buffer) : null })
    const affected = DRUM_VOICES.filter((id) => this.kit.voices[id]?.sample?.path === path)
    for (const id of affected) this.drumBufferSignatures.delete(id)
    this.resolveDrumBuffers(affected)
  }

  private prepareDrumSample(source: AudioBuffer): AudioBuffer {
    const ctx = this.ctx
    if (!ctx) return source
    const channels = Math.min(2, Math.max(1, source.numberOfChannels))
    let first = source.length
    let peak = 0
    for (let i = 0; i < source.length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = Math.abs(source.getChannelData(channel)[i] ?? 0)
        peak = Math.max(peak, value)
        if (first === source.length && value > 0.001) first = i
      }
    }
    const trim = Math.max(0, first === source.length ? 0 : first - Math.round(source.sampleRate * 0.001))
    const length = Math.max(1, Math.min(source.length - trim, Math.floor(source.sampleRate * 4)))
    const prepared = ctx.createBuffer(channels, length, source.sampleRate)
    peak = 0
    for (let channel = 0; channel < channels; channel++) {
      const input = source.getChannelData(channel)
      const output = prepared.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        output[i] = input[trim + i] ?? 0
        peak = Math.max(peak, Math.abs(output[i]))
      }
    }
    const scale = peak > 0 ? 0.9 / peak : 1
    const fade = Math.min(length, Math.ceil(source.sampleRate * 0.005))
    for (let channel = 0; channel < channels; channel++) {
      const output = prepared.getChannelData(channel)
      for (let i = 0; i < length; i++) output[i] *= scale
      for (let i = 0; i < fade; i++) output[length - fade + i] *= 1 - i / Math.max(1, fade - 1)
    }
    return prepared
  }

  triggerDrum(id: DrumVoiceId, velocity = 1, when?: number): void {
    const ctx = this.ctx
    const bus = this.drumBus
    const buffer = this.drumBuffers.get(id)
    if (!ctx || !bus || !buffer || !this.drumInput || !this.drumRoomInput) return
    const voice = this.kit.voices[id] ?? { ...DEFAULT_DRUM, model: DRUM_MODELS[id][0] }
    const time = Math.max(when ?? ctx.currentTime, ctx.currentTime)
    if (id === 'hat') this.chokeOpenHat(time)
    if (id === 'bass808') this.choke808(time)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    const output = ctx.createGain()
    output.gain.value = clamp(voice.level, 0, 1) * clamp(velocity, 0, 1)
    const panner = ctx.createStereoPanner()
    panner.pan.value = clamp(voice.pan, -1, 1)
    const nodes: AudioNode[] = [source, output, panner]
    let tail: AudioNode = source
    const isSample = this.drumBufferSamples.get(id) === true
    let playbackRate = 1
    if (isSample) {
      playbackRate = 2 ** (clamp(voice.tune, -24, 24) / 12)
      source.playbackRate.value = playbackRate
      // TONE on a sample: 50 % = untouched, left darkens (lowpass), right adds air (high shelf).
      const tone = clamp(voice.tone, 0, 1)
      if (tone < 0.48 || tone > 0.52) {
        const filter = ctx.createBiquadFilter()
        if (tone < 0.5) {
          filter.type = 'lowpass'
          filter.frequency.value = clamp(400 * 2 ** ((tone / 0.5) * 5.6), 20, ctx.sampleRate * 0.45)
        } else {
          filter.type = 'highshelf'
          filter.frequency.value = 3000
          filter.gain.value = ((tone - 0.5) / 0.5) * 9
        }
        tail.connect(filter)
        tail = filter
        nodes.push(filter)
      }
      if (voice.drive >= 0.01) {
        const shaper = ctx.createWaveShaper()
        shaper.curve = this.getSampleDriveCurve(voice.drive)
        shaper.oversample = '2x'
        tail.connect(shaper)
        tail = shaper
        nodes.push(shaper)
      }
    }
    tail.connect(output).connect(panner)
    panner.connect(this.drumInput)
    const reverbSend = ctx.createGain()
    reverbSend.gain.value = clamp(voice.reverb, 0, 1)
    panner.connect(reverbSend).connect(bus.reverb)
    const roomSend = ctx.createGain()
    roomSend.gain.value = clamp(this.kit.room, 0, 1) * (id === 'kick' || id === 'bass808' ? 0.35 : 1)
    panner.connect(roomSend).connect(this.drumRoomInput)
    nodes.push(reverbSend, roomSend)

    const active: ActiveDrum = { source, output, nodes, stopped: false }
    source.onended = () => {
      for (const node of nodes) node.disconnect()
      if (this.openHat === active) this.openHat = null
      if (this.active808 === active) this.active808 = null
    }
    source.start(time)
    if (isSample && voice.decay < 1) {
      const playedLength = buffer.duration / playbackRate
      const end = time + clamp(voice.decay, 0.1, 1) * playedLength
      const hold = time + 0.7 * clamp(voice.decay, 0.1, 1) * playedLength
      output.gain.setValueAtTime(output.gain.value, hold)
      output.gain.linearRampToValueAtTime(0, end)
      source.stop(end)
    }
    if (id === 'openhat') this.openHat = active
    if (id === 'bass808') this.active808 = active
  }

  private chokeOpenHat(when: number): void {
    const hat = this.openHat
    if (!hat || hat.stopped) return
    hat.stopped = true
    holdAt(hat.output.gain, when)
    hat.output.gain.exponentialRampToValueAtTime(EPSILON, when + 0.015)
    try {
      hat.source.stop(when + 0.02)
    } catch {
      // Already ended.
    }
    this.openHat = null
  }

  private choke808(when: number): void {
    const bass = this.active808
    if (!bass || bass.stopped) return
    bass.stopped = true
    holdAt(bass.output.gain, when)
    bass.output.gain.exponentialRampToValueAtTime(EPSILON, when + 0.02)
    try {
      bass.source.stop(when + 0.025)
    } catch {
      // Already ended.
    }
    this.active808 = null
  }

  private getSampleDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const bucket = Math.round(clamp(amount, 0, 1) * 20)
    const cached = this.sampleDriveCurves.get(bucket)
    if (cached) return cached
    const curve = new Float32Array(1024)
    const drive = 1 + bucket * 0.35
    const normalizer = Math.tanh(drive)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * drive) / normalizer
    }
    this.sampleDriveCurves.set(bucket, curve)
    return curve
  }

  private applyDrumBus(): void {
    const ctx = this.ctx
    if (!ctx || !this.drumCompressor || !this.drumCrunch || !this.drumMakeup) return
    const punch = clamp(this.kit.punch, 0, 1)
    const crunch = clamp(this.kit.crunch, 0, 1)
    const now = ctx.currentTime
    this.drumCompressor.threshold.setTargetAtTime(-4 - 26 * punch, now, 0.015)
    this.drumCompressor.ratio.setTargetAtTime(1 + 5 * punch, now, 0.015)
    this.drumCompressor.knee.setTargetAtTime(6, now, 0.015)
    this.drumCompressor.attack.setTargetAtTime(0.012, now, 0.015)
    this.drumCompressor.release.setTargetAtTime(0.09 + 0.1 * (1 - punch), now, 0.015)
    if (crunch < 0.01) this.drumCrunch.curve = null
    else {
      const bucket = Math.round(crunch * 20)
      let curve = this.crunchCurves.get(bucket)
      if (!curve) {
        curve = new Float32Array(1024)
        const gain = 1 + 5 * bucket / 20
        const normalizer = Math.tanh(gain)
        for (let i = 0; i < curve.length; i++) {
          const x = i / (curve.length - 1) * 2 - 1
          curve[i] = Math.tanh(x * gain) / normalizer
        }
        this.crunchCurves.set(bucket, curve)
      }
      this.drumCrunch.curve = curve
    }
    const makeup = (1 + 0.9 * punch) / (1 + 0.6 * crunch)
    this.drumMakeup.gain.setTargetAtTime(makeup, now, 0.015)
  }

  setChopBuffer(buffer: AudioBuffer | null): void {
    if (this.chopBuffer !== buffer) this.stopChops()
    this.chopBuffer = buffer
  }

  setChopSettings(settings: ChopSettings): void {
    this.chopSettings = { ...settings }
  }

  chopRegion(pad: number): { start: number; end: number } | null {
    const buffer = this.chopBuffer
    if (!buffer) return null
    const beatLength = 60 / Math.max(1, this.chopSettings.bpm)
    const index = Math.max(0, Math.floor(pad))
    const rawStart = this.chopSettings.offset +
      (this.chopSettings.startBeat + index * this.chopSettings.sliceBeats) * beatLength
    const rawEnd = rawStart + this.chopSettings.sliceBeats * beatLength
    const start = clamp(rawStart, 0, buffer.duration)
    const end = clamp(rawEnd, 0, buffer.duration)
    return rawStart >= buffer.duration || end <= start ? null : { start, end }
  }

  triggerChop(pad: number, velocity = 1, when?: number): void {
    if (!this.ctx || !this.chopBus || !this.chopBuffer) return
    const region = this.chopRegion(pad)
    if (!region) return
    const ctx = this.ctx
    const time = Math.max(when ?? ctx.currentTime, ctx.currentTime)
    if (this.chopSettings.choke) this.chokeChops(time, 0.005)
    const source = ctx.createBufferSource()
    source.buffer = this.chopBuffer
    const tempoRate = this.chopSettings.fitToTempo ? this.bpm / Math.max(1, this.chopSettings.bpm) : 1
    const playbackRate = Math.max(0.01, tempoRate * 2 ** (this.chopSettings.pitch / 12))
    source.playbackRate.value = playbackRate
    const gain = ctx.createGain()
    const send = ctx.createGain()
    send.gain.value = clamp(this.chopSettings.reverb, 0, 1)
    source.connect(gain)
    gain.connect(this.chopBus.dry)
    gain.connect(send).connect(this.chopBus.reverb)
    const realDuration = (region.end - region.start) / playbackRate
    const fade = Math.min(Math.max(0.001, this.chopSettings.fade), realDuration / 2)
    const level = Math.max(EPSILON, clamp(velocity, 0, 1))
    gain.gain.setValueAtTime(EPSILON, time)
    gain.gain.exponentialRampToValueAtTime(level, time + fade)
    gain.gain.setValueAtTime(level, Math.max(time + fade, time + realDuration - fade))
    gain.gain.exponentialRampToValueAtTime(EPSILON, time + realDuration)
    const active: ActiveChop = { source, gain, nodes: [source, gain, send], stopped: false }
    this.activeChops.add(active)
    source.onended = () => {
      this.activeChops.delete(active)
      for (const node of active.nodes) node.disconnect()
    }
    source.start(time, region.start, region.end - region.start)
    source.stop(time + realDuration + 0.01)
  }

  stopChops(): void {
    if (!this.ctx) return
    this.chokeChops(this.ctx.currentTime, 0.02)
  }

  private chokeChops(when: number, fade: number): void {
    for (const chop of this.activeChops) {
      if (chop.stopped) continue
      chop.stopped = true
      holdAt(chop.gain.gain, when)
      chop.gain.gain.exponentialRampToValueAtTime(EPSILON, when + fade)
      try {
        chop.source.stop(when + fade + 0.005)
      } catch {
        // Already ended.
      }
    }
  }

  setTrack(trackId: string, state: MixerTrack): void {
    const remembered = { volume: clamp(state.volume, 0, 1), mute: state.mute }
    this.trackStates.set(trackId, remembered)
    this.applyTrack(trackId, remembered)
  }

  private applyTrack(trackId: string, state: MixerTrack): void {
    if (!this.ctx) return
    const gain = state.mute ? 0 : clamp(state.volume, 0, 1)
    const time = this.ctx.currentTime
    const buses: TrackBus[] = []
    if (trackId === DRUM_TRACK && this.drumBus) buses.push(this.drumBus)
    if (trackId === CHOP_TRACK && this.chopBus) buses.push(this.chopBus)
    const synthBus = this.synthBuses.get(trackId)
    if (synthBus) buses.push(synthBus)
    for (const bus of buses) {
      bus.dry.gain.setTargetAtTime(gain, time, 0.015)
      bus.reverb.gain.setTargetAtTime(gain, time, 0.015)
      bus.delay.gain.setTargetAtTime(gain, time, 0.015)
    }
  }

  setProject(project: EngineProject): void {
    this.project = project
    this.reconcileSynths()
  }

  setMode(mode: PlayMode): void {
    if (this.playingFlag) this.stop()
    this.mode = mode
  }

  setCycle(cycle: CycleRange | null): void {
    this.cycle = cycle
  }

  seek(step: number): void {
    this.songStart = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0
    if (!this.ctx || !this.playingFlag || this.mode !== 'song') return
    this.allNotesOff()
    this.stopChops()
    this.clearStepTimeouts()
    this.scheduledSteps.length = 0
    this.nextStep = this.songStart
    this.songPlaybackStart = this.songStart
    this.nextStepTime = this.ctx.currentTime + 0.05
    this.schedulerTick()
  }

  setBpm(bpm: number): void {
    this.bpm = clamp(bpm, 20, 300)
    for (const synth of this.synths.values()) synth.setBpm(this.bpm)
    if (this.ctx) this.retuneDelay(this.ctx.currentTime)
  }

  setSwing(swing: number): void {
    this.swing = clamp(swing, 0, 0.6)
  }

  setMetronome(enabled: boolean): void {
    this.metronome = enabled
  }

  start(): void {
    if (!this.ctx || this.playingFlag) return
    void this.ctx.resume()
    this.playingFlag = true
    this.nextStep = this.mode === 'loop' ? 0 : this.songStart
    this.songPlaybackStart = this.nextStep
    this.nextStepTime = this.ctx.currentTime + 0.05
    this.scheduledSteps.length = 0
    this.schedulerTick()
    this.schedulerTimer = setInterval(() => this.schedulerTick(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (this.schedulerTimer !== null) clearInterval(this.schedulerTimer)
    this.schedulerTimer = null
    this.clearStepTimeouts()
    this.playingFlag = false
    this.scheduledSteps.length = 0
    this.stopChops()
    this.allNotesOff()
    for (const synth of this.synths.values()) synth.resetPump()
  }

  private clearStepTimeouts(): void {
    for (const timeout of this.stepTimeouts) clearTimeout(timeout)
    this.stepTimeouts.clear()
    this.songEndTimeout = null
  }

  getStepPosition(): number {
    if (!this.playingFlag || !this.ctx) return -1
    const now = this.ctx.currentTime
    while (this.scheduledSteps.length > 2 && this.scheduledSteps[1].time <= now) {
      this.scheduledSteps.shift()
    }
    let audible: { step: number; time: number; duration: number } | undefined
    for (const scheduled of this.scheduledSteps) {
      if (scheduled.time <= now) audible = scheduled
      else break
    }
    if (!audible) return this.scheduledSteps[0]?.step ?? this.nextStep
    const fraction = clamp((now - audible.time) / audible.duration, 0, 0.9999)
    const position = audible.step + fraction
    return this.mode === 'loop' ? position % LOOP_STEPS : position
  }

  private schedulerTick(): void {
    if (!this.ctx || !this.playingFlag || this.songEndTimeout !== null) return
    if (this.nextStepTime < this.ctx.currentTime - 0.1) {
      this.nextStepTime = this.ctx.currentTime + 0.01
    }
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      const stepDuration = 60 / this.bpm / 4
      let step = this.nextStep
      if (this.mode === 'loop') {
        step = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS
      } else {
        const cycle = this.validCycle()
        if (cycle && step >= cycle.end) step = cycle.start
        const audibleTime = this.nextStepTime + (step % 2 === 1 ? this.swing * stepDuration : 0)
        const songEnd = this.getSongEnd()
        if (!cycle && step >= songEnd && this.songPlaybackStart < songEnd) {
          this.scheduleSongEnd(audibleTime)
          return
        }
      }
      const audibleTime = this.nextStepTime + (step % 2 === 1 ? this.swing * stepDuration : 0)
      this.scheduleStep(step, audibleTime, stepDuration)
      this.nextStep = this.mode === 'loop' ? (step + 1) % LOOP_STEPS : step + 1
      this.nextStepTime += stepDuration
    }
  }

  private validCycle(): CycleRange | null {
    const cycle = this.cycle
    return cycle && Number.isFinite(cycle.start) && Number.isFinite(cycle.end) && cycle.end > cycle.start
      ? cycle
      : null
  }

  private getSongEnd(): number {
    const clips = Array.isArray(this.project?.clips) ? this.project.clips : []
    let end = 0
    for (const clip of clips) {
      if (!Number.isFinite(clip?.start) || !Number.isFinite(clip?.length)) continue
      end = Math.max(end, clip.start + clip.length)
    }
    return end
  }

  private scheduleSongEnd(when: number): void {
    const delay = Math.max(0, (when - (this.ctx?.currentTime ?? when)) * 1000)
    const timeout = setTimeout(() => {
      this.stepTimeouts.delete(timeout)
      if (this.songEndTimeout !== timeout || !this.playingFlag || this.mode !== 'song') return
      this.songEndTimeout = null
      this.stop()
      this.onSongEnd?.()
    }, delay)
    this.songEndTimeout = timeout
    this.stepTimeouts.add(timeout)
  }

  private scheduleStep(step: number, when: number, stepDuration: number): void {
    if (step % 4 === 0) {
      for (const synth of this.synths.values()) synth.pump(when, 60 / this.bpm)
    }
    if (this.mode === 'loop') this.scheduleLoopPatterns(step, when, stepDuration)
    else this.scheduleSongClips(step, when, stepDuration)
    if (this.metronome && step % 4 === 0) this.scheduleMetronome(step, when)
    this.scheduledSteps.push({ step, time: when, duration: stepDuration })
    while (this.scheduledSteps.length > 16) this.scheduledSteps.shift()
    const delay = Math.max(0, (when - (this.ctx?.currentTime ?? when)) * 1000)
    const timeout = setTimeout(() => {
      this.stepTimeouts.delete(timeout)
      if (this.playingFlag) this.onStep?.(step)
    }, delay)
    this.stepTimeouts.add(timeout)
  }

  private scheduleLoopPatterns(step: number, when: number, stepDuration: number): void {
    const project = this.project
    const tracks = Array.isArray(project?.tracks) ? project.tracks : []
    for (const track of tracks) {
      if (!track) continue
      const pattern = project?.patterns?.[track.patternId]
      if (!pattern || pattern.kind !== track.kind) continue
      const length = this.patternLength(pattern)
      if (length === 0) continue
      this.firePattern(track, pattern, step % length, when, stepDuration)
    }
  }

  private scheduleSongClips(step: number, when: number, stepDuration: number): void {
    const project = this.project
    const tracks = Array.isArray(project?.tracks) ? project.tracks : []
    const clips = Array.isArray(project?.clips) ? project.clips : []
    for (const clip of clips) {
      if (
        !Number.isFinite(clip?.start) ||
        !Number.isFinite(clip?.length) ||
        !Number.isFinite(clip?.offset) ||
        clip.length <= 0 ||
        step < clip.start ||
        step >= clip.start + clip.length
      ) {
        continue
      }
      const track = tracks.find((candidate) => candidate?.id === clip.trackId)
      const pattern = project?.patterns?.[clip.patternId]
      if (!track || !pattern || pattern.kind !== track.kind) continue
      const length = this.patternLength(pattern)
      if (length === 0) continue
      const local = ((step - clip.start + clip.offset) % length + length) % length
      const remaining = clip.start + clip.length - step
      this.firePattern(track, pattern, local, when, stepDuration, remaining)
    }
  }

  private patternLength(pattern: Pattern): number {
    const length = pattern.bars * STEPS_PER_BAR
    return Number.isFinite(length) && length > 0 ? Math.floor(length) : 0
  }

  private firePattern(
    track: EngineTrack,
    pattern: Pattern,
    local: number,
    when: number,
    stepDuration: number,
    remainingClipSteps?: number
  ): void {
    if (pattern.kind === 'drums') {
      for (const id of DRUM_VOICES) {
        const steps = pattern.drums?.[id]
        const velocity = Array.isArray(steps) ? steps[local] : 0
        if (!Number.isFinite(velocity) || velocity <= 0) continue
        const requested = pattern.rolls?.[id]?.[local]
        const roll = typeof requested === 'number' && Number.isFinite(requested) && Number.isInteger(requested) && requested >= 2
          ? Math.min(4, requested)
          : 1
        for (let hit = 0; hit < roll; hit++) {
          const offsetSteps = hit / roll
          if (remainingClipSteps !== undefined && offsetSteps >= remainingClipSteps) break
          this.triggerDrum(id, hit === 0 ? velocity : velocity * 0.85, when + offsetSteps * stepDuration)
        }
      }
      return
    }
    if (pattern.kind === 'chops') {
      const pads = Array.isArray(pattern.chops) ? pattern.chops : []
      for (let pad = 0; pad < pads.length; pad++) {
        const velocity = Array.isArray(pads[pad]) ? pads[pad][local] : 0
        if (Number.isFinite(velocity) && velocity > 0) this.triggerChop(pad, velocity, when)
      }
      return
    }
    const notes = Array.isArray(pattern.notes) ? pattern.notes : []
    for (const note of notes) {
      if (
        !Number.isFinite(note?.step) ||
        !Number.isFinite(note?.note) ||
        !Number.isFinite(note?.length) ||
        !Number.isFinite(note?.velocity) ||
        note.step !== local
      ) {
        continue
      }
      const noteSteps = remainingClipSteps === undefined
        ? Math.max(1, note.length)
        : Math.min(Math.max(1, note.length), remainingClipSteps)
      this.playNote(track.id, note.note, note.velocity, when, noteSteps * stepDuration * 0.98)
    }
  }

  private scheduleMetronome(step: number, when: number): void {
    if (!this.ctx || !this.studioMaster) return
    const oscillator = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = step % STEPS_PER_BAR === 0 ? 1500 : 1000
    gain.gain.setValueAtTime(EPSILON, when)
    gain.gain.exponentialRampToValueAtTime(0.24, when + 0.001)
    gain.gain.exponentialRampToValueAtTime(EPSILON, when + 0.03)
    oscillator.connect(gain).connect(this.studioMaster)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(when)
    oscillator.stop(when + 0.035)
  }

  private retuneDelay(when: number): void {
    const dottedEighth = (60 / this.bpm) * 0.75
    this.delayLeft?.delayTime.setTargetAtTime(dottedEighth * 0.99, when, 0.03)
    this.delayRight?.delayTime.setTargetAtTime(dottedEighth * 1.01, when, 0.03)
  }
}

export const studio = new StudioEngine()
