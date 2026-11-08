/**
 * Host 侧插件入口。
 *
 * 职责：把房间 API 挂到 DSH 的 web 服务器上，并用宿主的 Agent 服务跑 Bot 回合。
 * 编排、调度、Run 生命周期会在后续里程碑加进来。
 */
import { API_PREFIX, createHandler } from './host/api.js'
import type { AgentContext } from './host/agent.js'
import type { HostContext } from './host/types.js'

/** Cordis 插件名。 */
export const name = 'dshbot'

/** 需要 web 服务器、Agent 服务与会话存储；缺任何一个都不加载。 */
export const inject: string[] = ['webServer', 'agents', 'sessions']

/**
 * 挂载入口。
 *
 * @param ctx - Host 侧插件上下文
 */
export function apply(ctx: HostContext & AgentContext): void {
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
