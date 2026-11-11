/**
 * 展示用的数字格式化。
 *
 * 房间页面与 Markdown 导出都要显示 token 数，格式必须一致，
 * 所以收在这一处，两端都从这里复用。
 */

/** 把 token 数压成 1.2k / 3.4M 这种。 */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k'
  return String(Math.round(value))
}
