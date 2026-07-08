import { spawn, execFile } from 'child_process'
import { app } from 'electron'
import { subprocessEnv } from './env'
import { createHash } from 'crypto'
import { promises as fs, existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

export interface StemResult {
  vocals?: string
  drums?: string
  bass?: string
  other?: string
  instrumental?: string
}

export interface SeparationOptions {
  model: string
  onProgress: (line: string) => void
}

/** Models exposed in the UI. htdemucs_ft is the 4-stem DJ default;
 *  BS-Roformer is SOTA for vocal/instrumental splits. */
export const STEM_MODELS = {
  'htdemucs_ft.yaml': { label: 'Demucs v4 FT (4 stems: vocals/drums/bass/other)', stems: 4 },
  'model_bs_roformer_ep_317_sdr_12.9755.ckpt': { label: 'BS-Roformer SOTA (vocals + instrumental)', stems: 2 }
} as const

const BIN_CANDIDATES = [
  'audio-separator',
  path.join(homedir(), '.local/bin/audio-separator'),
  '/opt/homebrew/bin/audio-separator',
  '/usr/local/bin/audio-separator'
]

let resolvedBin: string | null = null

export async function findSeparatorBin(): Promise<string | null> {
  if (resolvedBin) return resolvedBin
  const override = process.env.STEMDECK_AUDIO_SEPARATOR
  const candidates = override ? [override, ...BIN_CANDIDATES] : BIN_CANDIDATES
  for (const bin of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      execFile(bin, ['--version'], { timeout: 15000, env: subprocessEnv() }, (err) =>
        resolve(!err)
      )
    })
    if (ok) {
      resolvedBin = bin
      return bin
    }
  }
  return null
}

function cacheDirFor(trackPath: string, model: string): string {
  const hash = createHash('sha1').update(`${trackPath}::${model}`).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'stems', hash)
}

/** Map output files to stem names based on audio-separator's "(Stem)" naming convention. */
async function collectStems(dir: string): Promise<StemResult> {
  const result: StemResult = {}
  const files = await fs.readdir(dir)
  for (const file of files) {
    if (!/\.(wav|flac|mp3)$/i.test(file)) continue
    const lower = file.toLowerCase()
    const full = path.join(dir, file)
    if (lower.includes('(vocals)')) result.vocals = full
    else if (lower.includes('(drums)')) result.drums = full
    else if (lower.includes('(bass)')) result.bass = full
    else if (lower.includes('(other)')) result.other = full
    else if (lower.includes('(instrumental)')) result.instrumental = full
  }
  return result
}

function hasAnyStem(r: StemResult): boolean {
  return Boolean(r.vocals || r.drums || r.bass || r.other || r.instrumental)
}

export async function getCachedStems(trackPath: string, model: string): Promise<StemResult | null> {
  const dir = cacheDirFor(trackPath, model)
  if (!existsSync(dir)) return null
  const stems = await collectStems(dir)
  return hasAnyStem(stems) ? stems : null
}

export async function separateStems(trackPath: string, opts: SeparationOptions): Promise<StemResult> {
  const bin = await findSeparatorBin()
  if (!bin) {
    throw new Error(
      'audio-separator not found. Install it with: pipx install "audio-separator[cpu]" (see README)'
    )
  }
  const cached = await getCachedStems(trackPath, opts.model)
  if (cached) return cached

  const outDir = cacheDirFor(trackPath, opts.model)
  await fs.mkdir(outDir, { recursive: true })

  const args = [
    trackPath,
    '--model_filename',
    opts.model,
    '--output_dir',
    outDir,
    '--output_format',
    'wav',
    '--log_level',
    'info'
  ]

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, args, { env: subprocessEnv() })
    let lastLines: string[] = []
    const onData = (data: Buffer) => {
      for (const raw of data.toString().split('\n')) {
        const line = raw.trim()
        if (!line) continue
        lastLines.push(line)
        if (lastLines.length > 20) lastLines = lastLines.slice(-20)
        opts.onProgress(line)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`audio-separator exited with code ${code}:\n${lastLines.join('\n')}`))
    })
  })

  const stems = await collectStems(outDir)
  if (!hasAnyStem(stems)) {
    throw new Error(`Separation finished but no stem files were found in ${outDir}`)
  }
  return stems
}
