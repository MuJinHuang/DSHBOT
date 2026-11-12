/**
 * 测试用的最小宿主。
 *
 * 两件事：
 * 1. `startApi()` 把插件里真正的 HTTP 处理器挂到一个临时端口上——不启动 DSH，
 *    也能跑完整条 API（建房、拉人、派活、验收）；
 * 2. `fakeCtx()` 提供一只假 agent：按脚本回一句话，就能让编排逻辑跑到底，0 token。
 */
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 每个测试文件一个独立数据目录，绝不碰 ~/.dsh/dshbot。 */
export function makeDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dshbot-test-'))
  process.env.DSHBOT_DATA_DIR = dir
  return dir
}

/** 写一份 rooms.json（旧格式：messages 还在里面）。 */
export function seedDb(dataDir, db) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'rooms.json'), JSON.stringify(db, null, 2), 'utf8')
}

/** 读回 rooms.json。 */
export function readDb(dataDir) {
  return JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'))
}

/**
 * 起一个只在回环地址监听的 API 实例。
 *
 * @param dataDir - 数据目录
 * @param ctx - 假宿主上下文，缺省用 fakeCtx()
 */
export async function startApi(dataDir, ctx = fakeCtx()) {
  process.env.DSHBOT_DATA_DIR = dataDir
  const loaded = await import('../../packages/plugin/lib/index.js')
  const handler = loaded.createHandler(ctx)
  const server = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}${loaded.API_PREFIX}`

  /** 发一次请求，永远返回 { status, data }，不抛 JSON 解析错。 */
  async function api(path, init = {}) {
    const res = await fetch(`${base}/${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init
    })
    const text = await res.text()
    let data = {}
    try {
      data = text === '' ? {} : JSON.parse(text)
    } catch {
      data = { raw: text }
    }
    return { status: res.status, data, text }
  }

  return {
    base,
    api,
    server,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

let sessionCounter = 0

/**
 * 假 agent 上下文。
 *
 * @param options.reply - 固定回复，或 (info) => string
 * @param options.onCreate - 每次 createSession 时调用，可以用来数"跑了几只"
 * @param options.failCreate - 直接让 createSession 抛错，用来模拟预算/故障
 * @param options.toolEvents - 想伪造的工具调用，会塞进事件流
 */
export function fakeCtx(options = {}) {
  const created = []
  const replyOf = (info) =>
    typeof options.reply === 'function' ? options.reply(info) : options.reply ?? '收到。'

  function makeAgent(cwd) {
    const listeners = new Map()
    let seq = 0
    const emit = (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    }

    const agent = {
      id: `sess_fake_${++sessionCounter}`,
      status: 'idle',
      followup(message) {
        const text = replyOf({ message, cwd, index: created.length })
        const log = []
        for (const tool of options.toolEvents ?? []) {
          seq += 1
          log.push({
            seq,
            type: 'tool/call',
            data: { callId: `call_${seq}`, name: tool.name, arguments: tool.args ?? '' }
          })
          seq += 1
          log.push({
            seq,
            type: 'tool/result',
            data: { toolCallId: `call_${seq - 1}`, message: { content: [{ type: 'text', text: tool.output ?? '' }] } }
          })
        }
        seq += 1
        log.push({
          seq,
          type: 'assistant/message',
          data: {
            message: { role: 'assistant', content: [{ type: 'text', text }] },
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
          }
        })

        setTimeout(() => {
          if (options.onCreate !== undefined) options.onCreate(cwd)
          emit('session/event', { log })
          emit('agent/status', { status: 'thinking' })
          setTimeout(() => emit('agent/status', { status: 'idle' }), 1)
        }, 0)
      },
      on(event, listener) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((item) => item !== listener)
          )
        }
      },
      cancel() {
        /* 测试里不模拟取消 */
      },
      session: { events: [] }
    }
    return agent
  }

  return {
    agents: {
      get: () => undefined,
      create: async () => {
        throw new Error('测试不应走底层 create 路径')
      }
    },
    sessionController: {
      agents: {
        createSession: async (request) => {
          created.push(request)
          if (options.failCreate === true) throw new Error('mock: 模型不可用')
          return { agent: makeAgent(request.cwd) }
        }
      }
    },
    /** 数一共起了几个会话。 */
    createdSessions: created
  }
}
