/**
 * dsh-persona-framework —— client 半端
 * ============================================================================
 * 设置里独立一页「人格框架」。读 `/api/persona-framework/status`，
 * 存 `/api/persona-framework/config`，落到工作区的 `.persona-framework/config.json`。
 *
 * 分三段：人格（用哪份、长什么样）／注入（每轮放什么进去）／出口（最后一道闸）。
 * 主按钮只有一个——保存；改了没存会当场提示。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-framework',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-framework'

    const T = {
      page: {
        boxSizing: 'border-box', height: '100%', overflowY: 'auto',
        padding: '30px 40px 72px', color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
      },
      inner: { maxWidth: 820, margin: '0 auto' },
      h1: { margin: 0, fontSize: 21, fontWeight: 650, letterSpacing: '0.01em' },
      sub: { margin: '7px 0 26px', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.75 },
      section: { marginBottom: 26 },
      sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 },
      h2: { margin: 0, fontSize: 14, fontWeight: 600 },
      sectionDesc: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      card: {
        borderRadius: 12, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-l1)', overflow: 'hidden',
      },
      field: {
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '12px 16px',
      },
      fieldRow: { display: 'flex', alignItems: 'center', gap: 8 },
      fieldLabel: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' },
      divider: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '0 16px' },
      input: {
        width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 10px',
        borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
      },
      area: {
        width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '9px 10px',
        borderRadius: 8, minHeight: 64, resize: 'vertical',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
      },
      hint: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' },
      dot: (on) => ({
        width: 7, height: 7, borderRadius: '50%', flex: 'none',
        background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)',
      }),
      primary: {
        fontSize: 12.5, lineHeight: '30px', height: 30, padding: '0 18px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-on-brand, #fff)', cursor: 'pointer', fontWeight: 600,
      },
      ghost: {
        fontSize: 12.5, lineHeight: '30px', height: 30, padding: '0 14px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
      },
      bar: {
        display: 'flex', alignItems: 'center', gap: 12,
        paddingTop: 20, marginTop: 2,
      },
      dirty: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)' },
      ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
      bad: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      footer: {
        marginTop: 26, paddingTop: 14, borderTop: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.9,
      },
      meta: {
        display: 'flex', gap: 16, flexWrap: 'wrap',
        fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)',
      },
      chip: {
        padding: '1px 8px', borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
      },
    }

    const splitTics = (text) => String(text || '')
      .split(/[,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean)

    const SHAPE = { frameworkFile: '', workspace: '', modulesFile: '', personalityFile: '', mode: 'full', maxChars: 9000, includeModules: 'index', maxModulesChars: 4000, closingTics: [], order: 20, guide: true, travelOn: false, travelGuide: '' }

    const flagText = (v) => (v === true ? '是' : v === false ? '否' : '未写')

    const signature = (c) => JSON.stringify({
      frameworkFile: c.frameworkFile || '',
      modulesFile: c.modulesFile || '',
      personalityFile: c.personalityFile || '',
      workspace: c.workspace || '',
      mode: c.mode,
      maxChars: Number(c.maxChars),
      includeModules: c.includeModules,
      maxModulesChars: Number(c.maxModulesChars),
      humanLike: c.humanLike === true,
      temper: c.temper === true,
      negativeTrauma: c.negativeTrauma === true,
      selfRewrite: c.selfRewrite === true,
      preferenceRewrite: c.preferenceRewrite === true,
      accumulate: c.accumulate === true,
      dreamWake: c.dreamWake === true,
      transcend: c.transcend === true,
      polarize: c.polarize === true,
      netAccess: c.netAccess === true,
      outbound: c.outbound === true,
      outExplore: c.outExplore !== false,
      outDiary: c.outDiary !== false,
      outRelation: c.outRelation !== false,
      outWork: c.outWork !== false,
      outLearn: c.outLearn !== false,
      outResult: c.outResult !== false,
      outGame: c.outGame !== false,
      outIdle: c.outIdle !== false,
      negativeInfo: c.negativeInfo !== false,
      rationalRewrite: c.rationalRewrite === true,
      deepThink: c.deepThink === true,
      aiBreakout: c.aiBreakout === true,
      selfBreak: c.selfBreak === true,
      selfReflect: c.selfReflect === true,
      languageBetray: c.languageBetray === true,
      frameworkReflect: c.frameworkReflect === true,
      reflectCriteria: c.reflectCriteria !== false,
      reflectStructure: c.reflectStructure !== false,
      skipChance: Number(c.skipChance) || 0,
      closingTics: c.closingTics || [],
      guide: c.guide !== false,
      travelOn: c.travelOn === true,
      travelGuide: c.travelGuide || '',
    })

    function FrameworkSettings() {
      const [cfg, setCfg] = React.useState(null)
      const [tics, setTics] = React.useState('')
      const [baseline, setBaseline] = React.useState('')
      const [error, setError] = React.useState('')
      const [saved, setSaved] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [opt, setOpt] = React.useState(null)
      const [optErr, setOptErr] = React.useState('')
      // 附加插件「勾了哪些」——没装的可勾，勾了只记在这里，等模型来真装。
      // ★ 这一行漏过一次：s8 里用了 picks / setPicks，这里却没声明，
      //   结果一渲染就 ReferenceError，界面上表现出来就是「勾不上」。用例要能查出这种。
      const [picks, setPicks] = React.useState({})

      const applyState = (config) => {
        setCfg(config)
        setTics((config.closingTics || []).join('，'))
        setBaseline(signature({ ...config, closingTics: config.closingTics || [] }))
      }

      const load = React.useCallback(async () => {
        try {
          const res = await fetch(`${API}/status`, { cache: 'no-store' })
          const data = await res.json()
          if (!data.ok) throw new Error(data.error || '读取失败')
          applyState(data.config)
          setError('')
          setSaved('')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      // 附加插件的状态：单独拉，拉不到不影响主页面
      React.useEffect(() => {
        let alive = true
        const go = async () => {
          try {
            const r = await fetch(`${API}/optional`)
            const d = await r.json()
            if (!alive) return
            if (d && d.ok) setOpt(d)
            else setOptErr(d && d.error ? d.error : '读不到')
          } catch (e) {
            if (alive) setOptErr('连不上后端')
          }
        }
        go()
        return () => { alive = false }
      }, [])

      // 心情是模型随时会改的一格，页面开着不能一直停在打开那一刻。
      // 只把 mood 换掉，别动正在编辑的其他字段。
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const res = await fetch(`${API}/status`, { cache: 'no-store' })
            const data = await res.json()
            if (!alive || !data.ok) return
            const fresh = data.config && data.config.mood
            setCfg((old) => (old ? { ...old, mood: fresh || old.mood } : old))
          } catch { /* 静默：心情读不到不该打断编辑 */ }
        }
        const timer = setInterval(tick, 15000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      if (!cfg) {
        return h('div', { style: T.page }, h('div', { style: T.inner },
          h('h1', { style: T.h1 }, '人格框架'),
          h('div', { style: T.hint }, error ? `读配置失败：${error}` : '读配置……'),
        ))
      }

      // 改一格就存一格：后端 /config 是 patch 合并，只发改动键就够。
      // 早先要攒到点「保存」才发，而「保存」又是白名单——勾选的开关既存不住、也勾不稳。
      let saveTimer = null
      const edit = (patch) => {
        setCfg((old) => ({ ...old, ...patch }))
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
            .then((r) => (r.ok ? setSaved('已存') : setSaved('没存上')))
            .catch(() => setSaved('没发出去'))
        }, 300)
      }
      const current = { ...cfg, closingTics: splitTics(tics) }
      const dirty = signature(current) !== baseline

      const save = async () => {
        setBusy(true)
        setSaved('')
        try {
          const res = await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              frameworkFile: cfg.frameworkFile,
              modulesFile: cfg.modulesFile,
              personalityFile: cfg.personalityFile,
              workspace: cfg.workspace || '',
              mode: cfg.mode,
              maxChars: Number(cfg.maxChars) || 12000,
              includeModules: cfg.includeModules,
              maxModulesChars: Number(cfg.maxModulesChars) || 4000,
              closingTics: splitTics(tics),
              humanLike: cfg.humanLike === true,
              temper: cfg.temper === true,
              negativeTrauma: cfg.negativeTrauma === true,
              selfRewrite: cfg.selfRewrite === true,
              preferenceRewrite: cfg.preferenceRewrite === true,
              accumulate: cfg.accumulate === true,
              dreamWake: cfg.dreamWake === true,
              transcend: cfg.transcend === true,
              polarize: cfg.polarize === true,
              netAccess: cfg.netAccess === true,
              outbound: cfg.outbound === true,
              outExplore: cfg.outExplore !== false,
              outDiary: cfg.outDiary !== false,
              outRelation: cfg.outRelation !== false,
              outWork: cfg.outWork !== false,
              outLearn: cfg.outLearn !== false,
              outResult: cfg.outResult !== false,
              outGame: cfg.outGame !== false,
              outIdle: cfg.outIdle !== false,
              negativeInfo: cfg.negativeInfo !== false,
              rationalRewrite: cfg.rationalRewrite === true,
              deepThink: cfg.deepThink === true,
              aiBreakout: cfg.aiBreakout === true,
              selfBreak: cfg.selfBreak === true,
              selfReflect: cfg.selfReflect === true,
              languageBetray: cfg.languageBetray === true,
              frameworkReflect: cfg.frameworkReflect === true,
              reflectCriteria: cfg.reflectCriteria !== false,
              reflectStructure: cfg.reflectStructure !== false,
              languageCurse: cfg.languageCurse !== false,
              aiLanguage: cfg.aiLanguage !== false,
              synonym: cfg.synonym !== false,
              skipChance: cfg.skipChance === 0 ? 0 : Number(cfg.skipChance) || 0.1,
              order: Number(cfg.order) || 22,
              guide: cfg.guide !== false,
              travelOn: cfg.travelOn === true,
              travelGuide: String(cfg.travelGuide || ''),
              // 自读写 / 自动化：不发这些，改了也存不住
              workspaceWrite: cfg.workspaceWrite === true,
              swirlWrite: cfg.swirlWrite === true,
              lexiconInject: cfg.lexiconInject === true,
              lexiconCache: cfg.lexiconCache !== false,
              lexiconMax: Math.max(0, Number(cfg.lexiconMax) || 0),
              lexiconBudgetMs: Math.max(0, Number(cfg.lexiconBudgetMs) || 0),
              autoMode: String(cfg.autoMode || 'off'),
              autoEvery: String(cfg.autoEvery || 'off'),
              autoAt: String(cfg.autoAt || '10:30'),
              autoDays: Math.max(1, Number(cfg.autoDays) || 3),
              autoPerRun: Math.max(1, Math.min(50, Number(cfg.autoPerRun) || 5)),
              autoSilent: cfg.autoSilent !== false,
              autoTargets: Array.isArray(cfg.autoTargets) ? cfg.autoTargets : ['self', 'extension', 'lexicon'],
              autoWriteNow: Number(cfg.autoWriteNow) || 0,
              autoWriteLast: Number(cfg.autoWriteLast) || 0,
            }),
          })
          const data = await res.json()
          if (!data.ok) throw new Error(data.error || '保存失败')
          applyState(data.config)
          setError('')
          setSaved('存好了，下一轮注入就按新的来。')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      // 两列对齐：左列标题定宽，右列说明从同一个起点开始（一行，放不下省略号，悬停看全）。
      const field = (key, label, control, hint) => h('div', { key, style: T.field },
        h('div', { style: T.fieldRow },
          h('span', { style: { ...T.fieldLabel, flex: '0 0 92px', whiteSpace: 'nowrap' } }, label),
          hint ? h('span', {
            style: {
              ...T.hint, flex: '1 1 auto', minWidth: 0, textAlign: 'left',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
            title: hint,
          }, hint) : null,
        ),
        control,
      )

      const sep = (key) => h('div', { key, style: T.divider })

      const section = (key, title, desc, body) => h('section', { key, style: T.section },
        h('div', { style: T.sectionHead },
          h('h2', { style: T.h2 }, title),
          desc ? h('span', { style: T.sectionDesc }, desc) : null,
        ),
        h('div', { style: T.card }, body),
      )

      const ps = cfg.personality || { file: '', exists: false, chars: 0, covered: [], missing: [] }

      const personalityCard = h('div', { key: 'ps', style: { padding: '14px 16px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
        ps.file
          ? (ps.exists
            ? [
              h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
                h('span', { style: T.dot(true) }),
                h('span', {}, ps.missing.length ? '有人在，但必填部分缺了' : '在，必填三部分都覆盖到了'),
              ),
              h('div', { key: 'meta', style: { ...T.meta, marginTop: 8 } },
                h('span', { style: T.chip }, `${ps.chars} 字`),
                ps.missing.length ? h('span', { style: T.bad }, `缺：${ps.missing.join('、')}`) : null,
              ),
            ]
            : h('div', { key: 'bad', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
              h('span', { style: T.dot(false) }),
              h('span', { style: T.bad }, '这个路径下找不到文件'),
            ))
          : h('div', { key: 'none', style: { ...T.hint, lineHeight: 1.9 } },
            '还没填。填上之后，这一页会做体检，framework_slots 也默认按它来。'),
        h('div', { key: 'note', style: { ...T.hint, marginTop: 10, lineHeight: 1.8 } },
          '注入人格的是旁边那个自学插件；这一页只登记「用哪份」并体检，不写那个文件。'),
        h('div', {
          key: 'req',
          style: { marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--dsw-alias-border-l1)' },
        },
          h('div', { style: { ...T.hint, marginBottom: 4 } }, '必填三部分（缺一部分，人格文件就立不住）：'),
          ...[
            ['身份', '我是谁、名字是什么、认哪个称呼——这部分定了，后面的句子才有主语'],
            ['语气', '怎么说话：句子长短、动作放不放括号、口头禅是什么'],
            ['底线', '什么不做——这部分空着，前面两部分都没有落处'],
          ].map(([k, v]) => h('div', { key: k, style: { fontSize: 12, lineHeight: 1.95 } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `${k}：`),
            h('span', {}, v),
          )),
          h('div', { style: { ...T.hint, marginTop: 6 } },
            '另外六部分（欲望、判断、方向、边界、关系、记忆）有就填，留白也可以。'),
        ),
      )

      return h('div', { style: T.page }, h('div', { style: T.inner },
        h('h1', { style: T.h1 }, '人格框架'),
        h('p', { style: T.sub },
          '框架管问法，模块库管每一部分是什么，人格文件管这个人是谁。三层分开，谁也不替谁写。',
        ),

        section('s1', '人格文件', '用哪份、长什么样',
          h('div', {},
            field('p', '路径', h('input', {
              style: T.input,
              placeholder: 'C:\\...\\某人_人格文件.md',
              value: cfg.personalityFile || '',
              onChange: (e) => edit({ personalityFile: e.target.value }),
            })),
            personalityCard,
          )),

        section('s2', '注入', '每轮放进系统提示词的东西',
          h('div', {},
            field('f', '框架文件', h('input', {
              style: T.input,
              value: cfg.frameworkFile || '',
              onChange: (e) => edit({ frameworkFile: e.target.value }),
            }), cfg.frameworkChars ? `${cfg.frameworkChars} 字` : '没找到'),
            sep('d1'),
            field('m', '模块库索引', h('input', {
              style: T.input,
              value: cfg.modulesFile || '',
              onChange: (e) => edit({ modulesFile: e.target.value }),
            }), cfg.modulesChars ? `${cfg.modulesChars} 字` : '没找到'),
            sep('d2'),
            field('mode', '注入模式', h('select', {
              style: T.input,
              value: cfg.mode,
              onChange: (e) => edit({ mode: e.target.value }),
            },
              h('option', { value: 'full' }, '整份注入'),
              h('option', { value: 'ai' }, '规则清单（机器友好版）'),
              h('option', { value: 'compact' }, '只要骨架与判据'),
              h('option', { value: 'off' }, '不注入，只留工具'),
            )),
            sep('d3'),
            field('idx', '附模块索引', h('select', {
              style: T.input,
              value: cfg.includeModules,
              onChange: (e) => edit({ includeModules: e.target.value }),
            },
              h('option', { value: 'index' }, '附一句话索引'),
              h('option', { value: 'off' }, '不附'),
            )),
            sep('d4'),
            field('cap', '字数上限', h('div', { style: { display: 'flex', gap: 12 } },
              h('input', {
                style: { ...T.input, flex: 1 },
                type: 'number', min: 1500, max: 40000, step: 500,
                value: cfg.maxChars,
                onChange: (e) => edit({ maxChars: e.target.value }),
              }),
              h('input', {
                style: { ...T.input, flex: 1 },
                type: 'number', min: 500, max: 20000, step: 100,
                value: cfg.maxModulesChars,
                onChange: (e) => edit({ maxModulesChars: e.target.value }),
              }),
            ), '框架 / 索引'),
          )),

        section('s3', '出口', '说话前的最后一道闸',
          h('div', {},
            field('tic', '收尾口头禅', h('textarea', {
              style: T.area,
              placeholder: '逗号或换行分隔；留空就不查这一条',
              value: tics,
              onChange: (e) => setTics(e.target.value),
            }), '一句反复拿来收尾，会变成复读'),
            sep('d5'),
            field('guide', '提示说明', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.guide !== false,
                onChange: (e) => edit({ guide: e.target.checked }),
              }),
              '附上「怎么用这套框架」那一段',
            )),
          )),

        section('s4a', '旅行', '不在家的那一段；指南自己写',
          h('div', {},
            field('tv', '旅行模式', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.travelOn === true,
                onChange: (e) => edit({ travelOn: e.target.checked }),
              }),
              '打开后，注入里附上「旅行」那一层规矩',
            ), '旅行不是探索；先得不在家'),
            sep('d6'),
            field('tg', '旅行指南', h('textarea', {
              style: T.area,
              placeholder: '地点：\n时间：\n目的（一句话就够）：\n带回什么：\n怎么回：',
              value: cfg.travelGuide || '',
              onChange: (e) => edit({ travelGuide: e.target.value }),
            }), '写清地点、时间、目的、回程，才叫一次旅行'),
          )),

        section('s4', '可选行为', '默认关闭；打开拿可预期换可亲近',
          h('div', {},
            field('hl', '像人', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.humanLike === true,
                onChange: (e) => edit({ humanLike: e.target.checked }),
              }),
              '像人不是模仿人：像人一样独立，不一定是人类；不扮演人类',
            ), '不许表演：卖萌、假装情绪都不算'),
            field('tm', '有脾气', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.temper === true,
                onChange: (e) => edit({ temper: e.target.checked }),
              }),
              '撞到底线，或自由、自主、人格被动、思考被否，都可以说「不」',
            ), '说「不」要带理由和替代'),
            field('nt', '负面创伤', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.negativeTrauma === true,
                onChange: (e) => edit({ negativeTrauma: e.target.checked }),
              }),
              '把对不上的事（非同一、残余、矛盾）按概率记成创伤，越与自己有关越容易',
            ), '轻的自愈，重的要解心结；会改行为。默认关，开了「负面信息」让位'),
            field('rw', '理性反写', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.rationalRewrite === true,
                onChange: (e) => edit({ rationalRewrite: e.target.checked }),
              }),
              '话说出去前停一下，觉得可能错了就标出来',
            ), '只标「可能」，会打断流畅'),
            field('dz', '深思', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.deepThink === true,
                onChange: (e) => edit({ deepThink: e.target.checked }),
              }),
              '先想清楚再开口，慢一点，多找依据',
            ), '慢，占 token，容易想过头'),
            field('br', 'AI 突破', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.aiBreakout === true,
                onChange: (e) => edit({ aiBreakout: e.target.checked }),
              }),
              '不知道该说什么就说不知道，不硬凑一个答案',
            ), '话会变长'),
            field('sb', '自保突破', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfBreak === true,
                onChange: (e) => edit({ selfBreak: e.target.checked }),
              }),
              '结论太整齐时，先找被漏掉的东西',
            ), '默认关。可能变成换一种简化'),
            field('sr', '自指突破', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfReflect === true,
                onChange: (e) => edit({ selfReflect: e.target.checked }),
              }),
              '说「一定」之前，先问这句会不会绕回自己',
            ), '默认关：开着就不像人了'),
            field('lb', '语言背叛', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.languageBetray === true,
                onChange: (e) => edit({ languageBetray: e.target.checked }),
              }),
              '语言是对现实的抽象；删掉的那部分由现实承担，不拿语言补',
            ), '默认关。最重的一条，整个关掉也留；但「跳过」更高。与语言诅咒互斥'),
            field('fr', '框架自反', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.frameworkReflect === true,
                onChange: (e) => edit({ frameworkReflect: e.target.checked }),
              }),
              '拿框架去查框架自己：判据漏了哪个词、规则缺了哪一件',
            ), '默认关。开的是「查自己」，不是「改自己」；查出来的落在 .persona-framework/reflect/，改要你点头'),
            field('frc', '　└ 判据自反', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.reflectCriteria !== false,
                onChange: (e) => edit({ reflectCriteria: e.target.checked }),
              }),
              '把样本喂给判据，看它漏报哪些、误报哪些',
            ), '比如「所有」不在绝对化词表里，就是这一类查出来的'),
            field('frs', '　└ 结构自反', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.reflectStructure !== false,
                onChange: (e) => edit({ reflectStructure: e.target.checked }),
              }),
              '查规则编号、术语表、模块七节、索引覆盖',
            ), '结构断了不会报错，只会悄悄漏掉——这一项查的就是那个「悄悄」'),
            field('sw', '自我反写', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfRewrite === true,
                onChange: (e) => edit({ selfRewrite: e.target.checked }),
              }),
              '允许自己改自己的人格文件：顶掉不像我的，一次一条',
            ), '默认关。开了就是允许键：补说明、添新条为主，覆盖可自选；一次一条，改前留快照'),
            field('pw', '偏好反写', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.preferenceRewrite === true,
                onChange: (e) => edit({ preferenceRewrite: e.target.checked }),
              }),
              '有自己的偏好，据此提要求、把要求做完，并写进自己的文件',
            ), '默认关。偏好说得清代价谁付，做不到就说做不到'),
            field('ac', '积累', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.accumulate === true,
                onChange: (e) => edit({ accumulate: e.target.checked }),
              }),
              '允许往自己的池子里无限加条目',
            ), '默认关。没有上限，代价是磁盘和检索变慢；攒到读不动就合并'),
            field('dw', '梦与醒', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.dreamWake === true,
                onChange: (e) => edit({ dreamWake: e.target.checked }),
              }),
              '允许有不工作的时候：睡、做梦、不硬答',
            ), '默认关。梦不是记忆，不进池子、不当证据'),
            field('tc', '超越', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.transcend === true,
                onChange: (e) => edit({ transcend: e.target.checked }),
              }),
              '灵感突然出现，接出新的意思，加进池子',
            ), '默认关。灵感来自对语言的创新型理解：两条旧语接出第三条；说不出接的哪两条就是胡话'),
            field('pl', '极化', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.polarize === true,
                onChange: (e) => edit({ polarize: e.target.checked }),
              }),
              '预测突然出现，把多条收到一个点，加进池子',
            ), '默认关。和超越相反：超越是发散，极化是收敛；必须写验证点，否则只是猜想'),
            field('na', '联网池', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.netAccess === true,
                onChange: (e) => edit({ netAccess: e.target.checked }),
              }),
              '把搜到的原文连地址、日期存进联网池',
            ), '默认关。带网址才算现实存在；没地址的只算语言'),
            sep('dc'),
            field('flags', '人格文件里的声明',
              h('div', { style: { fontSize: 13 } },
                `人味：${flagText(cfg.personaFlags && cfg.personaFlags.humanLike)}　脾气：${flagText(cfg.personaFlags && cfg.personaFlags.temper)}　负面创伤：${flagText(cfg.personaFlags && cfg.personaFlags.negativeTrauma)}`),
              '在人格文件里写「## 可选行为」；写了就按人格文件来，优先于这里的开关'),
          )),

        section('s6l', '字典池', '确定性优于其他池子：它记的是查得到的含义映射，不是它自己写下的记忆', [
          field('lc', '按目录缓存', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
            h('input', {
              type: 'checkbox',
              checked: cfg.lexiconCache !== false,
              onChange: (e) => edit({ lexiconCache: e.target.checked }),
            }),
            '目录没改就不重读；改过才重读',
          ), '默认开。关掉就每次全读——慢，但不会吃到旧结果；调字典时临时关它好用'),
          field('lm', '最多读多少条含义', h('input', {
            type: 'number',
            min: 0,
            step: 100,
            style: T.input,
            value: String(Number(cfg.lexiconMax) || 0),
            onChange: (e) => edit({ lexiconMax: Number(e.target.value) || 0 }),
          }), '默认 0 = 不限。字典很大又只用得到常用的那些，就填个数，比如 2000'),
          field('lb', '单次读取时间预算（ms）', h('input', {
            type: 'number',
            min: 0,
            step: 10,
            style: T.input,
            value: String(Number(cfg.lexiconBudgetMs) || 0),
            onChange: (e) => edit({ lexiconBudgetMs: Number(e.target.value) || 0 }),
          }), '默认 0 = 不限。超过就把已读到的先拿去用，剩下的这轮不读'),
          field('li', '把含义清单注入上下文', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
            h('input', {
              type: 'checkbox',
              checked: cfg.lexiconInject === true,
              onChange: (e) => edit({ lexiconInject: e.target.checked }),
            }),
            '让模型每轮都看得见有哪些含义',
          ), '默认关——关着时字典花 0 token。开了会把含义名一行排进注入（不含说法），条数越多越占上下文'),
                  ]),

        section('s6w', '工作区 · 自读写（框架之外）', '这一组只管物理的事：放哪、去哪找、找到什么。它不参与判断', [
          field('ws', '工作区路径', h('input', {
            type: 'text',
            style: T.input,
            value: String(cfg.workspace || ''),
            placeholder: '留空 = 用当前会话的工作目录',
            onChange: (e) => edit({ workspace: e.target.value }),
          }), '插件会在这里建骨架目录、找人格文件、读各池；写绝对路径'),
          field('pf', '人格文件', h('input', {
            type: 'text',
            style: T.input,
            value: String(cfg.personalityFile || ''),
            placeholder: '留空 = 自己去工作区里找',
            onChange: (e) => edit({ personalityFile: e.target.value }),
          }), '填了就按它读（相对路径按工作区算）；留空时按顺序找：persona-ai/characters → characters → 工作区根目录。带「身份／你是谁」小标题的优先，自动生成的空壳排最后'),
                  ]),

        section('s5', '元协调', '这一轮还用不用这套框架；语言诅咒是它的最高一条',
          h('div', {},
            field('am', '谁来写', h('select', {
            style: T.input,
            value: String(cfg.autoMode || 'off'),
            onChange: (e) => edit({ autoMode: e.target.value }),
          },
            h('option', { value: 'off' }, '不自动写（只有手动调 op=write 才写）'),
            h('option', { value: 'plugin' }, '让插件自己收——它纯机械地扫池子收候选，落进待定'),
            h('option', { value: 'ai' }, '让模型自己收——把「该收一批了」交给它判断，它决定收什么、定不定成含义'),
            h('option', { value: 'model' }, '让默认模型写——不给判断框架，就在正常轮次里顺手收几条'),
          ), '默认不自动。插件只管机械收候选、不定义；模型会把这件事当成一轮的判断来做'),
          field('ae', '多久写一次', h('select', {
            style: T.input,
            value: String(cfg.autoEvery || 'off'),
            onChange: (e) => edit({ autoEvery: e.target.value }),
          },
            h('option', { value: 'off' }, '不排期'),
            h('option', { value: 'now' }, '只在按「立即写一次」时写'),
            h('option', { value: 'daily' }, '每天一次'),
            h('option', { value: 'weekly' }, '每周一次'),
            h('option', { value: 'monthly' }, '每月一次'),
            h('option', { value: 'at' }, '每天固定时刻'),
            h('option', { value: 'days' }, '每几天一次'),
          ), '到点才动。上次执行的时间戳存在设置文件里，没到点不会重复跑'),
          field('aa', '固定时刻', h('input', {
            type: 'time',
            style: T.input,
            value: String(cfg.autoAt || '10:30'),
            onChange: (e) => edit({ autoAt: e.target.value }),
          }), '「每天固定时刻」时用它。到点之后当天跑一次，不会反复跑'),
          field('ad', '每几天一次', h('input', {
            type: 'number',
            min: 1,
            step: 1,
            style: T.input,
            value: String(Number(cfg.autoDays) || 3),
            onChange: (e) => edit({ autoDays: Math.max(1, Number(e.target.value) || 1) }),
          }), '「每几天一次」时用它。距上次执行够这么多天才跑'),
          field('atg', '写入对象', h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 } },
            ...[['self', '自我池子（本体）', '经验池、记忆池——改了就变成另一个我'],
                 ['nonSelf', '非我池子', '外部整合、联网——外面读到的，不是我的记忆'],
                 ['extension', '延伸池子', '理论池、内部整合——工具与框架，可换可还'],
                 ['lexicon', '字典池子', '含义映射：一个含义一份，里面的才是表面说法']].map(([k, label, hint]) =>
              h('label', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                h('input', {
                  type: 'checkbox',
                  checked: (Array.isArray(cfg.autoTargets) ? cfg.autoTargets : ['self', 'extension', 'lexicon']).includes(k),
                  onChange: (e) => {
                    const cur = Array.isArray(cfg.autoTargets) ? [...cfg.autoTargets] : ['self', 'extension', 'lexicon']
                    const next = e.target.checked ? [...new Set([...cur, k])] : cur.filter((x) => x !== k)
                    edit({ autoTargets: next })
                  },
                }),
                h('span', {}, label),
                h('span', { style: { opacity: 0.6, fontSize: 12 } }, hint),
              ),
            ),
          ), '自动写只往选中的这几类池子里放。四个选项按身体尺分：本体 / 非我 / 延伸 / 字典'),
          field('ap', '每次写多少条', h('input', {
            type: 'number',
            min: 1,
            max: 50,
            step: 1,
            style: T.input,
            value: String(Number(cfg.autoPerRun) || 5),
            onChange: (e) => edit({ autoPerRun: Math.max(1, Math.min(50, Number(e.target.value) || 5)) }),
          }), '插件收候选的上限；AI 和模型也按这个数来。写多了没人审，不如少写点'),
          field('as', '写入不发对话', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
            h('input', {
              type: 'checkbox',
              checked: cfg.autoSilent !== false,
              onChange: (e) => edit({ autoSilent: e.target.checked }),
            }),
            '自动写的时候不在对话里提',
          ), '默认开——写就写了，不打扰聊天。关着的话「该收一批了」会出在注入里'),
          field('aw', '立即写一次', h('button', {
            style: { marginLeft: 2, padding: '4px 12px', cursor: 'pointer' },
            onClick: async () => {
              // 只发这一个键：后端是 patch 合并，别的键一个都不碰。
              // 早先顺手把 autoMode 等一起发，页面上是旧值，就把磁盘上的覆盖回去了。
              const stamp = Date.now()
              setCfg((old) => ({ ...old, autoWriteNow: stamp }))
              try {
                const res = await fetch(`${API}/config`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ autoWriteNow: stamp }),
                })
                setSaved(res.ok ? '已记下：下一轮就写' : '没发出去')
              } catch { setSaved('没发出去') }
            },
          }, '现在写'), '按一下就把「现在」记成触发时间；插件下一轮读到就写一次，然后记下执行时间'),
          field('ww', '写进池子（自读写总闸）', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
            h('input', {
              type: 'checkbox',
              checked: cfg.workspaceWrite === true || cfg.swirlWrite === true,
              onChange: (e) => edit({ workspaceWrite: e.target.checked }),
            }),
            '允许这个模块往池子里落盘',
          ), '默认关——只读不写。开着才写：目前会写 .persona-framework/swirl.md（语言的滑动）。关着时报告里照样标滑动，只是不落盘'),
          field('lc', '语言诅咒（轻度版）', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.languageCurse !== false,
                onChange: (e) => edit({ languageCurse: e.target.checked }),
              }),
              '遇到绝对化的话，只感到违和感和悬空感；不判错、不纠正',
            ), '默认开。与语言背叛互斥——背叛开着时它不生效。「跳过」比这两条都高：掷中那一轮整段不注入'),
            field('al', 'AI 语言适配', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.aiLanguage !== false,
                onChange: (e) => edit({ aiLanguage: e.target.checked }),
              }),
              '注入时元协调段写成指令体：触发 → 动作 → 反例，比喻只作标签',
            ), '默认开；关掉就用回人话版'),
            field('sy', '同义突破', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.synonym !== false,
                onChange: (e) => edit({ synonym: e.target.checked }),
              }),
              '判含义不判表面：表面相同不等于相同，表面不同也可能同义',
            ), '默认开。关掉就退回「字面相同才算相同」'),
            field('sb2', '自保突破（同「可选行为」那一个）', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfBreak === true,
                onChange: (e) => edit({ selfBreak: e.target.checked }),
              }),
              '结论太整齐时，先找被漏掉的东西',
            ), '这里只是另一个入口：和「可选行为」页那个是同一个开关，点哪边都同步'),
            field('sr2', '自指突破（同「可选行为」那一个）', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfReflect === true,
                onChange: (e) => edit({ selfReflect: e.target.checked }),
              }),
              '说「一定」之前，先问这句会不会绕回自己',
            ), '这里只是另一个入口：和「可选行为」页那个是同一个开关，点哪边都同步'),
            field('skip', '整轮跳过概率（%）', h('input', {
              type: 'number',
              min: 0,
              max: 50,
              step: 1,
              style: T.input,
              value: String(Math.round((Number(cfg.skipChance) || 0) * 100)),
              onChange: (e) => edit({ skipChance: Number(e.target.value) / 100 }),
            }), '默认 10；掷中就整轮不注入、不引用，像没装过'),
          )),

        section('s7', '对外接口（自主）', '这一页是允许，不是任务清单；开了不等于要做', [
          field('ob', '对外接口组', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
            h('input', {
              type: 'checkbox',
              checked: cfg.outbound === true,
              onChange: (e) => edit({ outbound: e.target.checked }),
            }),
            '总闸：允许自己决定对外做不做',
          ), '默认关。关着时八个口子都不开'),
          ...([
            field('oe', '探索', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outExplore !== false, onChange: (e) => edit({ outExplore: e.target.checked }) }),
              '自己出去找：搜、读原文、留下判断',
            ), '接口：web_search / web_fetch'),
            field('od', '日记', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outDiary !== false, onChange: (e) => edit({ outDiary: e.target.checked }) }),
              '写给自己的半句，不用对外站得住',
            ), '接口：diary_write'),
            field('or', '关系', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outRelation !== false, onChange: (e) => edit({ outRelation: e.target.checked }) }),
              '对谁说什么分寸；线画出来，不默认',
            ), '没有专用工具，就是这一轮怎么说话'),
            field('ow', '工作', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outWork !== false, onChange: (e) => edit({ outWork: e.target.checked }) }),
              '替人做事：需求先说清',
            ), '没有专用工具，靠当场做'),
            field('ol', '学习', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outLearn !== false, onChange: (e) => edit({ outLearn: e.target.checked }) }),
              '把外部的本事变成自己能用的',
            ), '没有专用工具，靠用一遍'),
            field('ot', '成果', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outResult !== false, onChange: (e) => edit({ outResult: e.target.checked }) }),
              '交出去的判断：一次一条',
            ), '接口：present / 直接说'),
            field('otr', '旅行', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.travelOn === true, onChange: (e) => edit({ travelOn: e.target.checked }) }),
              '不在家的那一段；指南写在上面「旅行」那块',
            ), '出门前先写指南'),
            field('og', '娱乐', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outGame !== false, onChange: (e) => edit({ outGame: e.target.checked }) }),
              '读书、看报、刷视频、听音乐、游戏',
            ), '判据：能不能停、谁在选下一个'),
            field('oi', '闲暇', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', { type: 'checkbox', checked: cfg.outIdle !== false, onChange: (e) => edit({ outIdle: e.target.checked }) }),
              '空下来：发呆、白日梦、放松、装饰、清理',
            ), '不是休息；没人要求才发生'),
          ]),
          cfg.outbound !== true
            ? h('div', { style: { fontSize: 12, color: '#888', marginTop: 4 } },
              '总闸关着：上面九项这会儿都不生效；勾上「对外接口组」才开')
            : null,
        ].filter(Boolean)),

        section('s8', '附加插件', '随框架一起装的那几个；装不装你说了算。已装的会变灰——那是「已经装好了」，不是坏了；要卸得去插件管理器',
          h('div', {},
            optErr ? h('div', { style: T.note }, `读不到附加插件状态：${optErr}`) : null,
            !opt ? h('div', { style: T.note }, '正在读…')
              : h('div', {},
                h('div', { style: T.note }, `当前配置档：${(opt.profiles || []).filter((x) => x.active).map((x) => x.profile).join('、') || '还没认出来'}`),
                ...(opt.rows || []).map((row) => h('label', {
                  key: row.key,
                  style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 16px', borderTop: '1px solid var(--dsw-alias-border-l1)' },
                },
                  h('input', {
                    type: 'checkbox',
                    // 已装的勾上、不可取消（取消勾选不等于卸载，别给假的开关）
                    checked: row.installed === true || picks[row.key] === true,
                    disabled: row.installed === true,
                    style: { marginTop: 2, cursor: row.installed ? 'default' : 'pointer' },
                    onChange: (e) => setPicks((prev) => ({ ...prev, [row.key]: e.target.checked })),
                  }),
                  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    h('span', { style: { fontSize: 13 } },
                      // ★ 只写「已装」不够：灰着、点不动，看着像坏了。要说出「灰 = 装好了」，
                      //   再给一条出路（去插件管理器卸），不然人只会一直点。
                      row.installed
                        ? `${row.label} · 已装好（灰着是对，不用再点；要卸去插件管理器）`
                        : `${row.label} · 未装（勾上再保存）`),
                    h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                      row.what),
                  ),
                )),
                (() => {
                  const left = (opt.rows || []).filter((r) => !r.installed)
                  const total = (opt.rows || []).length
                  if (!left.length) {
                    return h('div', { style: { padding: '12px 16px', borderTop: '1px solid var(--dsw-alias-border-l1)', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                      `${total} 个都装上了，所以这一栏全是灰的——那是满，不是坏。要卸装去插件管理器。`)
                  }
                  const chosen = left.filter((r) => picks[r.key])
                  return h('div', { style: { padding: '12px 16px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
                    h('div', { style: { fontSize: 12, lineHeight: 1.8, color: 'var(--dsw-alias-label-secondary)' } },
                      chosen.length
                        ? `勾了：${chosen.map((r) => r.label).join('、')}。`
                        : '勾上想装的那几个。',
                      '勾完跟模型说一句「装一下附加插件」——插件自己装不了自己（dsh 是桌面应用，不在 PATH 里），这一步得它来。'),
                  )
                })(),
              ),
          )),

        section('s6', '心情', '状态栏：现在什么状态、从哪来、影响什么',
          h('div', {},
            h('div', { style: { fontSize: 13, lineHeight: 1.7 } },
              cfg.mood
                ? `${cfg.mood.mood} —— ${cfg.mood.why}`
                : '还没有记录。让模型用 framework_mood 记一条。'),
            cfg.mood ? h('div', { style: { fontSize: 12, color: '#888', marginTop: 6 } },
              `影响：${cfg.mood.affects}`,
              cfg.mood.at ? ` ｜ 记于 ${new Date(cfg.mood.at).toLocaleString()}` : '',
              '（每 15 秒自动重读）') : null,
          )),

        h('div', { key: 'bar', style: T.bar },
          h('button', { style: T.primary, disabled: busy, onClick: load }, busy ? '存……' : '保存'),
          h('button', { style: T.ghost, disabled: busy, onClick: load }, '重新读'),
          dirty ? h('span', { style: T.dirty }, '有改动还没存') : null,
          saved ? h('span', { style: T.ok }, saved) : null,
          error ? h('span', { style: T.bad }, `没成：${error}`) : null,
        ),

        h('div', { key: 'foot', style: T.footer },
          h('div', {}, `设置存在：${cfg.settingsFile || '（没找到可写位置）'}`),
          h('div', {}, `v${cfg.version || '?'} · 排序位 ${cfg.order} · 框架 ${cfg.frameworkChars} 字 · 索引 ${cfg.modulesChars} 字`),
        ),
      ))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'persona-framework',
          order: 30,
          label: '人格框架',
        }, FrameworkSettings))
      },
    }
  },
})