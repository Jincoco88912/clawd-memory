// 一般辦公室舞台：給定時間與狀態，畫出整張 SVG(純函式)。
// 白板一欄、檔案櫃一格是一座記憶島；螃蟹讀寫時走到那格檔案櫃，寫入在白板多貼一張便利貼。
import type { MemOp } from '../types'
import type { CardText } from './i18n'

/** think：思考中(泡泡、托下巴)；type：跑一般工具(對著筆電敲)。 */
export type CrabMood = 'idle' | 'read' | 'write' | 'walk' | 'think' | 'type' | 'stretch' | 'drink' | 'coffee' | 'sleep'
/** 辦公室裡螃蟹會去的地方：座位、飲水機、咖啡機。 */
export type Spot = 'desk' | 'water' | 'coffee'

export type OfficeIsland = {
  key: string
  label: string
  color: string
  /** 此刻有螃蟹在讀(r)或寫(w)它。 */
  op: MemOp | null
  /** 白板上的便利貼數(今天碰過幾次，最多 4)。 */
  notes: number
  /** 今天寫過：最後一張便利貼換成黃色。 */
  written: boolean
}

export type OfficeCrab = {
  name: string
  color: string
  /** 正在前往或停在哪一格(islands 的索引)，null 是待在座位。 */
  target: number | null
  /** 0 在座位、1 在檔案櫃前。 */
  u: number
  mood: CrabMood
  /** 待命時的移動：從哪走到哪、走了多少(0～1)。有 target 時不用。 */
  place?: { from: Spot; to: Spot; u: number }
}

export type OfficeInput = {
  t: number
  clock: { h: number; m: number; s: number }
  islands: OfficeIsland[]
  crabs: OfficeCrab[]
  /** true：只有一隻大螃蟹(這個 session)；false：總控，多隻小螃蟹掛名牌。 */
  big: boolean
  status: string
  mood: 'idle' | 'read' | 'write' | 'think' | 'type'
  /** 工具跑很久：印表機吐紙。 */
  printing?: boolean
  /** 有 session 同時寫同一份記憶：警示燈閃。 */
  alarm?: boolean
  /** 白板空白時的字。 */
  emptyBoard?: string
}

const W = 440
const H = 236
const FONT = "-apple-system, 'PingFang TC', 'Noto Sans TC', sans-serif"
const r1 = (v: number) => Math.round(v * 10) / 10
// eslint-disable-next-line no-control-regex
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ease = (u: number) => { const k = Math.max(0, Math.min(1, u)); return k * k * (3 - 2 * k) }
/** 大約的文字寬度：中日韓字一格，其他半格。 */
const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.58), 0)
/** 依實際寬度截斷，放不下就加「…」。 */
const clipW = (s: string, size: number, maxW: number) => {
  if (textWidth(s, size) <= maxW) return s
  const chars = [...s]
  while (chars.length && textWidth(chars.join('') + '…', size) > maxW) chars.pop()
  return chars.join('') + '…'
}
const clip = (s: string, max: number) => ([...s].length > max ? [...s].slice(0, max - 1).join('') + '…' : s)

// ---- 螃蟹像素 -------------------------------------------------------------

const CRAB_COLORS: Record<string, string> = { h: '#EFA083', c: '#D97757', d: '#B5593A', a: '#D97757', p: '#C4613D', E: '#24140F' }

export function crabPaths(mood: CrabMood, t: number): Record<string, string> {
  const g: string[][] = Array.from({ length: 10 }, () => Array<string>(16).fill('.'))
  const set = (x: number, y: number, k: string) => { if (x >= 0 && x < 16 && y >= 0 && y < 10) g[y]![x] = k }
  for (let y = 1; y <= 6; y++) for (let x = 3; x <= 12; x++) set(x, y, y === 1 ? (x > 3 && x < 12 ? 'h' : 'c') : y === 6 ? 'd' : 'c')
  set(3, 1, '.'); set(12, 1, '.')
  const blink = !['write', 'stretch', 'drink', 'coffee', 'sleep'].includes(mood) && (t % 3.7) < 0.14
  let eyes: [number, number][]
  if (blink) eyes = [[5, 3], [10, 3]]
  else if (mood === 'read') eyes = [[5, 3], [5, 4], [10, 3], [10, 4]]
  else if (mood === 'write') eyes = [[4, 3], [5, 3], [10, 3], [11, 3]]
  else if (mood === 'think') { const dx = Math.cos(t * 1.1) > 0 ? 1 : 0; eyes = [[5 + dx, 2], [5 + dx, 3], [10 + dx, 2], [10 + dx, 3]] }
  else if (mood === 'type') eyes = [[5, 4], [10, 4]]
  else if (mood === 'stretch' || mood === 'drink' || mood === 'coffee') eyes = [[4, 3], [5, 2], [6, 3], [9, 3], [10, 2], [11, 3]]
  else if (mood === 'sleep') eyes = [[4, 3], [5, 3], [6, 3], [9, 3], [10, 3], [11, 3]]
  else eyes = [[5, 2], [5, 3], [10, 2], [10, 3]]
  for (const [x, y] of eyes) set(x, y, 'E')
  const f = Math.floor(t * 7)
  let la = 4, ra = 4, lo = false, ro = false
  if (mood === 'idle') { lo = ro = (t % 2.4) < 0.5 && (t % 0.5) < 0.25 }
  if (mood === 'read') { la = ra = 5; lo = ro = (f % 4) < 2 }
  if (mood === 'write') { la = f % 2 ? 3 : 5; ra = f % 2 ? 5 : 3; lo = f % 2 === 0; ro = f % 2 === 1 }
  if (mood === 'think') { la = 3; ra = 4; lo = false; ro = (t % 1.6) < 0.3 }
  if (mood === 'stretch') { la = ra = 2; lo = ro = (t % 1.2) < 0.6 }
  if (mood === 'drink' || mood === 'coffee') { la = 3; ra = 4; lo = false; ro = false }
  if (mood === 'sleep') { la = ra = 5; lo = ro = false }
  if (mood === 'type') { const g = Math.floor(t * 10); la = g % 2 ? 3 : 6; ra = g % 2 ? 6 : 3; lo = g % 4 < 2; ro = !lo }
  const claw = (side: number, ay: number, open: boolean) => {
    const X = (x: number) => (side < 0 ? x : 15 - x)
    set(X(2), ay, 'a'); set(X(1), ay, 'a')
    if (open) { set(X(0), ay - 1, 'p'); set(X(0), ay + 1, 'p'); set(X(1), ay - 1, 'p') } else { set(X(0), ay, 'p'); set(X(0), ay - 1, 'p') }
  }
  claw(-1, la, lo); claw(1, ra, ro)
  const step = (mood === 'walk' || mood === 'write' || mood === 'think') && f % 2 === 1
  for (const x of step ? [5, 7, 8, 10] : [4, 6, 9, 11]) { set(x, 7, 'd'); set(x, 8, 'd') }
  const paths: Record<string, string> = {}
  g.forEach((row, y) => row.forEach((k, x) => { if (k !== '.') paths[k] = (paths[k] ?? '') + `M${x} ${y}h1v1h-1z` }))
  return paths
}

