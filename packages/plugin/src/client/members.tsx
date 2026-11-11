/**
 * Bot 库 + 临时拉人。
 *
 * 两种用法：
 * 1. 房间外设定好角色卡（存库里），房间里一键拉入；
 * 2. 房间里临时建一个，只在这个房间生效。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Room } from '@dshbot/core'
import { addMember, listBots, listPresets, saveBot, splitBotText } from './api'
import type { BotCard, PresetEntry } from './api'
import { createElement as h } from 'react'
import type { Member } from '@dshbot/core'

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

function formatTokens(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k'
  return String(Math.round(value))
}
const LINE = '1px solid rgba(128,128,128,0.25)'
const MUTED = 'rgba(128,128,128,0.72)'

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

/** 角色卡表单：可存库，也可只加进当前房间。 */
function BotForm(props: {
  roomId: string
  seeded?: BotCard
  onDone: (room: Room) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(props.seeded?.name ?? '')
  const [role, setRole] = useState<'host' | 'worker'>('worker')
  const [persona, setPersona] = useState(props.seeded?.persona ?? '')
  const [expertise, setExpertise] = useState(props.seeded?.expertise ?? '')
  const [instructions, setInstructions] = useState(props.seeded?.instructions ?? '')
  const [preset, setPreset] = useState(props.seeded?.agentPreset ?? '')
  const [presets, setPresets] = useState<PresetEntry[]>([])
  const [splitting, setSplitting] = useState(false)
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
    try {
      const result = await splitBotText(persona)
      if (result.expertise !== '') setExpertise(result.expertise)
      if (result.instructions !== '') setInstructions(result.instructions)
      // 拆分后岗位只留"身份"部分，避免三段内容重复
      if (result.persona !== '' && result.persona !== persona) setPersona(result.persona)
      setNote('已自动拆分，请检查后再保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '拆分失败')
    } finally {
      setSplitting(false)
    }
  }, [persona])

  const submit = useCallback(
    async (saveToLibrary: boolean) => {
      if (name.trim() === '') {
        setError('名字不能为空')
        return
      }
      try {
        setError(null)
        let defId: string | undefined
        if (saveToLibrary) {
          const bot = await saveBot({
            name: name.trim(),
            ...(persona === '' ? {} : { persona }),
            ...(expertise === '' ? {} : { expertise }),
            ...(instructions === '' ? {} : { instructions }),
            ...(preset === '' ? {} : { agentPreset: preset })
          })
          defId = bot.id
        }
        const result = await addMember(props.roomId, {
          name: name.trim(),
          role,
          ...(defId === undefined ? {} : { defId }),
          ...(persona === '' ? {} : { persona }),
          ...(expertise === '' ? {} : { expertise }),
          ...(instructions === '' ? {} : { instructions }),
          ...(preset === '' ? {} : { agentPreset: preset })
        })
        props.onDone(result.room)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加入失败')
      }
    },
    [name, role, persona, expertise, instructions, preset, props]
  )

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 } },
    h('input', {
      autoFocus: true,
      value: name,
      placeholder: '名字，如「老周」',
      onChange: (e: { target: { value: string } }) => setName(e.target.value),
      style: field
    }),
    h(
      'div',
      { style: { display: 'flex', gap: 6 } },
      h(
        'select',
        {
          value: role,
          onChange: (e: { target: { value: string } }) =>
            setRole(e.target.value === 'host' ? 'host' : 'worker'),
          style: { ...field, flex: 1 }
        },
        h('option', { value: 'worker' }, '执行'),
        h('option', { value: 'host' }, '总管')
      ),
      h(
        'select',
        {
          value: preset,
          onChange: (e: { target: { value: string } }) => setPreset(e.target.value),
          style: { ...field, flex: 1 }
        },
        h('option', { value: '' }, '工具：默认'),
        ...presets.map((item) => h('option', { key: item.id, value: item.id }, item.label))
      )
    ),
    h('textarea', {
      value: persona,
      rows: 5,
      placeholder: '岗位描述：他是谁、擅长什么、怎么干活。\n可以直接粘一大段，然后点「自动拆分」',
      onChange: (e: { target: { value: string } }) => setPersona(e.target.value),
      style: { ...field, resize: 'vertical' }
    }),
    h(
      'div',
      { style: { display: 'flex', gap: 6 } },
      h(
        'button',
        {
          onClick: () => void split(),
          disabled: splitting || persona.trim() === '',
          style: {
            flex: 1,
            padding: '5px 0',
            borderRadius: 6,
            border: LINE,
            background: 'transparent',
            color: 'inherit',
            fontSize: 11.5,
            fontFamily: 'inherit',
            cursor: splitting ? 'default' : 'pointer',
            opacity: splitting || persona.trim() === '' ? 0.5 : 1
          }
        },
        splitting ? '拆分中…' : '自动拆分'
      ),
      h('input', {
        value: expertise,
        placeholder: '一句话专长（总管据此派人）',
        onChange: (e: { target: { value: string } }) => setExpertise(e.target.value),
        style: { ...field, flex: 2 }
      })
    ),
    h('textarea', {
      value: instructions,
      rows: 2,
      placeholder: '输出要求：格式、长度、必须包含什么',
      onChange: (e: { target: { value: string } }) => setInstructions(e.target.value),
      style: { ...field, resize: 'vertical' }
    }),
    note === null
      ? null
      : h('div', { style: { fontSize: 11, color: '#2f9e44' } }, note),
    error === null ? null : h('div', { style: { fontSize: 11, color: '#e5484d' } }, error),
    h(
      'div',
      { style: { display: 'flex', gap: 6 } },
      h(
        'button',
        {
          onClick: () => void submit(false),
          style: {
            flex: 1,
            padding: '5px 0',
            borderRadius: 6,
            border: 'none',
            background: '#2f6fed',
            color: '#fff',
            fontSize: 11.5,
            fontFamily: 'inherit',
            cursor: 'pointer'
          }
        },
        '仅加入'
      ),
      h(
        'button',
        {
          onClick: () => void submit(true),
          style: {
            flex: 1,
            padding: '5px 0',
            borderRadius: 6,
            border: LINE,
            background: 'transparent',
            color: 'inherit',
            fontSize: 11.5,
            fontFamily: 'inherit',
            cursor: 'pointer'
          }
        },
        '存入库并加入'
      ),
      h(
        'button',
        {
          onClick: props.onCancel,
          style: { ...field, flex: 1, cursor: 'pointer', textAlign: 'center' as const }
        },
        '取消'
      )
    )
  )
}

/** 成员面板：现有成员 + Bot 库 + 拉人入口。 */
export function MemberPanel(props: { room: Room | null; onRoomChange: (room: Room) => void }) {
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
                  h('div', { style: { fontSize: 11, color: MUTED } }, 'Bot 库'),
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
                  )
                ),
            h(
              'div',
              { style: { fontSize: 11, color: MUTED, marginTop: 4 } },
              library.length === 0 ? '临时建一个' : '或者临时建一个'
            ),
            h(BotForm, {
              roomId: props.room.id,
              onDone: (room: Room) => {
                props.onRoomChange(room)
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
    member.expertise === undefined || member.expertise === ''
      ? null
      : h('div', { style: { fontSize: 10.5, color: '#2f9e44', marginTop: 2 } }, member.expertise),
    h('div', { style: { fontSize: 10.5, color: 'rgba(128,128,128,0.6)', marginTop: 4 } },
      '已用 ' + formatTokens(member.tokensUsed ?? 0))
  )
}

