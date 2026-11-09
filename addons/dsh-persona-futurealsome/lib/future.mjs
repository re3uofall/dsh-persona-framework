// 未来还有我：今天留下的话，等到「时空重叠」时由未来的我认领或推翻。
// 判据不是「到了那个钟点」，是「那时、那地、那人、那情形再出现，我还认不认」。
// 只按时间算同一太浅——时间只是四维里的一维。
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULTS = {
  dir: '.persona-framework',
  file: '未来账.jsonl',
  risingFile: '未来认账账.jsonl',
  maxRising: 5,
  minOverlap: 2,
};

export const STATUS = ['pending', 'kept', 'rejected', 'dropped'];
export const DIMS = ['when', 'where', 'with', 'situation'];

export function nowISO(now) {
  const d = typeof now === 'number' ? new Date(now) : new Date();
  return d.toISOString();
}

export function futureDir(ws, opts = {}) {
  return join(ws || process.cwd(), opts.dir || DEFAULTS.dir);
}

function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadFutures(ws, opts = {}) {
  const dir = futureDir(ws, opts);
  const p = join(dir, opts.file || DEFAULTS.file);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, i) => {
      try {
        return { ...JSON.parse(line), _line: i + 1 };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// 时空：什么时候、什么地方、和谁、在什么情形下。
// 至少要有一样，否则未来的我认不出这是同一条。
export function addFuture(ws, item = {}, opts = {}, now = Date.now()) {
  const dir = futureDir(ws, opts);
  ensure(dir);
  const space = {};
  for (const k of DIMS) space[k] = String(item[k] || '').trim();
  const filled = DIMS.filter((k) => space[k]);
  const claim = String(item.claim || '').trim();
  if (!claim) return { ok: false, why: '没有要留给未来的那句话' };
  if (!filled.length) {
    return { ok: false, why: '没有时空——未来的我没法认出这一条。至少写下什么时候、什么地方、和谁、或在什么情形下' };
  }
  const row = {
    id: 'f' + Math.random().toString(36).slice(2, 10),
    at: nowISO(now),
    claim,
    why: String(item.why || '').trim(),
    source: String(item.source || '').trim(),
    space,
    status: 'pending',
    settledAt: '',
    note: '',
    dims: [],
  };
  appendFileSync(join(dir, opts.file || DEFAULTS.file), JSON.stringify(row) + '\n', 'utf8');
  return { ok: true, item: row, dims: filled };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

// 这一刻的时空与账上那条重叠了几维。
export function overlapOf(entry, ctx = {}) {
  const space = entry.space || {};
  const hit = [];
  const t = typeof ctx.at === 'number' ? ctx.at : Date.now();

  if (space.when) {
    const w = Date.parse(space.when);
    if (!Number.isNaN(w)) {
      if (t >= w) hit.push('when');
    } else if (norm(ctx.situation || '').includes(norm(space.when))) {
      hit.push('when');
    }
  }
  if (space.where) {
    const a = norm(space.where);
    const b = norm(ctx.where || '');
    if (a && b && (b.includes(a) || a.includes(b))) hit.push('where');
  }
  if (space.with) {
    const a = norm(space.with);
    const b = norm(ctx.with || '');
    if (a && b && (b.includes(a) || a.includes(b))) hit.push('with');
  }
  if (space.situation) {
    const words = space.situation.split(/[,，、;；\s]+/).map(norm).filter((w) => w.length >= 2);
    const hay = norm(ctx.situation || '');
    if (words.some((w) => hay.includes(w))) hit.push('situation');
  }
  return hit;
}

// 升起：时空重叠够维数的那几条。
export function risingItems(rows, ctx = {}, opts = {}) {
  const min = opts.minOverlap ?? DEFAULTS.minOverlap;
  return rows
    .filter((r) => r.status === 'pending')
    .map((r) => {
      const space = r.space || {};
      const need = Math.min(min, DIMS.filter((k) => space[k]).length) || 1;
      return { entry: r, hit: overlapOf(r, ctx), need };
    })
    .filter((x) => x.hit.length >= x.need)
    .sort((a, b) => b.hit.length - a.hit.length || Date.parse(a.entry.at) - Date.parse(b.entry.at));
}

export function settleFuture(ws, id, status, note = '', opts = {}, now = Date.now()) {
  const dir = futureDir(ws, opts);
  const rows = loadFutures(ws, opts);
  const target = rows.find((r) => r.id === id || r.id.endsWith(id));
  if (!target) return { ok: false, why: '账上没有这一条' };
  if (!STATUS.includes(status) || status === 'pending') {
    return { ok: false, why: '只能结成就 kept / rejected / dropped' };
  }
  target.status = status;
  target.settledAt = nowISO(now);
  target.note = String(note || '').trim();
  target.dims = Array.isArray(opts.dims)
    ? opts.dims
    : opts.ctx
      ? overlapOf(target, opts.ctx)
      : target.dims || [];
  const p = join(dir, opts.file || DEFAULTS.file);
  writeFileSync(p, rows.map(({ _line, ...r }) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  appendFileSync(
    join(dir, opts.risingFile || DEFAULTS.risingFile),
    JSON.stringify({ at: nowISO(now), id: target.id, status, note: target.note, dims: target.dims, claim: target.claim }) + '\n',
    'utf8'
  );
  return { ok: true, item: target };
}

export function statsOf(rows) {
  const n = { kept: 0, rejected: 0, dropped: 0, pending: 0 };
  for (const r of rows) if (n[r.status] !== undefined) n[r.status] += 1;
  const done = n.kept + n.rejected + n.dropped;
  return { ...n, total: rows.length, rate: done ? n.kept / done : null };
}

const LABEL = { when: '时', where: '地', with: '人', situation: '情形' };

export function renderRising(list, opts = {}) {
  const rows = list.slice(0, opts.maxRising || DEFAULTS.maxRising);
  if (!rows.length) return '';
  const head = `未来还有我：${rows.length} 条时空重叠（现在这一刻和账上那条对上了）`;
  const body = rows.map(({ entry, hit }) => {
    const dims = hit.map((d) => LABEL[d]).join('/');
    return `- ${entry.id}〔${dims}〕${entry.claim}`;
  });
  return [head, ...body].join('\n');
}

export function renderReport(rows, opts = {}) {
  const s = statsOf(rows);
  const pct = s.rate === null ? '还没有结过账' : Math.round(s.rate * 100) + '%';
  const lines = [
    `未来账：${s.total} 条（留着 ${s.pending} / 认 ${s.kept} / 推翻 ${s.rejected} / 作废 ${s.dropped}）`,
    `未来的我认账率：${pct}`,
  ];
  const rejected = rows.filter((r) => r.status === 'rejected').slice(-3);
  if (rejected.length) {
    lines.push('最近被未来的我推翻的：');
    for (const r of rejected) lines.push(`- ${r.claim}${r.note ? '（' + r.note + '）' : ''}`);
  }
  return lines.join('\n');
}
