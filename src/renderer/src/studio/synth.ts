import { DEFAULT_PATCH } from './patch'
import { LFO_DIVISIONS, type DistortionType, type SynthPatch } from './types'

const EPSILON = 0.0001
const MAX_SYNTH_VOICES = 16
/**
 * Voice filters run their envelopes around this fixed reference frequency; the
 * patch's actual cutoff is added on top as a shared detune offset. That keeps
 * the CUTOFF knob live on notes that are already sounding without disturbing
 * their envelopes — sweeping an acid line must not flatten its squelch.
 */
const CUTOFF_REF = 10
const MIN_FILTER_HZ = 0.001

interface PitchParam {
  param: AudioParam
  ratio: number
  minimum?: number
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
  filters: BiquadFilterNode[]
  filterBase: number
  sources: AudioScheduledSourceNode[]
  oscillators: OscillatorNode[]
  nodes: AudioNode[]
  pitches: PitchParam[]
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

export class SynthInstrument {
  private patch: SynthPatch = structuredClone(DEFAULT_PATCH)
  private bpm = 120
  private voices: SynthVoice[] = []
  private monoVoice: SynthVoice | null = null
  private sequencerMonoVoice: SynthVoice | null = null
  private sequencerMonoEnd = 0
  private liveNoteStack: Array<{ midi: number; velocity: number }> = []

  private readonly input: GainNode
  private readonly tremolo: GainNode
  private readonly distortion: WaveShaperNode
  private readonly makeup: GainNode
  private readonly crusherInput: GainNode
  private crusher: AudioWorkletNode | null = null
  private readonly phaserInput: GainNode
  private readonly phaserStages: BiquadFilterNode[]
  private readonly phaserDry: GainNode
  private readonly phaserWet: GainNode
  private readonly phaserFeedback: GainNode
  private readonly phaserLfo: OscillatorNode
  private readonly phaserDepth: GainNode
  private readonly pumpGain: GainNode
  private readonly volume: GainNode
  private readonly reverbSend: GainNode
  private readonly delaySend: GainNode

  private readonly periodicLfo: OscillatorNode
  private readonly randomLfo: AudioBufferSourceNode
  private readonly periodicLfoGain: GainNode
  private readonly randomLfoGain: GainNode
  private readonly lfoOut: GainNode
  private readonly lfoPitch: GainNode
  private readonly lfoFilter: GainNode
  private readonly lfoAmp: GainNode
  /** Patch cutoff, in cents above CUTOFF_REF, feeding every voice filter's detune. */
  private readonly cutoffOffset: ConstantSourceNode

  private readonly nodes: AudioNode[] = []
  private readonly driveCurves = new Map<string, Float32Array<ArrayBuffer>>()
  private readonly filterDriveCurves = new Map<number, Float32Array<ArrayBuffer>>()
  private disposed = false

