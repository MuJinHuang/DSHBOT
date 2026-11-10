/**
 * 编排内核的入口。
 *
 * 领域模型 + 纯函数（解析与判定）。纯函数单独放在 parse.ts，
 * 因为它们不碰文件与网络，可以被单元测试固定住。
 *
 * 这个包必须保持零 DSH 依赖，才能被 CLI、插件、将来的独立服务复用。
 */
export * from './types.js'
export { newId, nowIso } from './ids.js'
export {
  parseMentions,
  resolveTargets,
  extractFiles,
  summarizeArgs,
  normalizeVerdict,
  parseChecks,
  parseGitStatus
} from './parse.js'
export { buildMarkdown } from './markdown.js'
