/**
 * 一条命令把当前代码装进 DSH：构建 → 类型检查 → 链接进 profile → 补丁层就位。
 *
 * 幂等：重复跑不会重复写补丁，也不会重复装包。
 * 只维护 `# >>> dshbot:managed` 到 `# <<< dshbot:managed` 之间那一段，别的内容一概不碰。
 *
 * 用法：
 *   node scripts/install.mjs                 # 默认装进 desktop
 *   DSHBOT_PROFILE=dshbot-dev node scripts/install.mjs
 *   node scripts/install.mjs --skip-build    # 只做安装
 */
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = join(root, 'packages', 'plugin')
const PACKAGE_NAME = '@dshbot/plugin'
const ENTRY_ID = 'dshbot'
const MARK_START = '# >>> dshbot:managed'
const MARK_END = '# <<< dshbot:managed'
const BLOCK = `${MARK_START} — scripts/install.mjs 维护这一段，请勿手改
- insert:
    - id: ${ENTRY_ID}
      name: '${PACKAGE_NAME}'
${MARK_END}
`

const profile = process.env.DSHBOT_PROFILE ?? 'desktop'
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
const skipBuild = process.argv.includes('--skip-build')

function sh(command) {
  execSync(command, { stdio: 'inherit', cwd: root })
}

function findDshCli() {
  if (process.env.DSHBOT_DSH_CLI) return process.env.DSHBOT_DSH_CLI
  const bundled = 'D:\\应用\\其他应用\\DeepSeek_Harness\\resources\\runtime\\cli\\bin\\dsh.cmd'
  if (existsSync(bundled)) return bundled
  return 'dsh'
}

function step(label) {
  console.log(`\n▸ ${label}`)
}

// ---- 1. 构建 ----
if (!skipBuild) {
  step('构建')
  sh('pnpm build')
  step('类型检查')
  sh('pnpm typecheck')
}

// ---- 2. profile 存在性 ----
if (!existsSync(profileDir)) {
  console.error(`✗ 找不到 profile: ${profileDir}`)
  console.error('  先创建它，或用 DSHBOT_PROFILE 指定别的 profile')
  process.exit(1)
}

// ---- 3. 链接进 profile ----
step(`链接到 profile: ${profile}`)
const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}

if (manifest.dependencies[PACKAGE_NAME]) {
  console.log(`  ${PACKAGE_NAME} 已在依赖里，跳过`)
} else {
  const dsh = findDshCli()
  const spec = packageDir.replaceAll('\\', '/')
  sh(`"${dsh}" plugin --profile ${profile} add "file:${spec}"`)
}

// ---- 4. 补丁层 ----
step('补丁层')
const patchPath = join(profileDir, 'cordis.patch.yml')
const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''

if (original.includes(MARK_START)) {
  console.log('  已存在 dshbot 托管段，跳过')
} else {
  if (original.length > 0) {
    const backup = `${patchPath}.bak-${Date.now()}`
    copyFileSync(patchPath, backup)
    console.log(`  已备份原补丁层 → ${backup}`)
  }
  const head = original.replace(/\s*$/, '')
  const next = (head.length > 0 ? `${head}\n\n` : '') + BLOCK
  writeFileSync(patchPath, next, 'utf8')
  console.log('  已写入托管段')
}

// ---- 5. 结果 ----
console.log('\n✓ 安装完成')
console.log(`  profile : ${profile}`)
console.log(`  包      : ${PACKAGE_NAME} → ${packageDir}`)
console.log(`  补丁    : ${patchPath}`)
console.log('\n  重启 DSH 后生效（Loader 条目只在启动时组合）。')
