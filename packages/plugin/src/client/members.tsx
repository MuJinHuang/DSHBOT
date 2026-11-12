/**
 * Bot 库与成员面板。
 *
 * 两种用法：
 * 1. 房间外：独立的 Bot 库页面，建/改/删角色卡；
 * 2. 房间内：从库里拉人，或临时建一个只在本房间生效的。
 */
import { useCallback, useEffect, useState } from 'react'
import { createElement as h } from 'react'
import type { ChangeEvent } from 'react'
import type { Member, Room } from '@dshbot/core'
import {
  addMember,
  deleteBot,
  deleteTeam,
  exportBot,
  importBot,
  listBots,
  listPresets,
  listTeams,
  removeMember,
  saveBot,
  saveTeam,
  splitBotText,
  updateBot,
  updateMember
} from './api'
import type { BotCard, PresetEntry, TeamTemplate } from './api'

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
          type: 'button',
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
        {
          type: 'button', onClick: () => void run('save'), disabled: busy, style: smallButton(true) },
        busy ? '保存中…' : props.initial === undefined ? '保存到库' : '保存修改'
      ),
      props.roomId === undefined
        ? null
        : h(
            'button',
            {
              type: 'button', onClick: () => void run('join'), disabled: busy, style: smallButton(false) },
            '保存并加入房间'
          ),
      h('button', { type: 'button', onClick: props.onCancel, style: smallButton(false) }, '取消')
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
  const [teams, setTeams] = useState<TeamTemplate[]>([])
  const [teamOpen, setTeamOpen] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamPick, setTeamPick] = useState<string[]>([])
  const [teamBusy, setTeamBusy] = useState(false)

  const refreshTeams = useCallback(async () => {
    try {
      setTeams(await listTeams())
    } catch {
      setTeams([])
    }
  }, [])

  useEffect(() => {
    void refreshTeams()
  }, [refreshTeams])

  const headerButton = (label: string, onClick: () => void) =>
    h(
      'button',
      {
        type: 'button',
        onClick,
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
      label
    )

  const download = async (bot: BotCard): Promise<void> => {
    try {
      const data = await exportBot(bot.id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${bot.name}.bot.json`
      a.click()
      URL.revokeObjectURL(url)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    }
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const bot = await importBot(parsed)
      props.onChanged()
      props.onSelect(bot.id)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      event.target.value = ''
    }
  }

  const saveTeamNow = async (): Promise<void> => {
    if (teamName.trim() === '') {
      setError('团队名不能为空')
      return
    }
    if (teamPick.length === 0) {
      setError('至少勾一只 Bot')
      return
    }
    setTeamBusy(true)
    try {
      await saveTeam({ name: teamName.trim(), botIds: teamPick })
      setTeamName('')
      setTeamPick([])
      setTeamOpen(false)
      await refreshTeams()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存团队失败')
    } finally {
      setTeamBusy(false)
    }
  }

  const removeTeam = async (teamId: string): Promise<void> => {
    try {
      await deleteTeam(teamId)
      await refreshTeams()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除团队失败')
    }
  }

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
      h('div', { style: { fontSize: 17 } }, 'Bot 库'),
      h('div', { style: { fontSize: 12, color: MUTED } }, `${props.bots.length} 个`),
      h('div', { style: { flex: 1 } }),
      headerButton(teamOpen ? '收起团队' : `团队模板${teams.length === 0 ? '' : `（${teams.length}）`}`, () =>
        setTeamOpen(!teamOpen)
      ),
      h(
        'label',
        {
          style: {
            padding: '5px 12px',
            borderRadius: 6,
            border: LINE,
            fontSize: 12,
            cursor: 'pointer'
          }
        },
        '导入',
        h('input', {
          type: 'file',
          accept: '.json,application/json',
          style: { display: 'none' },
          onChange: (event: ChangeEvent<HTMLInputElement>) => void importFile(event)
        })
      ),
      headerButton('＋ 新建 Bot', () => props.onSelect(null))
    ),

    teamOpen
      ? h(
          'div',
          {
            style: {
              border: LINE,
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxWidth: 640
            }
          },
          h('div', { style: { fontSize: 12, color: MUTED } },
            '把常一起干活的几只 Bot 存成团队，建房时一次拉入。'),
          h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            h('input', {
              value: teamName,
              placeholder: '团队名，如「硬件小分队」',
              onChange: (e: { target: { value: string } }) => setTeamName(e.target.value),
              style: { ...field, flex: 1 }
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: () => void saveTeamNow(),
                disabled: teamBusy,
                style: { ...smallButton(true), flex: '0 0 96px' }
              },
              teamBusy ? '保存中…' : '存为团队'
            )
          ),
          props.bots.length === 0
            ? h('div', { style: { fontSize: 11, color: MUTED } }, '库里还没有 Bot')
            : h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 140, overflow: 'auto' } },
                ...props.bots.map((bot) =>
                  h(
                    'label',
                    {
                      key: bot.id,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 7px',
                        border: LINE,
                        borderRadius: 6,
                        fontSize: 11.5,
                        cursor: 'pointer'
                      }
                    },
                    h('input', {
                      type: 'checkbox',
                      checked: teamPick.includes(bot.id),
                      onChange: () =>
                        setTeamPick((current) =>
                          current.includes(bot.id)
                            ? current.filter((id) => id !== bot.id)
                            : [...current, bot.id]
                        )
                    }),
                    `${bot.avatar} ${bot.name}`
                  )
                )
              ),
          teams.length === 0
            ? null
            : h(
                'div',
                { style: { borderTop: LINE, paddingTop: 6 } },
                ...teams.map((team) =>
                  h(
                    'div',
                    {
                      key: team.id,
                      style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '2px 0' }
                    },
                    h('span', { style: { flex: 1 } }, `${team.name}（${team.botIds.length} 只）`),
                    h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => void removeTeam(team.id),
                        style: {
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: LINE,
                          background: 'transparent',
                          color: '#e5484d',
                          fontSize: 10.5,
                          fontFamily: 'inherit',
                          cursor: 'pointer'
                        }
                      },
                      '删除'
                    )
                  )
                )
              )
        )
      : null,

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
              selected === null
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => void download(selected),
                      style: {
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: LINE,
                        background: 'transparent',
                        color: 'inherit',
                        fontSize: 11.5,
                        fontFamily: 'inherit',
                        cursor: 'pointer'
                      }
                    },
                    '导出'
                  ),
              h(
                'button',
                {
                  type: 'button',
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

/**
 * 房间内改一只 Bot：只改这个房间的成员副本，不碰库里的角色卡。
 *
 * 以前拉错人只能重建房间——这里补上「改」。
 */
function MemberEditor(props: {
  roomId: string
  member: Member
  onSaved: (room: Room) => void
  onCancel: () => void
}) {
  const { member } = props
  const [name, setName] = useState(member.name)
  const [avatar, setAvatar] = useState(member.avatar)
  const [role, setRole] = useState<'host' | 'worker'>(member.role)
  const [persona, setPersona] = useState(member.persona ?? '')
  const [expertise, setExpertise] = useState(member.expertise ?? '')
  const [instructions, setInstructions] = useState(member.instructions ?? '')
  const [preset, setPreset] = useState(member.agentPreset ?? '')
  const [presets, setPresets] = useState<PresetEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listPresets()
      .then(setPresets)
      .catch(() => setPresets([]))
  }, [])

  const save = useCallback(async () => {
    if (name.trim() === '') {
      setError('名字不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await updateMember(props.roomId, member.botId, {
        name: name.trim(),
        avatar: avatar.trim() === '' ? '🤖' : avatar.trim(),
        role,
        persona,
        expertise,
        instructions,
        agentPreset: preset
      })
      props.onSaved(result.room)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }, [name, avatar, role, persona, expertise, instructions, preset, member.botId, props])

  return h(
    'div',
    {
      style: {
        border: '1px solid rgba(47,111,237,0.5)',
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 5
      }
    },
    h(
      'div',
      { style: { display: 'flex', gap: 4 } },
      h('input', {
        value: avatar,
        onChange: (e: { target: { value: string } }) => setAvatar(e.target.value),
        style: { ...field, width: 36, textAlign: 'center' as const }
      }),
      h('input', {
        autoFocus: true,
        value: name,
        placeholder: '名字',
        onChange: (e: { target: { value: string } }) => setName(e.target.value),
        style: { ...field, flex: 1 }
      })
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 4 } },
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
          style: { ...field, flex: 2 }
        },
        h('option', { value: '' }, '工具集：跟随默认'),
        ...presets.map((item) => h('option', { key: item.id, value: item.id }, item.label))
      )
    ),
    h('input', {
      value: expertise,
      placeholder: '一句话专长',
      onChange: (e: { target: { value: string } }) => setExpertise(e.target.value),
      style: field
    }),
    h('textarea', {
      value: persona,
      rows: 5,
      placeholder: '岗位描述',
      onChange: (e: { target: { value: string } }) => setPersona(e.target.value),
      style: { ...field, resize: 'vertical', lineHeight: 1.5 }
    }),
    h('textarea', {
      value: instructions,
      rows: 2,
      placeholder: '输出要求',
      onChange: (e: { target: { value: string } }) => setInstructions(e.target.value),
      style: { ...field, resize: 'vertical' }
    }),
    error === null ? null : h('div', { style: { fontSize: 10.5, color: '#e5484d' } }, error),
    h(
      'div',
      { style: { display: 'flex', gap: 4 } },
      h('button', { type: 'button', onClick: () => void save(), disabled: busy, style: smallButton(true) }, busy ? '保存中…' : '保存'),
      h('button', { type: 'button', onClick: props.onCancel, style: smallButton(false) }, '取消')
    )
  )
}

/** 成员卡：头像、名字、专长、状态灯、花费。 */
export function MemberCard(props: {
  member: Member
  onEdit?: () => void
  onRemove?: () => void
  removing?: boolean
}) {
  const { member } = props
  const dot = STATUS_COLOR[member.status] ?? '#999'
  const action = (label: string, onClick: () => void, danger = false) =>
    h(
      'button',
      {
        type: 'button',
        onClick,
        style: {
          padding: '1px 5px',
          borderRadius: 4,
          border: LINE,
          background: 'transparent',
          color: danger ? '#e5484d' : MUTED,
          fontSize: 10,
          fontFamily: 'inherit',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }
      },
      label
    )

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
      h('span', { style: { fontSize: 15, flexShrink: 0 } }, member.avatar),
      h(
        'span',
        {
          style: {
            fontSize: 13,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }
        },
        member.name
      ),
      member.role === 'host'
        ? h(
            'span',
            { style: { fontSize: 10, color: MUTED, border: LINE, borderRadius: 3, padding: '0 3px', flexShrink: 0 } },
            '总管'
          )
        : null,
      props.onEdit === undefined ? null : action('改', props.onEdit),
      props.onRemove === undefined
        ? null
        : action(props.removing === true ? '确认移出' : '移出', props.onRemove, true)
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const members = props.room?.members ?? []

  useEffect(() => {
    void listBots()
      .then(setLibrary)
      .catch(() => setLibrary([]))
  }, [open])

  // 换房间时把"正在改/正在移"的状态清掉，避免改到另一个房间的人
  useEffect(() => {
    setEditingId(null)
    setRemovingId(null)
    setMemberError(null)
  }, [props.room?.id])

  const remove = (botId: string): void => {
    if (props.room === null) return
    if (removingId !== botId) {
      setRemovingId(botId)
      return
    }
    void removeMember(props.room.id, botId)
      .then((room) => {
        props.onRoomChange(room)
        setRemovingId(null)
        setEditingId(null)
        setMemberError(null)
      })
      .catch((err: unknown) => {
        setMemberError(err instanceof Error ? err.message : '移出失败')
        setRemovingId(null)
      })
  }

  return h(
    'div',
    { style: { width: 220, flexShrink: 0, padding: 12, boxSizing: 'border-box', overflow: 'auto' } },
    h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 8 } }, `成员（${members.length}）`),

    memberError === null
      ? null
      : h('div', { style: { fontSize: 10.5, color: '#e5484d', marginBottom: 6 } }, memberError),

    members.length === 0
      ? h('div', { style: { fontSize: 12, color: MUTED, lineHeight: 1.7 } }, '暂无 Bot')
      : members.map((m) =>
          editingId === m.botId && props.room !== null
            ? h(MemberEditor, {
                key: m.botId,
                roomId: props.room.id,
                member: m,
                onSaved: (room: Room) => {
                  props.onRoomChange(room)
                  setEditingId(null)
                },
                onCancel: () => setEditingId(null)
              })
            : h(MemberCard, {
                key: m.botId,
                member: m,
                onEdit: () => setEditingId(m.botId),
                onRemove: () => remove(m.botId),
                removing: removingId === m.botId
              })
        ),

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
                        type: 'button',
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
                      type: 'button',
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
              type: 'button',
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
