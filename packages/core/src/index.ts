/**
 * 编排内核的入口。
 *
 * 目前只导出领域模型；状态机与存储会在 M0 阶段进来。
 * 这个包必须保持零 DSH 依赖，才能被 CLI、插件、将来的独立服务复用。
 */
export * from './types.js'
export { newId, nowIso } from './ids.js'
