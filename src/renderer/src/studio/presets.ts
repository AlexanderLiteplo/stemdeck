import {
  CHOP_PADS,
  DRUM_VOICES,
  MAX_STEPS,
  type ChopSettings,
  type DrumKit,
  type DrumVoice,
  type Pattern,
  type SynthPatch
} from './types'

export const SYNTH_PRESETS: SynthPatch[] = [
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
  },
  {
    name: 'Init',
    description: 'A plain, neutral sawtooth patch with a simple envelope and open filter, ready to shape into a new sound.',
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
]

const voice = (
  tune: number,
  decay: number,
  tone: number,
  drive: number,
  level: number,
  reverb: number
): DrumVoice => ({ tune, decay, tone, drive, level, reverb })

export const DRUM_KITS: DrumKit[] = [
  {
    name: 'Donda Stadium',
    description: 'Huge sparse arena drums with a deep kick, dark metal, a roomy clap, a towering crash, and a long clean 808.',
    voices: {
      kick: voice(-2, 1.35, 0.35, 0.18, 0.95, 0.18),
      snare: voice(-1, 1.2, 0.5, 0.12, 0.82, 0.36),
      clap: voice(-2, 1.45, 0.48, 0.1, 0.9, 0.52),
      hat: voice(-3, 0.9, 0.34, 0.04, 0.58, 0.12),
      openhat: voice(-4, 1.25, 0.38, 0.05, 0.62, 0.22),
      perc: voice(-2, 1.1, 0.4, 0.1, 0.62, 0.28),
      crash: voice(-3, 1.5, 0.58, 0.16, 0.82, 0.5),
      bass808: voice(-2, 1.7, 0.38, 0.35, 0.92, 0.08)
    }
  },
  {
    name: 'Off The Grid Drill',
    description: 'Tight drill drums pair a short punchy kick, crisp snare, bright hat rolls, and a heavily driven long 808.',
    voices: {
      kick: voice(1, 0.72, 0.68, 0.22, 0.95, 0.05),
      snare: voice(2, 0.78, 0.86, 0.18, 0.9, 0.09),
      clap: voice(1, 0.7, 0.82, 0.12, 0.72, 0.12),
      hat: voice(3, 0.55, 0.94, 0.08, 0.68, 0.03),
      openhat: voice(2, 0.72, 0.9, 0.1, 0.66, 0.05),
      perc: voice(4, 0.65, 0.8, 0.12, 0.7, 0.06),
      crash: voice(1, 0.85, 0.85, 0.15, 0.72, 0.14),
      bass808: voice(-1, 1.6, 0.62, 0.6, 0.98, 0.02)
    }
  },
  {
    name: 'Jail Rock',
    description: 'Rock-leaning electronic drums use driven shells, an assertive open hat, and a bright crash for live-band energy.',
    voices: {
      kick: voice(0, 0.95, 0.62, 0.35, 0.94, 0.12),
      snare: voice(-1, 1.05, 0.72, 0.35, 0.94, 0.2),
      clap: voice(-1, 0.9, 0.62, 0.2, 0.62, 0.2),
      hat: voice(0, 0.9, 0.7, 0.16, 0.68, 0.08),
      openhat: voice(0, 1.35, 0.76, 0.18, 0.82, 0.14),
      perc: voice(-2, 0.9, 0.6, 0.28, 0.66, 0.12),
      crash: voice(2, 1.35, 0.96, 0.24, 0.9, 0.28),
      bass808: voice(0, 0.95, 0.7, 0.4, 0.75, 0.06)
    }
  },
  {
    name: 'Praise Gospel',
    description: 'Warm gospel percussion blends a soft kick, layered claps, tambourine-bright hats, and a welcoming medium room.',
    voices: {
      kick: voice(-1, 0.88, 0.38, 0.08, 0.82, 0.2),
      snare: voice(0, 0.95, 0.64, 0.08, 0.68, 0.3),
      clap: voice(1, 1.18, 0.72, 0.1, 0.88, 0.38),
      hat: voice(4, 0.58, 0.92, 0.04, 0.58, 0.22),
      openhat: voice(3, 0.78, 0.88, 0.05, 0.64, 0.25),
      perc: voice(5, 0.58, 0.92, 0.05, 0.7, 0.28),
      crash: voice(1, 1.05, 0.84, 0.08, 0.72, 0.36),
      bass808: voice(0, 1.05, 0.48, 0.16, 0.72, 0.12)
    }
  },
  {
    name: 'Moon Minimal',
    description: 'Soft lo-fi minimal drums keep the kick muted, rim quiet, hats dull, and saturation nearly absent for open arrangements.',
    voices: {
      kick: voice(-4, 0.75, 0.2, 0.04, 0.7, 0.14),
      snare: voice(-3, 0.72, 0.3, 0.03, 0.54, 0.18),
      clap: voice(-3, 0.68, 0.28, 0.02, 0.46, 0.22),
      hat: voice(-5, 0.62, 0.18, 0.01, 0.4, 0.08),
      openhat: voice(-5, 0.72, 0.22, 0.01, 0.42, 0.12),
      perc: voice(-4, 0.58, 0.26, 0.02, 0.36, 0.15),
      crash: voice(-5, 0.72, 0.3, 0.03, 0.42, 0.24),
      bass808: voice(-4, 1.15, 0.28, 0.08, 0.64, 0.06)
    }
  }
]

export function emptyPattern(bars: 1 | 2 | 4 = 1): Pattern {
  const drums = Object.fromEntries(
    DRUM_VOICES.map((id) => [id, Array<number>(MAX_STEPS).fill(0)])
  ) as Pattern['drums']
  return {
    bars,
    drums,
    chops: Array.from({ length: CHOP_PADS }, () => Array<number>(MAX_STEPS).fill(0)),
    notes: []
  }
}

export function demoPattern(): Pattern {
  const pattern = emptyPattern(2)
  for (const [step, velocity] of [[0, 1], [3, 0.72], [11, 0.86], [16, 0.94], [19, 0.7], [27, 0.84]] as const) {
    pattern.drums.kick[step] = velocity
  }
  for (const step of [8, 24]) {
    pattern.drums.snare[step] = 0.92
    pattern.drums.clap[step] = 0.72
  }
  for (let step = 0; step < 32; step += 2) {
    if (step !== 6 && step !== 22) pattern.drums.hat[step] = step % 4 === 0 ? 0.72 : 0.6
  }
  for (const [step, velocity] of [[7, 0.7], [9, 0.76], [13, 0.72], [14, 0.82], [15, 0.9], [30, 0.82], [31, 1]] as const) {
    pattern.drums.hat[step] = velocity
  }
  pattern.drums.openhat[6] = 0.62
  pattern.drums.openhat[22] = 0.66
  pattern.drums.bass808[0] = 0.95
  pattern.drums.bass808[11] = 0.86
  pattern.drums.bass808[16] = 0.92
  pattern.drums.bass808[27] = 0.88
  pattern.notes = [
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
  return pattern
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

export function clonePattern(pattern: Pattern): Pattern {
  return structuredClone(pattern)
}
