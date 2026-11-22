import {
  CHOP_PADS,
  CHOP_TRACK,
  DRUM_TRACK,
  DRUM_VOICES,
  MAX_STEPS,
  type ChopSettings,
  type Clip,
  type DrumKit,
  type DrumModel,
  type DrumPattern,
  type DrumVoice,
  type DrumVoiceId,
  type NotePattern,
  type Pattern,
  type StudioTrack,
  type SynthPatch,
  type TrackKind
} from './types'
import { builtinLabel } from './builtinSamples'
import { normalizePatch } from './patch'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
/** A preset only spells out what differs from the neutral init patch. */
type PatchSeed = DeepPartial<SynthPatch> & Pick<SynthPatch, 'name' | 'description'>

export const DONDA_GROUP = 'Donda-inspired'
export const ROBOT_GROUP = 'Robots & warehouse'

const DONDA_SEEDS: PatchSeed[] = [
  {
    name: 'Donda Organ',
    description: 'A wide gospel pipe organ built from sine drawbars, a quiet square octave, sub weight, Leslie-like vibrato, and a large hall.',
    osc1: { wave: 'sine', level: 0.9 },
    osc2: { wave: 'square', level: 0.24, octave: 1, detune: 0 },
    sub: 0.28,
    noise: 0,
    unison: 1,
    spread: 0,
    filter: { type: 'lowpass', cutoff: 7200, resonance: 0.7, envAmount: 0.2, keyTrack: 0.25 },
    ampEnv: { attack: 0.008, decay: 0.08, sustain: 0.95, release: 0.35 },
    filterEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.35 },
    lfo: { rate: 5.5, pitch: 8, filter: 0.05 },
    glide: 0,
    mono: false,
    drive: 0.08,
    reverb: 0.55,
    delay: 0.04,
    volume: 0.76
  },
  {
    name: 'Choir Pad',
    description: 'A huge wordless choir-like pad made from five softly detuned saw layers, a veiled filter, slow attack, and an expansive reverb tail.',
    osc1: { wave: 'sawtooth', level: 0.62 },
    osc2: { wave: 'triangle', level: 0.34, octave: 1, detune: -7 },
    sub: 0.12,
    noise: 0.05,
    unison: 5,
    spread: 18,
    filter: { type: 'lowpass', cutoff: 1800, resonance: 2.2, envAmount: 1.2, keyTrack: 0.35 },
    ampEnv: { attack: 0.6, decay: 1.2, sustain: 0.82, release: 2 },
    filterEnv: { attack: 0.9, decay: 1.6, sustain: 0.55, release: 2.2 },
    lfo: { rate: 0.22, pitch: 3, filter: 0.18 },
    glide: 0,
    mono: false,
    drive: 0.12,
    reverb: 0.7,
    delay: 0.12,
    volume: 0.58
  },
  {
    name: 'Off The Grid 808',
    description: 'A sliding drill bass combining a clean sine fundamental, a trace of triangle bite, deep sub, and driven low-pass weight.',
    osc1: { wave: 'sine', level: 0.88 },
    osc2: { wave: 'triangle', level: 0.14, octave: 0, detune: 2 },
    sub: 0.52,
    noise: 0,
    unison: 1,
    spread: 0,
    filter: { type: 'lowpass', cutoff: 900, resonance: 1.1, envAmount: 0.55, keyTrack: 0.2 },
    ampEnv: { attack: 0.004, decay: 0.3, sustain: 0.8, release: 0.5 },
    filterEnv: { attack: 0.002, decay: 0.24, sustain: 0.35, release: 0.35 },
    lfo: { rate: 0.1, pitch: 0, filter: 0 },
    glide: 0.09,
    mono: true,
    drive: 0.55,
    reverb: 0.03,
    delay: 0,
    volume: 0.82
  },
  {
    name: 'Hurricane Keys',
    description: 'Soft electric keys pair a rounded triangle body with a sine octave, a bright pluck envelope, and a restrained room halo.',
    osc1: { wave: 'triangle', level: 0.78 },
    osc2: { wave: 'sine', level: 0.32, octave: 1, detune: 3 },
    sub: 0.08,
    noise: 0.015,
    unison: 1,
    spread: 0,
    filter: { type: 'lowpass', cutoff: 3200, resonance: 1.4, envAmount: 2, keyTrack: 0.55 },
    ampEnv: { attack: 0.006, decay: 0.9, sustain: 0.35, release: 0.5 },
    filterEnv: { attack: 0.004, decay: 0.65, sustain: 0.12, release: 0.42 },
    lfo: { rate: 4.2, pitch: 1.5, filter: 0 },
    glide: 0,
    mono: false,
    drive: 0.1,
    reverb: 0.3,
    delay: 0.08,
    volume: 0.72
  },
  {
    name: 'Moon Bells',
    description: 'Glassy struck bells use clean sine partials an octave apart, a short sparkling decay, and intertwined delay and reverb trails.',
    osc1: { wave: 'sine', level: 0.88 },
    osc2: { wave: 'sine', level: 0.48, octave: 2, detune: 17 },
    sub: 0,
    noise: 0.02,
    unison: 1,
    spread: 0,
    filter: { type: 'highpass', cutoff: 280, resonance: 0.8, envAmount: 0.6, keyTrack: 0.4 },
    ampEnv: { attack: 0.002, decay: 1.15, sustain: 0.06, release: 0.8 },
    filterEnv: { attack: 0.001, decay: 0.8, sustain: 0.15, release: 0.7 },
    lfo: { rate: 0.35, pitch: 1, filter: 0.08 },
    glide: 0,
    mono: false,
    drive: 0.04,
    reverb: 0.45,
    delay: 0.35,
    volume: 0.7
  },
  {
    name: 'Praise Lead',
    description: 'A gritty monophonic saw lead uses resonant filtering, expressive glide, saturation, and a compact dotted echo.',
    osc1: { wave: 'sawtooth', level: 0.74 },
    osc2: { wave: 'square', level: 0.28, octave: 0, detune: -9 },
    sub: 0.12,
    noise: 0.025,
    unison: 2,
    spread: 8,
    filter: { type: 'lowpass', cutoff: 2100, resonance: 6, envAmount: 2.4, keyTrack: 0.65 },
    ampEnv: { attack: 0.008, decay: 0.18, sustain: 0.72, release: 0.28 },
    filterEnv: { attack: 0.005, decay: 0.32, sustain: 0.3, release: 0.25 },
    lfo: { rate: 5.2, pitch: 3, filter: 0.08 },
    glide: 0.06,
    mono: true,
    drive: 0.4,
    reverb: 0.22,
    delay: 0.25,
    volume: 0.68
  },
  {
    name: 'Heaven Strings',
    description: 'A slow three-voice saw ensemble floats behind a warm low-pass filter with gentle vibrato and a long orchestral release.',
    osc1: { wave: 'sawtooth', level: 0.55 },
    osc2: { wave: 'sawtooth', level: 0.36, octave: 1, detune: -5 },
    sub: 0.1,
    noise: 0.025,
    unison: 3,
    spread: 12,
    filter: { type: 'lowpass', cutoff: 2600, resonance: 1.2, envAmount: 0.8, keyTrack: 0.28 },
    ampEnv: { attack: 0.35, decay: 0.7, sustain: 0.78, release: 1.2 },
    filterEnv: { attack: 0.45, decay: 0.9, sustain: 0.58, release: 1.25 },
    lfo: { rate: 4.7, pitch: 4, filter: 0.12 },
    glide: 0,
    mono: false,
    drive: 0.08,
    reverb: 0.52,
    delay: 0.08,
    volume: 0.6
  },
  {
    name: 'Dark Drone',
    description: 'An ominous detuned saw-and-square drone crawls through a highly resonant dark filter animated by a very slow octave sweep.',
    osc1: { wave: 'sawtooth', level: 0.58 },
    osc2: { wave: 'square', level: 0.42, octave: -1, detune: -13 },
    sub: 0.36,
    noise: 0.08,
    unison: 2,
    spread: 10,
    filter: { type: 'lowpass', cutoff: 400, resonance: 8, envAmount: 1.1, keyTrack: 0.12 },
    ampEnv: { attack: 0.8, decay: 1.5, sustain: 0.9, release: 2.5 },
    filterEnv: { attack: 1.2, decay: 2.2, sustain: 0.5, release: 2.4 },
    lfo: { rate: 0.15, pitch: 2, filter: 1.5 },
    glide: 0,
    mono: false,
    drive: 0.28,
    reverb: 0.5,
    delay: 0.15,
    volume: 0.62
  }
]

