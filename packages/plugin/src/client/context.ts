/**
 * 客户端插件的上下文类型。
 *
 * 只声明我们真正用到的那几个服务，避免为了类型把整个 DSH 客户端依赖拖进来。
 * 这些形状来自 DSH 内置插件的实际用法（见 spike/README.md 第 1 节）。
 */

/** 释放函数。注册类 API 统一返回它。 */
export type Disposable = () => void

/** 插槽注册选项。 */
export interface SlotOptions {
  /** 插槽名：`main`（全屏页）、`sidebar.panellist`（侧栏入口）等。 */
  name: string
  /** `main` 插槽里的页面 id。 */
  key?: string
  /** 与 `main` 的 key 对应，侧栏入口用。 */
  id?: string
  /** 侧栏排序。 */
  order?: number
  /** 侧栏标签，支持字符串或返回字符串的函数。 */
  label?: string | (() => string)
}

/** 插槽服务。 */
export interface SlotsService {
  /** 等某个插槽可用后执行回调。 */
  inject(name: string, callback: () => Disposable): Disposable
  /** 往插槽里注册一个组件。 */
  register(options: SlotOptions, component: (props: never) => unknown): Disposable
}

/** 布局服务。 */
export interface LayoutService {
  /** 切到某个已注册的主面板。 */
  selectPanel(id: string): void
}

/** 浏览器端插件拿到的上下文。 */
export interface ClientContext {
  slots: SlotsService
  layout: LayoutService
}
