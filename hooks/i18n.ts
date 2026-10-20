// 介面文字：英文與繁體中文。language 選項 auto 時看 LC_ALL / LANG。

export type Lang = 'en' | 'zh-TW'

export type CardText = {
  title: string
  tagSession: string
  tagControl: string
  noteSession: string
  noteControl: string
  treeRoot: string
  noTree: string
  noLog: string
  noSessions: string
  here: string
  mount: string
  updated: string
  emptyBoard: string
}

export type Strings = {
  paneTitle: string
  cmdDesc: string
  cmdSession: string
  cmdControl: string
  btnSession: string
  btnControl: string
  names: { index: string; common: string; home: string }
  tagIndex: string
  tagMount: string
  tagHome: string
  tagCommon: string
  reading: string
  writing: string
  verbRead: string
  verbWrote: string
  logRead: string
  logWrote: string
  logLoaded: string
  run: (tool: string, secs: number) => string
  thinking: string
  idleToday: (r: number, w: number) => string
  idle: string
  stretch: string
  drink: string
  coffee: string
  sleep: string
  ctlBusy: (n: number) => string
  ctlIdle: (n: number) => string
  secAgo: (s: number) => string
  minAgo: (m: number) => string
  goTo: (island: string) => string
  lastDid: (what: string, ago: string) => string
  conflict: (file: string, who: string, ago: string) => string
  toast: (file: string, who: string) => string
  termUpdated: string
  termWriting: string
  termReading: string
  here: string
  sessionLine: [string, string]
  controlLine: [string, (n: number, m: number) => string]
  viewLine: [string, string]
  card: CardText
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    paneTitle: 'Clawd memory office',
    cmdDesc: 'Open the memory office pane; /clawd all shows every session on this machine',
    cmdSession: 'Memory office: this session',
    cmdControl: 'Memory office: all sessions on this machine',
    btnSession: 'This session',
    btnControl: 'All sessions',
    names: { index: 'Index', common: 'Common', home: 'Home' },
    tagIndex: 'cross-project index',
    tagMount: 'mounted',
    tagHome: 'home',
    tagCommon: 'shared lessons',
    reading: 'Reading',
    writing: 'Writing',
    verbRead: 'read',
    verbWrote: 'wrote',
    logRead: 'Read',
    logWrote: 'Wrote',
    logLoaded: 'Loaded',
    run: (tool, secs) => `Running ${tool}${secs ? ` · ${secs}s` : ''}`,
    thinking: 'Thinking…',
    idleToday: (r, w) => `Idle · ${r} reads, ${w} writes today`,
    idle: 'Idle',
    stretch: 'Stretching',
    drink: 'At the water cooler',
    coffee: 'Coffee break',
    sleep: 'Dozing off',
    ctlBusy: n => `All sessions · ${n} busy`,
    ctlIdle: n => `All sessions · ${n} idle`,
    secAgo: s => `${s}s ago`,
    minAgo: m => `${m}m ago`,
    goTo: island => `Heading to ${island}`,
    lastDid: (what, ago) => `Idle · last ${what} · ${ago}`,
    conflict: (file, who, ago) => `⚠ ${file}: ${who} both wrote it ${ago}; one may overwrite the other`,
    toast: (file, who) => `⚠ ${file}: the ${who} session just wrote it too. Check that nothing was overwritten`,
    termUpdated: ' updated',
    termWriting: ' ← writing',
    termReading: ' ← reading',
    here: ' (here)',
    sessionLine: ['SESSION', 'MEMORY'],
    controlLine: ['ALL', (n, m) => `${n} sessions · ${m} memory folders`],
    viewLine: ['VIEW', 'who is touching which folder'],
    card: {
      title: 'Office',
      tagSession: 'This session',
      tagControl: 'All sessions',
      noteSession: 'Reads open a filing drawer; writes stick a note on the whiteboard',
      noteControl: 'One crab per session, walking to the folder it reads or writes',
      treeRoot: 'Memory files',
      noTree: 'No memory touched yet',
      noLog: 'Nothing yet',
      noSessions: 'No session touched memory in the last 30 minutes',
      here: '(here)',
      mount: 'in ',
      updated: 'updated',
      emptyBoard: 'No memory touched today',
    },
  },
  'zh-TW': {
    paneTitle: 'Clawd 記憶辦公室',
    cmdDesc: '打開記憶辦公室面板；/clawd 總控 看本機所有 session',
    cmdSession: '記憶辦公室：這個 session',
    cmdControl: '記憶辦公室：總控(本機所有 session)',
    btnSession: '這個 session',
    btnControl: '總控',
    names: { index: '總目錄', common: '通用', home: '主島' },
    tagIndex: '跨專案總目錄',
    tagMount: '掛載中',
    tagHome: '主島',
    tagCommon: '通用教訓',
    reading: '讀取',
    writing: '寫入',
    verbRead: '讀',
    verbWrote: '寫',
    logRead: '讀取',
    logWrote: '寫入',
    logLoaded: '載入',
    run: (tool, secs) => `執行 ${tool}${secs ? ` · ${secs} 秒` : ''}`,
    thinking: '思考中…',
    idleToday: (r, w) => `待命 · 今天讀 ${r} 寫 ${w}`,
    idle: '待命',
    stretch: '伸懶腰',
    drink: '在飲水機喝水',
    coffee: '在喝咖啡',
    sleep: '在打瞌睡',
    ctlBusy: n => `總控 · ${n} 個 session 在動`,
    ctlIdle: n => `總控 · ${n} 個 session · 待命`,
    secAgo: s => `${s} 秒前`,
    minAgo: m => `${m} 分前`,
    goTo: island => `前往${island}`,
    lastDid: (what, ago) => `待命 · 上次${what} · ${ago}`,
    conflict: (file, who, ago) => `⚠ ${file}：${who} 兩個 session ${ago}都寫過，可能互相覆蓋`,
    toast: (file, who) => `⚠ ${file}：${who} 的 session 剛也寫過，可能互相覆蓋，請檢查`,
    termUpdated: ' 已更新',
    termWriting: ' ← 寫入中',
    termReading: ' ← 讀取中',
    here: '(這裡)',
    sessionLine: ['SESSION', '記憶島'],
    controlLine: ['總控', (n, m) => `本機 ${n} 個 session · ${m} 座記憶島`],
    viewLine: ['視角', '只看誰在碰哪座島'],
    card: {
      title: '一般辦公室',
      tagSession: '這個 session',
      tagControl: '總控',
      noteSession: '白天的開放式辦公室：讀取拉開檔案櫃，寫入在白板貼一張便利貼',
      noteControl: '每隻螃蟹是一個 session，走到牠正在讀寫的那座島',
      treeRoot: '記憶檔',
      noTree: '這個 session 還沒碰記憶',
      noLog: '還沒有紀錄',
      noSessions: '最近 30 分鐘沒有 session 碰記憶',
      here: '(這裡)',
      mount: '掛',
      updated: '已更新',
      emptyBoard: '今天還沒有碰記憶',
    },
  },
}

export type LanguageOption = 'auto' | Lang

export function asLanguage(value: unknown): LanguageOption {
  const v = String(value ?? '').trim()
  return v === 'en' || v === 'zh-TW' ? v : 'auto'
}

/** auto：環境變數 LC_ALL / LANG 有 zh 就用繁中，否則英文。 */
export function pickLang(option: LanguageOption, env: string): Lang {
  if (option !== 'auto') return option
  return /zh/i.test(env) ? 'zh-TW' : 'en'
}
