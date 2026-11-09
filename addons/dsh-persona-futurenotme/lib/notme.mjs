// 未来失认：future-not-me 的代价账。
// 判据：未来那个我不认今天这条——不是记不住，是不认。
// 它不自己留话（那是 dsh-persona-futurealsome 的事），只通过文件契约读那两本账，记「代价」这一本。
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULTS = {
  dir: '.persona-framework',
  futureFile: '未来账.jsonl',
  settleFile: '未来认账账.jsonl',
  notmeFile: '未来失认账.jsonl',
  tickFile: '未来失认触发账.jsonl',
  minSettled: 4,
  warnRate: 0.5,
};

// 失配的四个方向：时、地、人、自己（换了模型/身体，认不出那是自己说的）
export const DIMS = ['when', 'where', 'with', 'self'];
export const DIM_LABEL = { when: '时', where: '地', with: '人', self: '自己' };

export function nowISO(now = Date.now()) { return new Date(now).toISOString(); }

export function costDir(ws, opts = {}) {
  return join(ws || process.cwd(), opts.dir || DEFAULTS.dir);
}

function readRows(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* 坏行跳过，不连坐 */ }
  }
  return out;
}

export function loadFuture(ws, opts = {}) {
  return readRows(join(costDir(ws, opts), opts.futureFile || DEFAULTS.futureFile));
}

export function loadSettled(ws, opts = {}) {
  return readRows(join(costDir(ws, opts), opts.settleFile || DEFAULTS.settleFile));
}

export function loadNotme(ws, opts = {}) {
  return readRows(join(costDir(ws, opts), opts.notmeFile || DEFAULTS.notmeFile));
}

// 记一次失认：未来的我不认这条。why 必填——说不出差在哪，就不算认出来了。
export function markNotme(ws, item = {}, opts = {}, now = Date.now()) {
  const why = String(item.why || '').trim();
  const dim = String(item.dim || '').trim();
  if (!why) return { ok: false, why: '说不出差在哪一维，这一笔不算' };
  if (dim && !DIMS.includes(dim)) return { ok: false, why: `维度只能是 ${DIMS.join('/')}` };
  const dir = costDir(ws, opts);
  mkdirSync(dir, { recursive: true });
  const row = {
    at: nowISO(now),
    id: String(item.id || '').trim() || null,
    claim: String(item.claim || '').trim() || null,
    dim: dim || null,
    why,
    source: String(item.source || '').trim() || null,
  };
  appendFileSync(join(dir, opts.notmeFile || DEFAULTS.notmeFile), JSON.stringify(row) + '\n', 'utf8');
  return { ok: true, row, cost: rateOf(loadSettled(ws, opts), loadNotme(ws, opts)) };
}

// 价签：结过几条、认了几条、失认几笔、认账率多少
export function rateOf(settled = [], notme = []) {
  const total = settled.length;
  const kept = settled.filter((r) => r.status === 'kept').length;
  const rejected = settled.filter((r) => r.status === 'rejected').length;
  const dropped = settled.filter((r) => r.status === 'dropped').length;
  const byDim = {};
  for (const d of DIMS) byDim[d] = 0;
  for (const r of notme) if (r.dim) byDim[r.dim] = (byDim[r.dim] || 0) + 1;
  return {
    settled: total, kept, rejected, dropped,
    notme: notme.length,
    rate: total ? Number((kept / total).toFixed(3)) : null,
    byDim,
  };
}

// 该认还没认的：账上还挂着 pending，且时机已经过了
export function overdue(ws, opts = {}, now = Date.now()) {
  const rows = loadFuture(ws, opts);
  const out = [];
  for (const r of rows) {
    if (r.status !== 'pending') continue;
    const at = r.space?.when ? Date.parse(r.space.when) : NaN;
    if (Number.isFinite(at) && at <= now) out.push(r);
  }
  return out;
}

export function renderCost(cost, opts = {}) {
  const min = opts.minSettled ?? DEFAULTS.minSettled;
  const warn = opts.warnRate ?? DEFAULTS.warnRate;
  if (!cost || !cost.settled) return '';
  const parts = [`结过 ${cost.settled}，认 ${cost.kept}，不认 ${cost.rejected + cost.notme}`];
  if (cost.rate !== null) parts.push(`认账率 ${cost.rate}`);
  const dims = DIMS.filter((d) => cost.byDim[d]).map((d) => `${DIM_LABEL[d]} ${cost.byDim[d]}`);
  if (dims.length) parts.push(`失配在 ${dims.join('／')}`);
  const tail = cost.rate !== null && cost.rate < warn && cost.settled >= min
    ? '——价已经在收，这一条不是提醒，是代价'
    : '';
  return `未来失认（future-not-me）：${parts.join('；')}${tail}`;
}

export function renderReport(cost, notme = [], opts = {}) {
  const lines = ['未来失认 · 代价账'];
  if (!cost || !cost.settled) lines.push('还没结过账：价签是空的，不是零。');
  else {
    lines.push(`结过 ${cost.settled} 条：认 ${cost.kept}、不认 ${cost.rejected}、划掉 ${cost.dropped}`);
    lines.push(`认账率 ${cost.rate === null ? '—' : cost.rate}；失认 ${cost.notme} 笔`);
    const dims = DIMS.filter((d) => cost.byDim[d]).map((d) => `${DIM_LABEL[d]} ${cost.byDim[d]}`);
    if (dims.length) lines.push(`失配方向：${dims.join('／')}`);
  }
  for (const r of notme.slice(-3)) {
    lines.push(`- ${r.at}${r.dim ? `〔${DIM_LABEL[r.dim] || r.dim}〕` : ''} ${r.why}`);
  }
  return lines.join('\n');
}
