import { Component, createElement as h, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { formatTokens } from '@dshbot/core'
import type { Delivery, Member, Message, Room } from '@dshbot/core'
import {
  addMember,
  createRoom,
  deleteRoom,
  deliver,
  listMessages,
  listRooms,
  say,
  setRoomState,
  stop,
  takeover,
  updateRoom,
  listVersions,
  rollback,
  decidePlan,
  listBots,
  fetchDiff,
  fetchAudit
} from './api'
import type { VersionEntry } from './api'
import { buildMarkdown } from '@dshbot/core/markdown'
import { BotLibraryView, MemberPanel } from './members'
import type { BotCard } from './api'
import { parseBlocks, parseInline } from '@dshbot/core/blocks'

/**
 * 错误边界：一个渲染异常不该让整个页面变白。
 *
 * React 只在 class 组件上支持这个，所以这里破例用 class。
 */
export class RoomsBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return h(
        'div',
        { style: { padding: 24, fontSize: 13, lineHeight: 1.8 } },
        h('div', { style: { fontSize: 15, marginBottom: 8 } }, '房间页出错了'),
        h(
          'div',
          { style: { color: MUTED, marginBottom: 12, fontFamily: 'Consolas, monospace' } },
          this.state.error.message
        ),
        h(
          'button',
          {
            onClick: () => this.setState({ error: null }),
            style: {
              padding: '6px 14px',
              borderRadius: 6,
              border: LINE,
              background: 'transparent',
              color: 'inherit',
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer'
            }
          },
          '重试'
        )
      )
    }
    return this.props.children
  }
}

/** 房间页。
 *
 * M0-3 范围：建房、列房间、在房间里说话并看到 Bot 回话。
 * 工具动作折叠、状态灯、审批在后续里程碑接。
 */

const MUTED = 'rgba(128,128,128,0.72)'
const LINE = '1px solid rgba(128,128,128,0.25)'

/** 输入框统一样式。 */
const inputStyle = {
  padding: '7px 10px',
  borderRadius: 6,
  border: LINE,
  background: 'transparent',
  color: 'inherit',
  fontSize: 12.5,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box' as const
}

/** 状态灯颜色。 */
const STATUS_COLOR: Record<string, string> = {
  idle: '#9aa0a6',
  queued: '#b0b0b0',
  thinking: '#2f6fed',
  acting: '#2f6fed',
  waiting: '#e8a33d',
  waiting_approval: '#e8a33d',
  waiting_human: '#e8a33d',
  done: '#2f9e44',
  error: '#e5484d'
}

/** 状态灯文案。 */
const STATUS_TEXT: Record<string, string> = {
  idle: '空闲',
  queued: '排队中',
  thinking: '思考中',
  acting: '操作中',
  waiting: '等待',
  waiting_approval: '等审批',
  waiting_human: '等人',
  done: '完成',
  error: '出错'
}

function SectionTitle(props: { children?: React.ReactNode }) {
  return h(
    'div',
    {
      style: {
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: MUTED,
        marginBottom: 8
      }
    },
    props.children
  )
}

function Badge(props: { children?: React.ReactNode }) {
  return h(
    'span',
    {
      style: {
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 4,
        background: 'rgba(128,128,128,0.16)',
        color: MUTED,
        marginLeft: 8
      }
    },
    props.children
  )
}

const STATUS_LABEL: Record<string, string> = {
  created: '已建',
  briefing: '交代中',
  working: '进行中',
  waiting_approval: '等审批',
  reviewing: '评审中',
  done: '已完成',
  archived: '已归档',
  paused: '已暂停'
}

/** 建房表单。 */
function CreateForm(props: {
  onCancel: () => void
  onCreated: (room: Room) => void
}) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = name.trim() !== '' && goal.trim() !== '' && acceptance.trim() !== ''

  const submit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const room = await createRoom({
        name,
        goal,
        acceptance: acceptance
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        ...(workspace.trim() === '' ? {} : { workspaceDir: workspace.trim() })
      })
      props.onCreated(room)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }, [name, goal, acceptance, workspace, props])

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '8px 10px',
    borderRadius: 6,
    border: LINE,
    background: 'transparent',
    color: 'inherit',
    fontSize: 13,
    fontFamily: 'inherit'
  }

  return h(
    'div',
    { style: { maxWidth: 520 } },
    h('div', { style: { fontSize: 16, marginBottom: 4 } }, '新建房间'),
    h('div', { style: { fontSize: 12, color: MUTED, marginBottom: 18 } },
      '房间就是任务：一个目标、若干验收标准。Bot 稍后拉进来。'),

    h('div', { style: { marginBottom: 14 } },
      h('div', { style: { fontSize: 12, marginBottom: 6 } }, '名称'),
      h('input', {
        value: name,
        onChange: (e: { target: { value: string } }) => setName(e.target.value),
        placeholder: '改造登录页',
        style: inputStyle
      })
    ),

    h('div', { style: { marginBottom: 14 } },
      h('div', { style: { fontSize: 12, marginBottom: 6 } }, '目标'),
      h('textarea', {
        value: goal,
        onChange: (e: { target: { value: string } }) => setGoal(e.target.value),
        placeholder: '把登录页改成暗色主题，保持现有交互不变',
        rows: 3,
        style: { ...inputStyle, resize: 'vertical' }
      })
    ),

    h('div', { style: { marginBottom: 18 } },
      h('div', { style: { fontSize: 12, marginBottom: 6 } },
        '验收标准',
        h('span', { style: { color: MUTED, marginLeft: 8 } }, '一行一条，至少一条')
      ),
      h('textarea', {
        value: acceptance,
        onChange: (e: { target: { value: string } }) => setAcceptance(e.target.value),
        placeholder: 'file:dist/index.html\ncmd:pnpm test\n暗色主题下对比度符合 WCAG AA',
        rows: 3,
        style: { ...inputStyle, resize: 'vertical' }
      }),
      h('div', { style: { fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.6 } },
        'file:路径 = 文件必须存在；cmd:命令 = 退出码必须为 0；其余交给模型判。')
    ),

    h('div', { style: { marginBottom: 18 } },
      h('div', { style: { fontSize: 12, marginBottom: 6 } },
        '工作目录',
        h('span', { style: { color: MUTED, marginLeft: 8 } }, '可选，留空则用房间自己的空目录')
      ),
      h('input', {
        value: workspace,
        onChange: (e: { target: { value: string } }) => setWorkspace(e.target.value),
        placeholder: 'D:\\Desktop\\DSBOT',
        style: inputStyle
      }),
      h('div', { style: { fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.6 } },
        'Bot 只能看到这个目录里的文件。要让它们读你的项目，必须在这里填项目路径。')
    ),

    error
      ? h('div', { style: { color: '#e5484d', fontSize: 12, marginBottom: 12 } }, error)
      : null,

    h('div', { style: { display: 'flex', gap: 8 } },
      h(
        'button',
        {
          onClick: submit,
          disabled: busy || !ready,
          style: {
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#2f6fed',
            color: '#fff',
            fontSize: 13,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy || !ready ? 0.5 : 1
          }
        },
        busy ? '创建中…' : '创建'
      ),
      h(
        'button',
        {
          onClick: props.onCancel,
          style: {
            padding: '8px 16px',
            borderRadius: 6,
            border: LINE,
            background: 'transparent',
            color: 'inherit',
            fontSize: 13,
            cursor: 'pointer'
          }
        },
        '取消'
      )
    )
  )
}

