// Every built-in sample listed in builtinSamples.ts must exist on disk, and every
// bundled WAV must be listed (an unlisted file is dead weight in the app).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('../src/renderer/public/samples/', import.meta.url).pathname
const listed = new Set([...readFileSync(new URL('../src/renderer/src/studio/builtinSamples.ts', import.meta.url), 'utf8').matchAll(/'builtin:([^'<>]+\.wav)'/gi)].map((m) => m[1]))
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))
const onDisk = new Set(walk(root).filter((f) => /\.wav$/i.test(f)).map((f) => relative(root, f)))
const missing = [...listed].filter((f) => !onDisk.has(f))
const unlisted = [...onDisk].filter((f) => !listed.has(f))
for (const pack of ['tr808', 'uzu']) {
  if (!onDisk.size || !readdirSync(join(root, pack)).includes('LICENSE')) throw new Error(`samples/${pack}/LICENSE is missing`)
}
if (missing.length || unlisted.length) {
  throw new Error(`samples: missing on disk: ${missing.join(', ') || 'none'}; not listed: ${unlisted.join(', ') || 'none'}`)
}
console.log(`samples: ${listed.size} built-in samples present, licenses in place`)