/** 思考泡泡：兩顆小圓接一朵雲，裡面三個點輪流亮。 */
function thoughtBubble(x: number, top: number, t: number, s: number): string {
  const bx = x + 26 * s, by = top - 14 * s
  const ask = Math.floor(t / 1.6) % 3 === 2
  const dots = ask
    ? `<text x="${r1(bx)}" y="${r1(by + 4.5 * s)}" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="${r1(13 * s)}" fill="#4C3FA8">?</text>`
    : [0, 1, 2].map(i => `<circle cx="${r1(bx + (i - 1) * 6 * s)}" cy="${r1(by)}" r="${r1(1.9 * s)}" fill="#4C3FA8" opacity="${Math.floor(t * 4) % 3 === i ? 1 : 0.25}"/>`).join('')
  return `<g><circle cx="${r1(x + 9 * s)}" cy="${r1(top - 2 * s)}" r="${r1(1.6 * s)}" fill="#EFEAFF" stroke="#7C6FD0" stroke-width="1.1"/>` +
    `<circle cx="${r1(x + 15 * s)}" cy="${r1(top - 7 * s)}" r="${r1(2.6 * s)}" fill="#EFEAFF" stroke="#7C6FD0" stroke-width="1.1"/>` +
    `<ellipse cx="${r1(bx)}" cy="${r1(by)}" rx="${r1(14 * s)}" ry="${r1(8.5 * s)}" fill="#EFEAFF" stroke="#7C6FD0" stroke-width="1.2"/>${dots}</g>`
}

function crabSvg(mood: CrabMood, t: number, x: number, y: number, px: number, cap?: string): string {
  const paths = crabPaths(mood, t)
  const body = Object.entries(paths).map(([k, d]) => `<path d="${d}" fill="${CRAB_COLORS[k]}"/>`).join('')
  const hat = cap ? `<rect x="4" y="0" width="8" height="1" fill="${cap}"/>` : ''
  return `<g transform="translate(${r1(x - 8 * px)} ${r1(y - 9 * px)}) scale(${px})" shape-rendering="crispEdges">${body}${hat}</g>`
}

// ---- 版面 -----------------------------------------------------------------

/** 檔案櫃第 i 格的位置；超過 4 座島改成三欄窄抽屜。 */
export function drawerBox(i: number, n: number): { x: number; y: number; w: number } {
  const three = n > 4
  const w = three ? 28 : 40
  const col = Math.floor(i / 2), row = i % 2
  return { x: (three ? 341 + col * 29 : 342 + col * 44), y: 98 + row * 39, w }
}

function stickyXY(x0: number, n: number, cw: number): [number, number] {
  const per = cw >= 36 ? 2 : 1
  return [per === 2 ? x0 + 4 + (n % 2) * 17 : x0 + (cw - 14) / 2, 32 + Math.floor(n / per) * 15]
}

function sticky(x0: number, n: number, cw: number, color: string): string {
  const [x, y] = stickyXY(x0, n, cw), rot = ((n * 37) % 9) - 4
  return `<g transform="rotate(${rot} ${x + 7} ${y + 6})"><rect x="${x}" y="${y}" width="14" height="12" fill="${color}"/>` +
    `<rect x="${x + 2}" y="${y + 4}" width="9" height="1" fill="#00000033"/><rect x="${x + 2}" y="${y + 7}" width="6" height="1" fill="#00000033"/></g>`
}

