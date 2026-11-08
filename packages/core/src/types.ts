/**
 * DSHBot 领域模型。
 *
 * 这里只放**与 DSH 无关**的东西：房间、Bot、工位、消息、任务卡。
 * 任何 import 了 `@deepseek-ai/*` 的代码都不属于 core。
 *
 * 对应需求规格 v1.1 第 3、4、5 节。
 */

/** 房间的生命周期。 */
export type RoomStatus =
  | 'created'
  | 'briefing'
  | 'working'
  | 'waiting_approval'
  | 'reviewing'
  | 'done'
  | 'archived'
  | 'paused'

/** Bot 在当前房间里的实时状态，对应右侧面板的状态灯。 */
export type BotStatus =
  | 'idle'
  | 'thinking'
  | 'acting'
  | 'waiting_approval'
  | 'waiting_human'
  | 'done'
  | 'error'

/** 消息流里的七种卡片，对应界面骨架。 */
export type MessageKind =
  | 'human'
  | 'bot'
  | 'tool'
  | 'assignment'
  | 'artifact'
  | 'approval'
  | 'system'

/** 任务的执行模式：人工确认 / 全自动。 */
export type RoomMode = 'confirm' | 'auto'

/** 预算，单位 token。 */
export interface Budget {
  /** 单个 Run 的上限。 */
  perRun: number
  /** 单个 Bot 在房间内的累计上限。 */
  perBot: number
  /** 整个房间的上限。 */
  perRoom: number
}

/** Bot 的一张卡，可导出、可分享。 */
export interface BotCard {
  id: string
  name: string
  avatar: string
  persona: string
  /** 工具白名单。 */
  tools: string[]
  /** 技能包标识。 */
  skills: string[]
  /** 模型标识，留空表示跟随默认。 */
  model?: string
  budget: Budget
}

/** Bot 在房间里的工位：独立工作区 + 进程 + 浏览器 profile。 */
export interface Seat {
  botId: string
  roomId: string
  /** 私有草稿区，相对房间共享区的路径。 */
  privateDir: string
  status: BotStatus
  /** 一句话说明"当前在干什么"，给状态灯用。 */
  activity?: string
  /** 本工位已消耗的 token。 */
  tokensUsed: number
}

/** 房间 = 一次协作的现场，同时也是任务。 */
export interface Room {
  id: string
  name: string
  goal: string
  /** 验收标准，至少一条。 */
  acceptance: string[]
  status: RoomStatus
  mode: RoomMode
  budget: Budget
  /** 共享工作副本的路径。 */
  shared: string
  /** 主持人 Bot 的 id，负责分派。 */
  hostBotId?: string
  tokensUsed: number
  createdAt: string
  updatedAt: string
}

/** 一条消息。工具动作默认折叠，所以 payload 单独放。 */
export interface Message {
  id: string
  roomId: string
  kind: MessageKind
  /** 发送者：`human` 或 Bot 的 id。 */
  from: string
  text: string
  /** 结构化附加信息：工具调用参数、产物引用、审批选项等。 */
  payload?: Record<string, unknown>
  createdAt: string
}

/** 任务卡：房间内一次具体的派活。 */
export interface Assignment {
  id: string
  roomId: string
  title: string
  /** 承接的 Bot。 */
  botId?: string
  status: 'open' | 'accepted' | 'running' | 'done' | 'failed' | 'cancelled'
  /** 输出契约：没有它就不该被派发。 */
  outputContract?: string
  acceptance: string[]
  createdAt: string
}

/** 产物：文件、diff 或报告。 */
export interface Artifact {
  id: string
  roomId: string
  name: string
  kind: 'file' | 'diff' | 'report' | 'link'
  /** 产生它的 Run 或 Bot。 */
  producedBy: string
  version: number
  createdAt: string
}
