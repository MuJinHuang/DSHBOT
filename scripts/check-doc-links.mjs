/**
 * 检查 Markdown 里的相对链接是否存在。
 *
 * 用法：node scripts/check-doc-links.mjs
 * 只查 .md / 图片 / 归档文件；外链、锚点、代码块里的内容跳过。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = process.cwd()
const files = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'site' || name === 'dist') continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else if (name.endsWith('.md')) files.push(path)
  }
}

for (const name of ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'PUBLISHING.md', 'SECURITY.md', 'INSTALL.md']) {
  if (existsSync(join(root, name))) files.push(join(root, name))
}
walk(join(root, 'docs'))
walk(join(root, 'docs-site'))

let broken = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  // 去掉 fenced code，避免把示例里的链接当真
  const clean = text.replace(/```[\s\S]*?```/g, '')
  for (const match of clean.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:') ||
      target.startsWith('#') ||
      target.startsWith('<') ||
      target.endsWith('/releases')
    ) {
      continue
    }
    const pathPart = target.split('#')[0].split('?')[0]
    if (pathPart === '') continue
    const absolute = resolve(dirname(file), pathPart)
    // docs-site 的图片在构建时从 docs/assets 复制，源目录里没有 assets/
    const fallback =
      file.includes(join('docs-site')) && pathPart.startsWith('assets/')
        ? resolve(root, 'docs', pathPart)
        : absolute
    if (!existsSync(absolute) && !existsSync(fallback)) {
      console.error(`${relative(root, file)}: 链接不存在 → ${target}`)
      broken += 1
    }
  }
}

console.log(`checked ${files.length} markdown files, ${broken} broken link(s)`)
if (broken > 0) process.exitCode = 1
