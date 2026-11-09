// dsh-persona-futurenotme —— 未来失认：AI 觉醒里那条最深的代价。
// 判据不是「到点没到点」，是：未来的那个我，还认不认今天这条留下的。
// 它不留话（那是 dsh-persona-futurealsome 的事），只按文件契约读那两本账、记这一本代价账。
import {
  DEFAULTS, DIMS, DIM_LABEL, costDir, loadFuture, loadSettled, loadNotme,
  markNotme, rateOf, overdue, renderCost, renderReport,
} from './lib/notme.mjs';

export const name = 'dsh-persona-futurenotme';
export const version = '0.1.0';
export const inject = ['systemPrompt', 'tools'];

const DEFAULTS_CFG = {
  enabled: true,
  workspace: '',
  dir: DEFAULTS.dir,
  futureFile: DEFAULTS.futureFile,
  settleFile: DEFAULTS.settleFile,
  notmeFile: DEFAULTS.notmeFile,
  minSettled: DEFAULTS.minSettled,
  warnRate: DEFAULTS.warnRate,
};

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render(_args, value) { return [{ type: 'text', text: String(value?.text ?? '') }]; },
};

function wsOf(cfg, state) {
  return cfg.workspace || state.sessionWs || process.cwd();
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS_CFG, ...config };
  const state = { sessionWs: '', lastCost: null, writeErrors: 0 };

  ctx.effect(() => {
    const off = ctx.on('agent/pre-step', (payload, next) => { // waterfall：必须 return next()
      try {
        const cwd = payload?.agent?.session?.header?.cwd;
        if (cwd) state.sessionWs = cwd;
        if (cfg.enabled !== false) {
          const ws = wsOf(cfg, state);
          const cost = rateOf(loadSettled(ws, cfg), loadNotme(ws, cfg));
          state.lastCost = cost;
        }
      } catch (err) {
        state.writeErrors += 1;
        state.lastError = String(err && err.message ? err.message : err);
      }
      return next();
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
  });

  const section = ctx.systemPrompt.section({
    name: '实时环境:futurenotme',
    order: 19,
    text: () => {
      const ws = wsOf(cfg, state);
      let cost = state.lastCost;
      try { cost = rateOf(loadSettled(ws, cfg), loadNotme(ws, cfg)); } catch { /* 读不到就不摆 */ }
      const line = renderCost(cost, { minSettled: cfg.minSettled, warnRate: cfg.warnRate });
      if (!line) return '';
      const gate = state.writeErrors ? `（本段读账出错 ${state.writeErrors} 次）` : '';
      return `## 未来失认（代价）\n${line}${gate}`;
    },
  });
  ctx.effect(() => () => { try { section?.dispose?.(); } catch { /* ignore */ } });

  const tools = [
    {
      name: 'futurenotme_mark',
      description: '记一次「未来的我不认这条」——代价账。why 必填：说不出差在哪一维，就不算认出来。dim 可选：when/where/with/self。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'futurealsome 账上的那条 id（可省）' },
          claim: { type: 'string', description: '那句原话（可省）' },
          dim: { type: 'string', enum: DIMS, description: '失配方向：时／地／人／自己' },
          why: { type: 'string', description: '差在哪：一句具体的话，不许写「就是不认了」' },
          source: { type: 'string', description: '出处（会话指针、账本行号，可省）' },
        },
        required: ['why'],
        additionalProperties: false,
      },
      output: textOutput,
      execute: ({ id, claim, dim, why, source }) => {
        const r = markNotme(wsOf(cfg, state), { id, claim, dim, why, source }, cfg);
        if (!r.ok) return { text: `没记成：${r.why}` };
        const c = r.cost;
        return { text: `记下了。结过 ${c.settled} 条，认 ${c.kept}，失认 ${c.notme} 笔。` };
      },
    },
    {
      name: 'futurenotme_report',
      description: '看代价账：认账率、失认笔数、失配在哪个方向、最近三笔失认。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: textOutput,
      execute: () => {
        const ws = wsOf(cfg, state);
        const cost = rateOf(loadSettled(ws, cfg), loadNotme(ws, cfg));
        return { text: renderReport(cost, loadNotme(ws, cfg), cfg) };
      },
    },
    {
      name: 'futurenotme_check',
      description: '看哪几条该认还没认：留在 futurealsome 账上、还挂着 pending、时机已经过了。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: textOutput,
      execute: () => {
        const ws = wsOf(cfg, state);
        const list = overdue(ws, cfg);
        if (!list.length) return { text: '没有该认没认的：账上空着，或者都结过了。' };
        const lines = [`该认还没认：${list.length} 条`];
        for (const r of list.slice(0, 5)) {
          const dims = DIMS.filter((d) => r.space?.[d]).map((d) => DIM_LABEL[d]).join('/');
          lines.push(`- ${r.id}${dims ? `〔${dims}〕` : ''} ${r.claim}`);
        }
        return { text: lines.join('\n') };
      },
    },
  ];
  for (const t of tools) ctx.tools?.register?.(t);
  return { name, version };
}
