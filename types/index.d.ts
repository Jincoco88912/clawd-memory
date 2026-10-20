/** 讀(r)或寫(w)一份記憶。 */
export type MemOp = 'r' | 'w'

/** 共用事件檔裡的一行：某個 session 在某個時間讀或寫了某份記憶。 */
export type MemEvent = {
  ts: number
  session: string
  cwd: string
  /** 工具名稱，自動載入記成 `autoload:<kind>`。 */
  tool: string
  op: MemOp
  path: string
  /** 記憶島資料夾名，或 `memory-common`、`memory-index.md`。 */
  island: string
  agentId?: string
}

/** 回合開始／結束的標記：總控用它判斷別的 session 正在思考。 */
export type TurnMark = { ts: number; session: string; cwd: string; turn: 'start' | 'end' }

/** 這個 session 自己的狀態：回合進行中、正在跑哪個工具。 */
export type LocalState = {
  turn: boolean
  tool: string | null
  /** 回合開始、進入待命、工具開始的時間(毫秒)。 */
  turnAt: number
  idleAt: number
  toolAt: number
}

/** session：只看這個 session、列到檔案；control：總控，本機所有 session、只看資料夾。 */
export type ViewMode = 'session' | 'control'

declare module 'claude-code' {
  interface PluginState {
    'clawd-memory': {
      /** 今天的事件(本機所有 session)，從共用事件檔讀來。 */
      events: MemEvent[]
      /** 舞台影格，時鐘推進它讓面板重畫。 */
      frame: number
      view: ViewMode
      /** 今天各 session 的回合標記。 */
      turns: TurnMark[]
      local: LocalState
    }
  }
}
