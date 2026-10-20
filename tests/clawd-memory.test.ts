import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { activeTurns, dayStamp, findConflicts, islandLabel, matchMemory, opOf, parseTurns } from '../hooks/memory'
import { STRINGS, pickLang } from '../hooks/i18n'
import { cardSvg, officeSvg } from '../hooks/office'

const HOME = '/Users/test'
const FILE = `${HOME}/.claude/clawd-memory/events-${dayStamp()}.jsonl`
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

// 模擬磁碟上那個共用事件檔，兩個假 session 共用它
const disk = new Map<string, string>()
let sid = 'aaaaaaaa-session-A'
let cwd = '/Users/me/Workspace'
const toasts: string[] = []

const engineBottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: sid }))
  on('session.cwd', () => ({ value: cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', (_$, e) => { toasts.push(JSON.stringify(e)); return { value: undefined } as never })
  on('process.run', (_$, e) => {
    if (e.argv[2] === 'printf %s "$HOME"') return { value: ok(HOME) }
    // 外掛用 sh -c '... printf "%s\n" "$1" >> "$2"' sh <line> <file>
    const line = String(e.argv[4]), file = String(e.argv[5])
    disk.set(file, (disk.get(file) ?? '') + line + '\n')
    return { value: ok() }
  })
  on('fs.exists', (_$, e) => ({ value: disk.has(String((e as { path: string }).path)) }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: (disk.get(String((e as { path: string }).path)) ?? '').length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => ({ value: disk.get(String((e as { path: string }).path)) ?? '' }))
  on('tool.call', () => ({ result: 'fake tool output' }) as never)
  mock.store(on)
  mock.clock(on)
}

test('路徑辨識：島名、讀寫判斷、同時寫入', async () => {
  expect(matchMemory('/Users/me/.claude/projects/-Users-me-Workspace-canline/memory/MEMORY.md')?.island).toBe('-Users-me-Workspace-canline')
  expect(matchMemory('/Users/Shared/claude-shared/memory-common/a.md')?.island).toBe('memory-common')
  expect(matchMemory('/Users/me/Workspace/README.md')).toBeUndefined()
  expect(islandLabel('-Users-me-Workspace')).toBe('主島')
  expect(islandLabel('-Users-me-Workspace-canline')).toBe('canline')
  expect(islandLabel('memory-index.md')).toBe('總目錄')
  expect(opOf('Edit', 'x')).toBe('w')
  expect(opOf('Bash', 'cat a.md')).toBe('r')
  expect(opOf('Bash', 'echo x >> a.md')).toBe('w')
  const w = (session: string, ts: number) => ({ ts, session, cwd: '/x/' + session, tool: 'Edit', op: 'w' as const, path: '/Users/Shared/claude-shared/memory-common/a.md', island: 'memory-common' })
  expect(findConflicts([w('A', 0), w('B', 60_000)]).length).toBe(1)
  expect(findConflicts([w('A', 0), w('B', 600_000)]).length).toBe(0)
  expect(findConflicts([w('A', 0), w('A', 1_000)]).length).toBe(0)
  // 回合標記：最後是 start 才算思考中；超過 30 分鐘當作已結束
  const text = [
    JSON.stringify({ ts: 1_000, session: 'A', cwd: '/a', turn: 'start' }),
    JSON.stringify({ ts: 2_000, session: 'A', cwd: '/a', turn: 'end' }),
    JSON.stringify({ ts: 3_000, session: 'B', cwd: '/b', turn: 'start' }),
    JSON.stringify({ ts: 3_000, session: 'C', cwd: '/c', tool: 'Read', op: 'r', path: '/x', island: 'x' }),
  ].join('\n')
  const marks = parseTurns(text)
  expect(marks.length).toBe(3)
  expect([...activeTurns(marks, 10_000).keys()].join(',')).toBe('B')
  expect(activeTurns(marks, 3_000 + 31 * 60_000).size).toBe(0)
})

test('辦公室舞台畫得出來，總控有多隻螃蟹的名牌', async () => {
  const svg = officeSvg({
    t: 1, clock: { h: 4, m: 30, s: 5 }, big: false, status: '總控 · 2 個 session 在動', mood: 'write',
    islands: [{ key: 'memory-common', label: '通用', color: '#B8F0B0', op: 'w', notes: 3, written: true }, { key: 'x', label: 'canline', color: '#A8D8FF', op: null, notes: 1, written: false }],
    crabs: [{ name: 'canline', color: '#D97757', target: 0, u: 1, mood: 'write' }, { name: 'Workspace', color: '#B794F4', target: null, u: 0, mood: 'idle' }],
  })
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('通用')
  expect(svg).toContain('Workspace')
  expect(svg.length < 131072).toBe(true)
})

test('兩個 session 寫進同一個事件檔；同時寫同一份會提醒；總控面板看得到兩邊', async ($, on) => {
  engineBottom(on)
  await $.session.start({ cwd, surface: 'desktop', isInteractive: true })

  // session A：讀總目錄(命中)、讀普通檔(不命中)
  await $.tool.call({ tool: 'Read', file_path: '/Users/Shared/claude-shared/memory-index.md' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/Workspace/README.md' } as never)
  const lines = () => (disk.get(FILE) ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  expect(lines().length).toBe(1)
  expect(lines()[0].op).toBe('r')
  expect(lines()[0].island).toBe('memory-index.md')

  // session B(另一個資料夾)：Bash 讀記憶島、Edit memory-common
  sid = 'bbbbbbbb-session-B'
  cwd = '/Users/me/Workspace/canline'
  await $.tool.call({ tool: 'Bash', command: 'cat ~/.claude/projects/-Users-me-Workspace-canline/memory/MEMORY.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/Users/Shared/claude-shared/memory-common/foo.md', old_string: 'a', new_string: 'b' } as never)
  expect(lines().length).toBe(3)
  expect(lines()[2].op).toBe('w')

  // 回到 A：也寫 foo.md → 兩分鐘內兩個 session 寫同一份
  sid = 'aaaaaaaa-session-A'
  cwd = '/Users/me/Workspace'
  await $.tool.call({ tool: 'Write', file_path: '/Users/Shared/claude-shared/memory-common/foo.md', content: 'x' } as never)
  const out = await $.command.run({ command: 'clawd', args: '總控' } as never)
  expect(String((out as { text?: string }).text)).toContain('總控')
  expect(toasts.some(t => t.includes('foo.md'))).toBe(true)

  const ui = await $.ui.mount({ plugin: 'clawd-memory', surface: 'desktop', component: 'Pane', requestId: 'clawd-memory', props: { title: 'x', isFocused: false } as never })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  const props = (svg as unknown as { props: { source: string; alt: string } }).props
  expect(props.source).toContain('一般辦公室')
  expect(props.source).toContain('canline')
  expect(props.alt).toContain('可能互相覆蓋')
  await ui.unmount()

  const term = await $.ui.mount({ plugin: 'clawd-memory', surface: 'terminal', component: 'Pane', requestId: 'clawd-memory', props: { title: 'x', isFocused: false } as never })
  expect(await term.find({ type: 'Text', text: /總控/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /foo\.md.*可能互相覆蓋/ })).toBeDefined()
  await term.unmount()
})

test('語言：auto 跟著 LANG，卡片用對應的文字', async () => {
  expect(pickLang('auto', 'zh_TW.UTF-8')).toBe('zh-TW')
  expect(pickLang('auto', 'en_US.UTF-8')).toBe('en')
  expect(pickLang('en', 'zh_TW.UTF-8')).toBe('en')
  const svg = cardSvg({
    mode: 'control', line1: ['ALL', '1 sessions · 0 memory folders'], line2: ['VIEW', 'who is touching which folder'], conflicts: [], tree: [], log: [], sessions: [], text: STRINGS.en.card,
    stage: { t: 0, clock: { h: 1, m: 2, s: 3 }, islands: [], crabs: [], big: false, status: 'All sessions · 0 idle', mood: 'idle', emptyBoard: STRINGS.en.card.emptyBoard },
  })
  expect(svg).toContain('All sessions')
  expect(svg).toContain('No memory touched today')
  expect(svg.includes('總控')).toBe(false)
})
