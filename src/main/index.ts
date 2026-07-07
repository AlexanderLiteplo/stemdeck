import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import { findSeparatorBin, getCachedStems, separateStems, STEM_MODELS } from './stems'
import { checkYoutube, downloadYoutubeAudio } from './youtube'

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
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const result = await dialog.showSaveDialog(win, {
      title: 'Save mix recording',
      defaultPath: path.join(app.getPath('music'), `stemdeck-mix-${stamp}.webm`),
      filters: [{ name: 'WebM audio', extensions: ['webm'] }]
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, Buffer.from(data))
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
