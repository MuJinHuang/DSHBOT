import { createElement as h, useState } from 'react'

/**
 * 房间页的骨架：三栏（房间列表 / 消息流 / 成员）。
 *
 * M0 阶段这里会接真实数据；现在只放骨架和空态，先把构建链路和布局占位跑通。
 */

const PLACEHOLDER_ROOMS = [
  { id: 'demo-1', name: '改造登录页', status: '草稿' },
  { id: 'demo-2', name: '内容组', status: '常驻' }
]

function Column(props: { width: number | string; children?: React.ReactNode; border?: boolean }) {
  return h(
    'div',
    {
      style: {
        width: props.width,
        flexShrink: 0,
        borderRight: props.border ? '1px solid rgba(128,128,128,0.25)' : undefined,
        padding: 12,
        boxSizing: 'border-box',
        overflow: 'auto'
      }
    },
    props.children
  )
}

function SectionTitle(props: { children?: React.ReactNode }) {
  return h(
    'div',
    {
      style: {
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        opacity: 0.55,
        marginBottom: 8
      }
    },
    props.children
  )
}

export function RoomsPage() {
  const [selected, setSelected] = useState<string | null>(null)

  return h(
    'div',
    { style: { display: 'flex', height: '100%', minHeight: 0, fontFamily: 'inherit' } },
    // 左：房间列表
    Column({
      width: 224,
      border: true,
      children: [
        h(SectionTitle, { key: 't' }, '房间'),
        ...PLACEHOLDER_ROOMS.map((room) =>
          h(
            'button',
            {
              key: room.id,
              onClick: () => setSelected(room.id),
              style: {
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                marginBottom: 4,
                borderRadius: 6,
                border: 'none',
                background: selected === room.id ? 'rgba(128,128,128,0.18)' : 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 13
              }
            },
            room.name,
            h('span', { style: { opacity: 0.5, marginLeft: 8, fontSize: 11 } }, room.status)
          )
        )
      ]
    }),

    // 中：消息流
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
          boxSizing: 'border-box'
        }
      },
      h(
        'div',
        { style: { flex: 1, display: 'grid', placeItems: 'center', opacity: 0.6 } },
        h(
          'div',
          { style: { textAlign: 'center', maxWidth: 380 } },
          h('div', { style: { fontSize: 15, marginBottom: 6 } }, '还没有房间'),
          h(
            'div',
            { style: { fontSize: 12, lineHeight: 1.6 } },
            '建一个房间，拉几个 Bot 进来，说一句话，它们分头干活。',
            h('br'),
            '这条链路会在 M0 接上真实数据。'
          )
        )
      )
    ),

    // 右：成员
    Column({
      width: 220,
      border: false,
      children: [
        h(SectionTitle, { key: 't' }, '成员'),
        h('div', { style: { fontSize: 12, opacity: 0.55, lineHeight: 1.7 } }, '暂无 Bot'),
        h(
          'div',
          { style: { marginTop: 12, fontSize: 11, opacity: 0.4 } },
          '每个 Bot 会在这里显示状态灯：空闲 / 思考中 / 操作中 / 等审批'
        )
      ]
    })
  )
}

/** 侧栏图标。 */
export function RoomsIcon() {
  return h('span', { style: { fontSize: 16, lineHeight: 1 } }, '\u{1F3E0}')
}
