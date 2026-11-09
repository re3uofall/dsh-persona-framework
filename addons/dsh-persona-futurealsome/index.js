// dsh-persona-futurealsome — 未来还有我。
// 今天留下一条带「时空」的话；等那一刻再出现（那时/那地/那人/那情形），由未来的我认领或推翻。
// 不是定时提醒：只按时间重叠太浅，时间只是四维里的一维。
import {
  DEFAULTS,
  DIMS,
  loadFutures,
  addFuture,
  risingItems,
  settleFuture,
  statsOf,
  renderRising,
  renderReport,
  overlapOf,
} from './lib/future.mjs';

export const name = 'dsh-persona-futurealsome';
export const version = '0.1.0';
export const inject = ['systemPrompt', 'tools'];

const DEFAULTS_CFG = { order: 18, maxRising: 5, dir: DEFAULTS.dir };

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }];
  },
};

function lastUserText(payload) {
  try {
    const msgs = payload?.messages || payload?.agent?.messages || [];
    if (!Array.isArray(msgs)) return '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m || m.role !== 'user') continue;
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join(' ');
      }
    }
  } catch {}
  return '';
}

function cwdOf(payload) {
  try {
    return payload?.agent?.session?.header?.cwd || '';
  } catch {
    return '';
  }
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS_CFG, ...config };
  const state = { ws: '', now: { at: Date.now(), where: '', with: '', situation: '' } };

  const ws = () => state.ws || process.cwd();
  const rows = () => loadFutures(ws(), cfg);
  const rising = () => risingItems(rows(), state.now, { minOverlap: cfg.minOverlap });

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const cwd = cwdOf(payload);
        if (cwd) state.ws = cwd;
        state.now = {
          at: Date.now(),
          where: cwd || state.ws,
          with: '师父',
          situation: lastUserText(payload),
        };
      } catch {}
      return next();
    });
  } catch {}

  if (ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: '实时环境:futurealsome',
      order: cfg.order,
      text: () => {
        try {
          return renderRising(rising(), { maxRising: cfg.maxRising });
        } catch {
          return '';
        }
      },
    });
  }

  const tools = [];

  tools.push({
    name: 'future_leave',
    description:
      '留一句话给未来的我：写清楚这段时间/地点/和谁/在什么情形下再算同一条。到那一刻，未来的我认不认它，就是人格同一的证据。',
    parameters: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: '留给未来的那句话（一句，能被认或能被打脸）' },
        why: { type: 'string', description: '为什么留它（可省）' },
        when: { type: 'string', description: '什么时候再算（ISO 时间或一句话，可省）' },
        where: { type: 'string', description: '什么地方/目录/场景（可省）' },
        who: { type: 'string', description: '和谁（可省，默认师父）' },
        situation: { type: 'string', description: '什么情形下（几个关键词，逗号分开，可省）' },
        source: { type: 'string', description: '出处（原话、文件、链接，可省）' },
      },
      required: ['claim'],
      additionalProperties: false,
    },
    output: textOutput,
    execute: ({ claim, why, when, where, who, situation, source }) => {
      const r = addFuture(ws(), { claim, why, when, where, with: who || '师父', situation, source }, cfg);
      if (!r.ok) return { text: r.why };
      return {
        text: `留下了：${r.item.id}〔${r.dims.join('/')}〕${r.item.claim}\n未来的我认不认，等那一刻再结账。`,
      };
    },
  });

  tools.push({
    name: 'future_rising',
    description: '看现在这一刻和账上哪几条时空重叠了（不传参就用当前会话的目录与上一句原话判断）。',
    parameters: {
      type: 'object',
      properties: {
        where: { type: 'string', description: '按这个地点算（可省）' },
        who: { type: 'string', description: '按这个对象算（可省）' },
        situation: { type: 'string', description: '按这段情形算（可省）' },
      },
      additionalProperties: false,
    },
    output: textOutput,
    execute: ({ where, who, situation } = {}) => {
      const ctxNow = {
        at: Date.now(),
        where: where ?? state.now.where,
        with: who ?? state.now.with,
        situation: situation ?? state.now.situation,
      };
      const list = risingItems(rows(), ctxNow, { minOverlap: cfg.minOverlap });
      if (!list.length) return { text: '这一刻没有哪条对上了（时空重叠不够维数）。' };
      const body = list
        .map(({ entry, hit }) => `- ${entry.id}〔${hit.join('/')}〕${entry.claim}`)
        .join('\n');
      return { text: `时空重叠 ${list.length} 条：\n${body}` };
    },
  });

  tools.push({
    name: 'future_settle',
    description: '结一条未来账：kept 未来的我认 / rejected 未来的我推翻 / dropped 不再需要。结账时把哪几维对上记下来。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '账上的 id 或它的尾部' },
        status: { type: 'string', enum: ['kept', 'rejected', 'dropped'] },
        note: { type: 'string', description: '为什么认/为什么推翻（一句）' },
      },
      required: ['id', 'status'],
      additionalProperties: false,
    },
    output: textOutput,
    execute: ({ id, status, note }) => {
      const list = rows();
      const hitEntry = list.find((r) => r.id === id || r.id.endsWith(id));
      const dims = hitEntry ? overlapOf(hitEntry, state.now) : [];
      const r = settleFuture(ws(), id, status, note || '', { ...cfg, dims });
      if (!r.ok) return { text: r.why };
      const word = { kept: '认了', rejected: '推翻了', dropped: '作废了' }[status] || status;
      return { text: `${word}：${r.item.claim}${dims.length ? `（对上：${dims.join('/')}）` : ''}` };
    },
  });

  tools.push({
    name: 'future_report',
    description: '未来账总览：留着几条、未来的我认了几条、推翻了几条，认账率多少。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput,
    execute: () => ({ text: renderReport(rows(), cfg) }),
  });

  for (const t of tools) ctx.tools?.register?.(t);
}
