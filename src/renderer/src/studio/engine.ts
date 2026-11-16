import {
  DRUM_VOICES,
  STEPS_PER_BAR,
  type ChopSettings,
  type DrumKit,
  type DrumVoice,
  type DrumVoiceId,
  type MixerTrack,
  type Pattern,
  type StudioEngineApi,
  type StudioTrackId,
  type SynthPatch
} from './types'

const EPSILON = 0.0001
const MAX_SYNTH_VOICES = 16
const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.12

interface TrackBus {
  dry: GainNode
  reverb: GainNode
  delay: GainNode
}

interface PitchParam {
  param: AudioParam
  ratio: number
}

interface SynthVoice {
  midi: number
  velocity: number
  startedAt: number
  live: boolean
  releasing: boolean
  stolen: boolean
  cleaned: boolean
  amp: GainNode
  filter: BiquadFilterNode
  filterBase: number
  sources: AudioScheduledSourceNode[]
  oscillators: OscillatorNode[]
  nodes: AudioNode[]
  pitches: PitchParam[]
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

const INITIAL_PATCH: SynthPatch = {
  name: 'Init',
  description: 'A neutral sawtooth patch.',
  osc1: { wave: 'sawtooth', level: 0.75 },
  osc2: { wave: 'sine', level: 0, octave: 0, detune: 0 },
  sub: 0,
  noise: 0,
  unison: 1,
  spread: 0,
  filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7, envAmount: 0, keyTrack: 0 },
  ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.25 },
  filterEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.25 },
  lfo: { rate: 5, pitch: 0, filter: 0 },
  glide: 0,
  mono: false,
  drive: 0,
  reverb: 0,
  delay: 0,
  volume: 0.75
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

