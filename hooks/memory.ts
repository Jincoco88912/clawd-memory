// 記憶路徑的辨識與整理：純函式，不碰 $，方便測試。
import type { MemEvent, MemOp, TurnMark } from '../types'

// 記憶目錄的各種寫法：捷徑(~/.claude/projects/<島>/memory)、共用固定路徑、Drive 實體路徑
const PATTERNS: RegExp[] = [
  /\/\.claude(?:-work)?\/projects\/([^/\s'"]+)\/memory(?:\/[^\s'"]*)?/,
  /\/claude-shared\/memory\/([^/\s'"]+)(?:\/[^\s'"]*)?/,
  /\/claude-shared\/(memory-common)(?:\/[^\s'"]*)?/,
  /\/claude-shared\/(memory-index\.md)/,
]

/** 文字裡有記憶路徑就回傳那段路徑與它屬於哪座島。 */
export function matchMemory(text: string): { path: string; island: string } | undefined {
  for (const re of PATTERNS) {
    const m = re.exec(text)
    if (m) return { path: m[0], island: m[1] ?? '' }
  }
  return undefined
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const BASH_WRITES = /(>>?|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\btouch\b|\bln\b)/

/** 這次工具呼叫算讀還是寫。Bash 只看指令裡有沒有寫檔的動作，是推測。 */
export function opOf(tool: string, raw: string): MemOp {
  if (WRITE_TOOLS.has(tool)) return 'w'
  if (tool === 'Bash') return BASH_WRITES.test(raw) ? 'w' : 'r'
  return 'r'
}

/** 島的顯示名稱：主島、canline、通用、總目錄…… */
export function islandLabel(island: string, names = { index: '總目錄', common: '通用', home: '主島' }): string {
  if (island === 'memory-index.md') return names.index
  if (island === 'memory-common') return names.common
  const ws = /^-Users-[^-]+-Workspace(?:-(.+))?$/.exec(island)
  if (ws) return ws[1] ?? names.home
  return island.replace(/^-Users-[^-]+-?/, '') || island
}

const NOTE_COLORS = ['#A8D8FF', '#FFB3C7', '#E2C6FF', '#B5F0EA', '#FFD3A8', '#D9F99D', '#FBCFE8']

/** 便利貼顏色：總目錄黃、通用綠，其他依名稱固定配色。 */
export function islandColor(island: string): string {
  if (island === 'memory-index.md') return '#FFE27A'
  if (island === 'memory-common') return '#B8F0B0'
  let h = 0
  for (const ch of island) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return NOTE_COLORS[h % NOTE_COLORS.length]!
}

/** session 的顯示名稱：它開在哪個資料夾。 */
export function sessionLabel(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? '~'
}

export function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** 本地日期 YYYY-MM-DD，事件檔一天一個。 */
export function dayStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function eventsFile(home: string, d: Date = new Date()): string {
  return `${home}/.claude/clawd-memory/events-${dayStamp(d)}.jsonl`
}

/** 解析事件檔，壞行略過，只留最後 limit 筆。 */
export function parseEvents(text: string, limit = 2000): MemEvent[] {
  const out: MemEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as MemEvent
      if (typeof ev.ts === 'number' && typeof ev.session === 'string' && typeof ev.path === 'string') out.push(ev)
    } catch {
      // 寫到一半的行：下次再讀
    }
  }
  return out.slice(-limit)
}

/** 解析事件檔裡的回合標記(有 turn 欄位的行)。 */
export function parseTurns(text: string): TurnMark[] {
  const out: TurnMark[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('"turn"')) continue
    try {
      const m = JSON.parse(line) as TurnMark
      if (typeof m.ts === 'number' && typeof m.session === 'string' && (m.turn === 'start' || m.turn === 'end')) out.push(m)
    } catch {
      // 寫到一半的行
    }
  }
  return out
}

/** 每個 session 最後一個標記是 start、且不超過 30 分鐘：還在回合中(思考或工作)。 */
export function activeTurns(marks: TurnMark[], now: number, maxMs = 30 * 60_000): Map<string, TurnMark> {
  const last = new Map<string, TurnMark>()
  for (const m of marks) last.set(m.session, m)
  const out = new Map<string, TurnMark>()
  for (const [s, m] of last) if (m.turn === 'start' && now - m.ts < maxMs) out.set(s, m)
  return out
}

export type Conflict = { path: string; sessions: string[]; cwds: string[]; at: number }

/** 不同 session 在 windowMs 內寫同一份記憶：Drive 是最後寫的贏，可能有一邊被蓋掉。 */
export function findConflicts(events: MemEvent[], windowMs = 120_000): Conflict[] {
  const writes = events.filter(ev => ev.op === 'w')
  const byPath = new Map<string, MemEvent[]>()
  for (const ev of writes) {
    const key = baseName(ev.path) + '@' + ev.island
    byPath.set(key, [...(byPath.get(key) ?? []), ev])
  }
  const out: Conflict[] = []
  for (const list of byPath.values()) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!, b = list[i]!
      if (a.session !== b.session && b.ts - a.ts <= windowMs) {
        out.push({ path: b.path, sessions: [a.session, b.session], cwds: [a.cwd, b.cwd], at: b.ts })
      }
    }
  }
  return out
}
