/**
 * The song library: every song you have made, kept in localStorage next to
 * (but separate from) the working state. The open song autosaves as you work;
 * it is written here whenever you switch away from it.
 */
import { sanitizeSong, type SongData } from './song'

export interface SongMeta {
  id: string
  name: string
  savedAt: number
  /** For the song list; missing on songs saved before these were recorded. */
  bpm?: number
  bars?: number
}

interface SavedSong extends SongMeta {
  data: SongData
}

const STORAGE_KEY = 'stemdeck.studio.songs.v1'

function read(): Record<string, SavedSong> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, SavedSong>) : {}
  } catch {
    return {}
  }
}

const library = read()

/** Returns false when the browser refused to store it (quota), so callers can warn instead of losing work silently. */
function write(): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
    return true
  } catch {
    return false
  }
}

/** Saved songs, most recently saved first. */
export function listSongs(): SongMeta[] {
  return Object.values(library)
    .map(({ id, name, savedAt, bpm, bars }) => ({ id, name, savedAt, bpm, bars }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function putSong(id: string, name: string, data: SongData): boolean {
  const end = data.clips.reduce((max, c) => Math.max(max, c.start + c.length), 0)
  library[id] = { id, name, savedAt: Date.now(), bpm: data.bpm, bars: Math.ceil(end / 16), data }
  return write()
}

export function renameSaved(id: string, name: string): void {
  const saved = library[id]
  if (!saved) return
  saved.name = name
  write()
}

/** A saved song ready to load, or null when it is missing or unreadable. */
export function getSong(id: string): { name: string; data: SongData } | null {
  const saved = library[id]
  // A deep copy: the song about to be edited must never share objects with the stored one.
  const data = saved ? sanitizeSong(structuredClone(saved.data)) : null
  return saved && data ? { name: saved.name, data } : null
}

export function dropSong(id: string): void {
  delete library[id]
  write()
}
