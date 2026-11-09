import { createElement as h, useCallback, useEffect, useState } from 'react'
import type { Message, Room } from '@dshbot/core'
import { createRoom, listMessages, listRooms, say } from './api'

/**
 * 房间页。
 *
 * M0-3 范围：建房、列房间、在房间里说话并看到 Bot 回话。
 * 工具动作折叠、状态灯、审批在后续里程碑接。
 */

const MUTED = 'rgba(128,128,128,0.72)'
const LINE = '1px solid rgba(128,128,128,0.25)'

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

/** 一条消息。 */
function MessageRow(props: { message: Message }) {
  const { message } = props
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
      {
        style: {
          maxWidth: '78%',
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
}

/** 房间详情：目标 + 验收 + 消息流 + 输入框。 */
function RoomDetail(props: {
  room: Room
  messages: Message[]
  sending: boolean
  error: string | null
  onSend: (text: string) => void
}) {
  const { room, messages, sending, error } = props
  const [draft, setDraft] = useState('')

  const submit = () => {
    const text = draft.trim()
    if (text === '' || sending) return
    setDraft('')
    props.onSend(text)
  }

  return h(
    'div',
    { style: { maxWidth: 680, display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 6 } },
      h('div', { style: { fontSize: 17 } }, room.name),
      h(Badge, {}, STATUS_LABEL[room.status] ?? room.status)
    ),
    h('div', { style: { fontSize: 13, color: MUTED, lineHeight: 1.7, marginBottom: 16 } },
      room.goal),

    h(SectionTitle, { key: 'a' }, '验收标准'),
    h(
      'ul',
      { style: { margin: '0 0 18px', paddingLeft: 18, fontSize: 13, lineHeight: 1.8 } },
      ...room.acceptance.map((item, index) => h('li', { key: index }, item))
    ),

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
        : messages.map((m) => h(MessageRow, { key: m.id, message: m })),
      sending
        ? h('div', { style: { color: MUTED, fontSize: 12, padding: '4px 2px' } }, 'Bot 正在处理…')
        : null
    ),

    error
      ? h('div', { style: { color: '#e5484d', fontSize: 12, marginBottom: 8 } }, error)
      : null,

    h(
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
      try {
        const created = await say(selectedId, text)
        setMessages((prev) => [
          ...prev,
          ...created.filter((m) => !prev.some((p) => p.id === m.id))
        ])
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
        setSending(false)
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
                error: sendError,
                onSend: (text: string) => void send(text)
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
    h(
      'div',
      {
        style: {
          width: 220,
          flexShrink: 0,
          padding: 12,
          boxSizing: 'border-box',
          overflow: 'auto'
        }
      },
      h(SectionTitle, {}, '成员'),
      h('div', { style: { fontSize: 12, color: MUTED, lineHeight: 1.7 } }, '暂无 Bot'),
      h('div', { style: { marginTop: 12, fontSize: 11, color: 'rgba(128,128,128,0.55)' } },
        '每个 Bot 会在这里显示状态灯：空闲 / 思考中 / 操作中 / 等审批')
    )
  )
}

/** 侧栏图标。 */
export function RoomsIcon() {
  return h('span', { style: { fontSize: 16, lineHeight: 1 } }, '\u{1F3E0}')
}
