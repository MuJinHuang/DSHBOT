/**
 * Host 侧插件入口。
 *
 * 职责：把房间 API 挂到 DSH 的 web 服务器上。
 * 编排、调度、Run 生命周期会在后续里程碑加进来。
 */
import { API_PREFIX, handle } from './host/api.js'
import type { HostContext } from './host/types.js'

/** Cordis 插件名。 */
export const name = 'dshbot'

/** 需要 web 服务器；没有它的组合（比如纯 headless）不加载本插件。 */
export const inject: string[] = ['webServer']

/**
 * 挂载入口。
 *
 * @param ctx - Host 侧插件上下文
 */
export function apply(ctx: HostContext): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: handle
      }),
    'dshbot: rooms api'
  )
  console.log('[dshbot] host side loaded, api at ' + API_PREFIX)
}