/**
 * Loud, rude, mostly monophonic: acid lines, distorted leads, rave stabs and
 * machine noise. Built on the 24 dB filter, FM / ring-mod, the DESTROY stage
 * (hard clip, wavefold, fuzz, bitcrush) and the phaser / pump effects.
 */
const ROBOT_SEEDS: PatchSeed[] = [
  {
    name: 'On Sight Screech',
    description: 'A torn-speaker acid screech: saw and square slammed into a screaming 24 dB filter, hard-clipped, then bitcrushed while a random LFO glitches the cutoff every 16th. Play low, overlap notes to slide.',
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { wave: 'square', level: 0.42, octave: 0, semi: 0, detune: 9 },
    fm: 0.22,
    noise: 0.08,
    filter: { type: 'lowpass', slope: 24, cutoff: 820, resonance: 14, envAmount: 3.4, keyTrack: 0.4, drive: 0.7, fm: 0.2 },
    ampEnv: { attack: 0.002, decay: 0.2, sustain: 0.85, release: 0.08 },
    filterEnv: { attack: 0.002, decay: 0.26, sustain: 0.3, release: 0.1 },
    lfo: { shape: 'random', sync: true, division: 6, pitch: 0, filter: 1.3, amp: 0 },
    glide: 0.05,
    mono: true,
    drive: 0.78,
    driveType: 'hard',
    crush: { bits: 0.3, rate: 0.36 },
    reverb: 0.08,
    volume: 0.6
  },
  {
    name: 'Berghain Acid',
    description: 'The 303 line at 4am: one saw through a squelching 24 dB filter with a fast envelope, pushed into fuzz. Overlap notes in the piano roll to slide; louder notes bite harder.',
    osc1: { wave: 'sawtooth', level: 0.85 },
    filter: { type: 'lowpass', slope: 24, cutoff: 300, resonance: 17, envAmount: 4.2, keyTrack: 0.3, drive: 0.45, fm: 0 },
    ampEnv: { attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.1 },
    filterEnv: { attack: 0.002, decay: 0.22, sustain: 0.05, release: 0.15 },
    glide: 0.07,
    mono: true,
    drive: 0.46,
    driveType: 'fuzz',
    delay: 0.18,
    reverb: 0.06,
    volume: 0.62
  },
  {
    name: 'Da Funk Growl',
    description: 'A fat, rubbery mono lead: stacked saws an octave apart, overdriven into a resonant filter that barks on every note, with long glides between them.',
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { wave: 'sawtooth', level: 0.5, octave: -1, semi: 0, detune: -6 },
    sub: 0.2,
    filter: { type: 'lowpass', slope: 24, cutoff: 680, resonance: 9, envAmount: 2.6, keyTrack: 0.45, drive: 0.6, fm: 0 },
    ampEnv: { attack: 0.004, decay: 0.25, sustain: 0.8, release: 0.12 },
    filterEnv: { attack: 0.004, decay: 0.36, sustain: 0.22, release: 0.2 },
    lfo: { shape: 'sine', rate: 5.5, pitch: 6 },
    glide: 0.09,
    mono: true,
    drive: 0.55,
    driveType: 'soft',
    delay: 0.1,
    volume: 0.56
  },
  {
    name: 'Robot Rock',
    description: 'A fuzzed-out square lead swirling through a slow phaser — a guitar riff played by a machine.',
    osc1: { wave: 'square', level: 0.75 },
    osc2: { wave: 'sawtooth', level: 0.45, octave: 0, semi: 0, detune: 11 },
    filter: { type: 'lowpass', slope: 24, cutoff: 2400, resonance: 4, envAmount: 1.5, keyTrack: 0.5, drive: 0.3, fm: 0 },
    ampEnv: { attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.14 },
    filterEnv: { attack: 0.003, decay: 0.3, sustain: 0.4, release: 0.2 },
    glide: 0.03,
    mono: true,
    drive: 0.62,
    driveType: 'fuzz',
    phaser: { mix: 0.85, rate: 0.25 },
    delay: 0.12,
    reverb: 0.1,
    volume: 0.6
  },
  {
    name: 'Robot Voice',
    description: 'A talking, vowel-like lead: osc 2 shakes a resonant band-pass filter at audio rate while a synced LFO opens and closes its mouth every beat.',
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { wave: 'square', level: 0.2, octave: -1, semi: 0, detune: 0 },
    filter: { type: 'bandpass', slope: 24, cutoff: 1100, resonance: 8, envAmount: 0.8, keyTrack: 0.2, drive: 0.4, fm: 0.42 },
    ampEnv: { attack: 0.006, decay: 0.2, sustain: 0.9, release: 0.14 },
    lfo: { shape: 'triangle', sync: true, division: 3, filter: 1.5 },
    glide: 0.05,
    mono: true,
    drive: 0.4,
    driveType: 'soft',
    phaser: { mix: 0.3, rate: 0.5 },
    delay: 0.14,
    volume: 0.9
  },
  {
    name: 'French Pump',
    description: 'A wide filtered supersaw that ducks on every beat like it is sidechained to the kick, with a two-bar filter sweep — hold a chord and press play.',
    osc1: { wave: 'sawtooth', level: 0.65 },
    osc2: { wave: 'sawtooth', level: 0.4, octave: 1, semi: 0, detune: -8 },
    sub: 0.15,
    unison: 5,
    spread: 22,
    filter: { type: 'lowpass', slope: 12, cutoff: 1500, resonance: 3, envAmount: 0.6, keyTrack: 0.3, drive: 0, fm: 0 },
    ampEnv: { attack: 0.01, decay: 0.4, sustain: 0.85, release: 0.35 },
    lfo: { shape: 'sine', sync: true, division: 0, filter: 1.6 },
    drive: 0.15,
    phaser: { mix: 0.35, rate: 0.15 },
    pump: 0.85,
    reverb: 0.3,
    delay: 0.08,
    volume: 0.7
  },
  {
    name: 'Hoover Stab',
    description: 'The rave hoover: seven wildly detuned saws over a square an octave down, swooping up into pitch at the start of every note. Play minor chords, short and loud.',
    osc1: { wave: 'sawtooth', level: 0.7 },
    osc2: { wave: 'square', level: 0.5, octave: -1, semi: 0, detune: 14 },
    unison: 7,
    spread: 38,
    filter: { type: 'lowpass', slope: 12, cutoff: 3800, resonance: 2, envAmount: 1, keyTrack: 0.4, drive: 0.2, fm: 0 },
    ampEnv: { attack: 0.005, decay: 0.4, sustain: 0.75, release: 0.25 },
    filterEnv: { attack: 0.01, decay: 0.5, sustain: 0.5, release: 0.3 },
    pitchEnv: { amount: -12, decay: 0.09 },
    lfo: { shape: 'triangle', rate: 6, pitch: 14 },
    drive: 0.35,
    driveType: 'hard',
    reverb: 0.3,
    delay: 0.1,
    volume: 0.52
  },
  {
    name: 'Warehouse Rumble',
    description: 'A rolling sub-bass drone for dark techno: a low saw and square folded back on themselves, with a synced LFO chugging the filter in 8ths and a heavy pump. Hold one low note.',
    osc1: { wave: 'sawtooth', level: 0.7 },
    osc2: { wave: 'square', level: 0.4, octave: -1, semi: 0, detune: -12 },
    sub: 0.6,
    noise: 0.05,
    filter: { type: 'lowpass', slope: 24, cutoff: 190, resonance: 6, envAmount: 1, keyTrack: 0.1, drive: 0.5, fm: 0 },
    ampEnv: { attack: 0.01, decay: 0.5, sustain: 0.9, release: 0.3 },
    lfo: { shape: 'sawtooth', sync: true, division: 4, filter: 1.5 },
    mono: true,
    glide: 0.04,
    drive: 0.5,
    driveType: 'fold',
    pump: 0.6,
    reverb: 0.28,
    volume: 0.68
  },
  {
    name: 'Steel Hall',
    description: 'A struck sheet of metal: FM and ring-mod between two sines a fifth apart, lightly folded, ringing out in a concrete room. Industrial percussion and bell stabs.',
    osc1: { wave: 'sine', level: 0.8 },
    osc2: { wave: 'sine', level: 0, octave: 1, semi: 7, detune: 0 },
    fm: 0.55,
    ring: 0.4,
    filter: { type: 'lowpass', slope: 12, cutoff: 9000, resonance: 1, envAmount: 0.5, keyTrack: 0.5, drive: 0, fm: 0 },
    ampEnv: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.5 },
    filterEnv: { attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.4 },
    drive: 0.3,
    driveType: 'fold',
    reverb: 0.42,
    delay: 0.2,
    volume: 0.66
  },
  {
    name: 'Rave Laser',
    description: 'Pew. A square wave dropping three octaves in a tenth of a second through a ringing filter, with echoes. Tune PITCH ENV for zaps, toms or kick thumps.',
    osc1: { wave: 'square', level: 0.8 },
    filter: { type: 'lowpass', slope: 12, cutoff: 6000, resonance: 6, envAmount: 2, keyTrack: 0.5, drive: 0.2, fm: 0 },
    ampEnv: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.1 },
    filterEnv: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.1 },
    pitchEnv: { amount: 36, decay: 0.12 },
    drive: 0.3,
    driveType: 'hard',
    delay: 0.3,
    reverb: 0.15,
    volume: 0.6
  },
  {
    name: 'Broken Robot',
    description: 'A malfunctioning machine: a random LFO throws the pitch and a band-pass filter somewhere new every 16th while the crusher chews the result into 8-bit rubble. Hold any key and let it talk.',
    osc1: { wave: 'square', level: 0.75 },
    osc2: { wave: 'sawtooth', level: 0.3, octave: 1, semi: 5, detune: 0 },
    ring: 0.35,
    filter: { type: 'bandpass', slope: 24, cutoff: 1300, resonance: 10, envAmount: 0, keyTrack: 0.2, drive: 0.5, fm: 0.15 },
    ampEnv: { attack: 0.002, decay: 0.1, sustain: 0.9, release: 0.06 },
    lfo: { shape: 'random', sync: true, division: 6, pitch: 700, filter: 2.6 },
    mono: true,
    drive: 0.45,
    driveType: 'hard',
    crush: { bits: 0.5, rate: 0.6 },
    delay: 0.16,
    volume: 0.85
  },
  {
    name: 'Strobe Gate',
    description: 'A bright detuned pad chopped into 16th-note strobes by a square LFO locked to the tempo. Hold chords; the rhythm plays itself.',
    osc1: { wave: 'sawtooth', level: 0.65 },
    osc2: { wave: 'sawtooth', level: 0.45, octave: 1, semi: 0, detune: 7 },
    unison: 3,
    spread: 16,
    filter: { type: 'lowpass', slope: 12, cutoff: 3200, resonance: 2.5, envAmount: 1, keyTrack: 0.4, drive: 0, fm: 0 },
    ampEnv: { attack: 0.01, decay: 0.6, sustain: 0.85, release: 0.4 },
    filterEnv: { attack: 0.4, decay: 1.2, sustain: 0.6, release: 0.5 },
    lfo: { shape: 'square', sync: true, division: 6, amp: 1 },
    phaser: { mix: 0.25, rate: 0.1 },
    reverb: 0.35,
    delay: 0.3,
    volume: 0.8
  }
]

