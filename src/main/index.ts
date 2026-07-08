import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import { findSeparatorBin, getCachedStems, separateStems, STEM_MODELS } from './stems'
import { subprocessEnv } from './env'
import { checkYoutube, downloadYoutubeAudio, findFfmpeg } from './youtube'
import { execFile } from 'child_process'
import { tmpdir } from 'os'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: 'StemDeck',
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL as string)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'aiff']

function registerIpc(): void {
  ipcMain.handle('dialog:open-audio', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add tracks',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const buf = await fs.readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle('stems:models', () => STEM_MODELS)

  ipcMain.handle('stems:check', async () => {
    const bin = await findSeparatorBin()
    return { available: bin !== null, bin }
  })

  ipcMain.handle('stems:cached', (_event, trackPath: string, model: string) =>
    getCachedStems(trackPath, model)
  )

  ipcMain.handle('stems:separate', (event, trackPath: string, model: string) =>
    separateStems(trackPath, {
      model,
      onProgress: (line) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('stems:progress', { trackPath, line })
        }
      }
    })
  )

  ipcMain.handle('youtube:check', () => checkYoutube())

  ipcMain.handle('youtube:download', (event, url: string) =>
    downloadYoutubeAudio(url, (line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('youtube:progress', { url, line })
      }
    })
  )

  const libraryFile = (): string => path.join(app.getPath('userData'), 'library.json')

  ipcMain.handle('library:load', async () => {
    try {
      const raw = await fs.readFile(libraryFile(), 'utf8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.tracks)) {
        data.tracks = data.tracks.filter(
          (t: { path?: string }) => typeof t.path === 'string' && existsSync(t.path)
        )
      }
      return data
    } catch {
      return null
    }
  })

  ipcMain.handle('library:save', async (_event, data: unknown) => {
    await fs.writeFile(libraryFile(), JSON.stringify(data), 'utf8')
  })

  ipcMain.handle('recording:save', async (event, data: ArrayBuffer) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    // The recorder produces webm/opus; transcode to mp3 when ffmpeg exists
    const ffmpeg = await findFfmpeg()
    const ext = ffmpeg ? 'mp3' : 'webm'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const result = await dialog.showSaveDialog(win, {
      title: 'Save mix recording',
      defaultPath: path.join(app.getPath('music'), `stemdeck-mix-${stamp}.${ext}`),
      filters: ffmpeg
        ? [
            { name: 'MP3 audio', extensions: ['mp3'] },
            { name: 'WebM audio', extensions: ['webm'] }
          ]
        : [{ name: 'WebM audio', extensions: ['webm'] }]
    })
    if (result.canceled || !result.filePath) return null

    if (ffmpeg && result.filePath.toLowerCase().endsWith('.mp3')) {
      const tmpFile = path.join(tmpdir(), `stemdeck-rec-${Date.now()}.webm`)
      await fs.writeFile(tmpFile, Buffer.from(data))
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            ffmpeg,
            ['-y', '-i', tmpFile, '-codec:a', 'libmp3lame', '-b:a', '320k', result.filePath!],
            { timeout: 10 * 60 * 1000, env: subprocessEnv() },
            (err) => (err ? reject(err) : resolve())
          )
        })
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
    } else {
      await fs.writeFile(result.filePath, Buffer.from(data))
    }
    return result.filePath
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
