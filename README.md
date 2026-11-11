# DSHBot

在 DSH 里开一个**房间**，拉几个有名字、有工位、有记忆的 Bot 同事进来，说一句话，它们分头干活；你看着、随时插手、该拦的拦住。

> 目标形态参照 Grok Bot，但数据完全留在本地，且 Bot 的能力可改、可接私有工具。
> 当前版本：**v0.1.0**（M0–M3 主体可用）

**想上手？直接看 [实验案例.md](实验案例.md)**——照着做一个约 1 分钟的完整任务。

## 现在能做什么

| 能力 | 状态 |
|---|---|
| 建房间（目标 + 验收标准） | ✅ |
| 绑定工作目录：Bot 能直接读你的项目；不绑定则用房间空目录 | ✅ |
| 拉多个 Bot 进房间，各有独立会话与花费 | ✅ |
| `@名字` 指定谁接话；多 Bot 时不 @ 没人抢话 | ✅ |
| 总管按回复里的 `@名字` 派活，生成任务卡（进行中 → 完成/失败） | ✅ |
| 计划确认门：confirm 模式下先给人看计划，批准才开跑 | ✅ |
| 执行者带上下文块（房间目标 + 最近动态 + 自己的任务） | ✅ |
| 工具动作折叠展示，点开看参数与输出 | ✅ |
| Bot 回复按 Markdown 渲染（代码块 / 列表 / 表格 / 加粗） | ✅ |
| 运行中能看到「正在 xxx…」的实时活动 | ✅ |
| 交付验收：逐条判 pass/fail/存疑 + 变更文件 + 花费 | ✅ |
| 结构化验收：`file:` 看文件、`cmd:` 看退出码，机器判定不花钱 | ✅ |
| 预算熔断：房间 / 个人到线直接停跑，单轮超支事后留痕 | ✅ |
| 工作区版本快照 + 一键回滚（独立快照仓库，不污染你的 git） | ✅ |
| 变更文件点开看 diff（相对上次快照） | ✅ |
| 审计导出：整房间动作序列存 JSONL，可回放 | ✅ |
| 暂停 / 归档 / 仅@响应 / `@所有人 停` | ✅ |
| 停止正在跑的一轮 | ✅ |
| 接管：暂停后人工改，交还时写一句改动喂回房间 | ✅ |
| 编辑房间（改名 / 改目标 / 改验收）、删除房间 | ✅ |
| 导出整份对话与交付为 Markdown | ✅ |
| 拉人时选角色（总管 / 执行） | ✅ |
| 软写锁：任务里声明的文件冲突会提醒 | ✅ |
| 房间状态实时推送（SSE） | ✅ 逐条工具事件仍等整轮 |
| 单元测试 | ✅ `pnpm check` = 类型检查 + 47 个用例 |
| 房间级审批卡、硬预算熔断、审计导出 | ⬜ 见 TASKS（版本链、diff、回滚已完成） |

## 结构

```
packages/
  core/     领域模型与状态机，零 DSH 依赖
  plugin/   DSH 插件：Host 侧编排 + 房间页面（React）
  cli/      dsh-bot 命令行（骨架）
spike/     验证记录、截图与取证脚本
```

任务拆分见 [TASKS.md](TASKS.md)，架构决策见 [M1-技术方案.md](M1-技术方案.md)，当前状态见 [STATE.md](STATE.md)。

## 配置

单轮 Run 默认最多等 **5 分钟**，超时会明确标注「本轮被超时截断」并说明结论可能不完整。
改代码这类长任务可以调大：

```jsonc
// %USERPROFILE%\.dsh\dshbot\config.json
{
  "runTimeoutMs": 600000   // 10 分钟，范围 10 秒 ~ 30 分钟
}
```

也可以用环境变量临时覆盖：`$env:DSHBOT_RUN_TIMEOUT_MS = '600000'`（优先级更高）。

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
