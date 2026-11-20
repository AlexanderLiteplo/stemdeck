/**
 * Shared data model for the Studio (beat-making) side of the app.
 * The audio engine (./engine) consumes these; the UI edits them via ./store.
 */

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square'

/** Character of the DRIVE stage. */
export type DistortionType = 'soft' | 'hard' | 'fold' | 'fuzz'

export type LfoShape = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'random'

/** Tempo-synced LFO lengths; `beats` is quarter notes per LFO cycle. */
export const LFO_DIVISIONS = [
  { label: '2 BAR', beats: 8 },
  { label: '1 BAR', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
  { label: '1/32', beats: 0.125 }
] as const

export interface Envelope {
  /** Seconds. */
  attack: number
  /** Seconds. */
  decay: number
  /** Level 0..1 held while the key is down. */
  sustain: number
  /** Seconds after key-up. */
  release: number
}

export interface SynthPatch {
  name: string
  /** Short description shown in the preset tooltip. */
  description: string
  /** Preset-menu section for factory sounds. */
  group?: string
  osc1: { wave: Wave; level: number }
  /** octave -2..2, semi -12..12 semitones, detune in cents -50..50 */
  osc2: { wave: Wave; level: number; octave: number; semi: number; detune: number }
  /** FM: how hard osc 2 modulates osc 1's pitch at audio rate, 0..1 (metallic → screaming). */
  fm: number
  /** Ring-mod: level of osc1 × osc2, 0..1 (clangorous, robotic). */
  ring: number
  /** Sine one octave below osc1, 0..1. */
  sub: number
  /** White noise level 0..1. */
  noise: number
  /** Stacked voices per oscillator, 1..7 (supersaw-style thickness). */
  unison: number
  /** Unison detune spread in cents, 0..50. */
  spread: number
  filter: {
    type: 'lowpass' | 'highpass' | 'bandpass'
    /** dB/octave: 12 = one stage, 24 = two cascaded stages (acid / Moog-style). */
    slope: 12 | 24
    /** Hz, 40..18000 */
    cutoff: number
    /** Biquad Q, 0.1..30 */
    resonance: number
    /** How far the filter envelope opens the cutoff, in octaves, -4..6. */
    envAmount: number
    /** 0..1: how much the cutoff follows the played note (1 = fully). */
    keyTrack: number
    /** Overdrive into the filter, 0..1 — makes resonance growl instead of whistle. */
    drive: number
    /** Osc 2 wobbling the cutoff at audio rate, 0..1 (vocal growls, screams). */
    fm: number
  }
  ampEnv: Envelope
  filterEnv: Envelope
  /** Pitch sweep at the start of every note: `amount` semitones (-48..48) falling to 0 over `decay` seconds. */
  pitchEnv: { amount: number; decay: number }
  lfo: {
    shape: LfoShape
    /** Free-running speed in Hz, 0.05..100 (ignored while `sync` is on). */
    rate: number
    /** Lock the LFO to the project tempo using `division`. */
    sync: boolean
    /** Index into LFO_DIVISIONS. */
    division: number
    /** Vibrato depth in cents 0..2400 */
    pitch: number
    /** Filter wobble depth in octaves 0..5 */
    filter: number
    /** Tremolo / gate depth 0..1 */
    amp: number
  }
  /** Portamento time in seconds 0..1 (mono mode slides between notes). */
  glide: number
  /** One note at a time (needed for sliding 808s / leads). */
  mono: boolean
  /** Distortion amount 0..1. */
  drive: number
  driveType: DistortionType
  /** Bitcrusher: `bits` 0..1 = bit-depth reduction, `rate` 0..1 = sample-rate reduction. */
  crush: { bits: number; rate: number }
  /** Phaser: `mix` 0..1, sweep `rate` in Hz 0.05..8. */
  phaser: { mix: number; rate: number }
  /** Sidechain-style ducking on every beat while the transport runs, 0..1. */
  pump: number
  /** Send to the studio reverb 0..1. */
  reverb: number
  /** Send to the tempo-synced delay 0..1. */
  delay: number
  /** Patch output level 0..1. */
  volume: number
}

export const DRUM_VOICES = ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'crash', 'bass808'] as const
export type DrumVoiceId = (typeof DRUM_VOICES)[number]

