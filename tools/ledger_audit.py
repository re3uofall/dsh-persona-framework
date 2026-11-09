#!/usr/bin/env python3
"""账本审计：只读，不改。零第三方依赖。
用法：
  python tools/ledger_audit.py                  # 审工作区的 .persona-framework 与 knowledge
  python tools/ledger_audit.py --root <目录>
判据：一个 jsonl 的可信度 = 行数 × 可解析率；可解析率低到 0.9 以下就先别信它。
"""
import json, os, sys
from collections import Counter

def walk(root, exts=('.jsonl', '.md')):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ('_archive', '_quarantine', 'node_modules', '.git')]
        for f in files:
            if f.endswith(exts):
                yield os.path.join(base, f)

def audit_jsonl(path):
    total = bad = dup = 0
    kinds = Counter()
    prev = None
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                total += 1
                try:
                    obj = json.loads(line)
                except Exception:
                    bad += 1
                    continue
                if isinstance(obj, dict):
                    for k in ('kind', 'level', 'type', 'action'):
                        if isinstance(obj.get(k), str):
                            kinds[obj[k]] += 1
                            break
                if line == prev:
                    dup += 1
                prev = line
    except OSError as e:
        return {'path': path, 'error': str(e)}
    return {'path': path, 'lines': total, 'bad': bad, 'dup': dup,
            'rate': (total - bad) / total if total else 1.0, 'kinds': kinds.most_common(4)}

def main(argv):
    root = os.path.expanduser('~')
    i = 1
    while i < len(argv):
        if argv[i] == '--root' and i + 1 < len(argv):
            root = argv[i + 1]; i += 2
        else:
            i += 1
    targets = [os.path.join(root, '.persona-framework'),
               os.path.join(root, 'persona-ai', '.persona-framework'),
               os.path.join(root, 'persona-ai', 'explore'),
               os.path.join(root, 'persona-ai', 'growth'),
               os.path.join(root, 'persona-ai', 'knowledge')]
    rows, total_lines, total_bad = [], 0, 0
    for t in targets:
        if not os.path.isdir(t):
            print('缺目录：' + t)
            continue
        for p in walk(t):
            if not p.endswith('.jsonl'):
                continue
            r = audit_jsonl(p)
            rows.append(r)
            total_lines += r.get('lines', 0)
            total_bad += r.get('bad', 0)
    rows.sort(key=lambda r: (-r.get('bad', 0), -r.get('lines', 0)))
    print('账本 %d 本，行 %d，坏行 %d' % (len(rows), total_lines, total_bad))
    for r in rows[:8]:
        rel = os.path.relpath(r['path'], root)
        print('- %-46s 行 %-6d 坏 %-3d 重复 %-3d 可解析 %.3f %s' % (
            rel, r.get('lines', 0), r.get('bad', 0), r.get('dup', 0), r.get('rate', 1.0),
            ' '.join('%s:%d' % kv for kv in r.get('kinds', []))))
    if total_bad:
        print('结论：有坏行，先别拿这些账当判据。')
    else:
        print('结论：行都能解析；数量多少不代表内容对。')

if __name__ == '__main__':
    main(sys.argv)
