/**
 * 预算判定。
 *
 * 之前只有一个进度条，超支了也照跑——跑飞一次就是一整晚的 token。
 * 这里把"还能不能跑"做成纯函数，方便测试，也方便以后接告警。
 */
import type { Budget } from './types.js'

/** 预算状态。 */
export interface BudgetState {
  /** 已用比例，0~1，超支会大于 1。 */
  ratio: number
  /** ok 正常 / warn 超过 80% / exhausted 已用尽。 */
  level: 'ok' | 'warn' | 'exhausted'
  /** 还能用多少（token），用尽则是 0。 */
  remaining: number
}

/**
 * 算一个消耗占额度的状态。
 *
 * @param used - 已用 token
 * @param cap - 额度；小于等于 0 视为不限制
 */
export function evaluateBudget(used: number, cap: number): BudgetState {
  if (!Number.isFinite(cap) || cap <= 0) {
    return { ratio: 0, level: 'ok', remaining: Number.POSITIVE_INFINITY }
  }
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0
  const ratio = safeUsed / cap
  const remaining = Math.max(cap - safeUsed, 0)
  const level = ratio >= 1 ? 'exhausted' : ratio >= 0.8 ? 'warn' : 'ok'
  return { ratio, level, remaining }
}

/**
 * 房间还能不能开新的一轮。
 *
 * @param room - 至少要有 tokensUsed 与 budget
 */
export function canStartRun(room: { tokensUsed?: number; budget: Budget }): boolean {
  return evaluateBudget(room.tokensUsed ?? 0, room.budget.perRoom).level !== 'exhausted'
}