/** 螃蟹的座位(照畫布)：大螃蟹在桌子正中，總控的小螃蟹沿桌面排開。 */
function spotPos(spot: Spot, i: number, big: boolean): { x: number; y: number } {
  if (spot === 'water') return big ? { x: 74, y: 224 } : { x: 66 + (i % 3) * 10, y: 214 + (i % 2) * 8 }
  if (spot === 'coffee') return big ? { x: 112, y: 224 } : { x: 108 + (i % 3) * 10, y: 214 + (i % 2) * 8 }
  return seat(i, big)
}

function seat(i: number, big: boolean): { x: number; y: number } {
  return big ? { x: 200, y: 146 } : { x: 200 + (i - 1.5) * 44, y: 146 }
}

export function officeSvg(inp: OfficeInput): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${officeBody(inp)}</svg>`
}

/** 舞台本體(不含外層 svg)，440×236。 */
export function officeBody(inp: OfficeInput): string {
  const { t, islands, crabs, big } = inp
  const n = Math.min(islands.length, 6)
  const o: string[] = []
  o.push(
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9FD4F2"/><stop offset="1" stop-color="#E3F4FC"/></linearGradient>',
    '<filter id="bloom" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="a"/><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
    `<rect width="${W}" height="176" fill="#ECE7DE"/><rect y="172" width="${W}" height="4" fill="#CFC6B8"/>`,
  )
  // 窗、雲、百葉窗
  o.push('<rect x="14" y="16" width="108" height="96" fill="#D3CDC2"/><rect x="19" y="21" width="98" height="86" fill="url(#sky)"/>')
  for (const [x0, y, p] of [[30, 30, 0], [80, 10, 50]] as const) {
    const x = 19 + ((x0 + t * 4 + p) % 110) - 6
    o.push(`<g transform="translate(${r1(x)} ${y + 40})" opacity=".9"><ellipse cx="0" cy="0" rx="12" ry="5" fill="#fff"/><ellipse cx="8" cy="-3" rx="8" ry="5" fill="#fff"/></g>`)
  }
  o.push('<rect x="14" y="16" width="108" height="5" fill="#D3CDC2"/>')
  for (let y = 22; y < 62; y += 5) o.push(`<rect x="19" y="${y}" width="98" height="3" fill="#FAFAF7" opacity=".92"/>`)
  o.push('<line x1="108" y1="21" x2="108" y2="86" stroke="#B8B2A6"/><rect x="66" y="21" width="4" height="86" fill="#D3CDC2"/>')
  // 時鐘：真的時間
  o.push('<circle cx="148" cy="34" r="13" fill="#fff" stroke="#4B5563" stroke-width="2"/>')
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6
    o.push(`<line x1="${r1(148 + Math.cos(a) * 10)}" y1="${r1(34 + Math.sin(a) * 10)}" x2="${r1(148 + Math.cos(a) * 11.5)}" y2="${r1(34 + Math.sin(a) * 11.5)}" stroke="#9CA3AF"/>`)
  }
  const hand = (deg: number, len: number, color: string, w: number) => {
    const a = ((deg - 90) * Math.PI) / 180
    return `<line x1="148" y1="34" x2="${r1(148 + Math.cos(a) * len)}" y2="${r1(34 + Math.sin(a) * len)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`
  }
  const { h, m, s } = inp.clock
  o.push(hand((h % 12) * 30 + m * 0.5, 6, '#1F2328', 1.8), hand(m * 6 + s * 0.1, 9, '#1F2328', 1.2), hand(s * 6, 10, '#E5484D', 0.8))
  // 白板：一座島一欄
  o.push('<rect x="170" y="12" width="166" height="88" rx="2" fill="#FAFBFC" stroke="#AEB4BA" stroke-width="3"/><rect x="176" y="100" width="154" height="3" fill="#9AA0A6"/>')
  for (const [x, c] of [[190, '#2563EB'], [200, '#DC2626'], [210, '#16A34A']] as const) o.push(`<rect x="${x}" y="97" width="8" height="3" rx="1" fill="${c}"/>`)
  const cw = 160 / Math.max(n, 4)
  if (n === 0) o.push(`<text x="253" y="58" text-anchor="middle" font-family="${FONT}" font-size="9" fill="#9CA3AF">${esc(inp.emptyBoard ?? '')}</text>`)
  islands.slice(0, n).forEach((is, i) => {
    const x0 = 174 + i * cw
    if (is.op) o.push(`<rect x="${r1(x0)}" y="15" width="${r1(cw - 1)}" height="82" fill="${is.color}" opacity=".35"/>`)
    if (i) o.push(`<line x1="${r1(x0)}" y1="18" x2="${r1(x0)}" y2="94" stroke="#D5DAE0" stroke-dasharray="2 2"/>`)
    o.push(`<text x="${r1(x0 + cw / 2)}" y="25" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="7" fill="#374151">${esc(clip(is.label, cw >= 36 ? 8 : 5))}</text>`)
    if (is.op) o.push(`<rect x="${r1(x0 + 4)}" y="27" width="${r1(cw - 8)}" height="1.5" fill="${is.op === 'w' ? '#E0A800' : '#2563EB'}"/>`)
    const count = Math.max(1, Math.min(4, is.notes))
    for (let k = 0; k < count; k++) o.push(sticky(x0, k, cw, is.written && k === count - 1 ? '#FFC93C' : is.color))
  })
  // 檔案櫃：一座島一格
  o.push('<rect x="340" y="94" width="88" height="82" fill="#7B8794"/>')
  // 印表機(檔案櫃上)：工具跑很久時吐紙
  o.push('<rect x="356" y="74" width="56" height="20" rx="3" fill="#E5E7EB" stroke="#B8C0C8"/><rect x="362" y="70" width="44" height="5" rx="1" fill="#F3F4F6" stroke="#C9CED6" stroke-width=".6"/>')
  o.push(`<circle cx="404" cy="84" r="1.8" fill="${inp.printing ? (Math.floor(t * 4) % 2 ? '#22C55E' : '#86EFAC') : '#9CA3AF'}"/>`)
  if (inp.printing) {
    const q = (t * 0.7) % 1
    o.push(`<rect x="366" y="${r1(88 + q * 8)}" width="30" height="${r1(4 + q * 12)}" fill="#fff" stroke="#D1D5DB" stroke-width=".6"/>`)
    for (let k = 0; k < 3; k++) o.push(`<rect x="370" y="${r1(92 + q * 8 + k * 3.5)}" width="${16 + (k % 2) * 6}" height="1" fill="#9CA3AF" opacity="${q > 0.2 + k * 0.2 ? 1 : 0}"/>`)
  }
  // 警示燈(右上角牆上)：同時寫入時閃紅光
  const on = inp.alarm && Math.floor(t * 3) % 2 === 0
  if (on) o.push('<circle cx="424" cy="18" r="11" fill="#EF4444" opacity=".35" filter="url(#bloom)"/>')
  o.push(`<rect x="418" y="22" width="12" height="4" rx="1" fill="#4B5563"/><path d="M419 22 a5 6 0 0 1 10 0 z" fill="${inp.alarm ? (on ? '#FF5A5A' : '#991B1B') : '#C9CED6'}"/>`)
  const slots = n > 4 ? 6 : 4
  for (let i = 0; i < slots; i++) {
    const { x, y, w } = drawerBox(i, n)
    const is = i < n ? islands[i] : undefined
    o.push(`<rect x="${x}" y="${y}" width="${w}" height="36" fill="#4B5563"/>`)
    const open = Boolean(is?.op)
    if (open) o.push(`<rect x="${x}" y="${y}" width="${w}" height="36" fill="${is!.color}" opacity="${r1(0.6 + 0.2 * Math.sin(t * 5))}" filter="url(#bloom)"/>`)
    const sc = open ? 1.1 : 1, cx = x + w / 2, cy = y + 18
    o.push(`<g transform="translate(${r1(cx * (1 - sc))} ${r1(cy * (1 - sc) + (open ? 4 : 0))}) scale(${sc})">`)
    o.push(`<rect x="${x}" y="${y}" width="${w}" height="36" rx="1" fill="#AEB8C2" stroke="#8A96A3"/>`)
    if (is) {
      o.push(`<rect x="${x + 3}" y="${y + 5}" width="${w - 6}" height="10" fill="#fff" stroke="#8A96A3" stroke-width=".6"/>`)
      o.push(`<rect x="${x + 3}" y="${y + 5}" width="3" height="10" fill="${is.color}"/>`)
      o.push(`<text x="${r1(x + w / 2 + 1)}" y="${y + 12.6}" text-anchor="middle" font-family="${FONT}" font-size="6" font-weight="700" fill="#1F2328">${esc(clip(is.label, w >= 36 ? 6 : 4))}</text>`)
    }
    o.push(`<rect x="${x + w / 2 - 7}" y="${y + 22}" width="14" height="3" rx="1.5" fill="#5B6673"/></g>`)
  }
  // 地板、盆栽
  o.push(`<rect y="176" width="${W}" height="${H - 176}" fill="#CDB089"/>`)
  for (let y = 176; y < H; y += 12) {
    o.push(`<rect y="${y}" width="${W}" height="1" fill="#B9996F"/>`)
    for (let x = (y / 12) % 2 ? 30 : 0; x < W; x += 60) o.push(`<rect x="${x}" y="${y}" width="1" height="12" fill="#B9996F"/>`)
  }
  o.push(`<g transform="translate(-26 0) rotate(${r1(Math.sin(t * 0.9) * 1.5)} 50 160)">`)
  for (const [dx, hh, a] of [[-8, 26, -22], [0, 34, 0], [8, 28, 20], [-3, 22, -40], [4, 24, 40]] as const) {
    o.push(`<ellipse cx="${50 + dx}" cy="${160 - hh / 2}" rx="4.5" ry="${hh / 2}" fill="#4E9A5B" transform="rotate(${a} ${50 + dx} 160)"/>`)
  }
  o.push('</g><path d="M12 158 H36 L32 178 H16 Z" fill="#C8794B"/>')
  const drinking = crabs.some(c => c.mood === 'drink'), sipping = crabs.some(c => c.mood === 'coffee')
  // 飲水機：有人喝水時水桶冒氣泡
  o.push('<rect x="56" y="146" width="28" height="32" rx="2" fill="#D9DEE3" stroke="#B8C0C8"/><rect x="61" y="152" width="18" height="8" rx="1" fill="#C3CBD3"/>')
  o.push('<rect x="63" y="140" width="4" height="6" fill="#3B82F6"/><rect x="73" y="140" width="4" height="6" fill="#EF4444"/>')
  o.push('<rect x="59" y="110" width="22" height="31" rx="7" fill="#9FD4F2" fill-opacity=".85" stroke="#7DB9DC"/><rect x="66" y="106" width="8" height="5" rx="1" fill="#7DB9DC"/>')
  for (let k = 0; k < 4; k++) {
    const q = (t * (drinking ? 0.9 : 0.25) + k / 4) % 1
    o.push(`<circle cx="${r1(66 + (k % 2) * 7 + Math.sin(t * 2 + k) * 1.5)}" cy="${r1(138 - q * 24)}" r="${drinking ? 1.8 : 1.1}" fill="#fff" opacity="${r1((drinking ? 0.9 : 0.5) * (1 - q))}"/>`)
  }
  // 茶水台與咖啡機：有人喝咖啡時蒸氣變大
  o.push('<rect x="92" y="150" width="40" height="4" fill="#A47148"/><rect x="95" y="154" width="3" height="24" fill="#8A5A36"/><rect x="126" y="154" width="3" height="24" fill="#8A5A36"/>')
  o.push('<rect x="99" y="122" width="26" height="28" rx="2" fill="#3A3F47"/><rect x="102" y="125" width="20" height="5" rx="1" fill="#1F2328"/><circle cx="119" cy="127.5" r="1.4" fill="#EF4444"/>')
  o.push('<rect x="105" y="136" width="14" height="12" rx="2" fill="#CFE3EE" fill-opacity=".7" stroke="#8FA3AE" stroke-width=".6"/><rect x="106" y="141" width="12" height="6.5" fill="#6B3E1F"/>')
  o.push('<rect x="128" y="143" width="6" height="7" rx="1" fill="#fff" stroke="#C9CED6" stroke-width=".5"/>')
  for (let k = 0; k < 3; k++) {
    const q = (t * 0.6 + k / 3) % 1
    o.push(`<path d="M${r1(110 + k * 4 + Math.sin(t * 3 + k) * 1.5)} ${r1(120 - q * 16)} q2 -3 0 -6" fill="none" stroke="#9CA3AF" stroke-width="${sipping ? 1.4 : 0.9}" opacity="${r1((sipping ? 0.9 : 0.45) * (1 - q))}"/>`)
  }
  // 桌子、筆電、馬克杯
  o.push('<rect x="150" y="152" width="146" height="16" fill="#E3E0DA"/><rect x="146" y="152" width="4" height="26" fill="#8A9099"/><rect x="296" y="152" width="4" height="26" fill="#8A9099"/>')
  o.push('<rect x="138" y="146" width="170" height="6" rx="1" fill="#F7F7F5" stroke="#D5D2CC"/>')
  const screen = { idle: '#1E293B', read: '#0F2E4A', write: '#3A2E0F', think: '#2A2550', type: '#10243A' }[inp.mood]
  o.push(`<rect x="248" y="122" width="42" height="24" rx="2" fill="#2F3640"/><rect x="251" y="125" width="36" height="18" fill="${screen}"/>`)
  for (let i = 0; i < 4; i++) {
    const w = 10 + ((i * 7 + Math.floor(t * (inp.mood === 'write' || inp.mood === 'type' ? 8 : 1.5))) % 18)
    o.push(`<rect x="${254 + (i % 2) * 3}" y="${r1(128 + i * 3.6)}" width="${w}" height="1.6" fill="#7DD3FC" opacity=".8"/>`)
  }
  o.push('<rect x="242" y="145" width="54" height="3" rx="1" fill="#C4C8CE"/>')
  o.push('<rect x="146" y="136" width="9" height="10" rx="1.5" fill="#fff" stroke="#C9CED6" stroke-width=".6"/><path d="M155 139 h2.5 v4 h-2.5" fill="none" stroke="#C9CED6"/>')
  // 螃蟹：從座位走到檔案櫃前
  const px = big ? 5 : 3
  crabs.slice(0, big ? 1 : 5).forEach((c, i) => {
    const home = seat(i, big)
    // 照畫布：大螃蟹待在桌上(讀寫用光束連到下方記憶樹)；總控的小螃蟹走到那格檔案櫃前
    const box = !big && c.target !== null && c.target < n ? drawerBox(c.target, n) : undefined
    const dest = box ? { x: Math.min(W - 8 * px - 2, box.x + box.w / 2 + (i - 2) * 5), y: 198 } : home
    const k = ease(c.u)
    const sc = big ? 1 : 0.55
    const ti = t + i * 0.9
    // 思考：在桌上左右踱步；敲筆電：往筆電靠；其他留在原位
    const shift = c.mood === 'think' ? Math.sin(ti * 1.1) * 26 * sc : c.mood === 'type' && big ? 6 : 0
    let x = home.x + (dest.x - home.x) * k + shift, y = home.y + (dest.y - home.y) * k
    if (!box && c.place) {
      const a = spotPos(c.place.from, i, big), b = spotPos(c.place.to, i, big), e = ease(c.place.u)
      x = a.x + (b.x - a.x) * e
      y = a.y + (b.y - a.y) * e
    }
    const hop = c.mood === 'write' ? -Math.abs(Math.sin(t * 9 + i)) * (big ? 5 : 3)
      : c.mood === 'type' ? -Math.abs(Math.sin(ti * 10)) * 3 * sc
        : c.mood === 'think' ? -Math.abs(Math.sin(ti * 2.2)) * 2.5 * sc
          : c.mood === 'idle' ? Math.round(Math.sin(ti * 2.2) * 1.5 * sc)
            : c.mood === 'sleep' ? Math.sin(ti * 1.2) * 1.5 * sc
              : c.mood === 'stretch' ? -Math.abs(Math.sin(ti * 2.6)) * 4 * sc
            : 0
    // 敲筆電：鍵盤冒出小光點
    if (c.mood === 'type' && big) for (let kk = 0; kk < 4; kk++) {
      const q = (t * 1.6 + kk / 4) % 1
      o.push(`<rect x="${r1(254 + kk * 9 + Math.sin(t * 7 + kk) * 3)}" y="${r1(142 - q * 22)}" width="3" height="3" fill="${kk % 2 ? '#7DD3FC' : '#FFFFFF'}" opacity="${r1(1 - q)}"/>`)
    }
    o.push(crabSvg(c.mood, t + i * 0.7, x, y + hop, px, big ? undefined : c.color))
    if (c.mood === 'sleep') for (let kk = 0; kk < 3; kk++) {
      const q = (t * 0.45 + kk / 3) % 1
      o.push(`<text x="${r1(x + (14 + q * 14) * (big ? 1 : 0.6))}" y="${r1(y + hop - 9 * px - q * 22 * (big ? 1 : 0.6))}" font-family="${FONT}" font-weight="900" font-size="${r1((8 + q * 6) * (big ? 1 : 0.7))}" fill="#6B7280" opacity="${r1(1 - q)}">z</text>`)
    }
    if (c.mood === 'coffee' || c.mood === 'drink') {
      // 拿在鉗子上的杯子
      const cx = x - 8 * px + 1 * px, cy = y + hop - 6 * px
      o.push(`<rect x="${r1(cx - 3 * (big ? 1 : 0.6))}" y="${r1(cy - 5 * (big ? 1 : 0.6))}" width="${r1(6 * (big ? 1 : 0.6))}" height="${r1(7 * (big ? 1 : 0.6))}" rx="1" fill="${c.mood === 'coffee' ? '#fff' : '#BFE3F5'}" stroke="#9CA3AF" stroke-width=".6"/>`)
      if (c.mood === 'coffee') { const q = (t * 0.8) % 1; o.push(`<path d="M${r1(cx)} ${r1(cy - 6 - q * 8)} q2 -3 0 -6" fill="none" stroke="#9CA3AF" stroke-width="1" opacity="${r1(1 - q)}"/>`) }
    }
    if (c.mood === 'think') o.push(thoughtBubble(x, y + hop - 9 * px, t + i * 0.4, big ? 1.5 : 0.85))
    if (!big) {
      const ty = y + hop - 9 * px - 3 - (i % 2) * 9
      o.push(`<text x="${r1(x)}" y="${r1(ty)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="8" fill="${c.color}" stroke="#1F2328" stroke-opacity=".7" stroke-width="2.5" paint-order="stroke">${esc(clip(c.name, 10))}</text>`)
    }
  })
  // 狀態標籤
  const label = clip(inp.status, 26)
  const lw = textWidth(label, 11) + 26
  const dot = { idle: '#8FD18B', read: '#5BB8FF', write: '#FFC93C', think: '#B9A8FF', type: '#7DD3FC' }[inp.mood]
  o.push(`<g transform="translate(${r1(W - 12 - lw)} 206)"><rect width="${r1(lw)}" height="20" rx="6" fill="#fff" stroke="#D0D7DE"/>` +
    `<circle cx="11" cy="10" r="3.5" fill="${dot}"/><text x="19" y="14" font-family="${FONT}" font-size="11" font-weight="500" fill="#1F2328">${esc(label)}</text></g>`)
  return o.join('')
}

