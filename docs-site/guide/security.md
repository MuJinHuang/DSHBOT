# 安全、隐私与限制

## 威胁模型

DSHBot 的定位是**本地单用户**，默认信任本机。

- HTTP API 挂在 DSH 的本地 web 服务上，**只监听回环、不做鉴权**；不要把端口暴露到局域网/公网；
- 验收里的 `cmd:` 会以当前用户权限执行命令，只对可信房间使用；
- 房间可以绑定真实工作目录，Bot 会读写它；快照用独立 git 仓库，但回滚会直接改工作区；
- 上下文块有提示注入边界声明，但人工确认计划仍是最后一道闸门。

## 数据

- 位置：`%USERPROFILE%\.dsh\dshbot\`；
- `rooms.json` 只存房间 / Bot 库 / 团队；
- 每个房间的消息在 `rooms/<id>/messages.jsonl`；
- 备份在 `backups/`，恢复前自动写一份；
- **没有遥测**；网络请求只发生在 DSH 调用模型时。

## 明确不做

| 限制 | 原因 |
|---|---|
| 房间内审批卡 | DSH 不暴露工具调用拦截钩子 |
| 真写锁 | 同上；现在是软约束 + 冲突提醒 |
| 逐条工具事件推流 | 需要事件总线；现在是 1.2s 快照 + 活动行 |

## 报告漏洞

请用仓库的 Private vulnerability reporting，不要开公开 issue。详见仓库根 `SECURITY.md`。

## 兼容性

- DSH 0.2.1-rc.5 验证通过；
- 插件依赖 `webServer` / `agents` / `sessions` / `sessionController`，其他版本可能不兼容；
- 每 Bot 模型依赖 `sessionController.selectModel`；老版本没有时会明确报错，不会静默用错模型。
