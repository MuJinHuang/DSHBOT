/**
 * Bot 库与成员面板。
 *
 * 两种用法：
 * 1. 房间外：独立的 Bot 库页面，建/改/删角色卡；
 * 2. 房间内：从库里拉人，或临时建一个只在本房间生效的。
 */
import { useCallback, useEffect, useState } from 'react'
import { createElement as h } from 'react'
import type { Member, Room } from '@dshbot/core'
import {
  addMember,
  deleteBot,
  listBots,
  listPresets,
  saveBot,
  splitBotText,
  updateBot
} from './api'
import type { BotCard, PresetEntry } from './api'

const LINE = '1px solid rgba(128,128,128,0.25)'
const MUTED = 'rgba(128,128,128,0.72)'

const STATUS_COLOR: Record<string, string> = {
  idle: '#9aa0a6',
  queued: '#e8a33d',
  thinking: '#2f6fed',
  waiting_human: '#b45fd8',
  error: '#e5484d'
}

const STATUS_TEXT: Record<string, string> = {
  idle: '空闲',
  queued: '排队中',
  thinking: '处理中',
  waiting_human: '等人',
  error: '出错'
}

/** 把 token 数压成 1.2k / 3.4M 这种。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k'
  return String(Math.round(value))
}

const field: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 6,
  border: LINE,
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  fontFamily: 'inherit'
}

const smallButton = (primary: boolean): Record<string, string | number> => ({
  flex: 1,
  padding: '6px 0',
  borderRadius: 6,
  border: primary ? 'none' : LINE,
  background: primary ? '#2f6fed' : 'transparent',
  color: primary ? '#fff' : 'inherit',
  fontSize: 11.5,
  fontFamily: 'inherit',
  cursor: 'pointer'
})

/**
 * 角色卡表单。
 *
 * 有 roomId 时多一个「加入房间」；没有 roomId 就是纯粹的库编辑。
 */
