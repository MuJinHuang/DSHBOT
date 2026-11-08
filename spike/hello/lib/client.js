window.__ModuleLoader__.load({
  id: '@dshbot/hello',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** 与侧栏入口共用同一个 id，才能互相寻址。 */
    const PANEL_ID = 'hello'

    /** 需要的客户端服务：插槽注册 + 主面板切换。 */
    const inject = ['slots', 'layout']

    function HelloIcon() {
      return h('span', { style: { fontSize: 16, lineHeight: 1 } }, '\u{1F6D6}')
    }

    function HelloPage() {
      // 用一下 hooks：能跑起来就证明拿到的是宿主的同一份 React，
      // 而不是被打进 bundle 的第二份副本。
      const [count, setCount] = React.useState(0)
      const [now] = React.useState(() => new Date().toLocaleTimeString())

      const row = (k, v) =>
        h(
          'div',
          { style: { display: 'flex', gap: 12, padding: '4px 0' } },
          h('span', { style: { width: 96, color: '#888' } }, k),
          h('code', { style: { fontSize: 12 } }, v)
        )

      return h(
        'div',
        { style: { padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 720 } },
        h('h1', { style: { fontSize: 22, margin: '0 0 4px' } }, 'DSHBot · hello'),
        h('p', { style: { color: '#666', margin: '0 0 24px' } },
          'S0-1 冒烟页：第三方插件注册的全屏页面与侧栏入口。'),
        h(
          'div',
          { style: { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 20 } },
          row('页面 id', PANEL_ID),
          row('加载时间', now),
          row('来源', window.location.origin)
        ),
        h(
          'button',
          {
            onClick: () => setCount((c) => c + 1),
            style: {
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: count > 0 ? '#e8f4ff' : '#fff',
              fontSize: 14,
              cursor: 'pointer'
            }
          },
          h('span', { style: { color: '#1a1a1a' } },
            count === 0 ? '点我验证 React 状态' : `React 正常，点了 ${count} 次`)
        ),
        h('p', { style: { color: '#999', fontSize: 12, marginTop: 24 } },
          '如果你看到这一页，说明：第三方包 → Loader → /plugins → main 插槽 → React 渲染，全链路通了。')
      )
    }

    function apply(ctx) {
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID }, HelloPage)
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 0, label: 'Hello' },
          HelloIcon
        )
      )
      console.log('[dshbot-hello] client side loaded')
    }

    exports.name = '@dshbot/hello'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
