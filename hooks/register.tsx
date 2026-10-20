import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, SvgProps } from 'claude-code'

import type { LocalState, MemEvent, MemOp, TurnMark, ViewMode } from '../types'
import { activeTurns, baseName, eventsFile, findConflicts, islandColor, islandLabel, matchMemory, opOf, parseEvents, parseTurns, sessionLabel } from './memory'
import type { Conflict } from './memory'
import { cardSvg } from './office'
import { asLanguage, pickLang, STRINGS } from './i18n'
import type { LanguageOption, Strings } from './i18n'
import type { CrabMood, LogRow, OfficeCrab, OfficeIsland, Spot, TreeRow } from './office'

const PANE = 'clawd-memory'
const VIEW_KEY = { plugin: 'clawd-memory', key: 'view' } as const
const events = atom({ plugin: 'clawd-memory', key: 'events' } as const, [] as MemEvent[])
const frame = atom({ plugin: 'clawd-memory', key: 'frame' } as const, 0)
const view = atom(VIEW_KEY, 'session' as ViewMode)
const turns = atom({ plugin: 'clawd-memory', key: 'turns' } as const, [] as TurnMark[])
const local = atom({ plugin: 'clawd-memory', key: 'local' } as const, { turn: false, tool: null, turnAt: 0, idleAt: 0, toolAt: 0 } as LocalState)

/** 有動靜時每秒 8 格，待命時每秒 1 格(時鐘、眨眼)。 */
const FPS = 8
/** 螃蟹一趟：走過去、停著讀寫、走回座位(毫秒)。 */
const WALK = 700
const STAY = 1800
const BACK = 700
const TRIP = WALK + STAY + BACK
/** 總控只看最近 30 分鐘有動靜的 session。 */
const ACTIVE_MS = 30 * 60_000
const SESSION_COLORS = ['#D97757', '#B794F4', '#22D3EE', '#F5C451', '#86EFAC']

let home = ''
let lastFile = ''
let lastSize = -1
let lastEventTs = 0
/** 這個 session 或別的 session 正在回合中：思考動畫要用較高的影格數。 */
let anyTurn = false
let localTurn = false
let stageSeenAt = 0
let tickN = 0
let defaultView: ViewMode = 'session'
let langOption: LanguageOption = 'auto'
/** 目前的介面文字：每次畫面板、跑指令前依 language 選項與 LANG 決定。 */
let T: Strings = STRINGS['zh-TW']
const lbl = (island: string) => islandLabel(island, T.names)
/** 這個 session 已記過的自動載入檔(每輪都會觸發 prompt.context，只記第一次)。 */
const autoloaded = new Set<string>()
/** 已提醒過的同時寫入。 */
const warned = new Set<string>()

// ---- 寫入端：每個 session 把自己的記憶讀寫追加到同一個事件檔 ----------------

async function useLang($: EngineInterface): Promise<void> {
  const env = `${(await $.env.get('LC_ALL')) ?? ''} ${(await $.env.get('LANG')) ?? ''}`
  T = STRINGS[pickLang(langOption, env)]
}