/** 工具动作：默认折叠成一行，点开看参数与输出。 */
function ToolRow(props: { message: Message; member?: Member }) {
  const [open, setOpen] = useState(false)
  const payload = (props.message.payload ?? {}) as {
    name?: string
    input?: string
    output?: string
  }
  const output = payload.output ?? ''
  const lines = output.split('\n').length

  return h(
    'div',
    { style: { marginBottom: 8 } },
    props.member !== undefined
      ? h(
          'div',
          { style: { fontSize: 10.5, color: MUTED, marginBottom: 2, marginLeft: 2 } },
          `${props.member.avatar} ${props.member.name}`
        )
      : null,
    h(
      'button',
      {
        onClick: () => setOpen((v) => !v),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          padding: '5px 10px',
          borderRadius: 6,
          border: LINE,
          background: 'rgba(128,128,128,0.06)',
          color: 'inherit',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer'
        }
      },
      h('span', { style: { opacity: 0.6, width: 10 } }, open ? '▾' : '▸'),
      h('code', { style: { color: '#2f6fed' } }, props.message.text),
      h(
        'span',
        { style: { marginLeft: 'auto', color: MUTED, fontSize: 11 } },
        output === '' ? '无输出' : `${lines} 行输出`
      )
    ),
    open
      ? h(
          'div',
          {
            style: {
              marginTop: 6,
              marginLeft: 18,
              padding: 10,
              borderRadius: 6,
              background: 'rgba(128,128,128,0.08)',
              fontSize: 11.5,
              lineHeight: 1.5
            }
          },
          payload.input
            ? h('div', { style: { marginBottom: 6 } },
                h('div', { style: { color: MUTED, marginBottom: 2 } }, '参数'),
                h('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, payload.input))
            : null,
          h('div', { style: { color: MUTED, marginBottom: 2 } }, '输出'),
          h(
            'pre',
            {
              style: {
                margin: 0,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }
            },
            output === '' ? '（空）' : output
          )
        )
      : null
  )
}

/** 任务卡：总管派给某只 Bot 的活。 */
function AssignmentRow(props: { message: Message }) {
  const payload = (props.message.payload ?? {}) as {
    title?: string
    from?: string
    to?: string
    status?: string
  }
  const status = payload.status ?? 'running'
  const label =
    status === 'done'
      ? '完成'
      : status === 'failed'
        ? '失败'
        : status === 'skipped'
          ? '已跳过'
          : status === 'rejected'
            ? '已否决'
            : status === 'pending'
              ? '待确认'
              : status === 'running'
                ? '进行中'
                : status
  const color =
    status === 'done'
      ? '#2f9e44'
      : status === 'failed'
        ? '#e5484d'
        : status === 'skipped' || status === 'rejected' || status === 'pending'
          ? MUTED
          : '#2f6fed'

  return h(
    'div',
    {
      style: {
        border: LINE,
        borderRadius: 8,
        padding: '8px 12px',
        marginBottom: 8,
        background: 'rgba(47,111,237,0.05)',
        fontSize: 12,
        lineHeight: 1.6
      }
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
      h('span', { style: { fontSize: 11, color: '#2f6fed' } }, '任务卡'),
      h('span', { style: { color: MUTED, fontSize: 11 } },
        `${payload.from ?? ''} → ${payload.to ?? ''}`),
      h('span', { style: { marginLeft: 'auto', color, fontSize: 11 } }, label)
    ),
    h('div', {}, payload.title ?? props.message.text)
  )
}

/** 行内格式：**粗** 与 `代码`。 */
function InlineText(props: { text: string }) {
  const parts = parseInline(props.text)
  if (parts.length === 1 && parts[0]?.kind === 'text') return h('span', {}, props.text)
  return h(
    'span',
    {},
    ...parts.map((part, index) =>
      part.kind === 'bold'
        ? h('strong', { key: index }, part.text)
        : part.kind === 'code'
          ? h(
              'code',
              {
                key: index,
                style: {
                  fontFamily: 'Consolas, monospace',
                  fontSize: '0.92em',
                  background: 'rgba(128,128,128,0.16)',
                  padding: '1px 4px',
                  borderRadius: 3
                }
              },
              part.text
            )
          : h('span', { key: index }, part.text)
    )
  )
}

/** 把 Bot 回复按 Markdown 块渲染。 */
function MarkdownText(props: { text: string }) {
  const blocks = parseBlocks(props.text)
  if (blocks.length === 0) return h('div', {}, props.text)

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    ...blocks.map((block, index) => {
      if (block.kind === 'code') {
        return h(
          'pre',
          {
            key: index,
            style: {
              margin: 0,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.28)',
              fontFamily: 'Consolas, monospace',
              fontSize: 11.5,
              lineHeight: 1.5,
              overflow: 'auto',
              whiteSpace: 'pre'
            }
          },
          block.text
        )
      }
      if (block.kind === 'heading') {
        const size = block.level === 1 ? 15 : block.level === 2 ? 14 : 13
        return h('div', { key: index, style: { fontSize: size, fontWeight: 600 } }, [
          h(InlineText, { key: 'i', text: block.text })
        ])
      }
      if (block.kind === 'table') {
        return h(
          'table',
          {
            key: index,
            style: { borderCollapse: 'collapse', fontSize: 11.5, margin: '2px 0', width: '100%' }
          },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...block.header.map((cell, cellIndex) =>
                h(
                  'th',
                  {
                    key: cellIndex,
                    style: {
                      border: LINE,
                      padding: '3px 8px',
                      textAlign: 'left',
                      background: 'rgba(128,128,128,0.12)'
                    }
                  },
                  [h(InlineText, { key: 'i', text: cell })]
                )
              )
            )
          ),
          h(
            'tbody',
            {},
            ...block.rows.map((row, rowIndex) =>
              h(
                'tr',
                { key: rowIndex },
                ...row.map((cell, cellIndex) =>
                  h(
                    'td',
                    { key: cellIndex, style: { border: LINE, padding: '3px 8px' } },
                    [h(InlineText, { key: 'i', text: cell })]
                  )
                )
              )
            )
          )
        )
      }
      if (block.kind === 'list') {
        return h(
          block.ordered ? 'ol' : 'ul',
          { key: index, style: { margin: 0, paddingLeft: 20 } },
          ...block.items.map((item, itemIndex) =>
            h('li', { key: itemIndex, style: { marginBottom: 2 } }, [
              h(InlineText, { key: 'i', text: item })
            ])
          )
        )
      }
      const lines = block.text.split('\n')
      return h(
        'div',
        { key: index },
        ...lines.map((line, lineIndex) =>
          h(
            'div',
            { key: lineIndex },
            lineIndex === lines.length - 1 ? [h(InlineText, { key: 'i', text: line })] : [h(InlineText, { key: 'i', text: line })]
          )
        )
      )
    })
  )
}

