/**
 * Host 侧用到的服务类型。
 *
 * 只声明用到的那一小块，避免把整个 DSH 类型树拖进构建。
 * 形状取自 `dsh-host-webserver` 与 `dsh-client-modules` 的实际用法。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 释放函数。 */
export type Disposable = () => void

/** 路由注册选项。 */
export interface RouteOptions {
  /** `exact` 精确匹配，`prefix` 前缀匹配。 */
  kind: 'exact' | 'prefix'
  /** 路由键，以 `/` 开头。 */
  path: string
  /** 普通 node:http 处理器。 */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** Web 服务器服务（ctx key: `webServer`）。 */
export interface WebServerService {
  register(options: RouteOptions): Disposable
}

/** Host 侧插件上下文里我们依赖的部分。 */
export interface HostContext {
  webServer: WebServerService
  /** 注册随插件卸载而释放的资源。 */
  effect(callback: () => Disposable, label?: string): void
}
