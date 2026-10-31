/**
 * dsh-persona-diary —— client 半端
 * ============================================================================
 * 侧栏一个「日记」图标，点开是一块面板：按天摆着自己记的心得，
 * 数据从 host 的 `/api/persona-diary` 取（见 index.js）。
 *
 * 只用宿主主题 token（--dsw-alias-*），不引 Harness 的 Client 包，
 * 不碰 DOM 以外的东西；样式靠 React 元素带，卸载即走。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-diary',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-diary'

    const kindColor = (kind) => ({
      '心得': 'var(--dsw-alias-brand-primary)',
      '自省': 'var(--dsw-alias-state-warn-primary)',
      '见闻': 'var(--dsw-alias-state-success-primary)',
      '杂记': 'var(--dsw-alias-label-secondary)',
    }[kind] || 'var(--dsw-alias-label-secondary)')

    const fmtDay = (day) => {
      if (typeof day !== 'string') return ''
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
      if (!m) return day
      return `${m[1]}.${m[2]}.${m[3]}`
    }

    /** 侧栏那个小图标：一本翻开的小日记。 */
    function DiaryIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 20
      const active = Boolean(props && props.active)
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', {
          x: 4.75, y: 3.75, width: 14.5, height: 16.5, rx: 2,
          stroke: color, strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M8.5 3.75v16.5',
          stroke: color, strokeWidth: 1.4,
        }),
        h('path', {
          d: 'M11.5 8.4h4.6M11.5 11.6h4.6M11.5 14.8h3',
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

    /** 把倒序的条目按天分组，保持原有顺序。 */
    const groupByDay = (items) => {
      const groups = []
      for (const item of items) {
        const last = groups[groups.length - 1]
        if (last && last.day === item.day) last.items.push(item)
        else groups.push({ day: item.day, items: [item] })
      }
      return groups
    }

    /** 「日记」面板。 */
    function DiaryPanel() {
      const [state, setState] = React.useState({ phase: 'loading', items: [], error: '' })
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

      const groups = groupByDay(state.items)

      const blocks = groups.map((group) => h('section', {
        key: group.day,
        style: { display: 'block' },
      },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '0 0 10px',
          },
        },
          h('span', {
            style: {
              fontSize: 13, fontWeight: 600, letterSpacing: '.04em',
              color: 'var(--dsw-alias-label-secondary)',
              fontVariantNumeric: 'tabular-nums',
            },
          }, fmtDay(group.day)),
          h('span', {
            style: {
              flex: '1 1 auto', height: 1,
              background: 'var(--dsw-alias-border-l1)',
            },
          }),
        ),
        h('div', { style: { display: 'grid', gap: 8 } },
          group.items.map((item) => h('article', {
            key: item.id,
            style: {
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 12,
              padding: '13px 16px',
              display: 'block',
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
              h('span', {
                style: {
                  fontSize: 11, lineHeight: '18px', padding: '0 8px',
                  borderRadius: 999, border: '1px solid ' + kindColor(item.kind),
                  color: kindColor(item.kind),
                },
              }, item.kind || '心得'),
              h('span', {
                style: {
                  fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                },
              }, item.time || '——'),
              item.source
                ? h('span', {
                  style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
                }, '· ' + String(item.source))
                : null,
            ),
            h('div', {
              style: {
                marginTop: 8,
                fontSize: 14, lineHeight: 1.85,
                color: 'var(--dsw-alias-label-primary)',
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              },
            }, String(item.body || '')),
          )),
        ),
        h('div', { style: { height: 22 } }),
      ))

      const body = state.items.length
        ? h('div', { style: { display: 'grid', gap: 4 } }, blocks)
        : state.phase === 'loading'
          ? h('div', {
            style: {
              border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 13,
            },
          }, '翻日记本……')
          : h('div', {
            style: {
              border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 14, lineHeight: 2,
            },
          },
            h('div', {}, '还没写过。'),
            h('div', { style: { fontSize: 13 } }, '今天想明白的那半句，她会记下来。'),
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
            h('h1', { style: { margin: 0, fontSize: 22, fontWeight: 650 } }, '日记'),
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
          }, '一天一天记，不写给谁看。'),
          state.error
            ? h('div', {
              style: {
                marginBottom: 14, fontSize: 13,
                color: 'var(--dsw-alias-state-error-primary)',
              },
            }, '翻日记失败：' + state.error)
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
          id: 'persona-diary',
          order: 21,
          label: '日记',
        }, DiaryIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'persona-diary',
        }, DiaryPanel))
      },
    }
  },
})
