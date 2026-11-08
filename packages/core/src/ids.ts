import { randomUUID } from 'node:crypto'

/**
 * 生成带前缀的 id，便于在日志和消息流里一眼看出是什么东西。
 *
 * @param prefix - 实体类型，如 `room`、`bot`、`msg`
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

/** 当前时间的 ISO 字符串，统一时间格式。 */
export function nowIso(): string {
  return new Date().toISOString()
}
