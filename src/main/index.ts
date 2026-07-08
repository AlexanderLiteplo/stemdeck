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

  // Recordings live in one predictable place so the app can list them.
  const recordingsDir = (): string => path.join(app.getPath('music'), 'StemDeck Recordings')

  ipcMain.handle('recording:save', async (_event, data: ArrayBuffer) => {
    const dir = recordingsDir()
    await fs.mkdir(dir, { recursive: true })
    // The recorder produces webm/opus; transcode to mp3 when ffmpeg exists
    const ffmpeg = await findFfmpeg()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

    if (ffmpeg) {
      const outFile = path.join(dir, `stemdeck-mix-${stamp}.mp3`)
      const tmpFile = path.join(tmpdir(), `stemdeck-rec-${Date.now()}.webm`)
      await fs.writeFile(tmpFile, Buffer.from(data))
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            ffmpeg,
            ['-y', '-i', tmpFile, '-codec:a', 'libmp3lame', '-b:a', '320k', outFile],
            { timeout: 10 * 60 * 1000, env: subprocessEnv() },
            (err) => (err ? reject(err) : resolve())
          )
        })
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
      return outFile
    }

    const outFile = path.join(dir, `stemdeck-mix-${stamp}.webm`)
    await fs.writeFile(outFile, Buffer.from(data))
    return outFile
  })

  ipcMain.handle('recordings:list', async () => {
    const dir = recordingsDir()
    try {
      const names = await fs.readdir(dir)
      const items = await Promise.all(
        names
          .filter((n) => /\.(mp3|webm|wav)$/i.test(n))
          .map(async (name) => {
            const full = path.join(dir, name)
            const stat = await fs.stat(full)
            return { path: full, name, size: stat.size, mtime: stat.mtimeMs }
          })
      )
      return items.sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  })

  ipcMain.handle('recordings:open-folder', async () => {
    const dir = recordingsDir()
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  ipcMain.handle('path:reveal', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
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
