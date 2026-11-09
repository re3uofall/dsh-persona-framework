// lib/card.mjs —— 卡片 + 使用信号 + 被取代的退出选择
//
// 抄自 dsh-soul 2.1 的三件事（形状，不是代码）：
//   1. 每次请求只摆一张小卡片（默认 600 字节），细节留在本地，要的时候按指针回捞；
//   2. 「被展示不等于被使用」——展示记一次，真被引用才记一次，两个数分开；
//   3. 被纠正/被取代的旧记录退出当前选择，但仍留在账上可追溯。
//
// 判据：卡片省的是前缀，不是记忆。指针丢了，卡片就是废话。

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const CARD = {
  budget: 600,
  lineMax: 90,
  useFile: '使用账.jsonl',
  showDecayHours: 6,
  useBoost: 1.4,
  showPenalty: 0.85,
};

const nowISO = (now = Date.now()) => new Date(now).toISOString();

function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* 目录已在就忽略 */
  }
}

export function useDir(ws, opts = {}) {
  return join(ws || process.cwd(), opts.dir || '.persona-framework');
}

export function loadUses(ws, opts = {}) {
  const file = join(useDir(ws, opts), opts.useFile || CARD.useFile);
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.pointer) out.push(row);
    } catch {
      /* 坏行跳过，不连坐 */
    }
  }
  return out;
}

function appendUse(ws, row, opts = {}) {
  const dir = useDir(ws, opts);
  ensureDir(dir);
  appendFileSync(join(dir, opts.useFile || CARD.useFile), JSON.stringify(row) + '\n', 'utf8');
  return row;
}

/** 展示：卡片里出现过一次。只是「露过脸」，不算被用。 */
export function noteShown(ws, pointers, opts = {}, now = Date.now()) {
  const rows = (pointers || []).filter(Boolean).map((p) => appendUse(ws, { at: nowISO(now), pointer: p, kind: 'shown' }, opts));
  return rows.length;
}

/** 使用：这一轮真按这条指针翻回去用了。这是唯一会让它往上浮的信号。 */
export function noteUse(ws, pointer, opts = {}, now = Date.now()) {
  if (!pointer) return null;
  return appendUse(ws, { at: nowISO(now), pointer, kind: 'used' }, opts);
}

/** 把使用账折成 pointer -> { shown, used, score }。越近越重，刚露脸的轻度扣分。 */
export function boostOf(uses, now = Date.now(), opts = {}) {
  const out = new Map();
  const halfLife = (opts.hours || CARD.showDecayHours) * 3600 * 1000;
  for (const row of uses || []) {
    const t = Date.parse(row.at || '');
    if (!Number.isFinite(t)) continue;
    const age = Math.max(0, now - t);
    const w = Math.pow(0.5, age / halfLife);
    const cur = out.get(row.pointer) || { shown: 0, used: 0 };
    if (row.kind === 'used') cur.used += w;
    else cur.shown += w;
    out.set(row.pointer, cur);
  }
  for (const [p, cur] of out) cur.score = 1 + cur.used * CARD.useBoost - cur.shown * CARD.showPenalty;
  return out;
}

/**
 * 被取代的退出选择：items 里带 supersedes/supersededBy 的，退出的只是「当前选择」，
 * 不删、不归档，仍能按指针翻回去。
 */
export function filterSuperseded(items = []) {
  const dead = new Set();
  for (const it of items) {
    if (it.supersededBy) dead.add(it.pointer || it.key || it.title);
    if (it.replacedBy) dead.add(it.pointer || it.key || it.title);
  }
  const live = [];
  const rest = [];
  for (const it of items) {
    const key = it.pointer || it.key || it.title;
    if (dead.has(key)) rest.push(it);
    else live.push(it);
  }
  return { live, retired: rest };
}