export const JUNGLE_GROUP = 'Jungle'

/** The two sounds a jungle track leans on: a growling sub and a dark, slow pad. */
const JUNGLE_SEEDS: PatchSeed[] = [
  {
    name: 'Reese Sub',
    description: 'The jungle bassline: two saws detuned against each other so they growl and phase, over a clean sub, kept dark by a 24 dB filter that slowly breathes. Play long, low notes; overlap them to slide.',
    osc1: { wave: 'sawtooth', level: 0.7 },
    osc2: { wave: 'sawtooth', level: 0.65, octave: 0, semi: 0, detune: 19 },
    sub: 0.75,
    filter: { type: 'lowpass', slope: 24, cutoff: 260, resonance: 1.5, envAmount: 0.8, keyTrack: 0.2, drive: 0.35, fm: 0 },
    ampEnv: { attack: 0.005, decay: 0.3, sustain: 0.9, release: 0.12 },
    filterEnv: { attack: 0.01, decay: 0.5, sustain: 0.5, release: 0.2 },
    lfo: { shape: 'sine', rate: 0.25, filter: 0.7 },
    glide: 0.09,
    mono: true,
    drive: 0.3,
    driveType: 'soft',
    phaser: { mix: 0.2, rate: 0.12 },
    volume: 0.85
  },
  {
    name: 'Rollers Pad',
    description: 'A dark, drifting pad for intros and breakdowns: soft detuned saws with a slow fade-in, a filter sweeping over two bars, and a long hall tail.',
    osc1: { wave: 'sawtooth', level: 0.55 },
    osc2: { wave: 'triangle', level: 0.4, octave: 1, semi: 0, detune: -6 },
    noise: 0.04,
    unison: 3,
    spread: 16,
    filter: { type: 'lowpass', slope: 12, cutoff: 1100, resonance: 1.8, envAmount: 1, keyTrack: 0.3, drive: 0, fm: 0 },
    ampEnv: { attack: 0.5, decay: 1, sustain: 0.8, release: 1.6 },
    filterEnv: { attack: 0.8, decay: 1.5, sustain: 0.5, release: 1.6 },
    lfo: { shape: 'sine', sync: true, division: 0, filter: 0.6 },
    phaser: { mix: 0.25, rate: 0.08 },
    reverb: 0.6,
    delay: 0.2,
    volume: 0.5
  }
]

