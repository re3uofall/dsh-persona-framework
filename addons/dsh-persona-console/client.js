/**
 * dsh-persona-console —— client 半端
 * ============================================================================
 * 侧栏一个「人格框架」图标（和「日记」「成果」并排），点开是这一套的全貌：
 *   总模块插件 / 模块功能实现 / 附加插件
 * 和 DSH 原来的「插件」页分开——那边是全部插件，这边只这一套的三层。
 *
 * 数据从 host 的 `/api/persona-console` 取（见 index.js）。
 * 只用主题 token（--dsw-alias-*），不引 Harness 的 Client 包。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-console',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-console'

    /** 侧栏那个小图标：三层叠起来的方块（本体 / 模块 / 附加）。 */
    function ConsoleIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 20
      const active = Boolean(props && props.active)
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', { x: 3.2, y: 4.6, width: 17.6, height: 4.6, rx: 1.4, stroke: color, strokeWidth: 1.5 }),
        h('rect', { x: 3.2, y: 11.2, width: 17.6, height: 3.6, rx: 1.3, stroke: color, strokeWidth: 1.4 }),
        h('rect', { x: 3.2, y: 16.6, width: 11.6, height: 3.4, rx: 1.2, stroke: color, strokeWidth: 1.4 }),
      )
    }

    const buttonStyle = {
      fontSize: 12, lineHeight: '26px', height: 26, padding: '0 12px',
      borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
    }

    const mono = { fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)' }

    function dot(on) {
      return h('span', {
        style: {
          display: 'inline-block', width: 7, height: 7, borderRadius: 4,
          background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-quaternary)',
          marginRight: 6, flex: '0 0 auto',
        },
      })
    }

    function Row(item, kind) {
      const sub = kind === 'modules'
        ? item.file
        : [item.pkg, item.version ? 'v' + item.version : ''].filter(Boolean).join(' · ')
      return h('div', {
        key: (item.id || item.pkg || item.dir) + ':' + (item.version || ''),
        style: {
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)',
        },
      },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13.5, color: 'var(--dsw-alias-label-primary)',
            },
          },
            kind === 'addons' ? dot(Boolean(item.enabled)) : null,
            h('span', { style: { fontWeight: 500 } }, item.title || item.id || item.pkg),
            kind === 'addons' && !item.enabled
              ? h('span', {
                style: {
                  fontSize: 11, color: 'var(--dsw-alias-label-quaternary)',
                  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5, padding: '0 5px',
                },
              }, '未登记')
              : null,
          ),
          h('div', { style: Object.assign({}, mono, { fontSize: 11.5, color: 'var(--dsw-alias-label-quaternary)', marginTop: 2, wordBreak: 'break-all' }) }, sub),
          item.desc
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 3, lineHeight: 1.55 } }, item.desc)
            : null,
        ),
      )
    }

    function ConsolePanel() {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: '' })
      const [nonce, setNonce] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        setState((s) => ({ phase: 'loading', data: s.data, error: '' }))
        fetch(API, { cache: 'no-store' })
          .then((r) => r.json())
          .then((json) => {
            if (!alive) return
            if (json && json.ok) setState({ phase: 'ready', data: json, error: '' })
            else setState({ phase: 'ready', data: null, error: String(json && json.error || '读不出来') })
          })
          .catch((error) => {
            if (alive) setState({ phase: 'ready', data: null, error: String(error && error.message || error) })
          })
        return () => { alive = false }
      }, [nonce])

      const data = state.data
      const counts = data && data.counts

      const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 } },
        h('h2', { style: { fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' } }, '人格框架插件'),
        h('button', {
          onClick: () => setNonce((n) => n + 1),
          disabled: state.phase === 'loading',
          style: Object.assign({}, buttonStyle, { marginLeft: 'auto' }),
        }, '刷新'),
      )

      const summary = h('p', { style: { margin: '6px 0 18px', fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 } },
        counts
          ? `总分三层：本体 1 个 · 模块正文 ${counts.modules} 篇 · 附加插件 ${counts.addons} 个（已登记 ${counts.addonsOn}）`
          : '本体、模块正文、附加插件，三层分开摆。',
        data && data.workspace
          ? h('span', { style: Object.assign({}, mono, { display: 'block', fontSize: 11.5, color: 'var(--dsw-alias-label-quaternary)', marginTop: 4, wordBreak: 'break-all' }) }, data.workspace)
          : null,
      )

      const errorLine = state.error
        ? h('div', { style: { marginBottom: 14, fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } }, '读不出来：' + state.error)
        : null

      const groups = data && Array.isArray(data.groups) ? data.groups : []
      const body = groups.map((g) => h('section', {
        key: g.id,
        style: {
          marginBottom: 26, border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 10, padding: '14px 16px 6px', background: 'var(--dsw-alias-bg-l2, transparent)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 } },
          h('h3', { style: { fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' } }, g.title),
          h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-quaternary)' } }, String(g.items.length) + ' 项'),
        ),
        h('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 10px', lineHeight: 1.6 } }, g.hint),
        h('div', {
          style: g.id === 'modules' ? { maxHeight: 360, overflowY: 'auto', paddingRight: 4 } : null,
        }, g.items.map((item) => Row(item, g.id))),
      ))

      return h('div', { style: { padding: '22px 26px 40px', maxWidth: 820 } }, head, summary, errorLine, body)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 侧栏图标：panellist 的 id 与 main 的 key 必须同名。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'persona-framework',
          order: 22,
          label: '人格框架',
        }, ConsoleIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'persona-framework',
        }, ConsolePanel))
      },
    }
  },
})