/** 一条消息。bot 消息带发送者名字，方便分清楚是谁说的。 */
function MessageRow(props: { message: Message; member?: Member }) {
  const { message, member } = props

  if (message.kind === 'tool') return h(ToolRow, { message, member })
  if (message.kind === 'assignment') return h(AssignmentRow, { message })

  const mine = message.kind === 'human'
  return h(
    'div',
    {
      style: {
        display: 'flex',
        justifyContent: mine ? 'flex-end' : 'flex-start',
        marginBottom: 10
      }
    },
    h(
      'div',
      { style: { maxWidth: '78%' } },
      !mine && member !== undefined
        ? h(
            'div',
            { style: { fontSize: 10.5, color: MUTED, marginBottom: 2, marginLeft: 2 } },
            `${member.avatar} ${member.name}`
          )
        : null,
      h(
        'div',
        {
          style: {
            padding: '8px 12px',
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: mine ? 'pre-wrap' : 'normal',
            background: mine ? 'rgba(47,111,237,0.14)' : 'rgba(128,128,128,0.12)'
          }
        },
        mine ? message.text : h(MarkdownText, { text: message.text })
      )
    )
  )
}

/** 交付结论面板。 */
function DeliveryPanel(props: { delivery: Delivery; roomId: string }) {
  const { delivery } = props
  const passed = delivery.checks.filter((c) => c.verdict === 'pass').length
  const icon = (v: string) => (v === 'pass' ? '✅' : v === 'fail' ? '❌' : '❓')
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [openDiff, setOpenDiff] = useState<{ stat: string; diff: string } | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const onOpenFile = async (file: string): Promise<void> => {
    if (openFile === file) {
      setOpenFile(null)
      setOpenDiff(null)
      return
    }
    setOpenFile(file)
    setOpenDiff(null)
    setDiffLoading(true)
    try {
      setOpenDiff(await fetchDiff(props.roomId, file))
    } catch {
      setOpenDiff({ stat: '', diff: '（读取失败）' })
    } finally {
      setDiffLoading(false)
    }
  }

  return h(
    'div',
    {
      style: {
        border: LINE,
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 14,
        background: 'rgba(128,128,128,0.05)',
        fontSize: 12
      }
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', marginBottom: 8 } },
      h('span', { style: { fontWeight: 600 } }, '交付结论'),
      h('span', { style: { marginLeft: 8, color: passed === delivery.checks.length ? '#2f9e44' : '#e8a33d' } },
        `${passed}/${delivery.checks.length} 通过`),
      h('span', { style: { marginLeft: 'auto', color: MUTED, fontSize: 11 } },
        new Date(delivery.at).toLocaleTimeString())
    ),
    ...delivery.checks.map((check, index) =>
      h(
        'div',
        { key: index, style: { display: 'flex', gap: 6, marginBottom: 4, lineHeight: 1.5 } },
        h('span', {}, icon(check.verdict)),
        h(
          'div',
          {},
          h('div', {}, check.point),
          h('div', { style: { color: MUTED, fontSize: 11 } }, check.reason)
        )
      )
    ),
    h(
      'div',
      { style: { color: MUTED, fontSize: 11, marginTop: 8, borderTop: LINE, paddingTop: 6 } },
      `变更文件 ${delivery.changedFiles.length} 个` +
        `　·　本次验收花费 ${formatTokens(delivery.tokensUsed)}`
    ),
    // 全是文字判定又没改文件：提醒一句，否则"说做了"就等于"做了"
    delivery.changedFiles.length === 0 &&
    !delivery.checks.some((check) => /^(file|cmd):/.test(check.point))
      ? h(
          'div',
          { style: { color: '#e8a33d', fontSize: 11, marginTop: 6, lineHeight: 1.6 } },
          '这次验收全是文字判定，工作区没有变更——Bot 说"写好了"但可能没真写。' +
            '要文件就用 file:路径 当验收条件。'
        )
      : null,
    delivery.changedFiles.length === 0
      ? null
      : h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } },
          ...delivery.changedFiles.slice(0, 8).map((file) =>
            h(
              'button',
              {
                key: file,
                onClick: () => void onOpenFile(file),
                style: {
                  padding: '2px 8px',
                  borderRadius: 5,
                  border: LINE,
                  background: openFile === file ? 'rgba(47,111,237,0.16)' : 'transparent',
                  color: 'inherit',
                  fontSize: 11,
                  fontFamily: 'Consolas, monospace',
                  cursor: 'pointer'
                }
              },
              file
            )
          )
        ),
    openFile === null
      ? null
      : h(
          'pre',
          {
            style: {
              marginTop: 8,
              marginBottom: 0,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.28)',
              fontFamily: 'Consolas, monospace',
              fontSize: 11,
              lineHeight: 1.5,
              maxHeight: 260,
              overflow: 'auto',
              whiteSpace: 'pre'
            }
          },
          diffLoading ? '读取中…' : openDiff?.diff || '（没有差异，或该文件不在版本里）'
        )
  )
}

