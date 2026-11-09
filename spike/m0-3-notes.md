# M0-3 完成记录：Bot 在房间里说话

> 状态：**已跑通**。截图见 [m0-3-rooms.png](m0-3-rooms.png)。

## 结论

插件能在宿主进程内起一个 agent，投一条用户消息，等它跑完，把回复写回房间消息流。页面里发一句话，Bot 1–2 秒回话。

## 关键突破：`sessionController`

之前卡在 `prompt variable "{{model}}" has no value`——用 `agents.create()` 起出来的 agent 没有 Agent preset，系统提示词模板填不上。

`agents.createSession` 在插件上下文里不存在，全局搜定义也搜不到，因为它在**另一个服务的内部对象**上：

```js
// dsh-api-session-controller
var SessionController = class extends TypertRemoteService {
  constructor(ctx, config, internals) {
    super(ctx, 'sessionController', { namespace: 'session' })   // ← 服务键
    this.agents = new ApiSessionAgentController(ctx)            // ← createSession 在这
    ...
  }
}
```

所以插件这样拿：

```js
inject: ['webServer', 'agents', 'sessions', 'sessionController']

const { agent } = await ctx.sessionController.agents.createSession({ cwd })
```

这条路和界面点「新会话」走的是同一段代码，preset、模型、系统提示词全部由宿主配好。

## 三个坑（都已修）

1. **不要自己传 sessionId**
   传给 `createSession({ sessionId })` 会进 `claim`/reuse 分支。实测一个请求跑出 15 个重复回合。
   现在改成不传，让宿主自己 mint（`session-<uuid>`），一轮就是一轮。

2. **事件帧是整段日志快照，不是增量**
   每帧推 `{ log: [全部事件] }`。把所有帧摊平，同一事件会重复十几遍，`turn/start` 数出来 15。
   现在按 `seq` 去重再排序。

3. **提取助手文本必须严格判 role**
   一开始 `role === ''` 也放行，结果把用户消息和运行时上下文全拼进了回复。
   现在只认 `message.role === 'assistant'`。

## 实测数据

| 指标 | 值 |
|---|---|
| 一句话到回话 | 1.3–1.8 秒 |
| 事件数（一轮） | 18 |
| 单轮事件序列 | `permission/preset` → `sandbox/mode` → `approval/policy` → `agent/inbox/spliced` → `turn/start` → `step/start` → `system/message` → `user/message` → `request/header` → `request/context` → `assistant/message` → `step/end` → `turn/end` |

## 现在的实现

- `src/host/agent.ts`：`runOnce(ctx, prompt, cwd)` → `{ sessionId, text, status, eventTypes }`
  三级回退：`sessionController.agents.createSession` → `agents.createSession` → `agents.create`
- `src/host/api.ts`：`POST /dshbot/api/rooms/:id/messages` 会落盘用户消息、跑 agent、落盘回复
- `src/client/page.tsx`：消息流（人右 / Bot 左）+ 底部输入框

## 还没做

- **工具动作没展示**：现在只显示对话文本。事件里已经有工具调用，M0-4 把它折叠成一行。
- **没有持久会话**：每次说话新建一个 agent，Bot 不记得上一轮。要延续对话得复用 sessionId。
- **成员面板还是空的**：Bot 尚未作为房间成员建模。

## 下一步

M0-4：把 `tool/*` 事件映射成折叠的工具动作行，补上「看它干活」这一半。
