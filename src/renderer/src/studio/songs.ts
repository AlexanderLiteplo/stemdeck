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
    .map(({ id, name, savedAt }) => ({ id, name, savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function putSong(id: string, name: string, data: SongData): boolean {
  library[id] = { id, name, savedAt: Date.now(), data }
  return write()
}

/** A saved song ready to load, or null when it is missing or unreadable. */
export function getSong(id: string): { name: string; data: SongData } | null {
  const saved = library[id]
  const data = saved ? sanitizeSong(saved.data) : null
  return saved && data ? { name: saved.name, data } : null
}

export function dropSong(id: string): void {
  delete library[id]
  write()
}