export interface DrumVoice {
  /** Semitones relative to the voice's natural pitch, -24..24. */
  tune: number
  /** Length multiplier 0.1..4 (1 = the voice's natural decay). */
  decay: number
  /** Brightness 0..1. */
  tone: number
  /** Saturation 0..1. */
  drive: number
  /** Output level 0..1. */
  level: number
  /** Send to the studio reverb 0..1. */
  reverb: number
}

export interface DrumKit {
  name: string
  description: string
  /** Preset-menu section for factory kits. */
  group?: string
  voices: Record<DrumVoiceId, DrumVoice>
}

export type ChopSource = 'mix' | 'vocals' | 'drums' | 'bass' | 'other' | 'instrumental'

export interface ChopSettings {
  trackId: string | null
  source: ChopSource
  /** The sample's own tempo (from analysis, editable). */
  bpm: number
  /** Seconds where the sample's beat grid starts (first downbeat). */
  offset: number
  /** Length of each chop in beats: 0.5, 1, 2, 4 or 8. */
  sliceBeats: number
  /** First chop starts this many beats after `offset`. */
  startBeat: number
  /** Re-pitch chops so they play at the project tempo (SP-404 style). */
  fitToTempo: boolean
  /** Extra transpose for all chops in semitones, -12..12. */
  pitch: number
  /** A new chop cuts off the one still ringing (MPC "mono" pads). */
  choke: boolean
  /** Short fades at chop edges, seconds 0..0.05 — kills clicks. */
  fade: number
  /** Send to the studio reverb 0..1. */
  reverb: number
}

/** Number of chop pads (4×4 grid). */
export const CHOP_PADS = 16
export const STEPS_PER_BAR = 16
/** Patterns always store this many steps so shrinking `bars` is non-destructive. */
export const MAX_STEPS = 64

export interface SynthNote {
  /** 0-based 16th-note step. */
  step: number
  /** MIDI note number. */
  note: number
  /** Length in steps, >= 1. */
  length: number
  /** 0..1 */
  velocity: number
}

export interface Pattern {
  bars: 1 | 2 | 4
  /** drums[voice][step] = velocity 0..1 (0 = off). Each array has MAX_STEPS entries. */
  drums: Record<DrumVoiceId, number[]>
  /** chops[pad][step] = velocity 0..1. CHOP_PADS arrays of MAX_STEPS entries. */
  chops: number[][]
  notes: SynthNote[]
}

export type StudioTrackId = 'drums' | 'chops' | 'synth'

export interface MixerTrack {
  volume: number
  mute: boolean
}

/**
 * Audio engine contract for the studio. All `when` arguments are AudioContext
 * times (seconds); omitted = now.
 */
export interface StudioEngineApi {
  readonly ready: boolean
  init(ctx: AudioContext, destination: AudioNode): void

  // Synth
  setPatch(patch: SynthPatch): void
  /** Live key down (sustains until noteOff). */
  noteOn(midi: number, velocity?: number, when?: number): void
  /** Live key up: releases every live voice playing `midi`. */
  noteOff(midi: number, when?: number): void
  /** Sequenced note with a known duration (independent of live voices). */
  playNote(midi: number, velocity: number, when: number, duration: number): void
  allNotesOff(): void

  // Drums
  setKit(kit: DrumKit): void
  triggerDrum(id: DrumVoiceId, velocity?: number, when?: number): void

  // Chops
  setChopBuffer(buffer: AudioBuffer | null): void
  setChopSettings(settings: ChopSettings): void
  /** Start/end of a pad in source seconds, or null when no buffer is loaded. */
  chopRegion(pad: number): { start: number; end: number } | null
  triggerChop(pad: number, velocity?: number, when?: number): void
  stopChops(): void

  // Mixer
  setTrack(track: StudioTrackId, state: MixerTrack): void

  // Transport
  setPattern(pattern: Pattern): void
  setBpm(bpm: number): void
  /** 0..0.6 — delays every odd 16th by this fraction of a 16th. */
  setSwing(swing: number): void
  setMetronome(enabled: boolean): void
  start(): void
  stop(): void
  readonly playing: boolean
  /** Fractional step in [0, bars*16) at the moment you hear it, for the UI playhead. -1 when stopped. */
  getStepPosition(): number
  /** Fired (from the main thread, roughly on time) whenever a step starts sounding. */
  onStep: ((step: number) => void) | null
}
