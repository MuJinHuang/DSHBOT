/**
 * Host 侧插件入口。
 *
 * 职责：启动自愈、把房间 API 挂到 DSH 的 web 服务器上。
 * 编排逻辑在 host/turn.ts。
 */
import { API_PREFIX, createHandler } from './host/api.js'
import type { AgentContext } from './host/agent.js'
import type { HostContext } from './host/types.js'
import { healInterruptedRuns } from './host/turn.js'

/** Cordis 插件名。 */
export const name = 'dshbot'

/** 需要 web 服务器、Agent 服务与会话控制器；缺任何一个都不加载。 */
export const inject: string[] = ['webServer', 'agents', 'sessions', 'sessionController']

/**
 * 挂载入口。
 *
 * @param ctx - Host 侧插件上下文
 */
export function apply(ctx: HostContext & AgentContext): void {
  // 先把上次被中断的残留状态复位，否则页面会一直显示「进行中」
  try {
    const healed = healInterruptedRuns()
    if (healed > 0) console.log(`[dshbot] healed ${healed} interrupted room(s)`)
  } catch (error) {
    console.log('[dshbot] heal failed: ' + (error instanceof Error ? error.message : String(error)))
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: createHandler(ctx)
      }),
    'dshbot: rooms api'
  )
  console.log('[dshbot] host side loaded, api at ' + API_PREFIX)
}