export function BotForm(props: {
  initial?: BotCard
  roomId?: string
  onSaved: (result: { bot?: BotCard; room?: Room }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(props.initial?.name ?? '')
  const [avatar, setAvatar] = useState(props.initial?.avatar ?? '🤖')
  const [role, setRole] = useState<'host' | 'worker'>('worker')
  const [persona, setPersona] = useState(props.initial?.persona ?? '')
  const [expertise, setExpertise] = useState(props.initial?.expertise ?? '')
  const [instructions, setInstructions] = useState(props.initial?.instructions ?? '')
  const [preset, setPreset] = useState(props.initial?.agentPreset ?? '')
  const [presets, setPresets] = useState<PresetEntry[]>([])
  const [splitting, setSplitting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void listPresets()
      .then(setPresets)
      .catch(() => setPresets([]))
  }, [])

  // 把一大段话拆成三块，拆完还能手改
  const split = useCallback(async () => {
    if (persona.trim() === '') return
    setSplitting(true)
    setError(null)
    setNote(null)
    try {
      const result = await splitBotText(persona)
      if (result.expertise !== '') setExpertise(result.expertise)
      if (result.instructions !== '') setInstructions(result.instructions)
      if (result.persona !== '' && result.persona !== persona) setPersona(result.persona)
      setNote('已自动拆分，请检查后再保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '拆分失败')
    } finally {
      setSplitting(false)
    }
  }, [persona])

  const payload = useCallback(
    (): Partial<BotCard> & { name: string } => ({
      name: name.trim(),
      avatar,
      persona,
      expertise,
      instructions,
      ...(preset === '' ? {} : { agentPreset: preset })
    }),
    [name, avatar, persona, expertise, instructions, preset]
  )

  const run = useCallback(
    async (mode: 'save' | 'join') => {
      if (name.trim() === '') {
        setError('名字不能为空')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const bot =
          props.initial === undefined
            ? await saveBot(payload())
            : await updateBot(props.initial.id, payload())

        if (mode === 'save' || props.roomId === undefined) {
          props.onSaved({ bot })
          return
        }
        const result = await addMember(props.roomId, { defId: bot.id, role })
        props.onSaved({ bot, room: result.room })
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存失败')
      } finally {
        setBusy(false)
      }
    },
    [name, payload, props, role]
  )

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    h(
      'div',
      { style: { display: 'flex', gap: 6 } },
      h('input', {
        value: avatar,
        onChange: (e: { target: { value: string } }) => setAvatar(e.target.value),
        style: { ...field, width: 46, textAlign: 'center' as const }
      }),
      h('input', {
        autoFocus: props.initial === undefined,
        value: name,
        placeholder: '名字，如「老周」',
        onChange: (e: { target: { value: string } }) => setName(e.target.value),
        style: { ...field, flex: 1 }
      })
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 6 } },
      h(
        'select',
        {
          value: preset,
          onChange: (e: { target: { value: string } }) => setPreset(e.target.value),
          style: { ...field, flex: 2 }
        },
        h('option', { value: '' }, '工具集：跟随房间默认'),
        ...presets.map((item) => h('option', { key: item.id, value: item.id }, item.label))
      ),
      props.roomId === undefined
        ? null
        : h(
            'select',
            {
              value: role,
              onChange: (e: { target: { value: string } }) =>
                setRole(e.target.value === 'host' ? 'host' : 'worker'),
              style: { ...field, flex: 1 }
            },
            h('option', { value: 'worker' }, '执行'),
            h('option', { value: 'host' }, '总管')
          )
    ),
    h('textarea', {
      value: persona,
      rows: 8,
      placeholder:
        '岗位描述：他是谁、擅长什么、怎么干活。\n可以直接粘一大段（带「身份：」「专长：」「输出规范：」标签），再点「自动拆分」',
      onChange: (e: { target: { value: string } }) => setPersona(e.target.value),
      style: { ...field, resize: 'vertical', lineHeight: 1.6 }
    }),
    h(
      'div',
      { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      h(
        'button',
        {
          onClick: () => void split(),
          disabled: splitting || persona.trim() === '',
          style: { ...smallButton(false), flex: '0 0 96px', opacity: splitting ? 0.5 : 1 }
        },
        splitting ? '拆分中…' : '自动拆分'
      ),
      h('input', {
        value: expertise,
        placeholder: '一句话专长（总管据此派人）',
        onChange: (e: { target: { value: string } }) => setExpertise(e.target.value),
        style: { ...field, flex: 1 }
      })
    ),
    h('textarea', {
      value: instructions,
      rows: 3,
      placeholder: '输出要求：格式、长度、必须包含什么',
      onChange: (e: { target: { value: string } }) => setInstructions(e.target.value),
      style: { ...field, resize: 'vertical' }
    }),
    note === null ? null : h('div', { style: { fontSize: 11, color: '#2f9e44' } }, note),
    error === null ? null : h('div', { style: { fontSize: 11, color: '#e5484d' } }, error),
    h(
      'div',
      { style: { display: 'flex', gap: 6 } },
      h(
        'button',
        { onClick: () => void run('save'), disabled: busy, style: smallButton(true) },
        busy ? '保存中…' : props.initial === undefined ? '保存到库' : '保存修改'
      ),
      props.roomId === undefined
        ? null
        : h(
            'button',
            { onClick: () => void run('join'), disabled: busy, style: smallButton(false) },
            '保存并加入房间'
          ),
      h('button', { onClick: props.onCancel, style: smallButton(false) }, '取消')
    )
  )
}

/** 独立的 Bot 库页面：列表在上，编辑在下面。 */
export function BotLibraryView(props: {
  bots: BotCard[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChanged: () => void
}) {
  const selected = props.bots.find((bot) => bot.id === props.selectedId) ?? null
  const [error, setError] = useState<string | null>(null)

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
      h('div', { style: { fontSize: 17 } }, 'Bot 库'),
      h('div', { style: { fontSize: 12, color: MUTED } }, `${props.bots.length} 个`),
      h('div', { style: { flex: 1 } }),
      h(
        'button',
        {
          onClick: () => props.onSelect(null),
          style: {
            padding: '5px 12px',
            borderRadius: 6,
            border: LINE,
            background: 'transparent',
            color: 'inherit',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer'
          }
        },
        '＋ 新建 Bot'
      )
    ),
    error === null ? null : h('div', { style: { color: '#e5484d', fontSize: 12 } }, error),
    h(
      'div',
      { style: { flex: 1, overflow: 'auto', paddingRight: 4 } },
      props.selectedId === null
        ? h(
            'div',
            {
              style: {
                border: LINE,
                borderRadius: 8,
                padding: 14,
                maxWidth: 600,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }
            },
            h('div', { style: { fontSize: 13, marginBottom: 2 } }, '新建一个 Bot'),
            h(BotForm, {
              onSaved: () => {
                props.onChanged()
                props.onSelect(null)
              },
              onCancel: () => props.onSelect(null)
            })
          )
        : h(
            'div',
            {
              style: {
                border: LINE,
                borderRadius: 8,
                padding: 14,
                maxWidth: 640,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h(
                'div',
                { style: { fontSize: 14, fontWeight: 600 } },
                `${selected?.avatar ?? ''} ${selected?.name ?? ''}`
              ),
              h('div', { style: { flex: 1 } }),
              h(
                'button',
                {
                  onClick: () => {
                    if (selected === null) return
                    void deleteBot(selected.id)
                      .then(() => {
                        props.onChanged()
                        props.onSelect(null)
                      })
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : '删除失败')
                      )
                  },
                  style: {
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: LINE,
                    background: 'transparent',
                    color: '#e5484d',
                    fontSize: 11.5,
                    fontFamily: 'inherit',
                    cursor: 'pointer'
                  }
                },
                '删除'
              )
            ),
            selected === null
              ? null
              : h(BotForm, {
                  initial: selected,
                  onSaved: () => {
                    props.onChanged()
                    props.onSelect(selected.id)
                  },
                  onCancel: () => props.onSelect(selected.id)
                })
          )
    )
  )
}