export const SYNTH_PRESETS: SynthPatch[] = [
  ...DONDA_SEEDS.map((seed) => normalizePatch({ ...seed, group: DONDA_GROUP })),
  ...ROBOT_SEEDS.map((seed) => normalizePatch({ ...seed, group: ROBOT_GROUP })),
  ...JUNGLE_SEEDS.map((seed) => normalizePatch({ ...seed, group: JUNGLE_GROUP })),
  normalizePatch({ group: 'Blank' })
]

export const REAL_GROUP = 'Real drums'
export const SYNTH_GROUP = 'Synthesized'

const v = (
  model: DrumModel,
  tune: number,
  decay: number,
  tone: number,
  drive: number,
  level: number,
  pan = 0,
  reverb = 0.04
): DrumVoice => ({ model, sample: null, tune, decay, tone, drive, level, pan, reverb })

const kit = (
  name: string,
  group: string,
  description: string,
  [punch, crunch, room]: [number, number, number],
  voices: Record<DrumVoiceId, DrumVoice>
): DrumKit => ({ name, group, description, voices, punch, crunch, room })

/**
 * Factory kits. Voices are rendered at full scale, so LEVEL does the
 * balancing: kick loudest, hats and cymbals well under it, panned a little
 * apart like a real kit. The first kit is what new songs start with.
 */
