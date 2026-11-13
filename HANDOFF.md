# 新会话交接：DSHBot v1.0.0 → 下一阶段

> 更新时间：2026-11-14
> 当前 commit：`16f04a6`（工作区 clean）
> 当前版本：**1.0.0**
> 完整包：`D:\Desktop\DSBOT\DSHBOT(V1.0)`
> 总 ZIP：`DSHBOT(V1.0)\DSHBOT-V1.0-Windows.zip`
> 总 ZIP SHA256：`a5ceaeaff4ca7cc3b679c43227a4eabd5831d5fbb8be04f2282f2f2ba8117d6a`

---

## 0. 新会话第一件事

1. 读本文件；
2. 跑 `git status --short` 和 `git log --oneline -3`，确认仍在 `16f04a6` 附近；
3. 问用户：**是否已经建好 GitHub 仓库 / 是否要现在发布**；
4. 如果没有仓库 URL，不要空等——先做下面的 **Phase 1 稳定性**。

不要重新做已经完成的 N1/N2/N3 功能；不要重新打 v1.0.0 包，除非源码有改动。

---

## 1. 已经完成什么

### 1.1 产品与代码

- 房间式多 Bot 协作：建空房、拉 Bot、总管计划、部分批准、DAG 依赖、单件重跑；
- 每 Bot 模型 + 推理强度；保存前 `/models` 目录校验；
- 交付、文件预览、diff、快照回滚、审计、搜索、备份/恢复、预算；
- 真实 UI 冒烟：`pnpm smoke:ui`（隔离 DSH + 无头 Edge）；
- 文档站 + 英文落地页。

### 1.2 验证

- `pnpm check`：**144/144 通过**；
- `pnpm test:coverage`：lines **76.5%**；
- 真实模型 A→B DAG：`a.md=A`、`b.md=AB`、验收 2/2；
- 发布包在全新 profile 安装后 `/health`、`/models` 正常；
- 最终 ZIP 解压后 0 个坏哈希、0 个坏链接。

### 1.3 发布包（已生成，未发布）

```text
DSHBOT(V1.0)/
├─ DSHBOT-介绍文档.md/.docx/.pdf
├─ DSHBOT-说明文档.md/.docx/.pdf
├─ README.md / README.en.md
├─ install.ps1 / 安装.cmd
├─ plugin/dshbot-plugin-1.0.0/ + zip/tgz + SHA256SUMS
├─ source/                 完整源码/测试/文档站源
├─ docs/ / docs-site/ / spike/
├─ STATE.md / TASKS.md / PUBLISHING.md
├─ SHA256SUMS.txt / BUILD-INFO.txt / VERSION
└─ DSHBOT-V1.0-Windows.zip + .sha256
```

`DSHBOT(V1.0)/` 已加入 `.gitignore`，是**交付物，不提交进 git**。

---

## 2. 下一阶段：Phase 0 发布闭环（阻塞项）

当前仓库**没有 remote、没有 tag、没有 Pages**，本机也没有 `gh`。

需要用户提供：

- GitHub 仓库地址（owner/repo）；
- 是否有权限 push / 开 Pages。

拿到后执行：

```powershell
git remote add origin <repo-url>
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```

然后在 GitHub：

1. Settings → Pages → Source: **GitHub Actions**；
2. 确认 `pages` workflow 成功，记录线上 URL；
3. 确认 `release` workflow 产出 `dshbot-plugin-1.0.0.zip/.tgz/SHA256SUMS.txt`；
4. 在**另一台干净 Windows** 安装 Release zip，验证侧栏、`/health`、`/models`；
5. 补 README 的 CI badge（需要仓库 slug）。

验收：陌生人按 Release 说明 10 分钟内装好并创建示例房间。

---

## 3. Phase 1：v1.0.1 稳定性（可立即开始）

按优先级：

1. **单实例保护**：同一 `DSHBOT_DATA_DIR` 第二个进程启动时拒绝或只读，避免 `rooms.json` 覆盖；
2. **崩溃恢复**：启动时把卡在 `working` 的房间/`running` 的任务复位，并写系统消息；
3. **`cmd:` 安全**：建房/编辑二次确认；可选命令 allowlist；文档写清风险；
4. **DAG 收尾**：失败任务重跑整条下游链；单件取消；依赖图视图；
5. **模型收尾**：明确提示 `selectModel` 会改 DSH 默认模型，提供“仅本会话”说明/开关；
6. **CI**：release 产物安装测试；UI 冒烟改自托管 runner 或明确只手工跑。

验收：异常退出、重复启动、命令失败、模型不可用都有明确提示；`pnpm check` 仍全绿。

---

## 4. Phase 2：v1.1 可复用协作（建议重点）

1. **Bot 记忆（X-5）**：任务后提炼记忆；容量上限；可查看/删除/溯源；下一轮只注入相关片段；
2. **技能包（M4-1/2）**：成功执行可存为 DSH skill；另一个房间可 `@bot 用X技能`；
3. **例行房间（M4-3/4）**：cron 到点自动建卡；房间可长期存在；
4. **成本面板**：按房间 / Bot / 模型统计 token 与预估费用；
5. **英文文档/UI**：补齐主要指南（目前只有 README + 落地页）。

验收：同一个房间连续处理第二、第三个同类任务，不用每次重讲背景。

---

## 5. Phase 3：v1.2 平台化（按需）

- 真正的工具调用审批 / 硬写锁：**依赖 DSH 暴露钩子**，当前只能做软约束；
- 浏览器画面 / 接管（M5）；
- IM 通知与审批回执；
- `dsh-bot` CLI；
- 插件市场/示例库。

不要提前造，等明确用户场景。

---

## 6. 关键命令

```powershell
cd D:\Desktop\DSBOT
pnpm check
pnpm test:coverage
pnpm drill
pnpm smoke:ui
pnpm docs:build
pnpm stage:release
node spike/live-dag-check.mjs --port 54873   # 花 token，仅发布前手工跑
```

开发实例：

```powershell
$env:DSHBOT_DATA_DIR="$env:TEMP\dshbot-dev-data"
dsh --profile dshbot-dev --port 54873 --no-open
```

---

## 7. 不要做

- 不要重启当前 DSH 进程（会话会死）；
- 不要把 `DSHBOT(V1.0)/` 提交进 git；
- 不要用 `git reset --hard` 回滚用户工作区；
- 不要在未确认模型可用时假设 `selectModel` 成功；
- 不要把 UI 冒烟说成 CI 已覆盖——它目前需要本机 DSH + Edge/Chrome；
- 不要在没有 GitHub URL 的情况下声称已经发布。

---

## 8. 建议的新会话开场

> 继续 DSHBot。先读根目录 `HANDOFF.md`、`STATE.md`、`TASKS.md`，确认当前是 v1.0.0 包已完成、未发布。然后按 HANDOFF 的 Phase 0/1 继续；如果我没给 GitHub 仓库地址，先做 Phase 1 的单实例保护与崩溃恢复。
