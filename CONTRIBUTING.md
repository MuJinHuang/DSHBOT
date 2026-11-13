# 贡献指南

欢迎提 issue 和 PR。这个项目优先保证**本地可用、可解释、可回滚**，新功能请先开 issue 对齐。

## 开发环境

- Node ≥ 22、pnpm 11（`corepack enable` 或单独安装）
- 系统 `git`（版本快照 / diff / 回滚用；没有时功能降级，但不影响主流程）
- Windows / macOS / Linux 均可开发；交付脚本里的 `.ps1` 必须以 UTF-8 BOM 保存

```powershell
pnpm install
pnpm check        # lint + 类型检查 + 构建 + 144 个用例
pnpm test:coverage # 覆盖率门槛（lines ≥65%，branches ≥60%，functions ≥65%）
pnpm drill        # 建房→派活→产出→验收，默认假宿主、0 token
pnpm smoke:ui     # 真实 DSH + 无头浏览器的 UI 冒烟（需要本机 DSH）
pnpm docs:build   # 构建文档站
```

## 改代码前

1. 读 [STATE.md](STATE.md)（当前状态与约束）与 [TASKS.md](TASKS.md)（状态以代码为准）；
2. 架构与历史决策见 [M1-技术方案.md](docs/design/M1-技术方案.md)、[下一阶段任务.md](docs/internal/roadmap/下一阶段任务.md)；
3. **不要重启正在使用的 DSH**——插件跑在 DSH 进程里。开发验证用独立 profile：

```powershell
$env:DSHBOT_DATA_DIR = "$env:TEMP\dshbot-dev-data"
dsh --profile dshbot-dev --port 54873 --no-open
```

## 提交约定

- 小步提交，Conventional Commits：`feat:` / `fix:` / `docs:` / `test:` / `chore:`；
- 代码与文档同步改（`TASKS.md` 的状态列以代码为准）；
- 提交前 `pnpm check` 全绿；涉及安装/打包的改动再跑一次 `pnpm drill`；
- 测试不调用真实模型：用 `tests/helpers/harness.mjs` 的假宿主。

## PR 检查单

- [ ] `pnpm check` 通过
- [ ] 新增行为有测试（纯函数放 `tests/*.test.mjs`；HTTP 走 `startApi`）
- [ ] 改了用户可见行为，同步 README / CHANGELOG
- [ ] 没有把个人路径、token、真实房间数据写进仓库
- [ ] 客户端没有引入第二份 React，core 没有引入 `@deepseek-ai/*`

## 目录速览

```
packages/core     领域模型与纯函数（零 DSH 依赖）
packages/plugin   Host 编排 + React 房间页 + DSH bundle 清单
tests             纯函数、HTTP API、drill
spike             验证记录与取证工具
```
