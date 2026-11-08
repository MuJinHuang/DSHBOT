/**
 * M0-1 端到端取证：在真实页面里走一遍「新建房间」。
 *
 * 用法：node m0-1-check.cjs <url> <out.png>
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const url = process.argv[2]
const out = process.argv[3]
const profile = path.join(os.tmpdir(), 'edge-m01-' + Date.now())

const child = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
  ],
  { stdio: 'ignore', windowsHide: true }
)

function cleanup(code) {
  try { child.kill() } catch {}
  setTimeout(() => {
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
    process.exit(code)
  }, 300)
}

async function waitDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return r.json()
    } catch {}
    await sleep(200)
  }
  throw new Error('devtools never came up')
}

async function main() {
  await waitDevtools()
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  const target = await created.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

  const pending = new Map()
  let seq = 0
  const logs = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push((msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + msg.params.exceptionDetails.text)
  })

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 20000)
    })

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(8000)

  // 关掉首启弹窗（如果有）
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '继续')
    if (b) { b.click(); return 'dismissed' } return 'none'
  })()`)

  // 进房间页
  console.log('open panel:', await evalJs(`(() => {
    const leaf = [...document.querySelectorAll('*')].find(
      (e) => e.childElementCount === 0 && (e.textContent || '').trim() === '\\u{1F3E0}')
    if (!leaf) return 'icon not found'
    const btn = leaf.closest('button') || leaf.parentElement
    btn.click(); return 'clicked'
  })()`))
  await sleep(2500)

  console.log('list before:', await evalJs(`(document.body.innerText || '').slice(0, 160).replace(/\\n/g, ' | ')`))

  // 点新建
  console.log('open form:', await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建房间'))
    if (!b) return 'button not found'
    b.click(); return 'clicked'
  })()`))
  await sleep(800)

  // 填表（React 受控组件要走原型 setter）
  console.log('fill:', await evalJs(`(() => {
    const set = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const fields = [...document.querySelectorAll('input, textarea')]
    if (fields.length < 3) return 'fields missing: ' + fields.length
    set(fields[0], '冒烟房间')
    set(fields[1], '验证建房链路能不能走通')
    set(fields[2], '房间出现在左侧列表\\n详情里能看到验收标准')
    return 'filled ' + fields.length
  })()`))
  await sleep(600)

  // 提交
  console.log('submit:', await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '创建')
    if (!b) return 'no create button'
    if (b.disabled) return 'disabled'
    b.click(); return 'clicked'
  })()`))
  await sleep(2500)

  console.log('page after:', await evalJs(`(document.body.innerText || '').replace(/\\n/g, ' | ').slice(0, 400)`))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))

  console.log('\nconsole:', logs.length ? logs.join(' ;; ') : '(none)')
  ws.close()
  cleanup(0)
}

main().catch((e) => { console.error('FAILED:', e.message); cleanup(1) })
