# M0-3 进展与卡点

## 已经打通的

插件在宿主进程内可以：

1. `ctx.agents.create({ sessionId, agentOptions: { cwd } })` 起一个 agent；
2. 拿到句柄 `{ agent, dispose }`，用 `agent.followup(message)` 投一条用户消息；
3. 订阅 `agent/status` 观察 `running → idle`；
4. 订阅 `session/event` 拿到完整事件流。

投进去的消息确实进了 session：

```json
{
  "type": "agent/inbox/spliced",
  "seq": 3,
  "data": {
    "target": "next-turn",
    "inserted": [{ "role": "user", "content": [{ "type": "text", "text": "..." }], "source": "user-rpc" }]
  }
}
```

事件流的形状也摸清了——**这正是 M0-4 消息流要的东西**：

```json
{ "log": [ { "type": "turn/start", "seq": 4, "time": 1794157796265, "data": { "turn": 1 } },
           { "type": "step/start", "seq": 7, "data": { "turn": 1, "step": 1 } },
           { "type": "turn/end",   "seq": 9, "data": { "turn": 1, "reason": { ... } } } ] }
```

## 卡在哪

回合 32 毫秒就结束了，`turn/end` 带着：

```
prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")
```

原因：`agents.create()` 只给了 `cwd`，没给 **Agent preset** 和**模型选择**，系统提示词模板里的 `{{model}}` 没有值，整轮直接失败。

UI 走的是 `agents.createSession({ cwd, agentPreset })`，它会自动补齐 preset 与默认模型。但：

- `ctx.agents.createSession` 在插件上下文里**不存在**；
- 全局搜 `createSession(` 的定义也没搜到（0 命中）。

说明它要么是别的插件在运行时挂到 service 上的方法，要么走了不同的服务键。

## 下一步的两条路

| 方案 | 做法 | 风险 |
|---|---|---|
| A 找挂载点 | 确认哪个插件给 agents 加了 `createSession`，改成 `inject` 那个服务 | 要摸清一层间接，但最稳 |
| B 自己拼 options | 用 `agents.create({ sessionId, agentOptions: { preset, model: { provider, model } } })`，从 `ctx.agentDefaultModel` 读默认模型 | 字段名靠猜，可能要试几轮 |

倾向 A：UI 已经验证过的路径，不该重造。

## 当前代码状态

`src/host/agent.ts` 是可用状态：优先 `createSession`，没有就回退 `create()`，不会抛异常把接口打挂。`POST /dshbot/api/_probe` 是这条链路的探针，M0-3 完成后删掉。

房间的建房与列表不受影响。
