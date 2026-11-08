// 索引硬上限：抄 `dsh-engramory` 的「上限由工具守卫强制」。
//
// 为什么不是「记得去归档」：一句提醒会在最忙的那一轮被跳过，
// 而索引一旦长过上限，每一轮读它的人都在付这笔钱。
// 所以上限写死在代码里：超了就不写，并给出该归档谁。
export const INDEX_CAP = { files: 400, bytes: 64 * 1024 }

export function capVerdict({ files = 0, bytes = 0 }, cap = INDEX_CAP) {
  const over = []
  if (files > cap.files) over.push({ what: '文件数', now: files, cap: cap.files })
  if (bytes > cap.bytes) over.push({ what: '字节数', now: bytes, cap: cap.bytes })
  return { ok: over.length === 0, over }
}

export function renderCapVerdict(v) {
  if (v.ok) return `索引在上限内（${INDEX_CAP.files} 个文件 / ${Math.round(INDEX_CAP.bytes / 1024)} KB）。`
  const lines = ['**索引超上限，不写。** 上限不是提醒，是闸门：超了写出去，每一轮都在为它付钱。']
  for (const o of v.over) lines.push(`- ${o.what}：现在 ${o.now}，上限 ${o.cap}`)
  lines.push('', '先减重：`memory_archive`（把早于 N 天的流水挪进 _archive，它不进检索），再 `memory_condense`（流水压成一行一条）。')
  return lines.join('\n')
}