/** 成员卡：头像、名字、专长、状态灯、花费。 */
export function MemberCard(props: { member: Member }) {
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
        ? h(
            'span',
            { style: { fontSize: 10, color: MUTED, border: LINE, borderRadius: 3, padding: '0 3px' } },
            '总管'
          )
        : null
    ),
    member.expertise === undefined || member.expertise === ''
      ? null
      : h('div', { style: { fontSize: 10.5, color: '#2f9e44', marginBottom: 2 } }, member.expertise),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED } },
      h('span', {
        style: { width: 6, height: 6, borderRadius: 3, background: dot, display: 'inline-block' }
      }),
      h('span', {}, STATUS_TEXT[member.status] ?? member.status),
      member.activity ? h('span', { style: { opacity: 0.7 } }, '· ' + member.activity) : null
    ),
    h(
      'div',
      { style: { fontSize: 10.5, color: 'rgba(128,128,128,0.6)', marginTop: 4 } },
      '已用 ' + formatTokens(member.tokensUsed ?? 0)
    )
  )
}

/** 房间右侧：成员 + 拉人。 */
export function MemberPanel(props: {
  room: Room | null
  onRoomChange: (room: Room) => void
  onOpenLibrary: () => void
}) {
  const [open, setOpen] = useState(false)
  const [library, setLibrary] = useState<BotCard[]>([])
  const members = props.room?.members ?? []

  useEffect(() => {
    void listBots()
      .then(setLibrary)
      .catch(() => setLibrary([]))
  }, [open])

  return h(
    'div',
    { style: { width: 220, flexShrink: 0, padding: 12, boxSizing: 'border-box', overflow: 'auto' } },
    h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 8 } }, `成员（${members.length}）`),

    members.length === 0
      ? h('div', { style: { fontSize: 12, color: MUTED, lineHeight: 1.7 } }, '暂无 Bot')
      : members.map((m) => h(MemberCard, { key: m.botId, member: m })),

    props.room === null
      ? null
      : open
        ? h(
            'div',
            {
              style: {
                border: LINE,
                borderRadius: 8,
                padding: 10,
                marginTop: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }
            },
            library.length === 0
              ? null
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  h('div', { style: { fontSize: 11, color: MUTED } }, '从 Bot 库拉'),
                  ...library.map((bot) =>
                    h(
                      'button',
                      {
                        key: bot.id,
                        onClick: () => {
                          void addMember(props.room!.id, { defId: bot.id })
                            .then((result) => {
                              props.onRoomChange(result.room)
                              setOpen(false)
                            })
                            .catch(() => undefined)
                        },
                        style: {
                          textAlign: 'left' as const,
                          padding: '4px 6px',
                          borderRadius: 6,
                          border: LINE,
                          background: 'transparent',
                          color: 'inherit',
                          fontSize: 11.5,
                          fontFamily: 'inherit',
                          cursor: 'pointer'
                        }
                      },
                      `${bot.avatar} ${bot.name}` + (bot.expertise ? ` · ${bot.expertise}` : '')
                    )
                  ),
                  h(
                    'button',
                    {
                      onClick: props.onOpenLibrary,
                      style: {
                        marginTop: 2,
                        padding: '2px 0',
                        borderRadius: 6,
                        border: 'none',
                        background: 'transparent',
                        color: MUTED,
                        fontSize: 11,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left' as const
                      }
                    },
                    '去 Bot 库管理 →'
                  )
                ),
            h(BotForm, {
              roomId: props.room.id,
              onSaved: ({ room }) => {
                if (room !== undefined) props.onRoomChange(room)
                setOpen(false)
              },
              onCancel: () => setOpen(false)
            })
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

    h(
      'div',
      { style: { marginTop: 12, fontSize: 11, color: 'rgba(128,128,128,0.55)' } },
      '状态灯：空闲 / 思考中 / 操作中 / 排队 / 出错'
    )
  )
}
