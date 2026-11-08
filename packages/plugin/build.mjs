/**
 * 插件构建脚本。
 *
 * 产出两个文件，这正是 DSH 要求的形态：
 *   lib/index.js   Host 侧 ESM 插件
 *   lib/client.js  浏览器 bundle，包在 `window.__ModuleLoader__.load({ id, factory })` 里
 *
 * 客户端不能把 React 打进来，否则页面里会有两份 React，hooks 直接炸。
 * 所以下面这张表里的模块一律 external，运行时由宿主提供。
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const outdir = resolve(root, 'lib')

/** 宿主 shell 提供的共享模块表（从 index-*.js 里读出来的，见 T2 报告第 4 节）。 */
const PLATFORM_MODULES = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@tanstack/react-virtual',
  'zod'
]

mkdirSync(outdir, { recursive: true })

// ---- Host 侧：ESM，DSH 自家的包全部外置 ----
await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(outdir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  external: ['@deepseek-ai/*', 'node:*']
})

// ---- 客户端：CJS 语义 + 自定义 loader 包装 ----
await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile: resolve(outdir, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      `  id: ${JSON.stringify(pkg.name)},`,
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;'
    ].join('\n')
  },
  footer: {
    js: ['    return module.exports;', '  }', '});'].join('\n')
  }
})

console.log(`built ${pkg.name}: lib/index.js + lib/client.js`)
