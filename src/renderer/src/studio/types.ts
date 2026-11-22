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

/**
 * Each drum slot can be synthesized in a few classic styles. The first one
 * listed is the default for kits saved before models existed.
 */
export const DRUM_MODELS = {
  kick: ['808', '909', 'boom', 'rumble'],
  snare: ['808', '909', 'crack', 'fat'],
  clap: ['808', 'big'],
  hat: ['808', '909', 'shaker'],
  openhat: ['808', '909'],
  perc: ['rim', 'cowbell', 'conga', 'tom'],
  crash: ['crash', 'ride'],
  bass808: ['clean', 'dirty']
} as const satisfies Record<DrumVoiceId, readonly string[]>

export type DrumModel = (typeof DRUM_MODELS)[DrumVoiceId][number]

/** A sound file played instead of the synthesized drum. */
export interface DrumSample {
  /** Absolute path on disk (read through the preload's readFile). */
  path: string
  /** File name, for display. */
  name: string
  /** The pad's built-in sound settings from before the sample, restored when it is removed. */
  synth?: Pick<DrumVoice, 'tune' | 'decay' | 'tone' | 'drive'>
}

export interface DrumVoice {
  /** Synthesis style; must be one of DRUM_MODELS[voice]. Ignored while a sample is loaded. */
  model: DrumModel
  /** User sample that replaces the synthesized sound, or null. */
  sample: DrumSample | null
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
  /** Stereo position -1 (left) .. 1 (right). */
  pan: number
  /** Send to the studio reverb 0..1. */
  reverb: number
}

export interface DrumKit {
  name: string
  description: string
  /** Preset-menu section for factory kits. */
  group?: string
  voices: Record<DrumVoiceId, DrumVoice>
  /** Drum-bus compression 0..1: glues the kit together and makes hits jump out. */
  punch: number
  /** Drum-bus saturation 0..1: tape/console grit on the whole kit. */
  crunch: number
  /** Short room ambience 0..1 on the whole kit (separate from the big reverb). */
  room: number
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

interface PatternBase {
  id: string
  /** Short label shown on clips and in the pattern picker ("A", "B"…). */
  name: string
  /** The track this pattern was made on; the picker lists a track's own patterns. */
  trackId: string
  bars: 1 | 2 | 4
}

export interface DrumPattern extends PatternBase {
  kind: 'drums'
  /** drums[voice][step] = velocity 0..1 (0 = off). Each array has MAX_STEPS entries. */
  drums: Record<DrumVoiceId, number[]>
  /**
   * rolls[voice][step] = how many evenly spaced hits that step plays (2..4,
   * the trap hi-hat roll). Missing, 0 or 1 = a single hit.
   */
  rolls?: Partial<Record<DrumVoiceId, number[]>>
}

export interface ChopPattern extends PatternBase {
  kind: 'chops'
  /** chops[pad][step] = velocity 0..1. CHOP_PADS arrays of MAX_STEPS entries. */
  chops: number[][]
}

export interface NotePattern extends PatternBase {
  kind: 'synth'
  notes: SynthNote[]
}

/** A loop for one track: up to 4 bars of drum hits, chop hits, or synth notes. */
export type Pattern = DrumPattern | ChopPattern | NotePattern

export type TrackKind = Pattern['kind']

/** Id of the single drum track and the single chop track; synth tracks get generated ids. */
export const DRUM_TRACK = 'drums'
export const CHOP_TRACK = 'chops'

/**
 * A region on the song timeline: it plays `patternId` on `trackId`, looping the
 * pattern for as long as the clip lasts. All positions are 16th-note steps.
 * Clips that share a pattern are linked — editing the pattern changes them all.
 */
export interface Clip {
  id: string
  trackId: string
  patternId: string
  /** Where the clip begins on the timeline. */
  start: number
  length: number
  /** How far into the pattern the clip begins (set by splitting or trimming the left edge). */
  offset: number
}

export interface MixerTrack {
  volume: number
  mute: boolean
}

/** LOOP repeats each track's open pattern; SONG plays the clips on the timeline. */
export type PlayMode = 'loop' | 'song'

/** A stretch of the song that repeats while cycling, in steps (`end` exclusive). */
export interface CycleRange {
  start: number
  end: number
}

export interface EngineTrack {
  id: string
  kind: TrackKind
  /** Pattern this track loops in LOOP mode. */
  patternId: string
}

/** A lane on the timeline: one instrument, its mix settings and the pattern open in its editor. */
export interface StudioTrack extends EngineTrack {
  name: string
  volume: number
  mute: boolean
  /** While any track is soloed, only soloed tracks sound. */
  solo: boolean
  /** Synth tracks only: this track's sound. */
  patch?: SynthPatch
}

/** Everything the sequencer needs to play; handed over again after every edit. */
export interface EngineProject {
  tracks: EngineTrack[]
  patterns: Record<string, Pattern>
  clips: Clip[]
}

/** Loop mode wraps here: every pattern length (1, 2 or 4 bars) divides it. */
export const LOOP_STEPS = MAX_STEPS

/**
 * Audio engine contract for the studio. All `when` arguments are AudioContext
 * times (seconds); omitted = now. Synth calls take the id of a synth track;
 * each synth track is its own instrument with its own patch.
 */
export interface StudioEngineApi {
  readonly ready: boolean
  init(ctx: AudioContext, destination: AudioNode): void

