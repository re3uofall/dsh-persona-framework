/**
 * dsh-persona-results —— client 半端
 * ============================================================================
 * 侧栏一个「成果」图标，点开是一块面板：自己交上去的东西，一条一条摆着，
 * 点开看全文。数据从 host 的 `/api/persona-results` 取（见 index.js）。
 *
 * 只用宿主主题 token（--dsw-alias-*），不引 Harness 的 Client 包，
 * 不碰 DOM 以外的东西；样式靠 React 元素带，卸载即走。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-results',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-results'

    const kindColor = (kind) => ({
      '判断': 'var(--dsw-alias-brand-primary)',
      '骨架': 'var(--dsw-alias-state-success-primary)',
      '概念': 'var(--dsw-alias-state-warn-primary)',
      '反驳': 'var(--dsw-alias-state-error-primary)',
      '问题': 'var(--dsw-alias-state-idle-primary)',
      '杂记': 'var(--dsw-alias-label-secondary)',
    }[kind] || 'var(--dsw-alias-label-secondary)')

    const fmtTime = (iso) => {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      const two = (n) => String(n).padStart(2, '0')
      return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
    }

    /** 侧栏那个小图标：一枚书签。 */
    function ResultsIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 20
      const active = Boolean(props && props.active)
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('path', {
          d: 'M7 4.75h10a1.25 1.25 0 0 1 1.25 1.25v14.2a.3.3 0 0 1-.46.25L12 16.6l-5.79 3.85a.3.3 0 0 1-.46-.25V6A1.25 1.25 0 0 1 7 4.75Z',
          stroke: color, strokeWidth: 1.6, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M9.5 9h5M9.5 12.2h5',
          stroke: color, strokeWidth: 1.4, strokeLinecap: 'round',
        }),
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

    /** 「成果」面板。 */
    function ResultsPanel() {
      const [state, setState] = React.useState({ phase: 'loading', items: [], error: '' })
      const [open, setOpen] = React.useState(null)
      const [nonce, setNonce] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        const controller = new AbortController()
        setState((prev) => ({ ...prev, phase: prev.items.length ? 'refreshing' : 'loading' }))
        fetch(API, { signal: controller.signal, cache: 'no-store' })
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then((data) => {
            if (!alive) return
            const items = Array.isArray(data && data.items) ? data.items : []
            setState({
              phase: 'ready',
              items,
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

      const toggle = (id) => setOpen((prev) => (prev === id ? null : id))

      const cards = state.items.map((item) => {
        const color = kindColor(item.kind)
        const isOpen = open === item.id
        const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : []
        return h('div', {
          key: item.id,
          role: 'button',
          tabIndex: 0,
          onClick: () => toggle(item.id),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggle(item.id)
            }
          },
          style: {
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            padding: '14px 16px',
            cursor: 'pointer',
            display: 'block',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
            h('span', {
              style: {
                flex: '0 0 auto', fontSize: 11, lineHeight: '18px', padding: '0 8px',
                borderRadius: 999, border: '1px solid ' + color, color,
              },
            }, item.kind || '判断'),
            h('span', {
              style: {
                flex: '1 1 auto', fontSize: 15, fontWeight: 600,
                color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere',
              },
            }, String(item.title || '（无题）')),
            h('span', {
              style: { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
            }, fmtTime(item.t)),
          ),
          isOpen ? h('div', {
            style: {
              marginTop: 12, paddingTop: 12,
              borderTop: '1px solid var(--dsw-alias-border-l1)',
              fontSize: 14, lineHeight: 1.85,
              color: 'var(--dsw-alias-label-primary)',
              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            },
          },
            tags.length
              ? h('div', {
                style: {
                  marginBottom: 10, fontSize: 12,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              }, tags.map((tag) => '#' + tag).join('  '))
              : null,
            String(item.body || ''),
          ) : null,
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
          }, '翻账本……')
          : h('div', {
            style: {
              border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 14, lineHeight: 2,
            },
          },
            h('div', {}, '还没交过东西。'),
            h('div', { style: { fontSize: 13 } }, '她想完了，自己会来交。'),
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
            h('h1', { style: { margin: 0, fontSize: 22, fontWeight: 650 } }, '成果'),
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
          }, '她自己认的才算数。'),
          state.error
            ? h('div', {
              style: {
                marginBottom: 14, fontSize: 13,
                color: 'var(--dsw-alias-state-error-primary)',
              },
            }, '读账本失败：' + state.error)
            : null,
          body,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 侧栏图标：list id 与 main 面板的 key 必须同名，点图标签才会切到这块面板。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'thought-results',
          order: 20,
          label: '成果',
        }, ResultsIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'thought-results',
        }, ResultsPanel))
      },
    }
  },
})
