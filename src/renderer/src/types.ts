export interface StemPaths {
  vocals?: string
  drums?: string
  bass?: string
  other?: string
  instrumental?: string
}

export interface StemProgressEvent {
  trackPath: string
  line: string
}

export interface StemDeckApi {
  openAudioDialog(): Promise<string[]>
  readFile(filePath: string): Promise<ArrayBuffer>
  getPathForFile(file: File): string
  stemModels(): Promise<Record<string, { label: string; stems: number }>>
  checkStemEngine(): Promise<{ available: boolean; bin: string | null }>
  getCachedStems(trackPath: string, model: string): Promise<StemPaths | null>
  separateStems(trackPath: string, model: string): Promise<StemPaths>
  onStemProgress(callback: (event: StemProgressEvent) => void): () => void
  saveRecording(data: ArrayBuffer): Promise<string | null>
  loadLibrary(): Promise<unknown>
  saveLibrary(data: unknown): Promise<void>
  checkYoutube(): Promise<{ ytdlp: string | null; ffmpeg: string | null }>
  downloadYoutube(url: string): Promise<string[]>
  onYoutubeProgress(callback: (event: { url: string; line: string }) => void): () => void
}

export interface PersistedTrack {
  path: string
  name: string
  duration: number
  bpm: number
  firstBeat: number
  bpmConfidence?: number
  /** Analysis pipeline version; older tracks are re-analyzed on startup. */
  v?: number
  /** Base64-encoded Float32Array of waveform min/max pairs. */
  peaks: string | null
  stems: StemPaths | null
}

export interface PersistedLibrary {
  version: 1
  selectedModel: string
  autoStems?: boolean
  tracks: PersistedTrack[]
}

declare global {
  interface Window {
    stemdeck: StemDeckApi
  }
}
