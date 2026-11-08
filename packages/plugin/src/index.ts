/**
 * Host 侧插件。
 *
 * M0 阶段这里会挂：房间存储、编排调度、事件推送。
 * 现在只确认包能被 Loader 正确加载。
 */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis 插件名。 */
export const name = 'dshbot'

/** 暂时不依赖任何 Host 服务。 */
export const inject: string[] = []

/**
 * 挂载入口。
 *
 * @param _ctx - Host 侧插件上下文
 */
export function apply(_ctx: Context): void {
  console.log('[dshbot] host side loaded')
}
