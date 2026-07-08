import { homedir } from 'os'
import path from 'path'

/**
 * Dock-launched apps inherit launchd's minimal PATH (/usr/bin:/bin:...),
 * so tools like ffmpeg and audio-separator — and the tools THEY shell out
 * to — aren't findable. Every subprocess gets this augmented environment.
 */
const EXTRA_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(homedir(), '.local/bin')
]

export function subprocessEnv(): NodeJS.ProcessEnv {
  const parts = (process.env.PATH ?? '').split(':').filter(Boolean)
  for (const extra of EXTRA_PATHS) {
    if (!parts.includes(extra)) parts.push(extra)
  }
  return { ...process.env, PATH: parts.join(':') }
}