// ---- 整張卡片：照畫布的深色卡片，標題、SESSION 列、舞台、清單都畫在圖裡 ----------
// (面板元件的底色會被 App 換掉，畫進 SVG 才能跟畫布一樣)

/** 記憶樹的一列：資料夾或檔案，畫布同款(縮排、圖示、標籤、右側接點)。 */
export type TreeRow = { depth: number; kind: 'dir' | 'file'; name: string; tag?: string; mount?: boolean; key: string; seen: boolean; updated: boolean; live: MemOp | null }
/** 紀錄的一列：時間、動作、內容。 */
export type LogRow = { time: string; verb: string; text: string; op: MemOp | 'load' }
export type CardSessionRow = { color: string; name: string; here: boolean; home: string; action: string; state: 'idle' | 'busy' | 'w' }
export type CardInput = {
  mode: 'session' | 'control'
  line1: [string, string]
  line2: [string, string]
  stage: OfficeInput
  conflicts: string[]
  tree: TreeRow[]
  log: LogRow[]
  sessions: CardSessionRow[]
  text: CardText
}

const K = { bg: '#13161A', line: '#2C3138', chip: '#1A1F25', fg: '#ECE9F0', muted: '#A09CAA', read: '#5BB8FF', write: '#FFC93C', acc: '#8FD18B', clay: '#D97757', liveR: '#16283A', liveW: '#2E2A17', file: '#D6D2DE', guide: '#2A2833', port: '#2B2E38' }
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"
const CW = 460
const PORT_X = 442