/** 版本列表：每条都能回滚。 */
function VersionsPanel(props: {
  versions: VersionEntry[]
  onRollback: (hash: string) => void
}) {
  const [pending, setPending] = useState<string | null>(null)
  if (props.versions.length === 0) return null

  return h(
    'div',
    { style: { marginBottom: 16 } },
    h(SectionTitle, {}, '版本'),
    ...props.versions.map((version) =>
      h(
        'div',
        {
          key: version.hash,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11.5,
            padding: '4px 0',
            borderBottom: LINE
          }
        },
        h('code', { style: { color: MUTED, minWidth: 54 } }, version.hash),
        h(
          'div',
          { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          version.subject
        ),
        h(
          'button',
          {
            onClick: () => {
              if (pending !== version.hash) {
                setPending(version.hash)
                return
              }
              setPending(null)
              props.onRollback(version.hash)
            },
            style: {
              padding: '2px 8px',
              borderRadius: 5,
              border: LINE,
              background: 'transparent',
              color: pending === version.hash ? '#e5484d' : MUTED,
              fontSize: 11,
              fontFamily: 'inherit',
              cursor: 'pointer',
              flexShrink: 0
            }
          },
          pending === version.hash ? '确认回滚' : '回滚'
        )
      )
    )
  )
}

/** 待确认的计划：可以全批，也可以只批几件。 */
function PlanBanner(props: {
  plan: NonNullable<Room['pendingPlan']>
  busy: boolean
  onDecide: (action: 'approve' | 'reject', itemIds?: string[]) => void
}) {
  const { plan } = props
  const selectable = plan.items.every((item) => item.id !== undefined)
  const keyOf = (item: NonNullable<Room['pendingPlan']>['items'][number], index: number): string =>
    item.id ?? `legacy-${index}`
  const allKeys = plan.items.map((item, index) => keyOf(item, index))
  const [picked, setPicked] = useState<string[]>(allKeys)

  useEffect(() => {
    setPicked(plan.items.map((item, index) => keyOf(item, index)))
  }, [plan.id])

  const toggle = (key: string): void => {
    setPicked((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    )
  }

  const approve = (): void => {
    if (!selectable) {
      props.onDecide('approve')
      return
    }
    const ids = plan.items
      .filter((item, index) => item.id !== undefined && picked.includes(keyOf(item, index)))
      .map((item) => item.id as string)
    props.onDecide('approve', ids)
  }

  const pickedCount = selectable ? picked.length : plan.items.length

  return h(
    'div',
    {
      style: {
        border: '1px solid rgba(232,163,61,0.55)',
        background: 'rgba(232,163,61,0.08)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 14,
        fontSize: 12
      }
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
      h('span', { style: { fontWeight: 600 } }, '计划待确认'),
      h('span', { style: { color: MUTED, fontSize: 11 } }, `${plan.hostName} 想去派 ${plan.items.length} 件事`),
      selectable ? h('span', { style: { color: MUTED, fontSize: 11 } }, `已选 ${pickedCount} 件`) : null,
      h('div', { style: { flex: 1 } }),
      h(
        'button',
        {
          onClick: approve,
          disabled: props.busy || pickedCount === 0,
          style: {
            padding: '4px 12px',
            borderRadius: 6,
            border: 'none',
            background: '#2f9e44',
            color: '#fff',
            fontSize: 11.5,
            fontFamily: 'inherit',
            cursor: props.busy || pickedCount === 0 ? 'default' : 'pointer',
            opacity: props.busy || pickedCount === 0 ? 0.6 : 1
          }
        },
        props.busy
          ? '执行中…'
          : pickedCount < plan.items.length
            ? `批准选中 ${pickedCount} 件`
            : '批准执行'
      ),
      h(
        'button',
        {
          onClick: () => props.onDecide('reject'),
          disabled: props.busy,
          style: {
            padding: '4px 12px',
            borderRadius: 6,
            border: LINE,
            background: 'transparent',
            color: 'inherit',
            fontSize: 11.5,
            fontFamily: 'inherit',
            cursor: props.busy ? 'default' : 'pointer',
            opacity: props.busy ? 0.6 : 1
          }
        },
        '否决'
      )
    ),
    ...plan.items.map((item, index) =>
      h(
        'div',
        {
          key: keyOf(item, index),
          style: { display: 'flex', gap: 6, marginBottom: 3, lineHeight: 1.5, alignItems: 'flex-start' }
        },
        selectable
          ? h('input', {
              type: 'checkbox',
              checked: picked.includes(keyOf(item, index)),
              onChange: () => toggle(keyOf(item, index)),
              style: { marginTop: 3 }
            })
          : null,
        h('span', { style: { color: MUTED, flexShrink: 0 } }, `${item.name}：`),
        h('span', { style: { opacity: selectable && !picked.includes(keyOf(item, index)) ? 0.5 : 1 } }, item.task)
      )
    )
  )
}

/** 房间详情：目标 + 验收 + 消息流 + 输入框。 */
function RoomDetail(props: {
  room: Room
  messages: Message[]
  sending: boolean
  delivering: boolean
  error: string | null
  onSend: (text: string) => void
  onState: (action: 'pause' | 'resume' | 'archive' | 'unarchive' | 'toggleMentionOnly') => void
  onDeliver: () => void
  onTakeover: (action: 'take' | 'return', note?: string) => void
  onStop: () => void
  onEdit: (input: { name: string; goal: string; acceptance: string[]; workspaceDir: string }) => void
  onDelete: () => void
  onExport: () => void
  onExportAudit: () => void
  versions: VersionEntry[]
  onRollback: (hash: string) => void
  onDecidePlan: (action: 'approve' | 'reject', itemIds?: string[]) => void
  planBusy: boolean
}) {
  const { room, messages, sending, error } = props
  const [draft, setDraft] = useState('')
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnNote, setReturnNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(room.name)
  const [editGoal, setEditGoal] = useState(room.goal)
  const [editAcceptance, setEditAcceptance] = useState(room.acceptance.join('\n'))
  const [editWorkspace, setEditWorkspace] = useState(room.workspaceDir ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const submit = () => {
    const text = draft.trim()
    if (text === '' || sending) return
    setDraft('')
    props.onSend(text)
  }

  const paused = room.status === 'paused'
  const archived = room.status === 'archived'
  const mentionOnly = room.mentionOnly === true
  const spent = room.tokensUsed ?? 0
  const cap = room.budget.perRoom
  const ratio = cap > 0 ? Math.min(spent / cap, 1) : 0

  const actionButton = (label: string, action: string, onClick: () => void) =>
    h(
      'button',
      {
        key: action,
        onClick,
        style: {
          padding: '4px 10px',
          borderRadius: 6,
          border: LINE,
          background: 'transparent',
          color: 'inherit',
          fontSize: 11.5,
          fontFamily: 'inherit',
          cursor: 'pointer',
          opacity: 0.85
        }
      },
      label
    )

  return h(
    'div',
    { style: { maxWidth: 680, display: 'flex', flexDirection: 'column', height: '100%' } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
      h('div', { style: { fontSize: 17 } }, room.name),
      h(Badge, {}, STATUS_LABEL[room.status] ?? room.status),
      h('div', { style: { flex: 1 } }),
      actionButton(
        props.delivering
          ? '验收中…'
          : room.pendingPlan === undefined
            ? '交付验收'
            : '先批准计划',
        'deliver',
        () => props.onDeliver()
      ),
      actionButton('导出', 'export', () => props.onExport()),
      actionButton('审计', 'audit', () => props.onExportAudit()),
      actionButton(editing ? '取消编辑' : '编辑', 'edit', () => setEditing(!editing)),
      paused
        ? actionButton('恢复', 'resume', () => props.onState('resume'))
        : archived
          ? actionButton('取消归档', 'unarchive', () => props.onState('unarchive'))
          : actionButton('接管', 'takeover', () => props.onTakeover('take')),
      paused
        ? actionButton('交还', 'giveback', () => setReturnOpen(true))
        : archived
          ? null
          : actionButton('归档', 'archive', () => props.onState('archive')),
      actionButton(mentionOnly ? '仅 @ 响应：开' : '仅 @ 响应：关', 'mention', () =>
        props.onState('toggleMentionOnly')
      ),
      actionButton(confirmDelete ? '确认删除' : '删除', 'delete', () => {
        if (!confirmDelete) {
          setConfirmDelete(true)
          return
        }
        props.onDelete()
      })
    ),

    // 编辑态：改名称 / 目标 / 验收
    editing
      ? h(
          'div',
          {
            style: {
              border: LINE,
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }
          },
          h('input', {
            value: editName,
            placeholder: '房间名称',
            onChange: (e: { target: { value: string } }) => setEditName(e.target.value),
            style: inputStyle
          }),
          h('input', {
            value: editGoal,
            placeholder: '目标',
            onChange: (e: { target: { value: string } }) => setEditGoal(e.target.value),
            style: inputStyle
          }),
          h('textarea', {
            value: editAcceptance,
            rows: 3,
            placeholder: '验收标准，一行一条',
            onChange: (e: { target: { value: string } }) => setEditAcceptance(e.target.value),
            style: { ...inputStyle, resize: 'vertical' }
          }),
          h('input', {
            value: editWorkspace,
            placeholder: '工作目录（Bot 只能看这个目录）',
            onChange: (e: { target: { value: string } }) => setEditWorkspace(e.target.value),
            style: inputStyle
          }),
          h(
            'div',
            { style: { fontSize: 11, color: MUTED, lineHeight: 1.6 } },
            '想让它机器判定，就写成 file:路径 或 cmd:命令；其余交给模型判。'
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
            h(
              'button',
              {
                onClick: () => setEditing(false),
                style: { ...inputStyle, width: 72, cursor: 'pointer' }
              },
              '取消'
            ),
            h(
              'button',
              {
                onClick: () => {
                  const acceptance = editAcceptance
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line !== '')
                  props.onEdit({
                    name: editName.trim(),
                    goal: editGoal.trim(),
                    acceptance,
                    workspaceDir: editWorkspace.trim()
                  })
                  setEditing(false)
                },
                style: {
                  padding: '7px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#2f6fed',
                  color: '#fff',
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                  cursor: 'pointer'
                }
              },
              '保存'
            )
          )
        )
      : h('div', { style: { fontSize: 13, color: MUTED, lineHeight: 1.7, marginBottom: 10 } },
          room.goal),

    // 成本条
    h(
      'div',
      { style: { marginBottom: 16 } },
      h(
        'div',
        {
          style: {
            height: 6,
            borderRadius: 3,
            background: 'rgba(128,128,128,0.18)',
            overflow: 'hidden'
          }
        },
        h('div', {
          style: {
            width: `${(ratio * 100).toFixed(1)}%`,
            height: '100%',
            background: ratio > 0.8 ? '#e5484d' : '#2f6fed',
            transition: 'width .3s'
          }
        })
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED, marginTop: 4 } },
        h('span', {}, '已用 ' + formatTokens(spent)),
        spent >= cap && cap > 0
          ? h('span', { style: { color: '#e5484d' } }, '预算已用尽，Bot 不再执行')
          : h('span', {}, '预算 ' + formatTokens(cap))
      )
    ),

    h(SectionTitle, { key: 'a' }, '验收标准'),
    h(
      'ul',
      { style: { margin: '0 0 18px', paddingLeft: 18, fontSize: 13, lineHeight: 1.8 } },
      ...room.acceptance.map((item, index) => h('li', { key: index }, item))
    ),

    room.pendingPlan === undefined
      ? null
      : h(PlanBanner, {
          plan: room.pendingPlan,
          busy: props.planBusy,
          onDecide: props.onDecidePlan
        }),

    room.delivery === undefined ? null : h(DeliveryPanel, { delivery: room.delivery, roomId: room.id }),

    h(VersionsPanel, { versions: props.versions, onRollback: props.onRollback }),

    h(SectionTitle, { key: 'm' }, '消息流'),
    h(
      'div',
      {
        style: {
          flex: 1,
          minHeight: 120,
          overflow: 'auto',
          border: LINE,
          borderRadius: 8,
          padding: 12,
          marginBottom: 10
        }
      },
      messages.length === 0
        ? h('div', { style: { textAlign: 'center', color: MUTED, fontSize: 12, padding: '24px 0' } },
            '还没有消息。在下面说一句，Bot 就会接活。')
        : messages.map((m) =>
            h(MessageRow, {
              key: m.id,
              message: m,
              member: (room.members ?? []).find((x) => x.botId === m.botId)
            })
          ),
      sending
        ? h('div', { style: { color: MUTED, fontSize: 12, padding: '4px 2px' } }, 'Bot 正在处理…')
        : null
    ),

    error
      ? h('div', { style: { color: '#e5484d', fontSize: 12, marginBottom: 8 } }, error)
      : null,

    paused || archived
      ? h(
          'div',
          {
            style: {
              fontSize: 12,
              color: MUTED,
              padding: '9px 12px',
              borderRadius: 8,
              border: LINE,
              textAlign: 'center'
            }
          },
          paused
            ? returnOpen
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('div', { style: { fontSize: 12, color: MUTED } },
                    '你在接管期间改了什么？这句会写进房间，Bot 交还后能看到。'),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8 } },
                    h('input', {
                      autoFocus: true,
                      value: returnNote,
                      placeholder: '比如：改了 theme.css 的主色，新增了 dark.css',
                      onChange: (e: { target: { value: string } }) => setReturnNote(e.target.value),
                      onKeyDown: (e: { key: string }) => {
                        if (e.key === 'Enter') {
                          props.onTakeover('return', returnNote.trim())
                          setReturnOpen(false)
                          setReturnNote('')
                        }
                      },
                      style: {
                        flex: 1,
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: LINE,
                        background: 'transparent',
                        color: 'inherit',
                        fontSize: 13,
                        fontFamily: 'inherit'
                      }
                    }),
                    h(
                      'button',
                      {
                        onClick: () => {
                          props.onTakeover('return', returnNote.trim())
                          setReturnOpen(false)
                          setReturnNote('')
                        },
                        style: {
                          padding: '9px 16px',
                          borderRadius: 8,
                          border: 'none',
                          background: '#2f6fed',
                          color: '#fff',
                          fontSize: 13,
                          fontFamily: 'inherit',
                          cursor: 'pointer'
                        }
                      },
                      '交还'
                    )
                  )
                )
              : h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      color: MUTED,
                      padding: '9px 12px',
                      borderRadius: 8,
                      border: LINE,
                      textAlign: 'center'
                    }
                  },
                  '房间已暂停：可以点右上角「交还」写一句你改了什么。'
                )
            : h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: MUTED,
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: LINE,
                    textAlign: 'center'
                  }
                },
                '房间已归档，取消归档后才能继续说话。'
              )
        )
      : h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h('input', {
            value: draft,
            disabled: sending,
            placeholder: '说点什么，比如：把登录页改成暗色',
            onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
            onKeyDown: (e: { key: string }) => {
              if (e.key === 'Enter') submit()
            },
            style: {
              flex: 1,
              padding: '9px 12px',
              borderRadius: 8,
              border: LINE,
              background: 'transparent',
              color: 'inherit',
              fontSize: 13,
              fontFamily: 'inherit'
            }
          }),
          sending
            ? h(
                'button',
                {
                  onClick: () => props.onStop(),
                  style: {
                    padding: '9px 18px',
                    borderRadius: 8,
                    border: LINE,
                    background: 'transparent',
                    color: 'inherit',
                    fontSize: 13,
                    cursor: 'pointer'
                  }
                },
                '停止'
              )
            : h(
                'button',
                {
                  onClick: submit,
                  disabled: draft.trim() === '',
                  style: {
                    padding: '9px 18px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#2f6fed',
                    color: '#fff',
                    fontSize: 13,
                    cursor: draft.trim() === '' ? 'default' : 'pointer',
                    opacity: draft.trim() === '' ? 0.5 : 1
                  }
                },
                '发送'
              )
        )
  )
}

