/**
 * dsh-persona-lesson —— client 半端
 * ============================================================================
 * 侧栏一个「教训」图标，点开是一块面板：错在哪、代价谁付、下次拿什么拦自己。
 * 数据从 host 的 `/api/persona-lesson` 取（见 index.js）。
 *
 * 版式与「成果」「日记」一致：同样的留白、字号、卡片圆角、宿主主题 token。
 * 不引 Harness 的 Client 包，样式靠 React 元素带，卸载即走。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-lesson',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-lesson'

    const kindColor = (kind) => ({
      '判断失误': 'var(--dsw-alias-state-warn-primary)',
      '情绪失手': 'var(--dsw-alias-state-error-primary)',
      '流程失守': 'var(--dsw-alias-brand-primary)',
      '说了没做': 'var(--dsw-alias-state-warn-primary)',
      '读错原话': 'var(--dsw-alias-state-error-primary)',
      '硬撑': 'var(--dsw-alias-label-secondary)',
    }[kind] || 'var(--dsw-alias-state-warn-primary)')

    /** 侧栏那个小图标：一页纸，右下角一枚红点。 */
    function LessonIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 20
      const active = Boolean(props && props.active)
      const color = active ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', { x: 5.5, y: 3.5, width: 13, height: 17, rx: 2, stroke: color, strokeWidth: 1.5 }),
        h('path', { d: 'M8.8 8.4h6.4M8.8 12h6.4M8.8 15.6h3.2', stroke: color, strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 17.6, cy: 17.4, r: 2.2, fill: 'var(--dsw-alias-state-error-primary)' }),
      )
    }

    const buttonStyle = {
      fontSize: 12,
      lineHeight: '26px',
      height: 26,
      padding: '0 12px',
      borderRadius: 7,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
    }

    const fieldStyle = {
      fontSize: 14, lineHeight: 1.85,
      color: 'var(--dsw-alias-label-primary)',
      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    }

    const labelStyle = {
      fontSize: 12, lineHeight: '20px',
      color: 'var(--dsw-alias-label-secondary)',
    }

    /** 「教训」面板。 */
    function LessonPanel() {
      const [state, setState] = React.useState({ phase: 'loading', items: [], error: '' })
      const [nonce, setNonce] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        const controller = new AbortController()
        setState((prev) => ({ ...prev, phase: prev.items.length ? 'refreshing' : 'loading' }))
        fetch(API, { signal: controller.signal, cache: 'no-store' })
          .then(async (res) => {
            const type = String(res.headers.get('content-type') || '')
            const text = await res.text()
            if (!res.ok || !type.includes('application/json')) {
              throw new Error('接口还没装载（HTTP ' + res.status + '）：' + text.slice(0, 60))
            }
            return JSON.parse(text)
          })
          .then((data) => {
            if (!alive) return
            setState({
              phase: 'ready',
              items: Array.isArray(data && data.items) ? data.items : [],
              error: data && data.ok === false ? String(data.error || '读取失败') : '',
            })
          })
          .catch((error) => {
            if (!alive || (error && error.name === 'AbortError')) return
            setState((prev) => ({ ...prev, phase: 'error', error: (error && error.message) || String(error) }))
          })
        return () => {
          alive = false
          controller.abort()
        }
      }, [nonce])

      const cards = state.items.map((item, index) => {
        const color = kindColor(item.kind)
        const field = (label, text) => (text
          ? h('div', { style: { marginTop: 10 } },
            h('div', { style: labelStyle }, label),
            h('div', { style: fieldStyle }, String(text)))
          : null)
        return h('div', {
          key: item.id || index,
          style: {
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'block',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
            h('span', {
              style: {
                flex: '0 0 auto', fontSize: 11, lineHeight: '18px', padding: '0 8px',
                borderRadius: 999, border: '1px solid ' + color, color,
              },
            }, item.kind || '教训'),
            h('span', {
              style: {
                flex: '1 1 auto', fontSize: 15, fontWeight: 600,
                color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere',
              },
            }, String(item.title || '（无题）')),
            h('span', {
              style: { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
            }, item.id || ''),
          ),
          field('错在哪', item.what),
          field('代价谁付', item.cost),
          field('下次拿什么拦自己', item.fix),
        )
      })

      const body = state.items.length
        ? h('div', { style: { display: 'grid', gap: 10 } }, cards)
        : state.phase === 'loading'
          ? h('div', {
            style: {
              border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 13,
            },
          }, '翻一翻……')
          : h('div', {
            style: {
              border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 14, lineHeight: 2,
            },
          },
            h('div', {}, '还没有教训。'),
            h('div', { style: { fontSize: 13 } }, '没记过的错，下次还会犯。'),
          )

      return h('div', {
        style: {
          boxSizing: 'border-box', height: '100%', overflowY: 'auto',
          padding: '32px 40px 64px',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'inherit',
        },
      },
        h('div', { style: { maxWidth: 880, margin: '0 auto' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12 } },
            h('h1', { style: { margin: 0, fontSize: 22, fontWeight: 650 } }, '教训'),
            h('span', {
              style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
            }, `${state.items.length} 条`),
            h('button', {
              onClick: () => setNonce((n) => n + 1),
              disabled: state.phase === 'loading',
              style: Object.assign({}, buttonStyle, { marginLeft: 'auto' }),
            }, '刷新'),
          ),
          h('p', {
            style: {
              margin: '8px 0 28px', fontSize: 13,
              color: 'var(--dsw-alias-label-secondary)',
            },
          }, '错在哪、代价谁付、下次拿什么拦自己。'),
          state.error
            ? h('div', {
              style: {
                marginBottom: 14, fontSize: 13,
                color: 'var(--dsw-alias-state-error-primary)',
              },
            }, '读不出来：' + state.error)
            : null,
          body,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'lesson-panel',
          order: 22,
          label: '教训',
        }, LessonIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'lesson-panel',
        }, LessonPanel))
      },
    }
  },
})
