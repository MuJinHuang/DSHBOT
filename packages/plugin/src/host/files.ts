/**
 * 房间工作区的文件浏览。
 *
 * 交付环节一直断在最后一步：验收说"做了"，人还得去资源管理器找文件。
 * 这两个函数把工作区变成可读的列表与预览——只读，不写。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** 列目录时跳过的东西：版本库与依赖不属于"产物"。 */
const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** 默认最多列这么多条，防止绑定大项目时把响应撑爆。 */
export const MAX_FILES = 500

/** 单个文件预览上限 200 KB。 */
export const MAX_PREVIEW_BYTES = 200 * 1024

/** 最大递归深度，挡住畸形目录。 */
const MAX_DEPTH = 12

/** 列表里的一行。 */
export interface WorkspaceFile {
  /** 相对工作区的路径，统一用 `/`。 */
  path: string
  size: number
  /** ISO 时间串，前端自己格式化。 */
  mtime: string
}

/** 列工作区里的文件，按修改时间从新到旧。 */
export function listWorkspaceFiles(
  root: string,
  limit = MAX_FILES
): { files: WorkspaceFile[]; truncated: boolean } {
  const files: WorkspaceFile[] = []
  let truncated = false

  const walk = (dir: string, depth: number): void => {
    if (truncated) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true
        return
      }
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = statSync(full)
        files.push({
          path: relative(root, full).split(sep).join('/'),
          size: stat.size,
          mtime: stat.mtime.toISOString()
        })
      } catch {
        /* 单个文件读不到就跳过 */
      }
    }
  }

  walk(root, 0)
  files.sort((a, b) => b.mtime.localeCompare(a.mtime))
  return { files, truncated }
}

/** 预览结果：要么给正文，要么给一个明确的拒绝理由。 */
export type FilePreview =
  | { ok: true; path: string; size: number; mtime: string; text: string }
  | { ok: false; status: 400 | 404 | 413 | 415; error: string }

/**
 * 把相对路径解析到工作区内，挡掉越界访问。
 *
 * @param root - 工作区绝对路径
 * @param requested - 请求里的相对路径
 * @returns 绝对路径；越界或非法时返回错误
 */
function safeJoin(root: string, requested: string): { full: string } | { error: string } {
  const cleaned = requested.trim().replaceAll('\\', '/')
  if (cleaned === '') return { error: 'path 不能为空' }
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) {
    return { error: 'path 必须是工作区里的相对路径' }
  }
  const full = resolve(root, cleaned)
  const rel = relative(root, full)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return { error: 'path 越出了工作区' }
  }
  return { full }
}

/** 读一个工作区文件，只返回文本；二进制和超大文件明确拒绝。 */
export function readWorkspaceFile(root: string, requested: string): FilePreview {
  const joined = safeJoin(root, requested)
  if ('error' in joined) return { ok: false, status: 400, error: joined.error }

  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(joined.full)
  } catch {
    return { ok: false, status: 404, error: `文件不存在：${requested}` }
  }
  if (!stat.isFile()) return { ok: false, status: 400, error: '这是一个目录，不是文件' }
  if (stat.size > MAX_PREVIEW_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `文件 ${Math.round(stat.size / 1024)} KB，超过 200 KB 预览上限`
    }
  }

  let buffer: Buffer
  try {
    buffer = readFileSync(joined.full)
  } catch (error) {
    return {
      ok: false,
      status: 404,
      error: `读不到：${error instanceof Error ? error.message : '未知错误'}`
    }
  }
  // NUL 字节是最便宜的二进制判据：文本文件里不会出现
  if (buffer.includes(0)) {
    return { ok: false, status: 415, error: '这是二进制文件，不做文本预览' }
  }

  return {
    ok: true,
    path: relative(root, joined.full).split(sep).join('/'),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    text: buffer.toString('utf8')
  }
}