/** A pad that plays a bundled recording; `model` is what it falls back to while the file loads. */
const smp = (
  model: DrumModel,
  file: string,
  level: number,
  pan = 0,
  reverb = 0.04,
  tune = 0,
  drive = 0
): DrumVoice => ({
  model,
  sample: { path: `builtin:${file}`, name: builtinLabel(`builtin:${file}`) ?? file },
  tune,
  decay: 1,
  tone: 0.5,
  drive,
  level,
  pan,
  reverb
})

export const DRUM_KITS: DrumKit[] = [
  kit('Real 808', REAL_GROUP, 'Recordings of a real Roland TR-808 (Michael Fischer, 1994): the boom kick, snare, clap, hats, cowbell and cymbal hip-hop, electro and trap were built on. Pick other 808 recordings per pad under SOUND.', [0.35, 0.1, 0.08], {
    kick: smp('808', 'tr808/bd5050.wav', 0.95),
    snare: smp('808', 'tr808/sd5050.wav', 0.75),
    clap: smp('808', 'tr808/cp.wav', 0.7, 0, 0.1),
    hat: smp('808', 'tr808/ch.wav', 0.42, 0.2),
    openhat: smp('808', 'tr808/oh50.wav', 0.38, 0.25),
    perc: smp('cowbell', 'tr808/cb.wav', 0.4, -0.25),
    crash: smp('crash', 'tr808/cy5050.wav', 0.35, -0.15, 0.1),
    bass808: smp('clean', 'tr808/bd5010.wav', 0.85)
  }),
  kit('Real 808 Trap', REAL_GROUP, 'Real TR-808 recordings set up for trap: a short clicky kick, the high snappy snare, a roomy clap, crisp hats for rolls (right-click a hat step) and the longest 808 boom, driven a little.', [0.45, 0.25, 0.1], {
    kick: smp('808', 'tr808/bd1025.wav', 1),
    snare: smp('crack', 'tr808/sd1010.wav', 0.8, 0, 0.08),
    clap: smp('big', 'tr808/cp.wav', 0.8, 0, 0.18),
    hat: smp('808', 'tr808/ch.wav', 0.42, 0.2),
    openhat: smp('808', 'tr808/oh25.wav', 0.38, 0.25),
    perc: smp('rim', 'tr808/rs.wav', 0.45, -0.25),
    crash: smp('crash', 'tr808/cy5075.wav', 0.35, -0.15, 0.12),
    bass808: smp('dirty', 'tr808/bd5010.wav', 0.9, 0, 0, 0, 0.25)
  }),
  kit('uzu Analog', REAL_GROUP, 'The uzu kit: modern electronic drums run through analog gear and an LA-76-style compressor — round kick, tight snare, warm hats and ride. House, techno, electronic.', [0.4, 0.15, 0.12], {
    kick: smp('909', 'uzu/bd-14_bd_switchangel.wav', 0.95),
    snare: smp('909', 'uzu/sd-13_sd_switchangel_2.wav', 0.75),
    clap: smp('808', 'uzu/cp-10_cp_switchangel.wav', 0.7, 0, 0.1),
    hat: smp('909', 'uzu/hh-10_hh_switchangel.wav', 0.45, 0.2),
    openhat: smp('909', 'uzu/oh-12_oh_switchangel.wav', 0.4, 0.25),
    perc: smp('rim', 'uzu/rim-10_rim_switchangel.wav', 0.45, -0.25),
    crash: smp('ride', 'uzu/rd-10_rd_switchangel.wav', 0.38, -0.2, 0.08),
    bass808: smp('clean', 'uzu/bd-17_bd_switchangel.wav', 0.85)
  }),
  kit('uzu Punch', REAL_GROUP, 'Harder uzu picks: a short punchy kick, the bright snare, a snappy analog clap, tight hats and a crash, with more bus compression.', [0.6, 0.3, 0.1], {
    kick: smp('909', 'uzu/bd-16_bd_switchangel.wav', 1),
    snare: smp('crack', 'uzu/sd-11_sd_switchangel_3.wav', 0.75),
    clap: smp('808', 'uzu/cp-11_cp_mot4i.wav', 0.7, 0, 0.12),
    hat: smp('909', 'uzu/hh-13_hh_switchangel.wav', 0.45, 0.2),
    openhat: smp('909', 'uzu/oh-13_oh_switchangel.wav', 0.4, 0.25),
    perc: smp('cowbell', 'uzu/cb-10_perc_switchangel.wav', 0.45, -0.25),
    crash: smp('crash', 'uzu/cr-10_cr_switchangel.wav', 0.35, -0.15, 0.1),
    bass808: smp('dirty', 'uzu/bd-17_bd_switchangel.wav', 0.85, 0, 0, -2, 0.2)
  }),
  kit('Synth 808', SYNTH_GROUP, 'The Roland TR-808: boomy long kick, snappy tuned snare, the famous clap and cowbell, sizzling metal hats. Hip-hop, trap, electro.', [0.35, 0.1, 0.08], {
    kick: v('808', 0, 1, 0.5, 0, 0.95),
    snare: v('808', 0, 1, 0.5, 0, 0.75),
    clap: v('808', 0, 1, 0.5, 0, 0.7, 0, 0.1),
    hat: v('808', 0, 1, 0.55, 0, 0.45, 0.2),
    openhat: v('808', 0, 1, 0.5, 0, 0.4, 0.25),
    perc: v('cowbell', 0, 1, 0.5, 0, 0.45, -0.25),
    crash: v('crash', 0, 1, 0.5, 0, 0.4, -0.15, 0.1),
    bass808: v('clean', 0, 1.2, 0.5, 0.15, 0.85)
  }),
  kit('Synth 909', SYNTH_GROUP, 'The Roland TR-909: punchy clicky kick, noisy snare, bright hats and ride. House, techno, garage.', [0.5, 0.2, 0.12], {
    kick: v('909', 0, 1, 0.6, 0.1, 1),
    snare: v('909', 0, 1, 0.6, 0, 0.8),
    clap: v('808', 0, 1, 0.55, 0, 0.7, 0, 0.12),
    hat: v('909', 0, 1, 0.6, 0, 0.45, 0.2),
    openhat: v('909', 0, 1, 0.6, 0, 0.4, 0.25),
    perc: v('rim', 0, 1, 0.5, 0, 0.5, -0.25),
    crash: v('ride', 0, 1, 0.5, 0, 0.4, -0.2, 0.08),
    bass808: v('clean', 0, 1, 0.5, 0.2, 0.8)
  }),
  kit('Boom Bap', SYNTH_GROUP, 'Dusty 90s New York: a round, warm kick, a fat snare with body, dark hats, heavy bus compression and grit. Swing it 15–30 %.', [0.65, 0.5, 0.28], {
    kick: v('boom', -1, 1.1, 0.45, 0.25, 1),
    snare: v('fat', -1, 1, 0.4, 0.2, 0.85, 0, 0.08),
    clap: v('big', -2, 1, 0.4, 0.1, 0.6, 0, 0.15),
    hat: v('808', -3, 0.9, 0.3, 0.1, 0.42, 0.2),
    openhat: v('808', -3, 0.9, 0.35, 0.1, 0.35, 0.25),
    perc: v('rim', -2, 1, 0.4, 0.1, 0.5, -0.3),
    crash: v('ride', -2, 1, 0.35, 0.1, 0.35, -0.2),
    bass808: v('clean', 0, 1, 0.4, 0.2, 0.8)
  }),
  kit('Trap', SYNTH_GROUP, 'Modern trap: a short punchy kick, a cracking snare, a big clap, bright hats made for rolls (right-click a hat step), and a long distorted 808.', [0.45, 0.3, 0.1], {
    kick: v('808', 2, 0.55, 0.75, 0.2, 1),
    snare: v('crack', 2, 1, 0.7, 0.1, 0.85, 0, 0.1),
    clap: v('big', 0, 1, 0.6, 0, 0.8, 0, 0.18),
    hat: v('808', 3, 0.8, 0.85, 0, 0.42, 0.2),
    openhat: v('808', 2, 0.9, 0.8, 0, 0.38, 0.25),
    perc: v('rim', 3, 1, 0.7, 0, 0.45, -0.25),
    crash: v('crash', 0, 1, 0.7, 0, 0.4, -0.15, 0.12),
    bass808: v('dirty', 0, 1.8, 0.45, 0.25, 0.85)
  }),
  kit('Jungle Break', JUNGLE_GROUP, 'Tight, fast breakbeat drums: a short punchy kick, a cracking snare that still reads as a ghost note when played soft, crisp hats and ride, a conga for rolls.', [0.7, 0.45, 0.22], {
    kick: v('909', 3, 0.6, 0.75, 0.3, 0.95),
    snare: v('crack', 4, 0.9, 0.85, 0.3, 0.95, 0, 0.1),
    clap: v('808', 2, 0.7, 0.7, 0.2, 0.55),
    hat: v('909', 2, 0.8, 0.75, 0.1, 0.42, 0.2),
    openhat: v('909', 1, 0.8, 0.7, 0.1, 0.38, 0.25),
    perc: v('conga', 5, 0.6, 0.6, 0.2, 0.55, -0.3, 0.15),
    crash: v('ride', 0, 1.1, 0.6, 0.2, 0.4, -0.2, 0.2),
    bass808: v('clean', 5, 0.9, 0.4, 0.3, 0.8)
  }),
  kit('Warehouse 4x4', ROBOT_GROUP, 'Hard techno: a long distorted kick that rumbles into the next one, a dry clap, tight metallic hats, a deep tom and a crushed ride.', [0.6, 0.45, 0.3], {
    kick: v('rumble', -3, 1.2, 0.5, 0.6, 1),
    snare: v('909', 2, 0.6, 0.7, 0.4, 0.65),
    clap: v('big', 0, 0.9, 0.6, 0.3, 0.75, 0, 0.22),
    hat: v('909', 5, 0.5, 0.85, 0.2, 0.42, 0.15),
    openhat: v('909', 4, 0.8, 0.8, 0.25, 0.4, 0.3),
    perc: v('tom', -5, 1.2, 0.3, 0.5, 0.55, -0.3, 0.3),
    crash: v('ride', 6, 0.7, 0.9, 0.4, 0.4, -0.2, 0.2),
    bass808: v('dirty', -5, 0.7, 0.3, 0.6, 0.7)
  }),
  kit('Donda Stadium', DONDA_GROUP, 'Huge sparse arena drums: a deep long kick, a fat snare and a clap drowned in the hall, dark hats, a towering crash and a long clean 808.', [0.4, 0.2, 0.25], {
    kick: v('808', -2, 1.4, 0.35, 0.2, 1),
    snare: v('fat', -1, 1.2, 0.5, 0.1, 0.8, 0, 0.35),
    clap: v('big', -2, 1.4, 0.45, 0.1, 0.85, 0, 0.5),
    hat: v('808', -3, 0.9, 0.35, 0, 0.4, 0.2, 0.1),
    openhat: v('808', -4, 1.2, 0.4, 0, 0.38, 0.25, 0.2),
    perc: v('conga', -2, 1.1, 0.4, 0.1, 0.5, -0.3, 0.25),
    crash: v('crash', -3, 1.5, 0.55, 0.1, 0.45, -0.15, 0.45),
    bass808: v('clean', -2, 1.7, 0.4, 0.35, 0.9)
  }),
  kit('Off The Grid Drill', DONDA_GROUP, 'UK/NY drill: a short kick, a tight cracking snare, bright hats for triplet rolls and a long, heavily driven 808.', [0.5, 0.3, 0.08], {
    kick: v('808', 1, 0.6, 0.7, 0.2, 1),
    snare: v('crack', 2, 0.8, 0.8, 0.15, 0.85, 0, 0.08),
    clap: v('808', 1, 0.7, 0.8, 0.1, 0.65),
    hat: v('808', 3, 0.55, 0.9, 0.05, 0.45, 0.2),
    openhat: v('808', 2, 0.7, 0.85, 0.1, 0.4, 0.25),
    perc: v('rim', 4, 0.7, 0.8, 0.1, 0.5, -0.25),
    crash: v('crash', 1, 0.85, 0.85, 0.15, 0.4, -0.15),
    bass808: v('dirty', -1, 1.6, 0.6, 0.5, 0.9)
  }),
  kit('Jail Rock', DONDA_GROUP, 'Rock-leaning drums: a driven boom kick and fat snare, an assertive open hat and a bright crash, all pushed hard into the bus.', [0.7, 0.6, 0.3], {
    kick: v('boom', 0, 1, 0.6, 0.45, 1),
    snare: v('fat', -1, 1.05, 0.7, 0.4, 0.9, 0, 0.2),
    clap: v('big', -1, 0.9, 0.6, 0.2, 0.6),
    hat: v('909', 0, 0.9, 0.6, 0.2, 0.45, 0.2),
    openhat: v('909', 0, 1.3, 0.7, 0.2, 0.45, 0.25),
    perc: v('tom', -2, 0.9, 0.6, 0.3, 0.55, -0.3),
    crash: v('crash', 2, 1.3, 0.9, 0.3, 0.5, -0.15, 0.25),
    bass808: v('clean', 0, 1, 0.6, 0.4, 0.75)
  }),
  kit('Praise Gospel', DONDA_GROUP, 'Warm gospel percussion: a soft kick, a big clap, a tambourine-like shaker, congas and a ride, in a welcoming room.', [0.4, 0.15, 0.3], {
    kick: v('boom', -1, 0.9, 0.4, 0.1, 0.85),
    snare: v('fat', 0, 1, 0.6, 0.1, 0.75, 0, 0.3),
    clap: v('big', 1, 1.2, 0.7, 0.1, 0.85, 0, 0.38),
    hat: v('shaker', 4, 0.6, 0.85, 0, 0.4, 0.2, 0.2),
    openhat: v('808', 3, 0.8, 0.8, 0, 0.38, 0.25, 0.25),
    perc: v('conga', 5, 0.6, 0.8, 0.05, 0.55, -0.3, 0.28),
    crash: v('ride', 1, 1.05, 0.75, 0.1, 0.4, -0.2, 0.35),
    bass808: v('clean', 0, 1.05, 0.45, 0.15, 0.75)
  }),
  kit('Moon Minimal', DONDA_GROUP, 'Soft lo-fi minimal drums: a muted kick, a quiet rim, dull shaker hats and almost no saturation, for open arrangements.', [0.25, 0.1, 0.2], {
    kick: v('808', -4, 0.75, 0.2, 0.05, 0.8),
    snare: v('808', -3, 0.7, 0.3, 0, 0.55, 0, 0.18),
    clap: v('808', -3, 0.7, 0.3, 0, 0.45, 0, 0.22),
    hat: v('shaker', -5, 0.6, 0.2, 0, 0.35, 0.15, 0.08),
    openhat: v('808', -5, 0.7, 0.25, 0, 0.35, 0.2, 0.12),
    perc: v('rim', -4, 0.6, 0.3, 0, 0.4, -0.25, 0.15),
    crash: v('ride', -5, 0.7, 0.3, 0, 0.35, -0.2, 0.24),
    bass808: v('clean', -4, 1.15, 0.3, 0.08, 0.7)
  })
]