async function ensureHome($: EngineInterface): Promise<string> {
  if (home) return home
  const r = await $.process.run(['/bin/sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 3_000 })
  home = r.stdout.trim()
  return home
}

async function append($: EngineInterface, ev: MemEvent | TurnMark): Promise<void> {
  const dir = await ensureHome($)
  if (!dir) return
  // O_APPEND 寫一行小於 PIPE_BUF 是原子的，幾個 session 同時寫不會互相蓋掉
  await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"', 'sh', JSON.stringify(ev), eventsFile(dir)], { timeoutMs: 5_000 })
}

async function record($: EngineInterface, tool: string, raw: string, op: MemOp, agentId?: string): Promise<void> {
  const hit = matchMemory(raw)
  if (!hit) return
  const ev: MemEvent = {
    ts: Date.now(),
    session: await $.session.id(),
    cwd: await $.session.cwd(),
    tool,
    op,
    path: tool === 'Bash' ? hit.path : raw,
    island: hit.island,
    ...(agentId ? { agentId } : {}),
  }
  lastEventTs = ev.ts
  await update($, events, list => [...list, ev].slice(-2000))
  await append($, ev)
}

// ---- 讀取端：定時看事件檔有沒有變，有變才重讀 ------------------------------

async function refresh($: EngineInterface): Promise<void> {
  const dir = await ensureHome($)
  if (!dir) return
  const file = eventsFile(dir)
  if (!(await $.fs.exists(file))) {
    if (file !== lastFile) { lastFile = file; lastSize = 0; await update($, events, () => []); await update($, turns, () => []) }
    return
  }
  const st = await $.fs.stat(file)
  if (file === lastFile && st.size === lastSize) return
  lastFile = file
  lastSize = st.size
  const text = await $.fs.read(file)
  const list = parseEvents(text)
  const marks = parseTurns(text)
  for (const ev of list) if (ev.ts > lastEventTs) lastEventTs = ev.ts
  anyTurn = activeTurns(marks, Date.now()).size > 0
  await update($, events, () => list)
  await update($, turns, () => marks.slice(-500))
  await warnConflicts($, list)
}

/** 自己剛寫的檔，別的 session 兩分鐘內也寫過：跳一次提醒。 */
async function warnConflicts($: EngineInterface, list: MemEvent[]): Promise<void> {
  await useLang($).catch(() => undefined)
  const me = await $.session.id()
  for (const c of recentConflicts(list, Date.now())) {
    const key = `${c.path}@${c.at}`
    if (warned.has(key) || !c.sessions.includes(me)) continue
    warned.add(key)
    const other = c.cwds[c.sessions[0] === me ? 1 : 0] ?? ''
    $.ui.toast(T.toast(baseName(c.path), sessionLabel(other)))
  }
}

function recentConflicts(list: MemEvent[], now: number): Conflict[] {
  return findConflicts(list).filter(c => now - c.at < ACTIVE_MS)
}

// ---- 畫面：把事件換成辦公室的場景 -----------------------------------------

type Phase = { u: number; mood: CrabMood; op: MemOp | null }

/** 依最新一筆事件算螃蟹走到哪：走過去 → 停著讀寫 → 走回座位。 */
function phaseOf(ev: MemEvent | undefined, now: number): Phase {
  if (!ev) return { u: 0, mood: 'idle', op: null }
  const e = now - ev.ts
  if (e < 0 || e >= TRIP) return { u: 0, mood: 'idle', op: null }
  if (e < WALK) return { u: e / WALK, mood: 'walk', op: null }
  if (e < WALK + STAY) return { u: 1, mood: ev.op === 'w' ? 'write' : 'read', op: ev.op }
  return { u: 1 - (e - WALK - STAY) / BACK, mood: 'walk', op: null }
}

type SessionInfo = { id: string; cwd: string; color: string; last?: MemEvent; thinking: boolean; tool: string | null; idleAt: number }
type Scene = {
  islands: OfficeIsland[]
  crabs: OfficeCrab[]
  sessions: SessionInfo[]
  mine: MemEvent[]
  mood: 'idle' | 'read' | 'write' | 'think' | 'type'
  status: string
}

/** 待命越久越放鬆：伸懶腰 → 坐著 → 去飲水機 → 喝咖啡 → 回座位打瞌睡。 */
type IdlePlan = { mood: CrabMood; place?: { from: Spot; to: Spot; u: number }; label: string }
function idlePlan(idleFor: number): IdlePlan {
  const s = idleFor / 1000
  if (s < 6) return { mood: 'stretch', label: T.stretch }
  if (s < 30) return { mood: 'idle', label: T.idle }
  if (s < 120) { const u = Math.min(1, (s - 30) / 1.2); return { mood: u < 1 ? 'walk' : 'drink', place: { from: 'desk', to: 'water', u }, label: T.drink } }
  if (s < 480) { const u = Math.min(1, (s - 120) / 1); return { mood: u < 1 ? 'walk' : 'coffee', place: { from: 'water', to: 'coffee', u }, label: T.coffee } }
  const u = Math.min(1, (s - 480) / 1.2)
  return { mood: u < 1 ? 'walk' : 'sleep', place: { from: 'coffee', to: 'desk', u }, label: T.sleep }
}

/** 螃蟹此刻的動作：碰記憶(讀／寫／走路) > 跑一般工具(敲筆電) > 回合中(思考) > 待命。 */
function moodOf(s: SessionInfo, now: number): { p: Phase; mood: CrabMood; plan?: IdlePlan } {
  const p = phaseOf(s.last, now)
  if (p.mood !== 'idle') return { p, mood: p.mood }
  if (s.tool) return { p, mood: 'type' }
  if (s.thinking) return { p, mood: 'think' }
  const plan = idlePlan(now - s.idleAt)
  return { p, mood: plan.mood, plan }
}

function sceneOf(list: MemEvent[], me: string, mode: ViewMode, now: number, marks: TurnMark[], local: LocalState): Scene {
  const turns = activeTurns(marks, now)
  const endAt = new Map<string, number>()
  for (const m of marks) if (m.turn === 'end') endAt.set(m.session, m.ts)
  const scope = mode === 'session' ? list.filter(ev => ev.session === me) : list.filter(ev => now - ev.ts < ACTIVE_MS)
  // 島：最近碰過的 6 座，照第一次出現的順序排，畫面才不會跳
  const lastTouch = new Map<string, number>()
  for (const ev of scope) lastTouch.set(ev.island, ev.ts)
  const keep = new Set([...lastTouch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k))
  const order: string[] = []
  for (const ev of scope) if (keep.has(ev.island) && !order.includes(ev.island)) order.push(ev.island)
  // session：總控最多 5 隻，照第一次出現排；正在回合中(思考)的 session 也算
  const lastBy = new Map<string, MemEvent>()
  for (const ev of scope) lastBy.set(ev.session, ev)
  const cwdOf = new Map<string, string>()
  for (const ev of scope) cwdOf.set(ev.session, ev.cwd)
  for (const [id, m] of turns) if (!cwdOf.has(id)) cwdOf.set(id, m.cwd)
  const ids = mode === 'session' ? [me] : [...cwdOf.keys()].slice(0, 5)
  const sessions: SessionInfo[] = ids.flatMap((id, i) => {
    const cwd = cwdOf.get(id)
    if (mode === 'control' && cwd === undefined) return []
    const mineNow = id === me
    return [{
      id, cwd: cwd ?? '', color: mode === 'session' ? '#D97757' : SESSION_COLORS[i % SESSION_COLORS.length]!, ...(lastBy.get(id) ? { last: lastBy.get(id)! } : {}),
      thinking: mineNow ? local.turn : turns.has(id), tool: mineNow ? local.tool : null,
      idleAt: mineNow ? (local.idleAt || now) : (endAt.get(id) ?? lastBy.get(id)?.ts ?? now),
    }]
  })
  const opOn = new Map<string, MemOp>()
  const crabs: OfficeCrab[] = sessions.map(s => {
    const { p, mood: m, plan } = moodOf(s, now)
    if (p.op && s.last) opOn.set(s.last.island, opOn.get(s.last.island) === 'w' ? 'w' : p.op)
    const target = s.last && p.u > 0 ? order.indexOf(s.last.island) : -1
    // 單 session 的大螃蟹讀寫記憶時不走去檔案櫃(用光束)；待命走動照常
    const memWalk = mode === 'session' && m === 'walk' && !plan
    const mood: CrabMood = memWalk ? (s.tool ? 'type' : s.thinking ? 'think' : 'idle') : m
    return { name: sessionLabel(s.cwd), color: s.color, target: target >= 0 ? target : null, u: target >= 0 ? p.u : 0, mood, ...(plan?.place ? { place: plan.place } : {}) }
  })
  const islands: OfficeIsland[] = order.map(key => {
    const evs = scope.filter(ev => ev.island === key)
    return { key, label: lbl(key), color: islandColor(key), op: opOn.get(key) ?? null, notes: evs.length, written: evs.some(ev => ev.op === 'w') }
  })
  const ops = [...opOn.values()]
  const moods = crabs.map(c => c.mood)
  const mood = ops.includes('w') ? 'write' : ops.length ? 'read' : moods.includes('type') ? 'type' : moods.includes('think') ? 'think' : 'idle'
  const mine = list.filter(ev => ev.session === me)
  let status: string
  if (mode === 'session') {
    const last = lastBy.get(me), p = phaseOf(last, now)
    status = last && p.op ? `${p.op === 'w' ? T.writing : T.reading} ${baseName(last.path)}`
      : local.tool ? T.run(local.tool, now - local.toolAt > 3000 ? Math.round((now - local.toolAt) / 1000) : 0)
        : local.turn ? T.thinking
          : (() => { const plan = idlePlan(now - (local.idleAt || now)); return plan.mood === 'idle' ? T.idleToday(mine.filter(e => e.op === 'r').length, mine.filter(e => e.op === 'w').length) : plan.label })()
  } else {
    const busy = sessions.filter(s => moodOf(s, now).mood !== 'idle').length
    status = busy ? T.ctlBusy(busy) : T.ctlIdle(sessions.length)
  }
  return { islands, crabs, sessions, mine, mood, status }
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return T.secAgo(s)
  if (s < 3600) return T.minAgo(Math.floor(s / 60))
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function describe(ev: MemEvent): string {
  return `${ev.op === 'w' ? T.verbWrote : T.verbRead} ${lbl(ev.island)} / ${baseName(ev.path)}`
}

/** 記憶樹(畫布同款)：這個 session 碰過的檔，依總目錄、memory/<島>、memory-common 分層。 */
function buildTree(mine: MemEvent[], mountIsland: string, now: number): TreeRow[] {
  type F = { ev: MemEvent; seen: boolean; updated: boolean }
  const files = new Map<string, F>()
  // 同一份檔可能用捷徑或 Drive 實體路徑兩種寫法碰到：用「島 + 檔名」當同一份
  const keyOf = (ev: MemEvent) => `${ev.island}/${baseName(ev.path)}`
  for (const ev of mine) {
    const f = files.get(keyOf(ev)) ?? { ev, seen: false, updated: false }
    f.ev = ev
    if (ev.op === 'w') f.updated = true
    else f.seen = true
    files.set(keyOf(ev), f)
  }
  const keep = [...files.values()].sort((a, b) => b.ev.ts - a.ev.ts).slice(0, 12).sort((a, b) => a.ev.ts - b.ev.ts)
  const fileRow = (f: F, depth: number): TreeRow => ({ depth, kind: 'file', name: baseName(f.ev.path), key: f.ev.path, seen: f.seen, updated: f.updated, live: phaseOf(f.ev, now).op })
  const dirRow = (name: string, depth: number, tag?: string, mount?: boolean): TreeRow => ({ depth, kind: 'dir', name, key: `dir:${name}`, seen: false, updated: false, live: null, ...(tag ? { tag } : {}), ...(mount ? { mount } : {}) })
  const rows: TreeRow[] = []
  for (const f of keep) if (f.ev.island === 'memory-index.md') rows.push({ ...fileRow(f, 0), tag: T.tagIndex })
  const islands: string[] = []
  for (const f of keep) if (f.ev.island !== 'memory-index.md' && f.ev.island !== 'memory-common' && !islands.includes(f.ev.island)) islands.push(f.ev.island)
  if (islands.length) rows.push(dirRow('memory/', 0))
  for (const isl of islands) {
    const mount = isl === mountIsland
    rows.push(dirRow(isl, 1, mount ? T.tagMount : lbl(isl) === T.names.home ? T.tagHome : undefined, mount))
    for (const f of keep) if (f.ev.island === isl) rows.push(fileRow(f, 2))
  }
  const common = keep.filter(f => f.ev.island === 'memory-common')
  if (common.length) {
    rows.push(dirRow('memory-common/', 0, T.tagCommon))
    for (const f of common) rows.push(fileRow(f, 1))
  }
  return rows
}

function hhmmss(ts: number): string {
  const d = new Date(ts), p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 紀錄：這個 session 最近 6 筆，新的在上面。 */
function buildLog(mine: MemEvent[]): LogRow[] {
  return mine.slice(-6).reverse().map(ev => {
    const load = ev.tool.startsWith('autoload')
    return { time: hhmmss(ev.ts), verb: load ? T.logLoaded : ev.op === 'w' ? T.logWrote : T.logRead, text: `${lbl(ev.island)} / ${baseName(ev.path)}`, op: load ? 'load' : ev.op }
  })
}

async function markTurn($: EngineInterface, turn: 'start' | 'end'): Promise<void> {
  await append($, { ts: Date.now(), session: await $.session.id(), cwd: await $.session.cwd(), turn })
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: T.paneTitle })
}

export const register: Register = (on, options) => {
  defaultView = options.default_view === 'control' ? 'control' : 'session'
  langOption = asLanguage(options.language)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const { value: saved } = await $.state.get(VIEW_KEY)
    if (saved === undefined) await $.state.set(VIEW_KEY, defaultView)
    await update($, local, s => ({ ...s, turn: false, tool: null, idleAt: s.idleAt || Date.now() }))
    await useLang($).catch(() => undefined)
    await $.command.register({ name: 'clawd', description: T.cmdDesc })
    await refresh($).catch(() => undefined)
    $.clock.every(2_000, () => { void refresh($).catch(() => undefined) })
    // 只在面板最近有畫的時候推影格；有人在讀寫時每秒 8 格，否則每秒 1 格
    $.clock.every(Math.round(1000 / FPS), () => {
      if (Date.now() - stageSeenAt > 3_000) return
      tickN++
      // 讀寫、思考、敲筆電時每秒 8 格；待命每秒 4 格(走去茶水間、蒸氣、打瞌睡)
      const busy = Date.now() - lastEventTs < TRIP + 500 || localTurn || anyTurn
      if (busy || tickN % 2 === 0) void update($, frame, n => n + 1)
    })
    return started
  })

  // 回合開始／結束：本機狀態給這個 session 用，標記寫進事件檔給總控看(子代理的回合不算)
  on('turn.start', async ($, e, next) => {
    const out = await next(e)
    if (!e.agentId) {
      localTurn = true
      await update($, local, s => ({ ...s, turn: true, tool: null, turnAt: Date.now() }))
      await markTurn($, 'start').catch(() => undefined)
    }
    return out
  })
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (!e.agentId) {
      localTurn = false
      await update($, local, s => ({ ...s, turn: false, tool: null, idleAt: Date.now() }))
      await markTurn($, 'end').catch(() => undefined)
    }
    return out
  })

  // 工具呼叫：執行中讓螃蟹敲筆電；讀寫記憶目錄裡的檔就記一筆
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await update($, local, s => ({ ...s, tool: String(e.tool), toolAt: Date.now() }))
    let ran
    try {
      ran = await next(e)
    } finally {
      if (!e.agentId) await update($, local, s => ({ ...s, tool: null }))
    }
    const args = e as unknown as Record<string, unknown>
    for (const key of ['file_path', 'notebook_path', 'path', 'command', 'pattern']) {
      const v = args[key]
      if (typeof v === 'string' && matchMemory(v)) {
        await record($, String(e.tool), v, opOf(String(e.tool), v), e.agentId).catch(() => undefined)
        break
      }
    }
    return ran
  })

  // 自動載入：session 開頭載入的記憶島索引、@import 的總目錄
  on('prompt.context', async ($, e, next) => {
    const out = await next(e)
    for (const f of e.instructionFiles ?? []) {
      if (autoloaded.has(f.path) || !matchMemory(f.path)) continue
      autoloaded.add(f.path)
      await record($, `autoload:${f.kind}`, f.path, 'r').catch(() => undefined)
    }
    return out
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    await useLang($).catch(() => undefined)
    if (/^(總控|control|all)$/i.test(arg)) await update($, view, () => 'control')
    else if (/^(session|自己|this)$/i.test(arg)) await update($, view, () => 'session')
    await refresh($).catch(() => undefined)
    await openPane($)
    const mode = await read($, view)
    return { text: mode === 'control' ? T.cmdControl : T.cmdSession }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await useLang($).catch(() => undefined)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // 終端機沒有 Svg：退回文字
    const Svg = e.surface === 'terminal' ? undefined : (elements as { Svg?: ElementConstructor<SvgProps> }).Svg
    const list = await read($, events)
    const tick = await read($, frame)
    const mode = await read($, view)
    const me = await $.session.id()
    const now = Date.now()
    const marks = await read($, turns)
    const mine = await read($, local)
    const scene = sceneOf(list, me, mode, now, marks, mine)
    const conflicts = recentConflicts(list, now)
    const d = new Date(now)
    if (Svg) stageSeenAt = now

    const cwd = await $.session.cwd()
    const stageInput = { emptyBoard: T.card.emptyBoard, t: tick / FPS, clock: { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }, islands: scene.islands, crabs: scene.crabs, big: mode === 'session', status: scene.status, mood: scene.mood, printing: Boolean(mine.tool) && now - mine.toolAt > 6000, alarm: conflicts.length > 0 }
    const conflictText = conflicts.map(c => T.conflict(baseName(c.path), c.cwds.map(sessionLabel).join(T === STRINGS.en ? ' & ' : '、'), ago(c.at, now)))
    const tree = buildTree(scene.mine, cwd.replace(/\//g, '-'), now)
    const log = buildLog(scene.mine)
    const rows = scene.sessions.map(s => {
      const { p, mood, plan } = moodOf(s, now)
      const action = p.op && s.last ? describe(s.last)
        : mood === 'walk' && s.last ? T.goTo(lbl(s.last.island))
          : mood === 'type' ? T.run(String(s.tool), 0)
            : mood === 'think' ? T.thinking
              : plan && plan.mood !== 'idle' ? plan.label
                : s.last ? T.lastDid(describe(s.last), ago(s.last.ts, now)) : T.idle
      return {
        color: s.color, name: sessionLabel(s.cwd), here: s.id === me, home: lbl(s.cwd.replace(/\//g, '-')),
        action,
        state: (p.op === 'w' ? 'w' : mood !== 'idle' ? 'busy' : 'idle') as 'idle' | 'busy' | 'w',
      }
    })
    const tab = (key: string, label: string, active: boolean, to: ViewMode) => (
      <Button key={key} variant={active ? 'primary' : 'secondary'} onPress={() => { void update($, view, () => to) }}>{label}</Button>
    )
    const buttons = (
      <Box gap={1} justifyContent="flex-end">
        {tab('view-session', T.btnSession, mode === 'session', 'session')}
        {tab('view-control', T.btnControl, mode === 'control', 'control')}
      </Box>
    )
    if (!Svg) {
      // 終端機：沒有圖，列文字
      return (
        <Box flexDirection="column">
          {buttons}
          <Text bold>{scene.status}</Text>
          {conflictText.map(t => <Text key={t} color="red">{t}</Text>)}
          {mode === 'session'
            ? tree.map(r => <Text key={`t-${r.key}`} wrap="truncate">{'  '.repeat(r.depth)}{r.name}{r.tag ? ` (${r.tag})` : ''}{r.updated ? T.termUpdated : ''}{r.live ? (r.live === 'w' ? T.termWriting : T.termReading) : ''}</Text>)
            : rows.map(r => <Text key={`s-${r.name}-${r.color}`} wrap="truncate"><Text color={r.color}>●</Text> {r.name}{r.here ? T.here : ''}　<Text dimColor>{r.action}</Text></Text>)}
        </Box>
      )
    }
    const card = cardSvg({
      mode,
      line1: mode === 'control' ? [T.controlLine[0], T.controlLine[1](scene.sessions.length, scene.islands.length)] : [T.sessionLine[0], cwd.replace(/^\/Users\/[^/]+/, '~')],
      line2: mode === 'control' ? [T.viewLine[0], T.viewLine[1]] : [T.sessionLine[1], cwd.replace(/\//g, '-')],
      text: T.card,
      stage: stageInput, conflicts: conflictText, tree, log, sessions: rows,
    })
    const alt = [scene.status, ...conflictText, ...(mode === 'session' ? log.map(l => `${l.verb} ${l.text}`) : rows.map(r => `${r.name}：${r.action}`))].join('；')
    return (
      <Box flexDirection="column" gap={1}>
        {buttons}
        <Svg source={card} alt={alt} />
      </Box>
    )
  })
}
