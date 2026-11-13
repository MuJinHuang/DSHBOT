# 开发与测试

## 环境

- Node ≥ 22、pnpm 11
- 系统 `git`（快照/diff/回滚）
- Windows / macOS / Linux 均可开发；当前交付重点在 Windows

```powershell
pnpm install
pnpm check          # lint + 类型 + 构建 + 144 个用例
pnpm test:coverage  # 覆盖率门槛：lines ≥65 / branches ≥60 / functions ≥65
pnpm drill          # 建房→派活→产出→验收，默认假宿主 0 token
```

## 真实 UI 冒烟

需要本机有 DSH 与 Edge/Chrome：

```powershell
pnpm smoke:ui
pnpm smoke:ui -- --port 54880 --profile dshbot-dev
pnpm smoke:ui -- --browser "C:\path\to\msedge.exe" --keep
```

它会：

1. 用临时数据目录起一个隔离 DSH（不会碰桌面端数据）；
2. 用无头浏览器打开页面；
3. 点开空状态 → 创建示例房间 → 搜索 → Bot 库（含模型下拉）；
4. 截图 `spike/ui-smoke.png` 和 `spike/smoke-1..4.png`；
5. 不调用模型（不花钱）。

前提：`dsh` 可用（或设 `DSHBOT_DSH_CLI`），profile 已装本插件。

## 真实模型 DAG 验收

```powershell
# 先起一个隔离实例
$env:DSHBOT_DATA_DIR="$env:TEMP\dshbot-live-dag"
dsh --profile dshbot-dev --port 54873 --no-open

# 另一个终端：会花 token
node spike/live-dag-check.mjs --port 54873
```

它会建总管 + 两个执行者，强制 `小柯 → 老周` 依赖，验证 `a.md` / `b.md` 落盘和验收通过。
2026-11-13 的真实结果见 `docs/internal/reports/真实DAG验收-2026-11-13.md`。

## demo GIF

`pnpm smoke:ui` 生成四帧后：

```powershell
python scripts/make-demo-gif.py
```

输出 `docs/assets/demo.gif`（README 和文档站首屏使用）。

## 目录

```
packages/core     领域模型与纯函数（零 DSH 依赖）
packages/plugin   Host 编排 + React 房间页 + bundle 清单
tests             纯函数、HTTP API、DAG、备份、drill
spike             演练、CDP 取证、UI 冒烟
docs-site         这个文档站的 Markdown 源
```

## 提交约定

- 小步 conventional commit；
- 代码与文档同步；
- 新行为要有测试；测试不调用真实模型（用 `tests/helpers/harness.mjs`）；
- 不改客户端 React 版本（必须 external，共用宿主那份）；
- core 不引入 `@deepseek-ai/*` 或 Node 内置模块。

## 设计约束

- 一只 Bot 一个 session，每轮现拼 ≤2400 字上下文；
- 工具集 = agent preset，不做白名单；
- 快照用独立 bare 仓库，绝不提交到用户项目 git；
- 验收优先 `file:` / `cmd:`，模型只判文字。
