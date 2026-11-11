/**
 * id 与时间工具。
 *
 * 注意：**不要 import `node:crypto`**。
 * 这个包同时被 Host（Node）和房间页面（浏览器）使用，一旦引入 Node 内置模块，
 * 客户端打包就会报 `Could not resolve "node:crypto"`。
 * Web Crypto 在 Node 24 和浏览器里都是全局的，用它就够了。
 */

/** 生成一个随机 UUID，优先用 Web Crypto，实在没有就退化成随机串。 */
function uuid(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

/**
 * 生成带前缀的 id，便于在日志和消息流里一眼看出是什么东西。
 *
 * @param prefix - 实体类型，如 `room`、`bot`、`msg`
 */
export function newId(prefix: string): string {
  return `${prefix}_${uuid().replaceAll('-', '').slice(0, 12)}`
}

/** 当前时间的 ISO 字符串，统一时间格式。 */
export function nowIso(): string {
  return new Date().toISOString()
}