  constructor(
    private readonly ctx: AudioContext,
    bus: { dry: AudioNode; reverb: AudioNode; delay: AudioNode },
    private readonly noiseBuffer: AudioBuffer
  ) {
    this.input = ctx.createGain()
    this.tremolo = ctx.createGain()
    this.distortion = ctx.createWaveShaper()
    this.distortion.oversample = '4x'
    this.makeup = ctx.createGain()
    this.crusherInput = ctx.createGain()
    this.phaserInput = ctx.createGain()
    this.phaserDry = ctx.createGain()
    this.phaserWet = ctx.createGain()
    this.phaserWet.gain.value = 0
    this.phaserFeedback = ctx.createGain()
    this.phaserFeedback.gain.value = 0.55
    this.pumpGain = ctx.createGain()
    this.volume = ctx.createGain()
    this.reverbSend = ctx.createGain()
    this.delaySend = ctx.createGain()

    this.input
      .connect(this.tremolo)
      .connect(this.distortion)
      .connect(this.makeup)
      .connect(this.crusherInput)
      .connect(this.phaserInput)
    this.phaserInput.connect(this.phaserDry).connect(this.pumpGain)

    this.phaserStages = [350, 700, 1400, 2800].map((frequency) => {
      const stage = ctx.createBiquadFilter()
      stage.type = 'allpass'
      stage.frequency.value = frequency
      stage.Q.value = 0.7
      return stage
    })
    this.phaserInput.connect(this.phaserStages[0])
    for (let i = 0; i < this.phaserStages.length - 1; i++) {
      this.phaserStages[i].connect(this.phaserStages[i + 1])
    }
    const lastPhaser = this.phaserStages[this.phaserStages.length - 1]
    lastPhaser.connect(this.phaserWet).connect(this.pumpGain)
    lastPhaser.connect(this.phaserFeedback).connect(this.phaserStages[0])

    this.pumpGain.connect(this.volume)
    this.volume.connect(bus.dry)
    this.volume.connect(this.reverbSend).connect(bus.reverb)
    this.volume.connect(this.delaySend).connect(bus.delay)

    this.phaserLfo = ctx.createOscillator()
    this.phaserLfo.type = 'sine'
    this.phaserDepth = ctx.createGain()
    this.phaserDepth.gain.value = 2400
    this.phaserLfo.connect(this.phaserDepth)
    for (const stage of this.phaserStages) this.phaserDepth.connect(stage.detune)
    this.phaserLfo.start()

    this.periodicLfo = ctx.createOscillator()
    this.periodicLfo.type = 'sine'
    this.randomLfo = ctx.createBufferSource()
    this.randomLfo.buffer = this.makeRandomLfoBuffer()
    this.randomLfo.loop = true
    this.periodicLfoGain = ctx.createGain()
    this.randomLfoGain = ctx.createGain()
    this.randomLfoGain.gain.value = 0
    this.lfoOut = ctx.createGain()
    this.lfoPitch = ctx.createGain()
    this.lfoFilter = ctx.createGain()
    this.lfoAmp = ctx.createGain()
    this.lfoPitch.gain.value = 0
    this.lfoFilter.gain.value = 0
    this.lfoAmp.gain.value = 0
    this.periodicLfo.connect(this.periodicLfoGain).connect(this.lfoOut)
    this.randomLfo.connect(this.randomLfoGain).connect(this.lfoOut)
    this.lfoOut.connect(this.lfoPitch)
    this.lfoOut.connect(this.lfoFilter)
    this.lfoOut.connect(this.lfoAmp).connect(this.tremolo.gain)
    this.periodicLfo.start()
    this.randomLfo.start()

    this.cutoffOffset = ctx.createConstantSource()
    this.cutoffOffset.offset.value = this.cutoffCents()
    this.cutoffOffset.start()

    this.nodes.push(
      this.input,
      this.tremolo,
      this.distortion,
      this.makeup,
      this.crusherInput,
      this.phaserInput,
      this.phaserDry,
      this.phaserWet,
      this.phaserFeedback,
      ...this.phaserStages,
      this.phaserLfo,
      this.phaserDepth,
      this.pumpGain,
      this.volume,
      this.reverbSend,
      this.delaySend,
      this.periodicLfo,
      this.randomLfo,
      this.periodicLfoGain,
      this.randomLfoGain,
      this.lfoOut,
      this.lfoPitch,
      this.lfoFilter,
      this.lfoAmp,
      this.cutoffOffset
    )
    this.applyPatchGlobals()
  }

  setPatch(patch: SynthPatch): void {
    const modeChanged = patch.mono !== this.patch.mono
    if (modeChanged) this.allNotesOff()
    this.patch = structuredClone(patch)
    this.applyPatchGlobals()
    this.updateLiveFilters()
  }

  private cutoffCents(): number {
    return 1200 * Math.log2(clamp(this.patch.filter.cutoff, 40, 18000) / CUTOFF_REF)
  }