export const uid = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

/** A blank pattern of the right shape for a track of `kind`. */
export function newPattern(
  kind: TrackKind,
  trackId: string,
  name: string,
  bars: Pattern['bars'] = 1,
  id = uid('pat')
): Pattern {
  const base = { id, name, trackId, bars }
  if (kind === 'drums') {
    const drums = Object.fromEntries(
      DRUM_VOICES.map((voice) => [voice, Array<number>(MAX_STEPS).fill(0)])
    ) as DrumPattern['drums']
    return { ...base, kind, drums }
  }
  if (kind === 'chops') {
    return { ...base, kind, chops: Array.from({ length: CHOP_PADS }, () => Array<number>(MAX_STEPS).fill(0)) }
  }
  return { ...base, kind, notes: [] }
}

export interface Project {
  tracks: StudioTrack[]
  patterns: Record<string, Pattern>
  clips: Clip[]
}

/** The three starting tracks, each with one empty pattern "A" and nothing on the timeline. */
export function blankProject(): Project {
  const tracks: StudioTrack[] = [
    { id: DRUM_TRACK, kind: 'drums', name: 'DRUMS', volume: 0.9, mute: false, solo: false, patternId: 'drums-a' },
    { id: CHOP_TRACK, kind: 'chops', name: 'CHOPS', volume: 0.9, mute: false, solo: false, patternId: 'chops-a' },
    {
      id: 'synth',
      kind: 'synth',
      name: 'SYNTH',
      volume: 0.8,
      mute: false,
      solo: false,
      patternId: 'synth-a',
      patch: clonePatch(SYNTH_PRESETS[0])
    }
  ]
  const patterns: Record<string, Pattern> = {}
  for (const track of tracks) {
    patterns[track.patternId] = newPattern(track.kind, track.id, 'A', 2, track.patternId)
  }
  return { tracks, patterns, clips: [] }
}

