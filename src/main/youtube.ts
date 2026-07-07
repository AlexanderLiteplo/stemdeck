import { execFile, spawn } from 'child_process'
import { app } from 'electron'
import { promises as fs } from 'fs'
import { homedir, tmpdir } from 'os'
import path from 'path'

const YTDLP_CANDIDATES = [
  'yt-dlp',
  path.join(homedir(), '.local/bin/yt-dlp'),
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp'
]

const FFMPEG_CANDIDATES = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']

async function findBin(candidates: string[], versionArg: string): Promise<string | null> {
  for (const bin of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      execFile(bin, [versionArg], { timeout: 15000 }, (err) => resolve(!err))
    })
    if (ok) return bin
  }
  return null
}

export async function checkYoutube(): Promise<{ ytdlp: string | null; ffmpeg: string | null }> {
  const [ytdlp, ffmpeg] = await Promise.all([
    findBin(YTDLP_CANDIDATES, '--version'),
    findBin(FFMPEG_CANDIDATES, '-version')
  ])
  return { ytdlp, ffmpeg }
}

const YOUTUBE_URL = /^https?:\/\/(www\.|music\.|m\.)?(youtube\.com|youtu\.be)\//i

export async function downloadYoutubeAudio(
  url: string,
  onProgress: (line: string) => void
): Promise<string[]> {
  if (!YOUTUBE_URL.test(url.trim())) {
    throw new Error('That does not look like a YouTube URL')
  }
  const { ytdlp, ffmpeg } = await checkYoutube()
  if (!ytdlp) {
    throw new Error('yt-dlp not found. Install it with: pipx install yt-dlp')
  }

  const outDir = path.join(app.getPath('music'), 'StemDeck Downloads')
  await fs.mkdir(outDir, { recursive: true })
  const printFile = path.join(tmpdir(), `stemdeck-ytdlp-${Date.now()}.txt`)

  const args = [
    url.trim(),
    '--no-playlist',
    '--newline',
    '-o',
    path.join(outDir, '%(title)s.%(ext)s'),
    '--print-to-file',
    'after_move:filepath',
    printFile
  ]
  if (ffmpeg) {
    // Convert to mp3 when ffmpeg is available; otherwise keep the native
    // audio container (m4a/webm), which Chromium can still decode.
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0')
    args.push('--ffmpeg-location', path.dirname(ffmpeg))
  } else {
    args.push('-f', 'bestaudio')
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ytdlp, args)
    let lastLines: string[] = []
    const onData = (data: Buffer) => {
      for (const raw of data.toString().split('\n')) {
        const line = raw.trim()
        if (!line) continue
        lastLines.push(line)
        if (lastLines.length > 15) lastLines = lastLines.slice(-15)
        onProgress(line)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`yt-dlp exited with code ${code}:\n${lastLines.join('\n')}`))
    })
  })

  try {
    const raw = await fs.readFile(printFile, 'utf8')
    const paths = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (paths.length === 0) throw new Error('yt-dlp finished but reported no output file')
    return paths
  } finally {
    await fs.rm(printFile, { force: true })
  }
}