  /** Where a note's filter envelope rests, before the shared cutoff offset: key tracking only. */
  private filterBaseFor(midi: number): number {
    return CUTOFF_REF * 2 ** (((midi - 60) / 12) * clamp(this.patch.filter.keyTrack, 0, 1))
  }

  private filterHz(value: number): number {
    return clamp(value, MIN_FILTER_HZ, this.ctx.sampleRate * 0.48)
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    if (this.disposed) return
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
    if (this.disposed) return
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
    for (const voice of this.voices) {
      if (voice.live && voice.midi === midi) this.releaseVoice(voice, time, this.patch.ampEnv.release)
    }
  }

  playNote(midi: number, velocity: number, when: number, duration: number): void {
    if (this.disposed) return
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
    const now = this.ctx.currentTime
    this.liveNoteStack = []
    for (const voice of [...this.voices]) this.releaseVoice(voice, now, 0.03, true)
    this.monoVoice = null
    this.sequencerMonoVoice = null
    this.sequencerMonoEnd = 0
  }

  setBpm(bpm: number): void {
    this.bpm = clamp(bpm, 20, 300)
    this.applyLfoRate(this.ctx.currentTime)
  }

  pump(when: number, beatSeconds: number): void {
    const amount = clamp(this.patch.pump, 0, 1)
    if (amount <= 0.005 || this.disposed) return
    const time = Math.max(when, this.ctx.currentTime)
    // Duck over a few milliseconds rather than instantly: a hard step clicks on bass.
    this.pumpGain.gain.cancelScheduledValues(time)
    this.pumpGain.gain.setTargetAtTime(1 - 0.95 * amount, time, 0.004)
    this.pumpGain.gain.setTargetAtTime(1, time + 0.02, Math.max(0.001, beatSeconds * 0.22))
  }

  resetPump(): void {
    const now = this.ctx.currentTime
    holdAt(this.pumpGain.gain, now)
    this.pumpGain.gain.setTargetAtTime(1, now, 0.01)
  }

  enableCrusher(): void {
    if (this.crusher || this.disposed) return
    const crusher = new AudioWorkletNode(this.ctx, 'crush-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    this.crusherInput.disconnect(this.phaserInput)
    this.crusherInput.connect(crusher).connect(this.phaserInput)
    this.crusher = crusher
    this.nodes.push(crusher)
    this.applyCrusher(this.ctx.currentTime)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const now = this.ctx.currentTime
    for (const voice of [...this.voices]) {
      for (const source of voice.sources) {
        try {
          source.stop(now)
        } catch {
          // Already ended.
        }
      }
      this.cleanupVoice(voice)
    }
    for (const source of [this.periodicLfo, this.randomLfo, this.phaserLfo, this.cutoffOffset]) {
      try {
        source.stop(now)
      } catch {
        // Already ended.
      }
    }
    for (const node of this.nodes) node.disconnect()
    this.voices = []
    this.monoVoice = null
    this.sequencerMonoVoice = null
    this.liveNoteStack = []
  }

  private createVoice(midi: number, velocity: number, when: number, live: boolean): SynthVoice | null {
    const ctx = this.ctx
    const time = Math.max(when, ctx.currentTime)
    const active = this.voices.filter((voice) => !voice.cleaned && !voice.stolen)
    if (active.length >= MAX_SYNTH_VOICES) {
      const oldest = active.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b))
      oldest.stolen = true
      this.releaseVoice(oldest, time, 0.025, true)
    }

    const mix = ctx.createGain()
    const filters = this.createFilters()
    const filterBase = this.filterBaseFor(midi)
    const amp = ctx.createGain()
    amp.gain.value = EPSILON
    const voiceOut = ctx.createGain()
    voiceOut.gain.value = 0.3