/** First-run project: a two-bar beat and chord loop, laid out as four bars on the timeline. */
export function demoProject(): Project {
  const project = blankProject()
  const drums = project.patterns['drums-a'] as DrumPattern
  for (const [step, velocity] of [[0, 1], [3, 0.72], [11, 0.86], [16, 0.94], [19, 0.7], [27, 0.84]] as const) {
    drums.drums.kick[step] = velocity
  }
  for (const step of [8, 24]) {
    drums.drums.snare[step] = 0.92
    drums.drums.clap[step] = 0.72
  }
  for (let step = 0; step < 32; step += 2) {
    if (step !== 6 && step !== 22) drums.drums.hat[step] = step % 4 === 0 ? 0.72 : 0.6
  }
  for (const [step, velocity] of [[7, 0.7], [9, 0.76], [13, 0.72], [14, 0.82], [15, 0.9], [30, 0.82], [31, 1]] as const) {
    drums.drums.hat[step] = velocity
  }
  drums.drums.openhat[6] = 0.62
  drums.drums.openhat[22] = 0.66
  drums.drums.bass808[0] = 0.95
  drums.drums.bass808[11] = 0.86
  drums.drums.bass808[16] = 0.92
  drums.drums.bass808[27] = 0.88
  const chords = project.patterns['synth-a'] as NotePattern
  chords.notes = [
    { step: 0, note: 57, length: 8, velocity: 0.72 },
    { step: 0, note: 60, length: 8, velocity: 0.66 },
    { step: 0, note: 64, length: 8, velocity: 0.64 },
    { step: 8, note: 57, length: 8, velocity: 0.7 },
    { step: 8, note: 60, length: 8, velocity: 0.66 },
    { step: 8, note: 65, length: 8, velocity: 0.64 },
    { step: 16, note: 55, length: 8, velocity: 0.7 },
    { step: 16, note: 60, length: 8, velocity: 0.66 },
    { step: 16, note: 64, length: 8, velocity: 0.64 },
    { step: 24, note: 55, length: 8, velocity: 0.7 },
    { step: 24, note: 59, length: 8, velocity: 0.66 },
    { step: 24, note: 62, length: 8, velocity: 0.64 }
  ]
  project.clips = [
    { id: uid('clip'), trackId: DRUM_TRACK, patternId: 'drums-a', start: 0, length: 64, offset: 0 },
    { id: uid('clip'), trackId: 'synth', patternId: 'synth-a', start: 0, length: 64, offset: 0 }
  ]
  return project
}

export function defaultChopSettings(): ChopSettings {
  return {
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
}

export function clonePatch(patch: SynthPatch): SynthPatch {
  return structuredClone(patch)
}

export function cloneKit(kit: DrumKit): DrumKit {
  return structuredClone(kit)
}
