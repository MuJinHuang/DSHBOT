/**
 * 构建静态文档站：docs-site/*.md → site/*.html
 *
 * 不依赖框架：marked 只负责 Markdown → HTML，导航/样式/静态资源由本脚本生成。
 * 用法：pnpm docs:build
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { marked } from 'marked'

const root = process.cwd()
const source = join(root, 'docs-site')
const out = join(root, 'site')

/** 导航顺序。 */
const pages = [
  { file: 'index.md', label: '首页' },
  { file: 'guide/install.md', label: '安装' },
  { file: 'guide/rooms.md', label: '五分钟上手' },
  { file: 'guide/automation.md', label: '依赖 / 模型 / 预算' },
  { file: 'guide/development.md', label: '开发与测试' },
  { file: 'guide/security.md', label: '安全与限制' }
]

function titleOf(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() ?? fallback
}

function render(markdown) {
  const html = marked.parse(markdown)
  return String(html).replace(/href="([^"]+)\.md"/g, 'href="$1.html"')
}

function layout({ page, title, html, rootPath }) {
  const nav = pages
    .map((item) => {
      const href = rootPath + item.file.replace(/\.md$/, '.html')
      const active = item.file === page ? ' class="active"' : ''
      return `<a${active} href="${href}">${item.label}</a>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="DSHBot Rooms — 在 DSH 里开房间，让有岗位的 Bot 协作交付">
<title>${title} · DSHBot</title>
<link rel="stylesheet" href="${rootPath}assets/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="${rootPath}index.html">🏠 DSHBot <span>Rooms</span></a>
  <span class="spacer"></span>
  <a class="top-link" href="${rootPath}guide/install.html">安装</a>
  <a class="top-link" href="${rootPath}guide/rooms.html">上手</a>
</header>
<div class="shell">
  <aside class="sidebar">
    <div class="nav-title">文档</div>
    ${nav}
  </aside>
  <main class="content">
${html}
  </main>
</div>
<footer class="footer">
  MIT · 本地优先 · 没有遥测 · <span>DSHBot ${new Date().getFullYear()}</span>
</footer>
</body>
</html>
`
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const page of pages) {
  const markdown = readFileSync(join(source, page.file), 'utf8')
  const depth = page.file.includes('/') ? 1 : 0
  const rootPath = depth === 0 ? './' : '../'
  const title = titleOf(markdown, page.label)
  const html = layout({ page: page.file, title, html: render(markdown), rootPath })
  const target = join(out, page.file.replace(/\.md$/, '.html'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, html, 'utf8')
  console.log('docs:', posix.join('site', page.file.replace(/\.md$/, '.html')))
}

cpSync(join(root, 'docs', 'assets'), join(out, 'assets'), { recursive: true })
cpSync(join(source, 'style.css'), join(out, 'assets', 'style.css'))
writeFileSync(join(out, '.nojekyll'), '', 'utf8')
console.log('docs: site/ 构建完成')
