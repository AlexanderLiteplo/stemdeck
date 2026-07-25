import { execFile } from 'child_process'
import { app } from 'electron'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { subprocessEnv } from './env'
import { findFfmpeg } from './youtube'

export async function saveReel(data: ArrayBuffer): Promise<string | null> {
  const dir = path.join(app.getPath('music'), 'StemDeck Recordings')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const mp4File = path.join(dir, `stemdeck-reel-${stamp}.mp4`)
  const webmFile = path.join(dir, `stemdeck-reel-${stamp}.webm`)
  const tmpFile = path.join(tmpdir(), `stemdeck-reel-${process.pid}-${Date.now()}.webm`)
  const bytes = Buffer.from(data)

  const saveWebmFallback = async (): Promise<string | null> => {
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(webmFile, bytes)
      return webmFile
    } catch (error) {
      console.error('Failed to save reel WebM fallback:', error)
      return null
    }
  }

  try {
    await fs.mkdir(dir, { recursive: true })

    try {
      await fs.writeFile(tmpFile, bytes)
    } catch (error) {
      console.error('Failed to write temporary reel recording:', error)
      return saveWebmFallback()
    }

    let ffmpeg: string | null = null
    try {
      ffmpeg = await findFfmpeg()
    } catch (error) {
      console.error('Failed to locate ffmpeg for reel transcoding:', error)
    }

    if (!ffmpeg) {
      console.error('ffmpeg is unavailable; saving reel as WebM instead.')
      return saveWebmFallback()
    }

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpeg,
          [
            '-y',
            '-i',
            tmpFile,
            '-vf',
            'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '21',
            '-pix_fmt',
            'yuv420p',
            '-profile:v',
            'high',
            '-level',
            '4.0',
            '-r',
            '30',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-ar',
            '48000',
            '-movflags',
            '+faststart',
            mp4File
          ],
          { timeout: 10 * 60 * 1000, env: subprocessEnv() },
          (error) => (error ? reject(error) : resolve())
        )
      })
      return mp4File
    } catch (error) {
      console.error('Failed to transcode reel to MP4; saving WebM instead:', error)
      try {
        await fs.rm(mp4File, { force: true })
      } catch (cleanupError) {
        console.error('Failed to remove incomplete reel MP4:', cleanupError)
      }
      return saveWebmFallback()
    }
  } catch (error) {
    console.error('Failed to prepare reel recording:', error)
    return saveWebmFallback()
  } finally {
    try {
      await fs.rm(tmpFile, { force: true })
    } catch (error) {
      console.error('Failed to delete temporary reel recording:', error)
    }
  }
}