    let filterInput: AudioNode = mix
    const voiceNodes: AudioNode[] = [mix, ...filters, amp, voiceOut]
    const filterDrive = clamp(this.patch.filter.drive, 0, 1)
    if (filterDrive > 0.01) {
      const preGain = ctx.createGain()
      preGain.gain.value = 1 + filterDrive * 8
      const shaper = ctx.createWaveShaper()
      shaper.oversample = '2x'
      shaper.curve = this.getFilterDriveCurve(filterDrive)
      mix.connect(preGain).connect(shaper)
      filterInput = shaper
      voiceNodes.push(preGain, shaper)
    }
    filterInput.connect(filters[0])
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1])
    filters[filters.length - 1].connect(amp)
    amp.connect(voiceOut).connect(this.input)

    const voice: SynthVoice = {
      midi,
      velocity,
      startedAt: time,
      live,
      releasing: false,
      stolen: false,
      cleaned: false,
      amp,
      filters,
      filterBase,
      sources: [],
      oscillators: [],
      nodes: voiceNodes,
      pitches: []
    }

    const unison = Math.round(clamp(this.patch.unison, 1, 7))
    const normalization = 1 / Math.sqrt(unison)
    const osc1Bus = ctx.createGain()
    osc1Bus.connect(mix)
    voice.nodes.push(osc1Bus)
    const osc1Oscillators: OscillatorNode[] = []
    const pitchEnvelopeOscillators: OscillatorNode[] = []
    const addOscillatorStack = (
      wave: OscillatorType,
      level: number,
      ratio: number,
      detune: number,
      destination: AudioNode,
      collectOsc1 = false
    ): void => {
      if (level <= 0) return
      for (let i = 0; i < unison; i++) {
        const position = unison === 1 ? 0 : i / (unison - 1) - 0.5
        const oscillator = ctx.createOscillator()
        oscillator.type = wave
        oscillator.detune.value = detune + position * 2 * clamp(this.patch.spread, 0, 50)
        const gain = ctx.createGain()
        gain.gain.value = level * normalization
        oscillator.connect(gain).connect(destination)
        this.lfoPitch.connect(oscillator.detune)
        voice.sources.push(oscillator)
        voice.oscillators.push(oscillator)
        pitchEnvelopeOscillators.push(oscillator)
        voice.nodes.push(oscillator, gain)
        voice.pitches.push({ param: oscillator.frequency, ratio })
        if (collectOsc1) osc1Oscillators.push(oscillator)
        oscillator.start(time)
      }
    }

    addOscillatorStack(
      this.patch.osc1.wave,
      clamp(this.patch.osc1.level, 0, 1),
      1,
      0,
      osc1Bus,
      true
    )
    const osc2Ratio =
      2 ** (clamp(this.patch.osc2.octave, -2, 2) + clamp(this.patch.osc2.semi, -12, 12) / 12)
    addOscillatorStack(
      this.patch.osc2.wave,
      clamp(this.patch.osc2.level, 0, 1),
      osc2Ratio,
      clamp(this.patch.osc2.detune, -50, 50),
      mix
    )
    if (this.patch.sub > 0) {
      const sub = ctx.createOscillator()
      sub.type = 'sine'
      const subGain = ctx.createGain()
      subGain.gain.value = clamp(this.patch.sub, 0, 1)
      sub.connect(subGain).connect(mix)
      this.lfoPitch.connect(sub.detune)
      voice.sources.push(sub)
      voice.oscillators.push(sub)
      pitchEnvelopeOscillators.push(sub)
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
      noise.connect(noiseGain).connect(mix)
      voice.sources.push(noise)
      voice.nodes.push(noise, noiseGain)
      noise.start(time)
    }

    const fm = clamp(this.patch.fm, 0, 1)
    const ring = clamp(this.patch.ring, 0, 1)
    const filterFm = clamp(this.patch.filter.fm, 0, 1)
    if (fm > 0.005 || ring > 0.005 || filterFm > 0.005) {
      const modulator = ctx.createOscillator()
      modulator.type = this.patch.osc2.wave
      modulator.detune.value = clamp(this.patch.osc2.detune, -50, 50)
      this.lfoPitch.connect(modulator.detune)
      voice.sources.push(modulator)
      voice.oscillators.push(modulator)
      pitchEnvelopeOscillators.push(modulator)
      voice.nodes.push(modulator)
      voice.pitches.push({ param: modulator.frequency, ratio: osc2Ratio })

      if (fm > 0.005 && osc1Oscillators.length > 0) {
        const fmGain = ctx.createGain()
        const index = fm * fm * 10
        modulator.connect(fmGain)
        for (const oscillator of osc1Oscillators) fmGain.connect(oscillator.frequency)
        voice.nodes.push(fmGain)
        voice.pitches.push({ param: fmGain.gain, ratio: index, minimum: 0 })
      }
      if (ring > 0.005 && osc1Oscillators.length > 0) {
        const ringVca = ctx.createGain()
        ringVca.gain.value = 0
        const ringLevel = ctx.createGain()
        ringLevel.gain.value = ring
        osc1Bus.connect(ringVca).connect(ringLevel).connect(mix)
        modulator.connect(ringVca.gain)
        voice.nodes.push(ringVca, ringLevel)
      }
      if (filterFm > 0.005) {
        const filterFmGain = ctx.createGain()
        filterFmGain.gain.value = filterFm * 4800
        modulator.connect(filterFmGain)
        for (const filter of filters) filterFmGain.connect(filter.detune)
        voice.nodes.push(filterFmGain)
      }
      modulator.start(time)
    }

    const pitchAmount = clamp(this.patch.pitchEnv.amount, -48, 48)
    if (Math.abs(pitchAmount) > 0.01 && pitchEnvelopeOscillators.length > 0) {
      const pitchEnvelope = ctx.createConstantSource()
      const decay = clamp(this.patch.pitchEnv.decay, 0.005, 2)
      pitchEnvelope.offset.setValueAtTime(pitchAmount * 100, time)
      pitchEnvelope.offset.setTargetAtTime(0, time, decay / 3)
      for (const oscillator of pitchEnvelopeOscillators) pitchEnvelope.connect(oscillator.detune)
      voice.sources.push(pitchEnvelope)
      voice.nodes.push(pitchEnvelope)
      pitchEnvelope.start(time)
    }

    if (voice.sources.length === 0) {
      for (const node of voice.nodes) node.disconnect()
      return null
    }
    for (const filter of filters) {
      this.lfoFilter.connect(filter.detune)
      this.cutoffOffset.connect(filter.detune)
    }
    this.setVoicePitch(voice, midi, time, 0, false)
    this.scheduleVoiceAttack(voice, time)
    voice.sources[0].onended = () => this.cleanupVoice(voice)
    this.voices.push(voice)
    return voice
  }

  private createFilters(): BiquadFilterNode[] {
    const count = this.patch.filter.slope === 24 ? 2 : 1
    const resonance = clamp(this.patch.filter.resonance, 0.1, 30)
    return Array.from({ length: count }, (_, index) => {
      const filter = this.ctx.createBiquadFilter()
      filter.type = this.patch.filter.type
      filter.Q.value = index === 0 ? resonance : Math.max(0.5, resonance * 0.5)
      return filter
    })
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
    const peak = this.filterHz(
      voice.filterBase * 2 ** (clamp(this.patch.filter.envAmount, -4, 6) * envVelocity)
    )
    const sustain = this.filterSustainTarget(voice)
    const filterAttackEnd = when + Math.max(0.001, filterEnv.attack)
    const filterDecayEnd = filterAttackEnd + Math.max(0.001, filterEnv.decay)
    for (const filter of voice.filters) {
      filter.frequency.setValueAtTime(voice.filterBase, when)
      filter.frequency.exponentialRampToValueAtTime(peak, filterAttackEnd)
      filter.frequency.exponentialRampToValueAtTime(sustain, filterDecayEnd)
    }
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
      const target = Math.max(pitch.minimum ?? 1, base * pitch.ratio)
      if (glide > 0) {
        holdAt(pitch.param, when)
        pitch.param.setTargetAtTime(target, when, Math.max(0.001, glide / 3))
      } else {
        pitch.param.setValueAtTime(target, when)
      }
    }
    if (updateFilter) {
      voice.filterBase = this.filterBaseFor(midi)
      const target = this.filterSustainTarget(voice)
      for (const filter of voice.filters) {
        holdAt(filter.frequency, filterWhen)
        filter.frequency.setTargetAtTime(
          target,
          filterWhen,
          glide > 0 ? Math.max(0.001, glide / 3) : 0.005
        )
      }
    }
  }

  private filterSustainTarget(voice: SynthVoice): number {
    const envVelocity = 0.7 + voice.velocity * 0.3
    return this.filterHz(
      voice.filterBase *
        2 **
          (clamp(this.patch.filter.envAmount, -4, 6) *
            clamp(this.patch.filterEnv.sustain, 0, 1) *
            envVelocity)
    )
  }

  private releaseVoice(voice: SynthVoice, when: number, release: number, force = false): void {
    if (voice.cleaned || (voice.releasing && !force)) return
    voice.releasing = true
    const time = Math.max(when, this.ctx.currentTime)
    const end = time + Math.max(0.005, release)
    holdAt(voice.amp.gain, time)
    voice.amp.gain.exponentialRampToValueAtTime(EPSILON, end)
    for (const filter of voice.filters) {
      holdAt(filter.frequency, time)
      filter.frequency.exponentialRampToValueAtTime(voice.filterBase, end)
    }
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
        this.lfoPitch.disconnect(oscillator.detune)
      } catch {
        // Already disconnected.
      }
    }
    for (const filter of voice.filters) {
      for (const shared of [this.lfoFilter, this.cutoffOffset]) {
        try {
          shared.disconnect(filter.detune)
        } catch {
          // Already disconnected.
        }
      }
    }
    for (const node of voice.nodes) node.disconnect()
    this.voices = this.voices.filter((candidate) => candidate !== voice)
    if (this.monoVoice === voice) this.monoVoice = null
    if (this.sequencerMonoVoice === voice) this.sequencerMonoVoice = null
  }

  private applyPatchGlobals(): void {
    const now = this.ctx.currentTime
    const drive = clamp(this.patch.drive, 0, 1)
    const driveType = this.patch.driveType
    this.distortion.curve = drive < 0.01 ? null : this.getDriveCurve(driveType, drive)
    const attenuation = driveType === 'soft' ? 0.7 : driveType === 'fold' ? 0.9 : 1.6
    this.makeup.gain.setTargetAtTime(1 / (1 + drive * attenuation), now, 0.02)
    this.volume.gain.setTargetAtTime(clamp(this.patch.volume, 0, 1), now, 0.02)
    this.reverbSend.gain.setTargetAtTime(clamp(this.patch.reverb, 0, 1), now, 0.04)
    this.delaySend.gain.setTargetAtTime(clamp(this.patch.delay, 0, 1), now, 0.04)

    const lfoShape = this.patch.lfo.shape
    const random = lfoShape === 'random'
    this.periodicLfoGain.gain.setTargetAtTime(random ? 0 : 1, now, 0.005)
    this.randomLfoGain.gain.setTargetAtTime(random ? 1 : 0, now, 0.005)
    if (lfoShape !== 'random') this.periodicLfo.type = lfoShape
    this.applyLfoRate(now)
    this.lfoPitch.gain.setTargetAtTime(clamp(this.patch.lfo.pitch, 0, 2400), now, 0.03)
    this.lfoFilter.gain.setTargetAtTime(clamp(this.patch.lfo.filter, 0, 5) * 1200, now, 0.03)
    const amp = clamp(this.patch.lfo.amp, 0, 1)
    this.tremolo.gain.setTargetAtTime(1 - amp / 2, now, 0.02)
    this.lfoAmp.gain.setTargetAtTime(amp / 2, now, 0.02)

    this.phaserWet.gain.setTargetAtTime(clamp(this.patch.phaser.mix, 0, 1), now, 0.03)
    this.phaserLfo.frequency.setTargetAtTime(clamp(this.patch.phaser.rate, 0.05, 8), now, 0.03)
    this.cutoffOffset.offset.setTargetAtTime(this.cutoffCents(), now, 0.015)
    this.applyCrusher(now)
    if (clamp(this.patch.pump, 0, 1) <= 0.005) this.resetPump()
  }

  private applyLfoRate(when: number): void {
    const division = LFO_DIVISIONS[
      Math.round(clamp(this.patch.lfo.division, 0, LFO_DIVISIONS.length - 1))
    ]
    const rate = this.patch.lfo.sync
      ? (this.bpm / 60) / division.beats
      : clamp(this.patch.lfo.rate, 0.05, 100)
    const safeRate = clamp(rate, 0.05, 100)
    this.periodicLfo.frequency.setTargetAtTime(safeRate, when, 0.03)
    const holdFrames = 128
    this.randomLfo.playbackRate.setTargetAtTime((safeRate * holdFrames) / this.ctx.sampleRate, when, 0.03)
  }

  private applyCrusher(when: number): void {
    if (!this.crusher) return
    const bits = 16 * (2 / 16) ** clamp(this.patch.crush.bits, 0, 1)
    const hold = 48 ** clamp(this.patch.crush.rate, 0, 1)
    this.crusher.parameters.get('bits')?.setTargetAtTime(bits, when, 0.02)
    this.crusher.parameters.get('hold')?.setTargetAtTime(hold, when, 0.02)
  }

  /** Resonance and filter type follow the knobs on notes that are already sounding. */
  private updateLiveFilters(): void {
    const now = this.ctx.currentTime
    const resonance = clamp(this.patch.filter.resonance, 0.1, 30)
    for (const voice of this.voices) {
      if (voice.cleaned) continue
      voice.filters.forEach((filter, stage) => {
        filter.type = this.patch.filter.type
        filter.Q.setTargetAtTime(stage === 0 ? resonance : Math.max(0.5, resonance * 0.5), now, 0.015)
      })
    }
  }

  private getDriveCurve(type: DistortionType, amount: number): Float32Array<ArrayBuffer> {
    const bucket = Math.round(clamp(amount, 0, 1) * 20)
    const key = `${type}:${bucket}`
    const cached = this.driveCurves.get(key)
    if (cached) return cached
    const curve = new Float32Array(4096)
    const a = bucket / 20
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      if (type === 'hard') {
        curve[i] = clamp(x * (1 + a * 24), -1, 1)
      } else if (type === 'fold') {
        curve[i] = Math.sin((x * (1 + a * 7) * Math.PI) / 2)
      } else if (type === 'fuzz') {
        const k = 1 + a * 40
        curve[i] = x >= 0 ? 1 - Math.exp(-x * k) : -0.8 * (1 - Math.exp(x * k * 0.45))
      } else {
        const drive = 1 + bucket * 0.65
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive)
      }
    }
    this.driveCurves.set(key, curve)
    return curve
  }

  private getFilterDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const bucket = Math.round(clamp(amount, 0, 1) * 20)
    const cached = this.filterDriveCurves.get(bucket)
    if (cached) return cached
    const curve = new Float32Array(4096)
    const drive = 1 + bucket * 0.65
    const normalizer = Math.tanh(drive)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * drive) / normalizer
    }
    this.filterDriveCurves.set(bucket, curve)
    return curve
  }

  private makeRandomLfoBuffer(): AudioBuffer {
    const values = 256
    const holdFrames = 128
    const buffer = this.ctx.createBuffer(1, values * holdFrames, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let value = 0; value < values; value++) {
      const sample = Math.random() * 2 - 1
      data.fill(sample, value * holdFrames, (value + 1) * holdFrames)
    }
    return buffer
  }
}