function clip(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

/**
 * 组卡片：按「图上分数 × 使用信号」挑，价格按渲染后字节算，加 32 字节固定开销，
 * 免得几十字节的碎片靠便宜霸占整张卡。
 */
export function buildCard(items = [], opts = {}, now = Date.now()) {
  const budget = opts.budget ?? CARD.budget;
  const lineMax = opts.lineMax ?? CARD.lineMax;
  const uses = opts.uses instanceof Map ? opts.uses : boostOf(opts.uses || [], now, opts);
  const { live, retired } = filterSuperseded(items);

  const scored = live.map((it) => {
    const key = it.pointer || it.key || it.title;
    const b = uses.get(key);
    const boost = b && Number.isFinite(b.score) ? b.score : 1;
    const base = Number(it.score ?? it.value ?? 1);
    const text = `- ${clip(it.title || it.head || it.line || key, lineMax)}（${key}）`;
    return { it, key, boost, base, text, bytes: Buffer.byteLength(text, 'utf8') + 32 };
  });

  scored.sort((a, b) => b.base * b.boost - a.base * a.boost);
  const picked = [];
  let left = budget;
  for (const row of scored) {
    if (row.bytes > left) continue;
    picked.push(row);
    left -= row.bytes;
  }
  const bytes = picked.reduce((n, r) => n + r.bytes, 0);
  return {
    at: nowISO(now),
    budget,
    bytes,
    picked: picked.map((r) => ({ key: r.key, text: r.text, boost: Number(r.boost.toFixed(2)) })),
    shown: picked.map((r) => r.key),
    retired: retired.map((it) => it.pointer || it.key || it.title),
    left,
  };
}

export function renderCard(card, opts = {}) {
  if (!card || !card.picked || !card.picked.length) return '';
  const head = `记忆卡片（${card.bytes}/${card.budget} 字节；细节在本地，按指针回捞）`;
  const lines = card.picked.map((p) => p.text);
  const tail = card.retired.length ? `（另有 ${card.retired.length} 条已被取代，退出当前选择，仍可按指针翻回）` : '';
  return [head, ...lines, tail].filter(Boolean).join('\n');
}

export function renderUseReport(uses, opts = {}, now = Date.now()) {
  const map = boostOf(uses, now, opts);
  if (!map.size) return '使用账还空着：卡片展过几次、真被翻回去几次，都还没记。';
  const rows = [...map.entries()].sort((a, b) => b[1].used - a[1].used).slice(0, 10);
  const lines = rows.map(([p, c]) => `- ${p}｜用 ${c.used.toFixed(2)}｜露脸 ${c.shown.toFixed(2)}｜分 ${c.score.toFixed(2)}`);
  const shownOnly = [...map.values()].filter((c) => c.used === 0).length;
  return [`使用账：${map.size} 条指针，其中 ${shownOnly} 条只露过脸没被用过。`, ...lines].join('\n');
}

/** 从记忆池里捞一批候选：标题取首个 # 行，指针是相对路径，分数按修改时间（越近越高）。 */
export function collectPools(root, opts = {}) {
  const maxFiles = opts.maxFiles || 400;
  const maxDepth = opts.maxDepth || 3;
  const skip = new Set(['_archive', '_quarantine', 'node_modules', '.git']);
  const out = [];
  const walk = (dir, rel, depth) => {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let names = [];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of names) {
      if (out.length >= maxFiles) return;
      if (skip.has(ent.name)) continue;
      const full = join(dir, ent.name);
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        walk(full, r, depth + 1);
        continue;
      }
      if (!/\.(md|jsonl)$/.test(ent.name)) continue;
      let title = ent.name;
      let size = 0;
      let mtime = 0;
      try {
        const st = statSync(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        continue;
      }
      if (ent.name.endsWith('.md')) {
        try {
          const head = readFileSync(full, 'utf8').split(/\r?\n/).find((l) => l.startsWith('# '));
          if (head) title = head.replace(/^#\s+/, '').trim();
        } catch {
          /* 读不了就用文件名 */
        }
      } else {
        title = ent.name.replace(/\.jsonl$/, '') + '（流水）';
      }
      out.push({ pointer: r, title, score: mtime / 1e12, bytes: size });
    }
  };
  walk(root, '', 0);
  out.sort((a, b) => b.score - a.score);
  return out;
}
