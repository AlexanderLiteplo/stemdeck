import { execFile, spawn } from 'child_process'
import { app } from 'electron'
import { subprocessEnv } from './env'
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

const BROWSER_PROFILES = [
  {
    browser: 'chrome',
    profile: path.join(homedir(), 'Library/Application Support/Google/Chrome')
  },
  {
    browser: 'brave',
    profile: path.join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser')
  },
  {
    browser: 'edge',
    profile: path.join(homedir(), 'Library/Application Support/Microsoft Edge')
  },
  {
    browser: 'firefox',
    profile: path.join(homedir(), 'Library/Application Support/Firefox')
  }
]

async function findBin(candidates: string[], versionArg: string): Promise<string | null> {
  for (const bin of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      execFile(bin, [versionArg], { timeout: 15000, env: subprocessEnv() }, (err) =>
        resolve(!err)
      )
    })
    if (!ok) continue
    if (path.isAbsolute(bin)) return bin
    // Resolve bare names to an absolute path so callers can path.dirname() it
    // (passing a relative dir to --ffmpeg-location silently breaks yt-dlp).
    const resolved = await new Promise<string | null>((resolve) => {
      execFile('which', [bin], { timeout: 5000, env: subprocessEnv() }, (err, stdout) =>
        resolve(err ? null : stdout.trim() || null)
      )
    })
    return resolved ?? bin
  }
  return null
}

async function resolveBin(bin: string): Promise<string> {
  if (path.isAbsolute(bin)) return bin
  return new Promise<string>((resolve) => {
    execFile('which', [bin], { timeout: 5000, env: subprocessEnv() }, (err, stdout) =>
      resolve(err ? bin : stdout.trim() || bin)
    )
  })
}

function parseVersion(version: string): number[] | null {
  const value = version.trim()
  // Stable releases are YYYY.MM.DD; nightlies append a build number.
  if (!/^\d+(\.\d+)+$/.test(value)) return null
  return value.split('.').map(Number)
}

function compareVersions(left: number[] | null, right: number[] | null): number {
  if (!left) return right ? -1 : 0
  if (!right) return 1
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

async function findNewestYtdlp(): Promise<string | null> {
  const probes = await Promise.all(
    YTDLP_CANDIDATES.map(
      (bin) =>
        new Promise<{ bin: string; version: number[] | null } | null>((resolve) => {
          execFile(
            bin,
            ['--version'],
            { timeout: 15000, env: subprocessEnv() },
            async (err, stdout) => {
              if (err) {
                resolve(null)
                return
              }
              resolve({ bin: await resolveBin(bin), version: parseVersion(stdout) })
            }
          )
        })
    )
  )

  let newest: { bin: string; version: number[] | null } | null = null
  for (const probe of probes) {
    if (probe && (!newest || compareVersions(probe.version, newest.version) > 0)) {
      newest = probe
    }
  }
  return newest?.bin ?? null
}

let ytdlpPromise: Promise<string | null> | null = null

function findYtdlp(): Promise<string | null> {
  ytdlpPromise ??= findNewestYtdlp()
  return ytdlpPromise
}

let remoteComponentsPromise: Promise<boolean> | null = null

function supportsRemoteComponents(ytdlp: string): Promise<boolean> {
  remoteComponentsPromise ??= new Promise<boolean>((resolve) => {
    execFile(
      ytdlp,
      ['--help'],
      { timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: subprocessEnv() },
      (_err, stdout, stderr) =>
        resolve(`${stdout.toString()}\n${stderr.toString()}`.includes('--remote-components'))
    )
  })
  return remoteComponentsPromise
}

export function findFfmpeg(): Promise<string | null> {
  return findBin(FFMPEG_CANDIDATES, '-version')
}

export async function checkYoutube(): Promise<{ ytdlp: string | null; ffmpeg: string | null }> {
  const [ytdlp, ffmpeg] = await Promise.all([findYtdlp(), findFfmpeg()])
  return { ytdlp, ffmpeg }
}

const YOUTUBE_URL = /^https?:\/\/(www\.|music\.|m\.)?(youtube\.com|youtu\.be)\//i

async function existingBrowsers(): Promise<string[]> {
  const results = await Promise.all(
    BROWSER_PROFILES.map(async ({ browser, profile }) => {
      try {
        return (await fs.stat(profile)).isDirectory() ? browser : null
      } catch {
        return null
      }
    })
  )
  return results.filter((browser): browser is string => browser !== null)
}

async function runYtdlp(
  ytdlp: string,
  args: string[],
  onProgress: (line: string) => void
): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const proc = spawn(ytdlp, args, { env: subprocessEnv() })
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
    proc.on('error', (err) => reject(new Error(`Could not start yt-dlp: ${err.message}`)))
    proc.on('close', (code) => {
      if (code === 0) resolve(lastLines)
      else reject(new Error(`yt-dlp exited with code ${code}:\n${lastLines.join('\n')}`))
    })
  })
}

async function downloadAttempt(
  ytdlp: string,
  args: string[],
  browser: string | null,
  onProgress: (line: string) => void
): Promise<string[]> {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'stemdeck-ytdlp-'))
  const printFile = path.join(tempDir, 'output.txt')
  const attemptArgs = [...args, '--print-to-file', 'after_move:filepath', printFile]
  if (browser) attemptArgs.push('--cookies-from-browser', browser)

  try {
    const lastLines = await runYtdlp(ytdlp, attemptArgs, onProgress)
    let raw = ''
    try {
      raw = await fs.readFile(printFile, 'utf8')
    } catch {
      // A zero exit can still mean no media was produced.
    }
    const paths = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (paths.length === 0) {
      throw new Error(
        `yt-dlp exited successfully but reported no output file:\n${lastLines.join('\n')}`
      )
    }
    return paths
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

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

  const args = [
    url.trim(),
    '--no-playlist',
    '--newline',
    '-o',
    path.join(outDir, '%(title)s.%(ext)s')
  ]
  if (await supportsRemoteComponents(ytdlp)) {
    args.push('--remote-components', 'ejs:github')
  }
  if (ffmpeg && path.isAbsolute(ffmpeg)) {
    // Convert to mp3 when ffmpeg is available; otherwise keep the native
    // audio container (m4a/webm), which Chromium can still decode.
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0')
    args.push('--ffmpeg-location', path.dirname(ffmpeg))
  } else {
    args.push('-f', 'bestaudio')
  }

  const browsers = await existingBrowsers()
  let lastError: Error | null = null
  for (const browser of [...browsers, null]) {
    onProgress(
      browser
        ? `[stemdeck] trying cookies from ${browser}`
        : '[stemdeck] trying without browser cookies'
    )
    try {
      return await downloadAttempt(ytdlp, args, browser, onProgress)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw new Error(
    `YouTube download failed:\n${lastError?.message ?? 'yt-dlp produced no output'}\n\n` +
      'YouTube may require signing in to a browser so its cookies can be read. ' +
      'A JavaScript runtime (deno or node) and an up-to-date yt-dlp are also required.'
  )
}
