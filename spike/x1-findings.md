# X-1 结论：Run 不能用子进程，改用进程内 activation

> 原计划：每个 Run 起一个 `dsh headless --json` 子进程，理由是崩溃隔离。
> 实测结论：**这条路在账号登录下走不通**，改走进程内。

## 实测过程

| 步骤 | 结果 |
|---|---|
| `dsh --profile headless --json "只输出 OK"` | `MISSING_CREDENTIAL`：`no API key for provider route "deepseek-official"` |
| 新建 `dshbot-runner` profile（复制 headless，把 provider 改成 `deepseek-account`） | `ACCOUNT_SIGN_IN_REQUIRED`：`The request destination must allow account authentication` |
| 查 `dsh-llm-deepseek-account` 源码 | `resolveToken(connection.baseURL)` 只有在 `destination.origin === inferenceOrigin` 时才返回 token |
| 查 `dsh-deepseek-account-platform` | `inferenceOrigin` 是**该插件的配置项**，且要求 issuer 与 origin 匹配 |

## 为什么走不通

账号凭证不是 API Key，而是一个绑定 **inferenceOrigin** 的 grant：

```js
async resolveToken(url) {
  const destination = new URL(url)
  if (destination.origin !== this.inferenceOrigin) return void 0
  // 再校验 credentials 里的 issuer === origin
}
```

桌面端能用，是因为它把 `inferenceOrigin` 配成了实际推理端点；裸 CLI 进程用默认端点，对不上，于是拿不到 token。

要修就得在 profile 里复刻整套端点与请求头配置——那是**跟着 DSH 内部实现走**的私有约定，版本一升就可能失效。另一个选择是让用户去申请 API Key，但那等于把「已登录」变成「再配一次钥匙」。

## 改用进程内 activation

`@deepseek-ai/dsh-subagent` 提供的正是这件事：

```js
startActivation({ provider, label, request, signal, delivery })
// → { childId, messageId?, result, dispose }
```

- `delivery: 'caller'`：调用方等结果，不发父级通知——正是编排器要的语义；
- 本地子级保留会话，可继续发消息、可冷恢复；
- `maxActiveSubagents` 默认 **8**，是每棵 activation 树的并发上限。

在宿主进程内跑，天然复用桌面端已经认证好的 `deepseek-account`，不用碰任何端点配置。

## 三个必须承认的代价

1. **放弃进程级隔离**。一个 Run 卡死不会拖垮宿主（activation 是异步的），但内存与事件循环是共享的。
2. **并发上限是 8**（默认值，可配置）。这不是性能数字，是硬约束——超过就 `ACTIVATION_LIMIT_REACHED`，不会排队。
3. **不能脱离 GUI 跑**。插件得在宿主进程里才有 `subagent` 服务；「关掉界面后台跑」这条路暂时没有。

## 对需求文档的修正

需求规格 v1.1 §5.2/§11 里写的是「每个 Run 一个独立进程」。改为：

> **Run = 一个独立 session + 独立工作区沙箱**，进程共享宿主。

隔离靠三件事维持：独立 session（上下文不串）、独立 workspace（文件不串）、并发上限（资源不炸）。崩溃隔离这一层放弃。

## 对 M0-3 的影响

`ctx.subagent.startActivation({ provider: 'spawn', delivery: 'caller', request: {...} })`
→ 拿 `childId` 与 `result`，把事件映射成房间消息。

需要先确认 `request` 的字段形状（prompt / agentOptions / preset），以及宿主是否在 web profile 里挂载了 `spawn` 提供方——`dsh-tool-subagent` 在配置里，服务应该在。
