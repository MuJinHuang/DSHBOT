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

/** 读 JSON 时容忍 BOM——PowerShell 写的文件经常带。 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
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
// 用 link: 而不是 file:。file: 在 pnpm 里是拷贝（硬链接），构建后 profile 里还是旧代码；
// link: 是真软链，重建即生效。
step(`链接到 profile: ${profile}`)
const manifestPath = join(profileDir, 'package.json')
let manifest = readJson(manifestPath)
manifest.dependencies ??= {}

const currentSpec = manifest.dependencies[PACKAGE_NAME]
if (typeof currentSpec === 'string' && currentSpec.startsWith('link:')) {
  console.log(`  ${PACKAGE_NAME} 已是 link: 依赖，跳过`)
} else {
  const dsh = findDshCli()
  const spec = packageDir.replaceAll('\\', '/')
  sh(`"${dsh}" plugin --profile ${profile} add "link:${spec}"`)
  // pnpm 会重写 package.json（依赖和 bundle 层），必须重新读，不能拿旧对象覆盖
  manifest = readJson(manifestPath)
}

// ---- 4. Loader 层：优先用 bundle 声明，不再手写补丁 ----
const pluginManifest = readJson(join(packageDir, 'package.json'))
const hasBundle = pluginManifest.dsh?.bundle !== undefined
const patchPath = join(profileDir, 'cordis.patch.yml')
const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''

/**
 * 把旧版托管段从 profile 补丁层里摘掉。
 *
 * 以前没有 dsh.bundle，只能手工写 insert；现在 bundle 会自动插入同一行。
 * 两边都留会变成重复 id，Loader 会报错，所以升级时必须清理。
 */
function stripManagedBlock(text) {
  if (!text.includes(MARK_START)) return text
  const backup = `${patchPath}.bak-${Date.now()}`
  copyFileSync(patchPath, backup)
  console.log(`  已备份原补丁层 → ${backup}`)
  const next = text
    .replace(new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}[ \\t]*\\r?\\n?`), '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '')
  const hasEntry = next
    .split('\n')
    .some((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  const final = (next === '' ? '' : `${next}\n`) + (hasEntry ? '' : '[]\n')
  writeFileSync(patchPath, final, 'utf8')
  console.log('  已移除旧版托管段（改由 bundle 自动注册）')
  return final
}

if (hasBundle) {
  step('bundle 层')
  const bundles = manifest.dsh?.profile?.bundles
  const list = Array.isArray(bundles) ? bundles : []
  if (list.includes(PACKAGE_NAME)) {
    console.log(`  已在 profile layers 里: ${PACKAGE_NAME}`)
  } else {
    manifest.dsh = {
      ...(manifest.dsh ?? {}),
      profile: { ...(manifest.dsh?.profile ?? {}), bundles: [...list, PACKAGE_NAME] }
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    console.log(`  已加入 profile layers: ${PACKAGE_NAME}`)
  }

  if (original.includes(MARK_START)) {
    step('清理旧补丁')
    stripManagedBlock(original)
  }
} else if (existsSync(patchPath) || original === '') {
  step('补丁层')
  if (original.includes(MARK_START)) {
    console.log('  已存在 dshbot 托管段，跳过')
  } else if (new RegExp(`^\\s*-\\s*id:\\s*${ENTRY_ID}\\s*$`, 'm').test(original)) {
    // 已经有人手工插过同名条目。再写一段会出现重复 id，Loader 会报错。
    console.log(`  ⚠ 补丁层里已有裸的 id: ${ENTRY_ID}，未写入托管段`)
    console.log('    请手工删掉那段，或把它的 id 改成别的，再重跑本脚本')
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
}

// ---- 5. 结果 ----
console.log('\n✓ 安装完成')
console.log(`  profile : ${profile}`)
console.log(`  包      : ${PACKAGE_NAME} → ${packageDir}`)
console.log(`  补丁    : ${patchPath}`)
console.log('\n  重启 DSH 后生效（Loader 条目只在启动时组合）。')

