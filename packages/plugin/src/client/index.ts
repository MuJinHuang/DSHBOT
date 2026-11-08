/**
 * 客户端插件入口。
 *
 * 构建后会包进 `window.__ModuleLoader__.load({ id, factory })`，
 * 由宿主的模块系统按需加载（见 build.mjs 的 banner/footer）。
 */
import type { ClientContext } from './context'
import { RoomsIcon, RoomsPage } from './page'

/** 与侧栏入口共用的 id，两边必须一致。 */
export const PANEL_ID = 'rooms'

/** 需要的客户端服务。 */
export const inject = ['slots', 'layout']

/**
 * 注册房间页与侧栏入口。
 *
 * 注意顺序：先有 `main` 面板，侧栏入口才切得过去——
 * 宿主对不存在的面板 id 会直接抛错。
 *
 * @param ctx - 浏览器端插件上下文
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, RoomsPage as never)
  )

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 0, label: '房间' },
      RoomsIcon as never
    )
  )
}
