# DSHBot

在 DSH 里开一个**房间**，拉几个有名字、有工位、有记忆的 Bot 同事进来，说一句话，它们分头干活；你看着、随时插手、该拦的拦住。

> 目标形态参照 Grok Bot，但数据完全留在本地，且 Bot 的能力可改、可接私有工具。
> 当前版本：**v0.1.0**（M0–M3 主体可用）

**想上手？直接看 [实验案例.md](实验案例.md)**——照着做一个约 1 分钟的完整任务。

## 现在能做什么

| 能力 | 状态 |
|---|---|
| 建房间（目标 + 验收标准） | ✅ |
| 拉多个 Bot 进房间，各有独立会话与花费 | ✅ |
| `@名字` 指定谁接话；多 Bot 时不 @ 没人抢话 | ✅ |
| 总管按回复里的 `@名字` 派活，生成任务卡（进行中 → 完成/失败） | ✅ |
| 执行者带上下文块（房间目标 + 最近动态 + 自己的任务） | ✅ |
| 工具动作折叠展示，点开看参数与输出 | ✅ |
| 交付验收：逐条判 pass/fail/存疑 + 变更文件 + 花费 | ✅ |
| 暂停 / 归档 / 仅@响应 / `@所有人 停` | ✅ |
| 接管：暂停后人工改，交还时写一句改动喂回房间 | ✅ |
| 软写锁：任务里声明的文件冲突会提醒 | ✅ |
| 实时推送（SSE/WS） | ⬜ 目前轮询 |
| 房间级审批卡、产物版本链、硬预算熔断 | ⬜ 见 TASKS |

## 结构

```
packages/
  core/     领域模型与状态机，零 DSH 依赖
  plugin/   DSH 插件：Host 侧编排 + 房间页面（React）
  cli/      dsh-bot 命令行（骨架）
spike/     验证记录、截图与取证脚本
```

任务拆分见 [TASKS.md](TASKS.md)，架构决策见 [M1-技术方案.md](M1-技术方案.md)，当前状态见 [STATE.md](STATE.md)。

## 开发

```powershell
pnpm install
pnpm build        # 产出 packages/plugin/lib/{index,client}.js 与 cli/bin
pnpm typecheck

# 一条命令装进 DSH（构建 + 类型检查 + 链接 + 补丁层，幂等）
pnpm install:profile
# 或指定别的 profile
$env:DSHBOT_PROFILE = 'dshbot-dev'; pnpm install:profile
```

装完**重启 DSH** 才生效——Loader 条目只在启动时组合。

安装细节见 [INSTALL.md](INSTALL.md)。

## 关键约束

- **客户端不能用第二份 React**：`react` 系列在 `build.mjs` 里是 external，运行时取宿主 shell 的那份；
- **core 不许 import `@deepseek-ai/*`**：它要能被 CLI、插件、将来的独立服务同时复用；
- **客户端产物必须是 `lib/client.js`**，且包在 `window.__ModuleLoader__.load({ id, factory })` 里。
