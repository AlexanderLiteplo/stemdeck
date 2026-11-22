/** Drum kit defaults and normalization for kits saved by older versions. */
import { DRUM_MODELS, DRUM_VOICES, type DrumKit, type DrumModel, type DrumVoice, type DrumVoiceId } from './types'

export const DEFAULT_DRUM_VOICE: Omit<DrumVoice, 'model'> = {
  sample: null,
  tune: 0,
  decay: 1,
  tone: 0.5,
  drive: 0,
  level: 0.8,
  pan: 0,
  reverb: 0.05
}

export const DEFAULT_BUS = { punch: 0.4, crunch: 0.15, room: 0.12 }

export const defaultModel = (id: DrumVoiceId): DrumModel => DRUM_MODELS[id][0]

export function isModelOf(id: DrumVoiceId, model: unknown): model is DrumModel {
  return (DRUM_MODELS[id] as readonly unknown[]).includes(model)
}

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

function normalizeVoice(id: DrumVoiceId, value: unknown): DrumVoice {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<DrumVoice>
  const sample =
    v.sample && typeof v.sample.path === 'string' && v.sample.path
      ? {
          path: v.sample.path,
          name: typeof v.sample.name === 'string' ? v.sample.name : v.sample.path.split('/').pop() ?? 'sample',
          ...(v.sample.synth
            ? {
                synth: {
                  tune: num(v.sample.synth.tune, 0, -24, 24),
                  decay: num(v.sample.synth.decay, 1, 0.1, 4),
                  tone: num(v.sample.synth.tone, 0.5, 0, 1),
                  drive: num(v.sample.synth.drive, 0, 0, 1)
                }
              }
            : {})
        }
      : null
  return {
    model: isModelOf(id, v.model) ? v.model : defaultModel(id),
    sample,
    tune: num(v.tune, DEFAULT_DRUM_VOICE.tune, -24, 24),
    decay: num(v.decay, DEFAULT_DRUM_VOICE.decay, 0.1, 4),
    tone: num(v.tone, DEFAULT_DRUM_VOICE.tone, 0, 1),
    drive: num(v.drive, DEFAULT_DRUM_VOICE.drive, 0, 1),
    level: num(v.level, DEFAULT_DRUM_VOICE.level, 0, 1),
    pan: num(v.pan, DEFAULT_DRUM_VOICE.pan, -1, 1),
    reverb: num(v.reverb, DEFAULT_DRUM_VOICE.reverb, 0, 1)
  }
}

/**
 * Fill in anything a kit is missing. A kit saved before drum models existed
 * was voiced for the old synthesis, so when it is one of the factory kits it is
 * swapped for the new factory version of that kit wholesale.
 */
export function normalizeKit(value: unknown, factory: DrumKit[] = []): DrumKit {
  const k = (typeof value === 'object' && value !== null ? value : {}) as Partial<DrumKit>
  const voices = (k.voices ?? {}) as Partial<Record<DrumVoiceId, Partial<DrumVoice>>>
  const legacy = !Object.values(voices).some((v) => v && 'model' in v)
  const replacement = legacy ? factory.find((f) => f.name === k.name) : undefined
  if (replacement) return structuredClone(replacement)
  return {
    name: typeof k.name === 'string' ? k.name : 'Kit',
    description: typeof k.description === 'string' ? k.description : '',
    ...(typeof k.group === 'string' ? { group: k.group } : {}),
    voices: Object.fromEntries(DRUM_VOICES.map((id) => [id, normalizeVoice(id, voices[id])])) as Record<DrumVoiceId, DrumVoice>,
    punch: num(k.punch, DEFAULT_BUS.punch, 0, 1),
    crunch: num(k.crunch, DEFAULT_BUS.crunch, 0, 1),
    room: num(k.room, DEFAULT_BUS.room, 0, 1)
  }
}
