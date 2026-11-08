/** CLI 构建：打成单文件，core 一起打进来，只留 Node 内置模块外置。 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outdir = resolve(root, 'bin')
mkdirSync(outdir, { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(outdir, 'dsh-bot.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  external: ['node:*']
})

console.log('built @dshbot/cli: bin/dsh-bot.js')