const ICON_DIR = 'M1.5 4.5v8h13v-6.5H7.5L6 4.5z'
const ICON_FILE = 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3'

/** 三次貝茲曲線上的一點。 */
function bez(p: number[][], u: number): [number, number] {
  const v = 1 - u
  const x = v * v * v * p[0]![0]! + 3 * v * v * u * p[1]![0]! + 3 * v * u * u * p[2]![0]! + u * u * u * p[3]![0]!
  const y = v * v * v * p[0]![1]! + 3 * v * v * u * p[1]![1]! + 3 * v * u * u * p[2]![1]! + u * u * u * p[3]![1]!
  return [x, y]
}

/** 把一段說明切成最多兩行，每行不超過 maxW。 */
function twoLines(s: string, size: number, maxW: number): string[] {
  const chars = [...s]
  let a = ''
  while (chars.length && textWidth(a + chars[0], size) <= maxW) a += chars.shift()
  if (!chars.length) return [a]
  // 英文在空格處換行，不切斷單字
  const cut = a.lastIndexOf(' ')
  if (cut > 0 && /[A-Za-z]/.test(chars[0] ?? '')) { chars.unshift(...a.slice(cut + 1)); a = a.slice(0, cut) }
  return [a, clipW(chars.join('').trim(), size, maxW)]
}

