import { createElement as h, useCallback, useEffect, useState } from 'react'
import type { Delivery, Member, Message, Room } from '@dshbot/core'
import { addMember, createRoom, deliver, listMessages, listRooms, say, setRoomState, takeover } from './api'

/**
 * 房间页。
 *
 * M0-3 范围：建房、列房间、在房间里说话并看到 Bot 回话。
 * 工具动作折叠、状态灯、审批在后续里程碑接。
 */

const MUTED = 'rgba(128,128,128,0.72)'
const LINE = '1px solid rgba(128,128,128,0.25)'

/** 把 token 数压成 1.2k / 3.4M 这种。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k'
  return String(value)
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
          .filter(Boolean)
      })
      props.onCreated(room)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }, [name, goal, acceptance, props])

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
        placeholder: '暗色主题下对比度符合 WCAG AA\n现有测试全绿',
        rows: 3,
        style: { ...inputStyle, resize: 'vertical' }
      })
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
    status === 'done' ? '完成' : status === 'failed' ? '失败' : status === 'running' ? '进行中' : status
  const color = status === 'done' ? '#2f9e44' : status === 'failed' ? '#e5484d' : '#2f6fed'

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
            whiteSpace: 'pre-wrap',
            background: mine ? 'rgba(47,111,237,0.14)' : 'rgba(128,128,128,0.12)'
          }
        },
        message.text
      )
    )
  )
}

/** 交付结论面板。 */
function DeliveryPanel(props: { delivery: Delivery }) {
  const { delivery } = props
  const passed = delivery.checks.filter((c) => c.verdict === 'pass').length
  const icon = (v: string) => (v === 'pass' ? '✅' : v === 'fail' ? '❌' : '❓')

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
        (delivery.changedFiles.length === 0 ? '' : '：' + delivery.changedFiles.slice(0, 6).join('、')) +
        `　·　本次验收花费 ${formatTokens(delivery.tokensUsed)}`
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
}) {
  const { room, messages, sending, error } = props
  const [draft, setDraft] = useState('')
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnNote, setReturnNote] = useState('')

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
      actionButton(props.delivering ? '验收中…' : '交付验收', 'deliver', () => props.onDeliver()),
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
      )
    ),
    h('div', { style: { fontSize: 13, color: MUTED, lineHeight: 1.7, marginBottom: 10 } },
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
        h('span', {}, '预算 ' + formatTokens(cap))
      )
    ),

    h(SectionTitle, { key: 'a' }, '验收标准'),
    h(
      'ul',
      { style: { margin: '0 0 18px', paddingLeft: 18, fontSize: 13, lineHeight: 1.8 } },
      ...room.acceptance.map((item, index) => h('li', { key: index }, item))
    ),

    room.delivery === undefined ? null : h(DeliveryPanel, { delivery: room.delivery }),

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
          h(
            'button',
            {
              onClick: submit,
              disabled: sending || draft.trim() === '',
              style: {
                padding: '9px 18px',
                borderRadius: 8,
                border: 'none',
                background: '#2f6fed',
                color: '#fff',
                fontSize: 13,
                cursor: sending || draft.trim() === '' ? 'default' : 'pointer',
                opacity: sending || draft.trim() === '' ? 0.5 : 1
              }
            },
            sending ? '…' : '发送'
          )
        )
  )
}