function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
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

  private ctx: AudioContext | null = null
  private studioMaster: GainNode | null = null
  private tracks: Record<StudioTrackId, TrackBus> | null = null
  private readonly trackStates: Record<StudioTrackId, MixerTrack> = {
    drums: { volume: 1, mute: false },
    chops: { volume: 1, mute: false },
    synth: { volume: 1, mute: false }
  }

  private reverbInput: GainNode | null = null
  private delayInput: GainNode | null = null
  private delayLeft: DelayNode | null = null
  private delayRight: DelayNode | null = null

  private synthDrive: WaveShaperNode | null = null
  private synthMakeup: GainNode | null = null
  private synthVolume: GainNode | null = null
  private synthReverb: GainNode | null = null
  private synthDelay: GainNode | null = null
  private lfo: OscillatorNode | null = null
  private lfoPitch: GainNode | null = null
  private lfoFilter: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private readonly driveCurves = new Map<number, Float32Array<ArrayBuffer>>()

  private patch: SynthPatch = structuredClone(INITIAL_PATCH)
  private kit: DrumKit = structuredClone(DEFAULT_KIT)
  private synthVoices: SynthVoice[] = []
  private monoVoice: SynthVoice | null = null
  private sequencerMonoVoice: SynthVoice | null = null
  private sequencerMonoEnd = 0
  private liveNoteStack: Array<{ midi: number; velocity: number }> = []

  private chopBuffer: AudioBuffer | null = null
  private chopSettings: ChopSettings = { ...DEFAULT_CHOPS }
  private readonly activeChops = new Set<ActiveChop>()
  private openHat: ActiveOpenHat | null = null
  private active808: ActiveOpenHat | null = null

  private pattern: Pattern | null = null
  private bpm = 120
  private swing = 0
  private metronome = false
  private playingFlag = false
  private schedulerTimer: ReturnType<typeof setInterval> | null = null
  private nextStep = 0
  private nextStepTime = 0
  private readonly scheduledSteps: Array<{ step: number; time: number; duration: number }> = []
  private readonly stepTimeouts = new Set<ReturnType<typeof setTimeout>>()

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

    const makeTrack = (): TrackBus => {
      const dry = ctx.createGain()
      const reverb = ctx.createGain()
      const delay = ctx.createGain()
      dry.connect(this.studioMaster!)
      return { dry, reverb, delay }
    }
    this.tracks = { drums: makeTrack(), chops: makeTrack(), synth: makeTrack() }

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

    for (const track of Object.values(this.tracks)) {
      track.reverb.connect(this.reverbInput)
      track.delay.connect(this.delayInput)
    }

    this.synthDrive = ctx.createWaveShaper()
    this.synthDrive.oversample = '2x'
    this.synthMakeup = ctx.createGain()
    this.synthVolume = ctx.createGain()
    this.synthReverb = ctx.createGain()
    this.synthDelay = ctx.createGain()
    this.synthDrive.connect(this.synthMakeup).connect(this.synthVolume)
    this.synthVolume.connect(this.tracks.synth.dry)
    this.synthVolume.connect(this.synthReverb).connect(this.tracks.synth.reverb)
    this.synthVolume.connect(this.synthDelay).connect(this.tracks.synth.delay)

    this.lfo = ctx.createOscillator()
    this.lfoPitch = ctx.createGain()
    this.lfoFilter = ctx.createGain()
    this.lfo.connect(this.lfoPitch)
    this.lfo.connect(this.lfoFilter)
    this.lfo.start()

    this.retuneDelay(ctx.currentTime)
    for (const id of ['drums', 'chops', 'synth'] as StudioTrackId[]) {
      this.applyTrack(id, this.trackStates[id])
    }
    this.applyPatchGlobals()
  }

  setPatch(patch: SynthPatch): void {
    const modeChanged = patch.mono !== this.patch.mono
    if (modeChanged) this.allNotesOff()
    this.patch = structuredClone(patch)
    this.applyPatchGlobals()
  }

  private applyPatchGlobals(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (this.synthDrive) this.synthDrive.curve = this.patch.drive < 0.01 ? null : this.getDriveCurve(this.patch.drive)
    this.synthMakeup?.gain.setTargetAtTime(1 / (1 + this.patch.drive * 0.7), now, 0.02)
    this.synthVolume?.gain.setTargetAtTime(clamp(this.patch.volume, 0, 1), now, 0.02)
    this.synthReverb?.gain.setTargetAtTime(clamp(this.patch.reverb, 0, 1), now, 0.04)
    this.synthDelay?.gain.setTargetAtTime(clamp(this.patch.delay, 0, 1), now, 0.04)
    this.lfo?.frequency.setTargetAtTime(clamp(this.patch.lfo.rate, 0.05, 20), now, 0.03)
    this.lfoPitch?.gain.setTargetAtTime(clamp(this.patch.lfo.pitch, 0, 100), now, 0.03)
    this.lfoFilter?.gain.setTargetAtTime(clamp(this.patch.lfo.filter, 0, 4) * 1200, now, 0.03)
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    if (!this.ctx) return
    const time = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime)
    const note = clamp(midi, 0, 127)
    const level = clamp(velocity, 0, 1)
    if (this.patch.mono) {
      this.liveNoteStack.push({ midi: note, velocity: level })
      if (this.monoVoice && !this.monoVoice.cleaned && !this.monoVoice.releasing) {
        this.monoVoice.midi = note
        this.monoVoice.velocity = level
        holdAt(this.monoVoice.amp.gain, time)
        this.monoVoice.amp.gain.setTargetAtTime(
          Math.max(EPSILON, level * clamp(this.patch.ampEnv.sustain, 0, 1)),
          time,
          0.01
        )
        this.setVoicePitch(this.monoVoice, note, time, this.patch.glide, true)
      } else {
        this.monoVoice = this.createVoice(note, level, time, true)
      }
      return
    }
    this.createVoice(note, level, time, true)
  }

  noteOff(midi: number, when?: number): void {
    if (!this.ctx) return
    const time = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime)
    if (this.patch.mono) {
      this.liveNoteStack = this.liveNoteStack.filter((note) => note.midi !== midi)
      const fallback = this.liveNoteStack.at(-1)
      if (fallback && this.monoVoice && !this.monoVoice.cleaned) {
        this.monoVoice.midi = fallback.midi
        this.monoVoice.velocity = fallback.velocity
        holdAt(this.monoVoice.amp.gain, time)
        this.monoVoice.amp.gain.setTargetAtTime(
          Math.max(EPSILON, fallback.velocity * clamp(this.patch.ampEnv.sustain, 0, 1)),
          time,
          0.01
        )
        this.setVoicePitch(this.monoVoice, fallback.midi, time, this.patch.glide, true)
      } else if (this.monoVoice) {
        this.releaseVoice(this.monoVoice, time, this.patch.ampEnv.release)
        this.monoVoice = null
      }
      return
    }
    for (const voice of this.synthVoices) {
      if (voice.live && voice.midi === midi) this.releaseVoice(voice, time, this.patch.ampEnv.release)
    }
  }

  playNote(midi: number, velocity: number, when: number, duration: number): void {
    if (!this.ctx) return
    const time = Math.max(when, this.ctx.currentTime)
    const end = time + Math.max(0.005, Number.isFinite(duration) ? duration : 0.005)
    if (this.patch.mono) {
      const isLegato =
        this.sequencerMonoVoice &&
        !this.sequencerMonoVoice.cleaned &&
        time <= this.sequencerMonoEnd + 0.03
      if (isLegato && this.sequencerMonoVoice) {
        const voice = this.sequencerMonoVoice
        const holdTime = Math.max(this.ctx.currentTime, Math.min(time, this.sequencerMonoEnd))
        voice.releasing = false
        voice.midi = clamp(midi, 0, 127)
        voice.velocity = clamp(velocity, 0, 1)
        holdAt(voice.amp.gain, holdTime)
        voice.amp.gain.setTargetAtTime(
          Math.max(EPSILON, voice.velocity * clamp(this.patch.ampEnv.sustain, 0, 1)),
          holdTime,
          0.01
        )
        this.setVoicePitch(voice, voice.midi, time, this.patch.glide, true, holdTime)
        this.sequencerMonoEnd = Math.max(this.sequencerMonoEnd, end)
        this.releaseVoice(voice, this.sequencerMonoEnd, this.patch.ampEnv.release)
      } else {
        const voice = this.createVoice(clamp(midi, 0, 127), clamp(velocity, 0, 1), time, false)
        this.sequencerMonoVoice = voice
        this.sequencerMonoEnd = end
        if (voice) this.releaseVoice(voice, end, this.patch.ampEnv.release)
      }
      return
    }
    const voice = this.createVoice(clamp(midi, 0, 127), clamp(velocity, 0, 1), time, false)
    if (voice) this.releaseVoice(voice, end, this.patch.ampEnv.release)
  }

  allNotesOff(): void {
    if (!this.ctx) {
      this.liveNoteStack = []
      return
    }
    const now = this.ctx.currentTime
    this.liveNoteStack = []
    for (const voice of [...this.synthVoices]) this.releaseVoice(voice, now, 0.03, true)
    this.monoVoice = null
    this.sequencerMonoVoice = null
    this.sequencerMonoEnd = 0
  }

  private createVoice(midi: number, velocity: number, when: number, live: boolean): SynthVoice | null {
    if (!this.ctx || !this.synthDrive || !this.noiseBuffer || !this.lfoPitch || !this.lfoFilter) return null
    const ctx = this.ctx
    const time = Math.max(when, ctx.currentTime)
    const active = this.synthVoices.filter((voice) => !voice.cleaned && !voice.stolen)
    if (active.length >= MAX_SYNTH_VOICES) {
      const oldest = active.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b))
      oldest.stolen = true
      this.releaseVoice(oldest, time, 0.025, true)
    }

    const filter = ctx.createBiquadFilter()
    filter.type = this.patch.filter.type
    filter.Q.value = clamp(this.patch.filter.resonance, 0.1, 20)
    const nyquist = ctx.sampleRate * 0.48
    const keyFactor = 2 ** (((midi - 60) / 12) * clamp(this.patch.filter.keyTrack, 0, 1))
    const filterBase = clamp(this.patch.filter.cutoff * keyFactor, 20, nyquist)
    const amp = ctx.createGain()
    amp.gain.value = EPSILON
    const voiceOut = ctx.createGain()
    voiceOut.gain.value = 0.3
    amp.connect(voiceOut).connect(this.synthDrive)

    const voice: SynthVoice = {
      midi,
      velocity,
      startedAt: time,
      live,
      releasing: false,
      stolen: false,
      cleaned: false,
      amp,
      filter,
      filterBase,
      sources: [],
      oscillators: [],
      nodes: [filter, amp, voiceOut],
      pitches: []
    }

    const unison = Math.round(clamp(this.patch.unison, 1, 7))
    const normalization = 1 / Math.sqrt(unison)
    const addOscillatorStack = (
      wave: OscillatorType,
      level: number,
      octave: number,
      detune: number
    ): void => {
      if (level <= 0) return
      for (let i = 0; i < unison; i++) {
        const position = unison === 1 ? 0 : i / (unison - 1) - 0.5
        const oscillator = ctx.createOscillator()
        oscillator.type = wave
        oscillator.detune.value = detune + position * 2 * clamp(this.patch.spread, 0, 50)
        const gain = ctx.createGain()
        gain.gain.value = level * normalization
        oscillator.connect(gain).connect(filter)
        this.lfoPitch!.connect(oscillator.detune)
        voice.sources.push(oscillator)
        voice.oscillators.push(oscillator)
        voice.nodes.push(oscillator, gain)
        voice.pitches.push({ param: oscillator.frequency, ratio: 2 ** octave })
        oscillator.start(time)
      }
    }

    addOscillatorStack(this.patch.osc1.wave, clamp(this.patch.osc1.level, 0, 1), 0, 0)
    addOscillatorStack(
      this.patch.osc2.wave,
      clamp(this.patch.osc2.level, 0, 1),
      clamp(this.patch.osc2.octave, -2, 2),
      clamp(this.patch.osc2.detune, -50, 50)
    )
    if (this.patch.sub > 0) {
      const sub = ctx.createOscillator()
      sub.type = 'sine'
      const subGain = ctx.createGain()
      subGain.gain.value = clamp(this.patch.sub, 0, 1)
      sub.connect(subGain).connect(filter)
      this.lfoPitch.connect(sub.detune)
      voice.sources.push(sub)
      voice.oscillators.push(sub)
      voice.nodes.push(sub, subGain)
      voice.pitches.push({ param: sub.frequency, ratio: 0.5 })
      sub.start(time)
    }
    if (this.patch.noise > 0) {
      const noise = ctx.createBufferSource()
      noise.buffer = this.noiseBuffer
      noise.loop = true
      const noiseGain = ctx.createGain()
      noiseGain.gain.value = clamp(this.patch.noise, 0, 1) * 0.5
      noise.connect(noiseGain).connect(filter)
      voice.sources.push(noise)
      voice.nodes.push(noise, noiseGain)
      noise.start(time)
    }

    if (voice.sources.length === 0) {
      voiceOut.disconnect()
      return null
    }
    filter.connect(amp)
    this.lfoFilter.connect(filter.detune)
    this.setVoicePitch(voice, midi, time, 0, false)
    this.scheduleVoiceAttack(voice, time)
    voice.sources[0].onended = () => this.cleanupVoice(voice)
    this.synthVoices.push(voice)
    return voice
  }

  private scheduleVoiceAttack(voice: SynthVoice, when: number): void {
    const ampEnv = this.patch.ampEnv
    const filterEnv = this.patch.filterEnv
    const ampAttackEnd = when + Math.max(0.001, ampEnv.attack)
    const ampDecayEnd = ampAttackEnd + Math.max(0.001, ampEnv.decay)
    voice.amp.gain.setValueAtTime(EPSILON, when)
    voice.amp.gain.linearRampToValueAtTime(voice.velocity, ampAttackEnd)
    voice.amp.gain.exponentialRampToValueAtTime(
      Math.max(EPSILON, voice.velocity * clamp(ampEnv.sustain, 0, 1)),
      ampDecayEnd
    )

    const envVelocity = 0.7 + voice.velocity * 0.3
    const peak = clamp(voice.filterBase * 2 ** (this.patch.filter.envAmount * envVelocity), 20, this.ctx!.sampleRate * 0.48)
    const sustain = clamp(
      voice.filterBase * 2 ** (this.patch.filter.envAmount * clamp(filterEnv.sustain, 0, 1) * envVelocity),
      20,
      this.ctx!.sampleRate * 0.48
    )
    const filterAttackEnd = when + Math.max(0.001, filterEnv.attack)
    const filterDecayEnd = filterAttackEnd + Math.max(0.001, filterEnv.decay)
    voice.filter.frequency.setValueAtTime(Math.max(20, voice.filterBase), when)
    voice.filter.frequency.exponentialRampToValueAtTime(Math.max(20, peak), filterAttackEnd)
    voice.filter.frequency.exponentialRampToValueAtTime(Math.max(20, sustain), filterDecayEnd)
  }

  private setVoicePitch(
    voice: SynthVoice,
    midi: number,
    when: number,
    glide: number,
    updateFilter: boolean,
    filterWhen = when
  ): void {
    const base = midiFrequency(midi)
    for (const pitch of voice.pitches) {
      const target = Math.max(1, base * pitch.ratio)
      if (glide > 0) {
        holdAt(pitch.param, when)
        pitch.param.setTargetAtTime(target, when, Math.max(0.001, glide / 3))
      } else {
        pitch.param.setValueAtTime(target, when)
      }
    }
    if (this.ctx && updateFilter) {
      const keyFactor = 2 ** (((midi - 60) / 12) * clamp(this.patch.filter.keyTrack, 0, 1))
      voice.filterBase = clamp(this.patch.filter.cutoff * keyFactor, 20, this.ctx.sampleRate * 0.48)
      const envVelocity = 0.7 + voice.velocity * 0.3
      const target = clamp(
        voice.filterBase *
          2 ** (this.patch.filter.envAmount * clamp(this.patch.filterEnv.sustain, 0, 1) * envVelocity),
        20,
        this.ctx.sampleRate * 0.48
      )
      holdAt(voice.filter.frequency, filterWhen)
      if (glide > 0) {
        voice.filter.frequency.setTargetAtTime(target, filterWhen, Math.max(0.001, glide / 3))
      } else {
        voice.filter.frequency.setTargetAtTime(target, filterWhen, 0.005)
      }
    }
  }

  private releaseVoice(voice: SynthVoice, when: number, release: number, force = false): void {
    if (voice.cleaned || (voice.releasing && !force)) return
    voice.releasing = true
    const time = Math.max(when, this.ctx?.currentTime ?? when)
    const end = time + Math.max(0.005, release)
    holdAt(voice.amp.gain, time)
    voice.amp.gain.exponentialRampToValueAtTime(EPSILON, end)
    holdAt(voice.filter.frequency, time)
    voice.filter.frequency.exponentialRampToValueAtTime(Math.max(20, voice.filterBase), end)
    for (const source of voice.sources) {
      try {
        source.stop(end + 0.03)
      } catch {
        // Already ended.
      }
    }
  }

  private cleanupVoice(voice: SynthVoice): void {
    if (voice.cleaned) return
    voice.cleaned = true
    for (const oscillator of voice.oscillators) {
      try {
        this.lfoPitch?.disconnect(oscillator.detune)
      } catch {
        // Already disconnected.
      }
    }
    try {
      this.lfoFilter?.disconnect(voice.filter.detune)
    } catch {
      // Already disconnected.
    }
    for (const node of voice.nodes) node.disconnect()
    this.synthVoices = this.synthVoices.filter((candidate) => candidate !== voice)
    if (this.monoVoice === voice) this.monoVoice = null
    if (this.sequencerMonoVoice === voice) this.sequencerMonoVoice = null
  }

  setKit(kit: DrumKit): void {
    this.kit = structuredClone(kit)
  }

  triggerDrum(id: DrumVoiceId, velocity = 1, when?: number): void {
    if (!this.ctx || !this.tracks || !this.noiseBuffer) return
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
    if (!this.tracks || !this.ctx) return
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
    output.connect(this.tracks.drums.dry)
    const send = this.ctx.createGain()
    send.gain.value = clamp(voice.reverb, 0, 1)
    output.connect(send).connect(this.tracks.drums.reverb)
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
    if (!this.ctx || !this.tracks || !this.chopBuffer) return
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
    gain.connect(this.tracks.chops.dry)
    gain.connect(send).connect(this.tracks.chops.reverb)
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

  setTrack(track: StudioTrackId, state: MixerTrack): void {
    this.trackStates[track] = { volume: clamp(state.volume, 0, 1), mute: state.mute }
    this.applyTrack(track, this.trackStates[track])
  }

  private applyTrack(track: StudioTrackId, state: MixerTrack): void {
    if (!this.ctx || !this.tracks) return
    const gain = state.mute ? 0 : clamp(state.volume, 0, 1)
    const time = this.ctx.currentTime
    this.tracks[track].dry.gain.setTargetAtTime(gain, time, 0.015)
    this.tracks[track].reverb.gain.setTargetAtTime(gain, time, 0.015)
    this.tracks[track].delay.gain.setTargetAtTime(gain, time, 0.015)
  }

  setPattern(pattern: Pattern): void {
    this.pattern = pattern
    const length = pattern.bars * STEPS_PER_BAR
    if (this.nextStep >= length) this.nextStep %= length
  }

  setBpm(bpm: number): void {
    this.bpm = clamp(bpm, 20, 300)
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
    this.nextStep = 0
    this.nextStepTime = this.ctx.currentTime + 0.05
    this.scheduledSteps.length = 0
    this.schedulerTick()
    this.schedulerTimer = setInterval(() => this.schedulerTick(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (this.schedulerTimer !== null) clearInterval(this.schedulerTimer)
    this.schedulerTimer = null
    for (const timeout of this.stepTimeouts) clearTimeout(timeout)
    this.stepTimeouts.clear()
    this.playingFlag = false
    this.scheduledSteps.length = 0
    this.stopChops()
    this.allNotesOff()
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
    if (!audible) return this.scheduledSteps[0]?.step ?? 0
    const fraction = clamp((now - audible.time) / audible.duration, 0, 0.9999)
    const length = (this.pattern?.bars ?? 1) * STEPS_PER_BAR
    return (audible.step + fraction) % length
  }

  private schedulerTick(): void {
    if (!this.ctx || !this.playingFlag) return
    if (this.nextStepTime < this.ctx.currentTime - 0.1) {
      this.nextStepTime = this.ctx.currentTime + 0.01
    }
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      const stepDuration = 60 / this.bpm / 4
      const length = (this.pattern?.bars ?? 1) * STEPS_PER_BAR
      if (this.nextStep >= length) this.nextStep %= length
      const audibleTime = this.nextStepTime + (this.nextStep % 2 === 1 ? this.swing * stepDuration : 0)
      this.scheduleStep(this.nextStep, audibleTime, stepDuration)
      this.nextStep = (this.nextStep + 1) % length
      this.nextStepTime += stepDuration
    }
  }

  private scheduleStep(step: number, when: number, stepDuration: number): void {
    const pattern = this.pattern
    if (pattern) {
      for (const id of DRUM_VOICES) {
        const velocity = pattern.drums[id][step] ?? 0
        if (velocity > 0) this.triggerDrum(id, velocity, when)
      }
      for (let pad = 0; pad < pattern.chops.length; pad++) {
        const velocity = pattern.chops[pad]?.[step] ?? 0
        if (velocity > 0) this.triggerChop(pad, velocity, when)
      }
      for (const note of pattern.notes) {
        if (note.step === step) {
          this.playNote(note.note, note.velocity, when, Math.max(1, note.length) * stepDuration * 0.98)
        }
      }
    }
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