export function cardSvg(c: CardInput): string {
  const o: string[] = []
  const tx = (x: number, yy: number, s: string, size: number, fill: string, extra = '') => `<text x="${r1(x)}" y="${r1(yy)}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`
  const t = c.stage.t
  // 標題列：左邊名稱與標籤，右邊說明(畫布的 style-name 列)
  const L = c.text
  o.push(tx(14, 24, L.title, 14, K.fg, 'font-weight="700"'))
  const tag = c.mode === 'control' ? L.tagControl : L.tagSession
  const tw = textWidth(tag, 10.5) + 12
  const tagX = 14 + textWidth(L.title, 14) + 10
  o.push(`<rect x="${r1(tagX)}" y="12" width="${r1(tw)}" height="16" rx="8" fill="${c.mode === 'control' ? '#F5F5F0' : K.clay}"/>`, tx(tagX + 6, 23.5, tag, 10.5, c.mode === 'control' ? '#111418' : '#1A0F0A', 'font-weight="700"'))
  const note = c.mode === 'control' ? L.noteControl : L.noteSession
  const noteLines = twoLines(note, 11, CW - 28 - (tagX + tw + 12))
  noteLines.forEach((line, i) => o.push(tx(CW - 14, 18 + i * 14, line, 11, K.muted, 'text-anchor="end"')))
  let y = Math.max(38, 18 + noteLines.length * 14) + 4
  // SESSION 列
  o.push(`<rect x="10" y="${y}" width="440" height="42" rx="6" fill="${K.chip}"/>`)
  o.push(tx(22, y + 17, c.line1[0], 10.5, K.muted, 'letter-spacing=".06em"'), `<text x="84" y="${y + 17}" font-family="${MONO}" font-size="11.5" fill="${K.fg}">${esc(clip(c.line1[1], 48))}</text>`)
  o.push(tx(22, y + 34, c.line2[0], 10.5, K.muted), `<circle cx="88" cy="${y + 30.5}" r="3.5" fill="${K.acc}"/>`, `<text x="97" y="${y + 34}" font-family="${MONO}" font-size="11.5" fill="${K.fg}">${esc(clip(c.line2[1], 46))}</text>`)
  y += 52
  // 舞台
  const stageY = y
  o.push(`<defs><clipPath id="stageclip"><rect x="10" y="${y}" width="440" height="236" rx="8"/></clipPath>` +
    '<filter id="beamglow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="a"/><feMerge><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
  o.push(`<g clip-path="url(#stageclip)"><g transform="translate(10 ${y})">${officeBody(c.stage)}</g></g>`)
  y += 236 + 10
  // 同時寫入提醒
  for (const msg of c.conflicts) {
    o.push(`<rect x="10" y="${y}" width="440" height="24" rx="5" fill="#3A1D1D"/>`, tx(20, y + 16, clipW(msg, 11.5, 420), 11.5, '#FF8A8A'))
    y += 30
  }
  if (c.mode === 'session') {
    // 記憶樹(畫布同款)
    o.push(`<text x="12" y="${y + 12}" font-family="${MONO}" font-size="11" fill="${K.muted}">${esc(L.treeRoot)}</text>`)
    y += 20
    if (c.tree.length === 0) { o.push(tx(14, y + 14, L.noTree, 11.5, K.muted)); y += 24 }
    let beam: { x1: number; y1: number; op: MemOp } | undefined
    c.tree.forEach((r, idx) => {
      const rowH = 28, cy = y + rowH / 2
      if (r.live) o.push(`<rect x="10" y="${y}" width="420" height="${rowH}" rx="5" fill="${r.live === 'w' ? K.liveW : K.liveR}"/>`)
      // 縮排導引線：接到下一列同層以下才畫
      for (let d = 1; d <= r.depth; d++) o.push(`<rect x="${25 + (d - 1) * 18}" y="${y}" width="1" height="${rowH}" fill="${K.guide}"/>`)
      const ix = 18 + r.depth * 18
      o.push(`<path d="${r.kind === 'dir' ? ICON_DIR : ICON_FILE}" transform="translate(${ix} ${cy - 7.5}) scale(.94)" fill="none" stroke="${K.muted}" stroke-width="1.3" stroke-linejoin="round"/>`)
      let x = ix + 22
      const nm = clipW(r.name, 12.5 * 1.1, 300 - x)
      const nameFill = r.live ? '#FFFFFF' : r.kind === 'dir' ? K.fg : K.file
      o.push(`<text x="${x}" y="${cy + 4.5}" font-family="${MONO}" font-size="12.5" fill="${nameFill}" ${r.kind === 'dir' ? 'font-weight="600"' : ''}>${esc(nm)}</text>`)
      x += [...nm].length * 7.6 + 8
      if (r.tag) {
        const w = textWidth(r.tag, 10.5) + 14
        o.push(`<rect x="${r1(x)}" y="${cy - 8}" width="${r1(w)}" height="16" rx="8" fill="${K.chip}" ${r.mount ? `stroke="${K.acc}" stroke-opacity=".55"` : ''}/>`, tx(x + 7, cy + 4, r.tag, 10.5, r.mount ? K.acc : K.muted))
        x += w + 6
      }
      if (r.updated) {
        o.push(`<rect x="${r1(x)}" y="${cy - 8}" width="${r1(textWidth(L.updated, 10.5) + 14)}" height="16" rx="8" fill="#FFC93C33"/>`, tx(x + 7, cy + 4, L.updated, 10.5, K.write, 'font-weight="600"'))
      }
      // 右側接點
      const portFill = r.live === 'r' ? K.read : r.live === 'w' || r.updated ? K.write : r.seen ? '#3F6A8F' : K.port
      if (r.live) o.push(`<circle cx="${PORT_X}" cy="${cy}" r="9" fill="${r.live === 'w' ? K.write : K.read}" opacity=".35" filter="url(#beamglow)"/>`)
      o.push(`<circle cx="${PORT_X}" cy="${cy}" r="4.5" fill="${portFill}" stroke="${K.bg}" stroke-width="2"/>`)
      if (r.live && !beam) beam = { x1: PORT_X, y1: cy, op: r.live }
      y += rowH + (idx === c.tree.length - 1 ? 0 : 1)
    })
    // 光束：從桌上的螃蟹接到正在讀寫的那一列(讀：檔案 → 螃蟹；寫：螃蟹 → 檔案)
    if (beam) {
      const x0 = 210, y0 = stageY + 146
      const pts = [[x0, y0], [x0 + 30, y0 + 70], [Math.min(CW - 4, beam.x1 + 12), beam.y1 - 50], [beam.x1, beam.y1]]
      const col = beam.op === 'w' ? K.write : K.read
      o.push(`<path d="M${x0} ${y0} C${pts[1]!.join(' ')} ${pts[2]!.join(' ')} ${beam.x1} ${beam.y1}" fill="none" stroke="${col}" stroke-width="1.2" stroke-opacity=".5" stroke-dasharray="4 3"/>`)
      for (let i = 0; i < 8; i++) {
        const q = (t * 0.75 + i / 8) % 1
        const [px, py] = bez(pts, beam.op === 'w' ? q : 1 - q)
        const fade = Math.min(1, q * 6, (1 - q) * 6)
        const fill = beam.op === 'w' ? '#FFE27A' : '#FFFFFF', stroke = beam.op === 'w' ? '#E0A800' : col
        o.push(`<rect x="-2.5" y="-3" width="5" height="6" fill="${fill}" stroke="${stroke}" stroke-width=".7" opacity="${r1(fade)}" transform="translate(${r1(px)} ${r1(py)}) rotate(${r1(Math.sin(t * 3 + i) * 25)})" filter="url(#beamglow)"/>`)
      }
    }
    // 紀錄
    y += 10
    o.push(`<line x1="10" y1="${y}" x2="450" y2="${y}" stroke="${K.guide}" stroke-dasharray="3 3"/>`)
    y += 8
    for (const l of c.log) {
      const vc = l.op === 'w' ? K.write : l.op === 'r' ? K.read : K.fg
      o.push(`<text x="22" y="${y + 12}" font-family="${MONO}" font-size="11" fill="#6F6A7C">${esc(l.time)}</text>`, tx(84, y + 12, l.verb, 11.5, vc, 'font-weight="500"'), tx(84 + textWidth(l.verb, 11.5) + 6, y + 12, clipW(l.text, 11.5, 330), 11.5, K.muted))
      y += 18
    }
    if (c.log.length === 0) { o.push(tx(22, y + 12, L.noLog, 11.5, K.muted)); y += 18 }
  } else {
    if (c.sessions.length === 0) { o.push(tx(14, y + 14, L.noSessions, 11.5, K.muted)); y += 22 }
    for (const r of c.sessions) {
      o.push(`<rect x="10" y="${y}" width="440" height="42" rx="6" fill="${r.state === 'w' ? K.liveW : r.state === 'busy' ? K.liveR : K.chip}"/>`)
      o.push(`<rect x="20" y="${y + 9}" width="10" height="10" rx="3" fill="${r.color}"/>`)
      const nm = clip(r.name, 22)
      o.push(tx(38, y + 18, nm, 13, K.fg, 'font-weight="700"'))
      if (r.here) o.push(tx(38 + textWidth(nm, 13) + 4, y + 18, L.here, 11, K.muted))
      o.push(`<text x="440" y="${y + 18}" text-anchor="end" font-family="${MONO}" font-size="10.5" fill="${K.muted}">${esc(L.mount)}${esc(clip(r.home, 16))}</text>`)
      o.push(tx(38, y + 34, clipW(r.action, 11.5, 400), 11.5, r.state === 'w' ? K.write : r.state === 'busy' ? K.fg : K.muted))
      y += 48
    }
  }
  y += 8
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${y}" viewBox="0 0 ${CW} ${y}">` +
    `<rect x=".5" y=".5" width="${CW - 1}" height="${y - 1}" rx="10" fill="${K.bg}" stroke="${K.line}"/>` + o.join('') + '</svg>'
}
