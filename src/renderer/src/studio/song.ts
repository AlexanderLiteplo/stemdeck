/**
 * A song is everything that makes one track of music: its instruments,
 * patterns and timeline, plus tempo, kit, sample and key. It is the unit that
 * undo snapshots, the song library and templates all pass around.
 */
import type { SongScale } from './chords'
import { normalizePatch } from './patch'
import { normalizeKit } from './kit'
import { DRUM_KITS, cloneKit, defaultChopSettings, demoProject, type Project } from './presets'
import type { ChopSettings, CycleRange, DrumKit } from './types'

export interface SongData extends Project {
  bpm: number
  swing: number
  kit: DrumKit
  chop: ChopSettings
  chopTitle: string
  /** Song key root for chord pads, 0 = C .. 11 = B. */
  songKey: number
  songScale: SongScale
  /** Stretch of the song that repeats while `cycleOn`. */
  cycle: CycleRange | null
  cycleOn: boolean
}

export const SONG_KEYS = [
  'tracks',
  'patterns',
  'clips',
  'bpm',
  'swing',
  'kit',
  'chop',
  'chopTitle',
  'songKey',
  'songScale',
  'cycle',
  'cycleOn'
] as const satisfies readonly (keyof SongData)[]

/** Just the song fields of a larger object (the store state), by reference. */
export function pickSong(source: SongData): SongData {
  return Object.fromEntries(SONG_KEYS.map((key) => [key, source[key]])) as unknown as SongData
}

/** A project is only usable when every track and clip points at a pattern of the right kind. */
function validProject(value: Partial<Project>): value is Project {
  const { tracks, patterns, clips } = value
  if (!Array.isArray(tracks) || tracks.length === 0 || !patterns || !Array.isArray(clips)) return false
  const kinds = new Map(tracks.map((t) => [t.id, t.kind]))
  return (
    tracks.every((t) => patterns[t.patternId]?.kind === t.kind) &&
    clips.every((c) => kinds.has(c.trackId) && patterns[c.patternId]?.kind === kinds.get(c.trackId))
  )
}

/**
 * Turn stored JSON back into a song. Missing settings get defaults and sounds
 * saved by older versions are normalized (newer synth modules switched off).
 * When the tracks/patterns/clips are unusable the `fallback` project is used
 * instead — or, without one, the whole thing is rejected with null.
 */
export function sanitizeSong(value: unknown, fallback?: () => Project): SongData | null {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<SongData>
  // Read the plain settings through an un-narrowed alias: the project check below narrows `saved`.
  const settings: Partial<SongData> = saved
  let project: Project
  if (validProject(saved)) {
    project = {
      tracks: saved.tracks.map((t) => ({
        ...t,
        solo: t.solo ?? false,
        ...(t.kind === 'synth' ? { patch: normalizePatch(t.patch) } : {})
      })),
      patterns: saved.patterns,
      clips: saved.clips
    }
  } else if (fallback) {
    project = fallback()
  } else {
    return null
  }
  return {
    ...project,
    bpm: settings.bpm ?? 140,
    swing: settings.swing ?? 0,
    // Kits saved before drum models existed are upgraded (factory kits are swapped for their new versions).
    kit: settings.kit ? normalizeKit(settings.kit, DRUM_KITS) : cloneKit(DRUM_KITS[0]),
    chop: { ...defaultChopSettings(), ...settings.chop },
    chopTitle: settings.chopTitle ?? '',
    songKey: settings.songKey ?? 0,
    songScale: settings.songScale ?? 'minor',
    cycle: settings.cycle ?? null,
    cycleOn: settings.cycleOn ?? false
  }
}

/** What a brand-new install opens with. */
export function starterSong(): SongData {
  return sanitizeSong({}, demoProject) as SongData
}
