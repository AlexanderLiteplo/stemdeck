import {
  CHOP_TRACK,
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

interface ActiveOpenHat {
  output: GainNode
  sources: AudioScheduledSourceNode[]
  stopped: boolean
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
  tune: 0,
  decay: 1,
  tone: 0.5,
  drive: 0,
  level: 0.8,
  reverb: 0.1
}

const DEFAULT_KIT: DrumKit = {
  name: 'Default',
  description: 'Balanced synthesized drums.',
  voices: Object.fromEntries(DRUM_VOICES.map((id) => [id, { ...DEFAULT_DRUM }])) as Record<
    DrumVoiceId,
    DrumVoice
  >
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
  private readonly driveCurves = new Map<number, Float32Array<ArrayBuffer>>()

  private readonly patches = new Map<string, SynthPatch>()
  private kit: DrumKit = structuredClone(DEFAULT_KIT)

  private chopBuffer: AudioBuffer | null = null
  private chopSettings: ChopSettings = { ...DEFAULT_CHOPS }
  private readonly activeChops = new Set<ActiveChop>()
  private openHat: ActiveOpenHat | null = null
  private active808: ActiveOpenHat | null = null

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
  }

  triggerDrum(id: DrumVoiceId, velocity = 1, when?: number): void {
    if (!this.ctx || !this.drumBus || !this.noiseBuffer) return
    const ctx = this.ctx
    const time = Math.max(when ?? ctx.currentTime, ctx.currentTime)
    const voice = this.kit.voices[id] ?? DEFAULT_DRUM
    const tune = 2 ** (clamp(voice.tune, -24, 24) / 12)
    const decay = clamp(voice.decay, 0.1, 4)
    const tone = clamp(voice.tone, 0, 1)
    const mix = ctx.createGain()
    const output = ctx.createGain()
    output.gain.value = clamp(voice.level, 0, 1) * clamp(velocity, 0, 1)
    const nodes: AudioNode[] = [mix, output]
    const sources: AudioScheduledSourceNode[] = []
    let lastDuration = 0.2

    const routeSource = (source: AudioScheduledSourceNode, gain: GainNode): void => {
      source.connect(gain)
      gain.connect(mix)
      sources.push(source)
      nodes.push(source, gain)
    }
    const oscillator = (wave: OscillatorType, frequency: number, gainLevel: number, duration: number): OscillatorNode => {
      const source = ctx.createOscillator()
      source.type = wave
      source.frequency.value = frequency
      const gain = ctx.createGain()
      routeSource(source, gain)
      this.decayEnvelope(gain.gain, time, gainLevel, duration)
      lastDuration = Math.max(lastDuration, duration)
      return source
    }
    const noise = (gainLevel: number, duration: number): { source: AudioBufferSourceNode; gain: GainNode } => {
      const source = ctx.createBufferSource()
      source.buffer = this.noiseBuffer
      source.loop = true
      const gain = ctx.createGain()
      routeSource(source, gain)
      this.decayEnvelope(gain.gain, time, gainLevel, duration)
      lastDuration = Math.max(lastDuration, duration)
      return { source, gain }
    }

    if (id === 'kick') {
      const body = oscillator('sine', 160 * tune, 1, 0.45 * decay)
      body.frequency.setValueAtTime(160 * tune, time)
      body.frequency.exponentialRampToValueAtTime(48 * tune, time + 0.06)
      const click = noise(0.12 + tone * 0.32, 0.005)
      const clickFilter = ctx.createBiquadFilter()
      clickFilter.type = 'bandpass'
      clickFilter.frequency.value = 1800 + tone * 3200
      clickFilter.Q.value = 0.8
      click.source.disconnect(click.gain)
      click.source.connect(clickFilter).connect(click.gain)
      nodes.push(clickFilter)
    } else if (id === 'bass808') {
      this.choke808(time)
      const duration = 1.4 * decay
      const fundamental = 49 * tune
      const sine = oscillator('sine', fundamental * 1.06, 0.95, duration)
      sine.frequency.exponentialRampToValueAtTime(fundamental, time + 0.045)
      const triangle = oscillator('triangle', fundamental * 1.04, 0.13, duration * 0.9)
      triangle.frequency.exponentialRampToValueAtTime(fundamental, time + 0.045)
      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 200 * 25 ** tone
      mix.disconnect()
      mix.connect(lowpass)
      nodes.push(lowpass)
      this.connectDrumOutput(lowpass, output, voice, nodes)
    } else if (id === 'snare') {
      const duration = 0.22 * decay
      const body = oscillator('triangle', 230 * tune, 0.62 * (1.15 - tone * 0.35), duration * 0.75)
      body.frequency.exponentialRampToValueAtTime(185 * tune, time + 0.035)
      const hiss = noise(0.38 + tone * 0.55, duration)
      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 1200 + tone * 1000
      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = 2500 + tone * 3500
      bandpass.Q.value = 0.7
      hiss.source.disconnect(hiss.gain)
      hiss.source.connect(highpass).connect(bandpass).connect(hiss.gain)
      nodes.push(highpass, bandpass)
    } else if (id === 'clap') {
      const duration = 0.3 * decay
      const burst = noise(0.9, duration)
      burst.gain.gain.cancelScheduledValues(time)
      burst.gain.gain.setValueAtTime(EPSILON, time)
      for (let i = 0; i < 3; i++) {
        const start = time + i * 0.01
        burst.gain.gain.linearRampToValueAtTime(0.85 - i * 0.12, start + 0.001)
        burst.gain.gain.exponentialRampToValueAtTime(i === 2 ? 0.3 : 0.08, start + 0.007)
      }
      burst.gain.gain.exponentialRampToValueAtTime(EPSILON, time + duration)
      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = 700 * (2500 / 700) ** tone
      bandpass.Q.value = 1.5
      burst.source.disconnect(burst.gain)
      burst.source.connect(bandpass).connect(burst.gain)
      nodes.push(bandpass)
    } else if (id === 'hat' || id === 'openhat') {
      if (id === 'hat') this.chokeOpenHat(time)
      const duration = (id === 'hat' ? 0.06 : 0.45) * decay
      const metallic = ctx.createGain()
      this.decayEnvelope(metallic.gain, time, 0.52, duration)
      nodes.push(metallic)
      for (const ratio of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
        const source = ctx.createOscillator()
        source.type = 'square'
        source.frequency.value = 40 * ratio * tune
        source.connect(metallic)
        sources.push(source)
        nodes.push(source)
      }
      const hiss = ctx.createBufferSource()
      hiss.buffer = this.noiseBuffer
      hiss.loop = true
      const hissGain = ctx.createGain()
      hissGain.gain.value = 0.18 + tone * 0.22
      hiss.connect(hissGain).connect(metallic)
      sources.push(hiss)
      nodes.push(hiss, hissGain)
      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = 7000 + tone * 5000
      bandpass.Q.value = 0.9
      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 5500 + tone * 2500
      metallic.connect(bandpass).connect(highpass).connect(mix)
      nodes.push(bandpass, highpass)
      lastDuration = duration
    } else if (id === 'perc') {
      const duration = 0.12 * decay
      const ping = oscillator('sine', 820 * tune, 0.9, duration)
      ping.frequency.exponentialRampToValueAtTime(660 * tune, time + Math.min(0.025, duration * 0.5))
      oscillator('triangle', 1230 * tune, 0.2, duration * 0.65)
      const click = noise(0.12 + tone * 0.2, 0.008)
      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 2500
      click.source.disconnect(click.gain)
      click.source.connect(highpass).connect(click.gain)
      nodes.push(highpass)
    } else {
      const duration = 1.8 * decay
      const wash = noise(0.8, duration)
      const metallic = ctx.createGain()
      this.decayEnvelope(metallic.gain, time, 0.18, duration * 0.85)
      nodes.push(metallic)
      for (const ratio of [1, 1.34, 1.79, 2.47]) {
        const source = ctx.createOscillator()
        source.type = 'square'
        source.frequency.value = 1500 * ratio * tune
        source.connect(metallic)
        sources.push(source)
        nodes.push(source)
      }
      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 3200 + tone * 2400
      wash.source.disconnect(wash.gain)
      wash.source.connect(highpass).connect(wash.gain)
      metallic.connect(highpass)
      nodes.push(highpass)
    }

    if (id !== 'bass808') this.connectDrumOutput(mix, output, voice, nodes)
    const end = time + lastDuration + 0.04
    for (const source of sources) {
      source.start(time)
      source.stop(end)
    }
    if (sources.length > 0) {
      const cleanup = (): void => {
        for (const node of nodes) node.disconnect()
        if (this.openHat?.output === output) this.openHat = null
        if (this.active808?.output === output) this.active808 = null
      }
      sources[0].onended = cleanup
    }
    if (id === 'openhat') this.openHat = { output, sources, stopped: false }
    if (id === 'bass808') this.active808 = { output, sources, stopped: false }
  }

  private decayEnvelope(param: AudioParam, when: number, peak: number, duration: number): void {
    param.setValueAtTime(EPSILON, when)
    param.exponentialRampToValueAtTime(Math.max(EPSILON, peak), when + 0.0015)
    param.exponentialRampToValueAtTime(EPSILON, when + Math.max(0.004, duration))
  }

  private connectDrumOutput(input: AudioNode, output: GainNode, voice: DrumVoice, nodes: AudioNode[]): void {
    if (!this.drumBus || !this.ctx) return
    let tail: AudioNode = input
    if (voice.drive >= 0.01) {
      const shaper = this.ctx.createWaveShaper()
      shaper.curve = this.getDriveCurve(voice.drive)
      shaper.oversample = '2x'
      tail.connect(shaper)
      tail = shaper
      nodes.push(shaper)
    }
    tail.connect(output)
    output.connect(this.drumBus.dry)
    const send = this.ctx.createGain()
    send.gain.value = clamp(voice.reverb, 0, 1)
    output.connect(send).connect(this.drumBus.reverb)
    nodes.push(send)
  }

  private chokeOpenHat(when: number): void {
    const hat = this.openHat
    if (!hat || hat.stopped) return
    hat.stopped = true
    holdAt(hat.output.gain, when)
    hat.output.gain.exponentialRampToValueAtTime(EPSILON, when + 0.015)
    for (const source of hat.sources) {
      try {
        source.stop(when + 0.02)
      } catch {
        // Already ended.
      }
    }
    this.openHat = null
  }

  private choke808(when: number): void {
    const bass = this.active808
    if (!bass || bass.stopped) return
    bass.stopped = true
    holdAt(bass.output.gain, when)
    bass.output.gain.exponentialRampToValueAtTime(EPSILON, when + 0.02)
    for (const source of bass.sources) {
      try {
        source.stop(when + 0.025)
      } catch {
        // Already ended.
      }
    }
    this.active808 = null
  }

  private getDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const bucket = Math.round(clamp(amount, 0, 1) * 20)
    const cached = this.driveCurves.get(bucket)
    if (cached) return cached
    const curve = new Float32Array(1024)
    const drive = 1 + bucket * 0.65
    const normalizer = Math.tanh(drive)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * drive) / normalizer
    }
    this.driveCurves.set(bucket, curve)
    return curve
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
        if (Number.isFinite(velocity) && velocity > 0) this.triggerDrum(id, velocity, when)
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
