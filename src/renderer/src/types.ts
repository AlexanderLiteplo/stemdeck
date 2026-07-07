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
}

declare global {
  interface Window {
    stemdeck: StemDeckApi
  }
}