export function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

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

  // 拉一只 Bot 进房间
  const addBot = useCallback(
    async (name: string) => {
      if (selectedId === null) return
      try {
        const result = await addMember(selectedId, { name })
        setRooms((list) => list.map((r) => (r.id === result.room.id ? result.room : r)))
        setSendError(null)
      } catch (err) {
        setSendError(err instanceof Error ? err.message : '拉人失败')
      }
    },
    [selectedId]
  )

  // 交付验收
  const runDelivery = useCallback(async () => {
    if (selectedId === null) return
    setDelivering(true)
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

  return h(
    'div',
    { style: { display: 'flex', height: '100%', minHeight: 0, fontFamily: 'inherit' } },

    // 左：房间列表
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
      h(SectionTitle, {}, '房间'),
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
    ),

    // 中：内容
    h(
      'div',
      { style: { flex: 1, minWidth: 0, padding: 24, boxSizing: 'border-box', overflow: 'auto' } },
      error
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
                  void changeTakeover(action, note)
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

    // 右：成员
    h(MemberPanel, { room: selected, onAdd: (name: string) => void addBot(name) })
  )
}

/** 右侧成员面板：成员卡 + 拉人入口。 */
function MemberPanel(props: { room: Room | null; onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const members = props.room?.members ?? []

  const submit = () => {
    const value = name.trim()
    if (value === '') return
    setName('')
    setOpen(false)
    props.onAdd(value)
  }

  return h(
    'div',
    { style: { width: 220, flexShrink: 0, padding: 12, boxSizing: 'border-box', overflow: 'auto' } },
    h(SectionTitle, {}, `成员（${members.length}）`),

    members.length === 0
      ? h('div', { style: { fontSize: 12, color: MUTED, lineHeight: 1.7 } }, '暂无 Bot')
      : members.map((m) => h(MemberCard, { key: m.botId, member: m })),

    props.room === null
      ? null
      : open
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
            h('input', {
              autoFocus: true,
              value: name,
              placeholder: 'Bot 名字，如「老周」',
              onChange: (e: { target: { value: string } }) => setName(e.target.value),
              onKeyDown: (e: { key: string }) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setOpen(false)
              },
              style: {
                padding: '6px 8px',
                borderRadius: 6,
                border: LINE,
                background: 'transparent',
                color: 'inherit',
                fontSize: 12,
                fontFamily: 'inherit'
              }
            }),
            h(
              'div',
              { style: { display: 'flex', gap: 6 } },
              h(
                'button',
                {
                  onClick: submit,
                  style: {
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: 6,
                    border: 'none',
                    background: '#2f6fed',
                    color: '#fff',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    cursor: 'pointer'
                  }
                },
                '加入'
              ),
              h(
                'button',
                {
                  onClick: () => setOpen(false),
                  style: {
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: 6,
                    border: LINE,
                    background: 'transparent',
                    color: 'inherit',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    cursor: 'pointer'
                  }
                },
                '取消'
              )
            )
          )
        : h(
            'button',
            {
              onClick: () => setOpen(true),
              style: {
                width: '100%',
                marginTop: 4,
                padding: '6px 0',
                borderRadius: 6,
                border: LINE,
                background: 'transparent',
                color: 'inherit',
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: 'pointer'
              }
            },
            '＋ 拉一个 Bot'
          ),

    h('div', { style: { marginTop: 12, fontSize: 11, color: 'rgba(128,128,128,0.55)' } },
      '状态灯：空闲 / 思考中 / 操作中 / 排队 / 出错')
  )
}

/** 成员卡：头像、名字、状态灯、活动、花费。 */
function MemberCard(props: { member: Member }) {
  const { member } = props
  const dot = STATUS_COLOR[member.status] ?? '#999'
  return h(
    'div',
    {
      style: {
        padding: '8px 10px',
        marginBottom: 8,
        borderRadius: 8,
        border: LINE,
        background: 'rgba(128,128,128,0.04)'
      }
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
      h('span', { style: { fontSize: 15 } }, member.avatar),
      h('span', { style: { fontSize: 13 } }, member.name),
      member.role === 'host'
        ? h('span', { style: { fontSize: 10, color: MUTED, border: LINE, borderRadius: 3, padding: '0 3px' } }, '总管')
        : null
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED } },
      h('span', {
        style: { width: 6, height: 6, borderRadius: 3, background: dot, display: 'inline-block' }
      }),
      h('span', {}, STATUS_TEXT[member.status] ?? member.status),
      member.activity ? h('span', { style: { opacity: 0.7 } }, '· ' + member.activity) : null
    ),
    h('div', { style: { fontSize: 10.5, color: 'rgba(128,128,128,0.6)', marginTop: 4 } },
      '已用 ' + formatTokens(member.tokensUsed ?? 0))
  )
}

/** 侧栏图标。 */
export function RoomsIcon() {
  return h('span', { style: { fontSize: 16, lineHeight: 1 } }, '\u{1F3E0}')
}
