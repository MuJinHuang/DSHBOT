# DSHBot

在 DSH 里开一个**房间**，拉几个有名字、有工位、有记忆的 Bot 同事进来，说一句话，它们分头干活；你看着、随时插手、该拦的拦住。

> 目标形态参照 Grok Bot，但数据完全留在本地，且 Bot 的能力可改、可接私有工具。

## 现在到哪一步了

| 阶段 | 状态 |
|---|---|
| 需求（v1.1） | ✅ [DSHBot-需求规格-v1.1.md](DSHBot-需求规格-v1.1.md) |
| 插件可行性（T2） | ✅ [T2-验证报告.md](T2-验证报告.md) |
| 第三方包全链路（S0-1） | ✅ [spike/README.md](spike/README.md) |
| 仓库脚手架（S0-2） | 进行中 |
| 房间骨架（M0） | 未开始 |

任务拆分见 [TASKS.md](TASKS.md)。

## 结构

```
packages/
  core/     领域模型与状态机，零 DSH 依赖
  plugin/   DSH 插件：Host 侧服务 + 房间页面（React）
  cli/      dsh-bot 命令行
spike/      S0-1 冒烟验证（手写插件 + CDP 取证）
```

## 开发

```powershell
pnpm install
pnpm build        # 产出 packages/plugin/lib/{index,client}.js 与 cli/bin
pnpm typecheck
```

安装到 DSH 见 [INSTALL.md](INSTALL.md)。

## 关键约束

- **客户端不能用第二份 React**：`react` 系列在 `build.mjs` 里是 external，运行时取宿主 shell 的那份；
- **core 不许 import `@deepseek-ai/*`**：它要能被 CLI、插件、将来的独立服务同时复用；
- **客户端产物必须是 `lib/client.js`**，且包在 `window.__ModuleLoader__.load({ id, factory })` 里。