/** 顶部 tab 的样式。 */
function tabStyle(active: boolean): Record<string, string | number> {
  return {
    flex: 1,
    padding: '6px 0',
    borderRadius: 6,
    border: active ? 'none' : '1px solid rgba(128,128,128,0.25)',
    background: active ? 'rgba(128,128,128,0.18)' : 'transparent',
    color: 'inherit',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer'
  }
}

export function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'rooms' | 'bots'>('rooms')
  const [bots, setBots] = useState<BotCard[]>([])
  const [botId, setBotId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)


  const refreshBots = useCallback(async () => {
    try {
      setBots(await listBots())
    } catch {
      setBots([])
    }
  }, [])

  useEffect(() => {
    if (view === 'bots') void refreshBots()
  }, [view, refreshBots])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listRooms()
      setRooms(list)
      setSelectedId((current) => current ?? list[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selected = rooms.find((room) => room.id === selectedId) ?? null

  // 切房间时把消息读出来
  useEffect(() => {
    if (selectedId === null) {
      setMessages([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await listMessages(selectedId)
        if (!cancelled) setMessages(list)
      } catch {
        if (!cancelled) setMessages([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // 房间状态走 SSE：一条长连接，服务端有变化就推
  useEffect(() => {
    if (selectedId === null || typeof EventSource === 'undefined') return
    let source: EventSource | undefined
    try {
      source = new EventSource(`dshbot/api/rooms/${selectedId}/events`)
      source.onmessage = (event: MessageEvent<string>) => {
        try {
          const room = JSON.parse(event.data) as Room
          if (room?.id === undefined) return
          setRooms((list) => list.map((r) => (r.id === room.id ? room : r)))
          // 跑完了就把新消息补上
          if (room.status !== 'working') {
            void listMessages(selectedId).then(setMessages).catch(() => undefined)
          }
        } catch {
          /* 单帧坏了不影响后续 */
        }
      }
      source.addEventListener('gone', () => {
        source?.close()
      })
    } catch {
      source = undefined
    }
    return () => source?.close()
  }, [selectedId])

  const send = useCallback(
    async (text: string) => {
      if (selectedId === null) return
      setSending(true)
      setSendError(null)

      // 跑的过程里定时刷新房间，状态灯才会动
      const ticker = setInterval(() => {
        void (async () => {
          try {
            const list = await listRooms()
            setRooms(list)
          } catch {
            /* 轮询失败不打断 */
          }
        })()
      }, 1500)

      try {
        const created = await say(selectedId, text)
        setMessages((prev) => [
          ...prev,
          ...created.filter((m) => !prev.some((p) => p.id === m.id))
        ])
        // 本轮花了 token，把房间对象刷新一下，成本条才动
        try {
          const list = await listRooms()
          setRooms(list)
        } catch {
          /* 刷新失败不影响这轮结果 */
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '发送失败'
        setSendError(message)
        // 失败时用户消息已经落盘，重新拉一次保持一致
        try {
          setMessages(await listMessages(selectedId))
        } catch {
          /* 忽略二次失败 */
        }
      } finally {
        clearInterval(ticker)
        setSending(false)
      }
    },
    [selectedId]
  )

  // 暂停 / 恢复 / 归档 / 仅@：改完把房间对象换掉
  const changeState = useCallback(    async (action: 'pause' | 'resume' | 'archive' | 'unarchive' | 'toggleMentionOnly') => {
      if (selectedId === null) return
      try {
        const updated = await setRoomState(selectedId, action)
        setRooms((list) => list.map((r) => (r.id === updated.id ? updated : r)))
        setSendError(null)
      } catch (err) {
        setSendError(err instanceof Error ? err.message : '操作失败')
      }
    },
    [selectedId]
  )


  // 交付验收
  const runDelivery = useCallback(async () => {
    if (selectedId === null) return    setDelivering(true)
    setSendError(null)
    try {
      const delivery = await deliver(selectedId)
      setRooms((list) =>
        list.map((r) => (r.id === selectedId ? { ...r, delivery } : r))
      )
      setMessages(await listMessages(selectedId))
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '验收失败')
    } finally {
      setDelivering(false)
    }
  }, [selectedId])

  // 接管 / 交还
  const changeTakeover = useCallback(
    async (action: 'take' | 'return', note?: string) => {
      if (selectedId === null) return
      try {
        const result = await takeover(selectedId, action, note)
        setRooms((list) => list.map((r) => (r.id === result.room.id ? result.room : r)))
        setMessages(await listMessages(selectedId))
        setSendError(null)
      } catch (err) {
        setSendError(err instanceof Error ? err.message : '操作失败')
      }
    },
    [selectedId]
  )

  // 停止当前这一轮
  const stopRun = useCallback(async () => {
    if (selectedId === null) return
    try {
      await stop(selectedId)
      setSending(false)
      setMessages(await listMessages(selectedId))
      const list = await listRooms()
      setRooms(list)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '停止失败')
    }
  }, [selectedId])

  // 版本：读列表 + 回滚
  const [versions, setVersions] = useState<VersionEntry[]>([])

  useEffect(() => {
    if (selectedId === null) {
      setVersions([])
      return
    }
    let cancelled = false
    void listVersions(selectedId)
      .then((list) => {
        if (!cancelled) setVersions(list)
      })
      .catch(() => {
        if (!cancelled) setVersions([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, messages.length])

  const doRollback = useCallback(
    async (hash: string) => {
      if (selectedId === null) return
      try {
        await rollback(selectedId, hash)
        setMessages(await listMessages(selectedId))
        setVersions(await listVersions(selectedId))
        setSendError(null)
      } catch (err) {
        setSendError(err instanceof Error ? err.message : '回滚失败')
      }
    },
    [selectedId]
  )

  // 批准 / 否决计划
  const [planBusy, setPlanBusy] = useState(false)
  const decidePlanHandler = useCallback(
    async (action: 'approve' | 'reject', itemIds?: string[]) => {
      if (selectedId === null) return
      setPlanBusy(true)
      setSendError(null)
      try {
        const result = await decidePlan(selectedId, action, itemIds)
        setMessages(await listMessages(selectedId))
        const list = await listRooms()
        setRooms(list)
        void result
      } catch (err) {
        setSendError(err instanceof Error ? err.message : '操作失败')
      } finally {
        setPlanBusy(false)
      }
    },
    [selectedId]
  )

  // 改房间
  const editRoom = useCallback(
    async (input: { name: string; goal: string; acceptance: string[]; workspaceDir: string }) => {
      if (selectedId === null) return
      try {
        // 留空表示不动工作目录（不能把它改成空，那会让 Bot 无处落文件）
        const patch =
          input.workspaceDir === ''
            ? { name: input.name, goal: input.goal, acceptance: input.acceptance }
            : input
        const room = await updateRoom(selectedId, patch)
        setRooms((list) => list.map((r) => (r.id === room.id ? room : r)))
        setSendError(null)
      } catch (err) {
        setSendError(err instanceof Error ? err.message : '保存失败')
      }
    },
    [selectedId]
  )

  // 删房间
  const removeRoom = useCallback(async () => {
    if (selectedId === null) return
    try {
      await deleteRoom(selectedId)
      const list = await listRooms()
      setRooms(list)
      setSelectedId(list[0]?.id ?? null)
      setSendError(null)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '删除失败')
    }
  }, [selectedId])

  // 导出 Markdown
  const exportRoom = useCallback(() => {
    const room = rooms.find((r) => r.id === selectedId)
    if (room === undefined) return
    const md = buildMarkdown(room, messages)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${room.name}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [rooms, selectedId, messages])

  // 导出审计 JSONL
  const exportAudit = useCallback(async () => {
    if (selectedId === null) return
    const room = rooms.find((r) => r.id === selectedId)
    try {
      const text = await fetchAudit(selectedId)
      const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${room?.name ?? selectedId}.audit.jsonl`
      a.click()
      URL.revokeObjectURL(url)
      setSendError(null)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '导出审计失败')
    }
  }, [rooms, selectedId])

  return h(
    'div',
    { style: { display: 'flex', height: '100%', minHeight: 0, fontFamily: 'inherit' } },

    // 左：房间 / Bot 库
    h(
      'div',
      {
        style: {
          width: 224,
          flexShrink: 0,
          borderRight: LINE,
          padding: 12,
          boxSizing: 'border-box',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }
      },
      h(
        'div',
        { style: { display: 'flex', gap: 4, marginBottom: 10 } },
        h(
          'button',
          {
            onClick: () => setView('rooms'),
            style: tabStyle(view === 'rooms')
          },
          '房间'
        ),
        h(
          'button',
          {
            onClick: () => setView('bots'),
            style: tabStyle(view === 'bots')
          },
          'Bot 库'
        )
      ),

      view === 'rooms'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } },
            h(
              'button',
              {
                onClick: () => {
                  setCreating(true)
                  setSelectedId(null)
                },
                style: {
                  width: '100%',
                  padding: '7px 10px',
                  marginBottom: 10,
                  borderRadius: 6,
                  border: LINE,
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer'
                }
              },
              '＋ 新建房间'
            ),
            loading
              ? h('div', { style: { fontSize: 12, color: MUTED } }, '读取中…')
              : rooms.length === 0
                ? h('div', { style: { fontSize: 12, color: MUTED, lineHeight: 1.7 } }, '还没有房间')
                : rooms.map((room) =>
                    h(
                      'button',
                      {
                        key: room.id,
                        onClick: () => {
                          setCreating(false)
                          setSelectedId(room.id)
                        },
                        style: {
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 10px',
                          marginBottom: 4,
                          borderRadius: 6,
                          border: 'none',
                          background:
                            !creating && selectedId === room.id
                              ? 'rgba(128,128,128,0.18)'
                              : 'transparent',
                          color: 'inherit',
                          cursor: 'pointer',
                          fontSize: 13
                        }
                      },
                      room.name,
                      h('span', { style: { color: MUTED, marginLeft: 8, fontSize: 11 } },
                        STATUS_LABEL[room.status] ?? room.status)
                    )
                  )
          )
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } },
            h(
              'button',
              {
                onClick: () => setBotId(null),
                style: {
                  width: '100%',
                  padding: '7px 10px',
                  marginBottom: 10,
                  borderRadius: 6,
                  border: LINE,
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer'
                }
              },
              '＋ 新建 Bot'
            ),
            bots.length === 0
              ? h('div', { style: { fontSize: 12, color: MUTED, lineHeight: 1.7 } }, '库里还没有 Bot')
              : bots.map((bot) =>
                  h(
                    'button',
                    {
                      key: bot.id,
                      onClick: () => setBotId(bot.id),
                      style: {
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        marginBottom: 4,
                        borderRadius: 6,
                        border: 'none',
                        background: botId === bot.id ? 'rgba(128,128,128,0.18)' : 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        fontSize: 13
                      }
                    },
                    `${bot.avatar} ${bot.name}`,
                    bot.expertise === undefined
                      ? null
                      : h(
                          'div',
                          { style: { color: MUTED, fontSize: 10.5, marginTop: 2 } },
                          bot.expertise
                        )
                  )
                )
          )
    ),

    // 中：内容
    h(
      'div',
      { style: { flex: 1, minWidth: 0, padding: 24, boxSizing: 'border-box', overflow: 'auto' } },
      view === 'bots'
        ? h(BotLibraryView, {
            bots,
            selectedId: botId,
            onSelect: (id: string | null) => setBotId(id),
            onChanged: () => void refreshBots()
          })
        : error
          ? h('div', { style: { color: '#e5484d', fontSize: 13 } },
              '读取房间失败：' + error,
              h('div', { style: { color: MUTED, fontSize: 12, marginTop: 8 } },
                '确认插件已加载：宿主日志里应有 [dshbot] host side loaded。'))
          : creating
            ? h(CreateForm, {
                onCancel: () => setCreating(false),
                onCreated: (room: Room) => {
                  setCreating(false)
                  setRooms((list) => [room, ...list])
                  setSelectedId(room.id)
                }
              })
            : selected
              ? h(RoomDetail, {
                  room: selected,
                  messages,
                  sending,
                  delivering,
                  error: sendError,
                  onSend: (text: string) => void send(text),
                  onState: (action: string) =>
                    void changeState(action as Parameters<typeof changeState>[0]),
                  onDeliver: () => void runDelivery(),
                  onTakeover: (action: 'take' | 'return', note?: string) =>
                    void changeTakeover(action, note),
                  onStop: () => void stopRun(),
                  onEdit: (input: {
                    name: string
                    goal: string
                    acceptance: string[]
                    workspaceDir: string
                  }) => void editRoom(input),
                  onDelete: () => void removeRoom(),
                  onExport: () => exportRoom(),
                  onExportAudit: () => void exportAudit(),
                  versions,
                  onRollback: (hash: string) => void doRollback(hash),
                  onDecidePlan: (action: 'approve' | 'reject', itemIds?: string[]) =>
                    void decidePlanHandler(action, itemIds),
                  planBusy
                })
              : h(
                  'div',
                  { style: { display: 'grid', placeItems: 'center', height: '100%', color: MUTED } },
                  h(
                    'div',
                    { style: { textAlign: 'center', maxWidth: 380, fontSize: 13, lineHeight: 1.8 } },
                    '还没有房间',
                    h('br'),
                    '建一个房间，拉几个 Bot 进来，说一句话，它们分头干活。'
                  )
                )
    ),

    // 右：成员（Bot 库视图不需要）
    view === 'rooms'
      ? h(MemberPanel, {
          room: selected,
          onRoomChange: (room: Room) =>
            setRooms((list) => list.map((r) => (r.id === room.id ? room : r))),
          onOpenLibrary: () => setView('bots')
        })
      : null
  )
}

/** 右侧成员面板：成员卡 + 拉人入口。 */
/** 侧栏图标。 */
export function RoomsIcon() {
  return h('span', { style: { fontSize: 16, lineHeight: 1 } }, '\u{1F3E0}')
}
