import { contextBridge, ipcRenderer, webUtils } from 'electron'

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

const api = {
  openAudioDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:open-audio'),
  readFile: (filePath: string): Promise<ArrayBuffer> => ipcRenderer.invoke('file:read', filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  stemModels: (): Promise<Record<string, { label: string; stems: number }>> =>
    ipcRenderer.invoke('stems:models'),
  checkStemEngine: (): Promise<{ available: boolean; bin: string | null }> =>
    ipcRenderer.invoke('stems:check'),
  getCachedStems: (trackPath: string, model: string): Promise<StemPaths | null> =>
    ipcRenderer.invoke('stems:cached', trackPath, model),
  separateStems: (trackPath: string, model: string): Promise<StemPaths> =>
    ipcRenderer.invoke('stems:separate', trackPath, model),
  onStemProgress: (callback: (event: StemProgressEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: StemProgressEvent): void =>
      callback(payload)
    ipcRenderer.on('stems:progress', listener)
    return () => ipcRenderer.removeListener('stems:progress', listener)
  },
  saveRecording: (data: ArrayBuffer): Promise<string | null> =>
    ipcRenderer.invoke('recording:save', data),
  listRecordings: (): Promise<{ path: string; name: string; size: number; mtime: number }[]> =>
    ipcRenderer.invoke('recordings:list'),
  openRecordingsFolder: (): Promise<void> => ipcRenderer.invoke('recordings:open-folder'),
  revealPath: (filePath: string): Promise<void> => ipcRenderer.invoke('path:reveal', filePath),
  loadLibrary: (): Promise<unknown> => ipcRenderer.invoke('library:load'),
  saveLibrary: (data: unknown): Promise<void> => ipcRenderer.invoke('library:save', data),
  checkYoutube: (): Promise<{ ytdlp: string | null; ffmpeg: string | null }> =>
    ipcRenderer.invoke('youtube:check'),
  downloadYoutube: (url: string): Promise<string[]> => ipcRenderer.invoke('youtube:download', url),
  onYoutubeProgress: (callback: (event: { url: string; line: string }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { url: string; line: string }): void =>
      callback(payload)
    ipcRenderer.on('youtube:progress', listener)
    return () => ipcRenderer.removeListener('youtube:progress', listener)
  }
}

export type StemDeckApi = typeof api

contextBridge.exposeInMainWorld('stemdeck', api)