  // Synths (one instrument per synth track in the project)
  setPatch(trackId: string, patch: SynthPatch): void
  /** Live key down (sustains until noteOff). */
  noteOn(trackId: string, midi: number, velocity?: number, when?: number): void
  /** Live key up: releases every live voice playing `midi`. */
  noteOff(trackId: string, midi: number, when?: number): void
  /** Sequenced note with a known duration (independent of live voices). */
  playNote(trackId: string, midi: number, velocity: number, when: number, duration: number): void
  /** Silence one synth track, or every synth when no id is given. */
  allNotesOff(trackId?: string): void

  // Drums
  /** Re-renders only the voices whose sound settings changed. */
  setKit(kit: DrumKit): void
  /**
   * Register (or with null, forget) the decoded audio for a sample path. Kit
   * voices whose `sample.path` matches play it; until it arrives they fall
   * back to their synthesized model.
   */
  setDrumSample(path: string, buffer: AudioBuffer | null): void
  triggerDrum(id: DrumVoiceId, velocity?: number, when?: number): void

  // Chops
  setChopBuffer(buffer: AudioBuffer | null): void
  setChopSettings(settings: ChopSettings): void
  /** Start/end of a pad in source seconds, or null when no buffer is loaded. */
  chopRegion(pad: number): { start: number; end: number } | null
  triggerChop(pad: number, velocity?: number, when?: number): void
  stopChops(): void

  // Mixer
  setTrack(trackId: string, state: MixerTrack): void

  // Transport
  /** Tracks, patterns and clips to play. Synth instruments are created/removed to match the synth tracks. */
  setProject(project: EngineProject): void
  setMode(mode: PlayMode): void
  /** Song mode only: repeat this range instead of playing through. null = off. */
  setCycle(cycle: CycleRange | null): void
  /** Song mode: move the playhead to `step` (takes effect immediately, also while playing). */
  seek(step: number): void
  setBpm(bpm: number): void
  /** 0..0.6 — delays every odd 16th by this fraction of a 16th. */
  setSwing(swing: number): void
  setMetronome(enabled: boolean): void
  /** Loop mode starts from step 0; song mode starts from the last `seek` position. */
  start(): void
  stop(): void
  readonly playing: boolean
  /**
   * Fractional step at the moment you hear it, for the UI playheads. -1 when stopped.
   * Loop mode: 0..LOOP_STEPS, wrapping. Song mode: absolute song step.
   */
  getStepPosition(): number
  /** Fired (from the main thread, roughly on time) whenever a step starts sounding. */
  onStep: ((step: number) => void) | null
  /** Song mode without cycling: fired when playback runs off the end of the last clip and stops itself. */
  onSongEnd: (() => void) | null
}
