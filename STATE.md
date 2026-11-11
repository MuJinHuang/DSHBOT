# 项目状态快照

> 写于 2026-11-09。这是一份**可交接的状态快照**：接手的人（或下一次会话）从这份文档就能继续，不必重走探索。
> 需求见 [DSHBot-需求规格-v1.1.md](DSHBot-需求规格-v1.1.md)，任务清单见 [TASKS.md](TASKS.md)。

---

## 1. 现在能跑什么

DSH 桌面端侧栏多了「🏠 房间」入口，点开是三栏页面：

- **建房**：名称 + 目标 + 验收标准（一行一条），落盘到 `~/.dsh/dshbot/rooms.json`；
- **列表与详情**：状态徽标、目标、验收条目；
- **数据持久化**：重启 DSH 不丢。

还不能：让 Bot 用工具干活（现在只会回话，不展示工具动作）、审批、交付。

## 2. 进度

| 项 | 状态 |
|---|---|
| 需求规格 v1.1 | ✅ 决策已锁定 |
| T2 插件页面可行性 | ✅ 结论：官方支持 |
| S0-1 第三方包全链路 | ✅ 冒烟通过 |
| S0-2 脚手架与构建 | ✅ `pnpm build` / `typecheck` 全绿 |
| S0-3 插件加载闭环 | ✅ 桌面端可见 |
| S0-4 数据模型 | ✅ 类型完成 |
| S0-5 存储层 | ✅ JSON + 原子写 |
| X-1 执行模型 | ✅ 结论：子进程不可行，改进程内 |
| M0-1 建房 | ✅ |
| M0-2 三栏布局 | ✅ |
| **M0-3 单 Bot 执行** | ✅ 房间内发消息，Bot 1.3–1.8s 回话 |
| M0-4 消息流渲染（工具动作折叠） | ✅ 折叠行 + 展开看参数/输出 |
| M0-5 @ 提及 | ✅ 仅@开关、`@所有人 停` |
| M0-6 暂停/恢复/归档 | ✅ 暂停/归档时发送 409 |
| M0-7 成本条 | ✅ 累计 token + 进度条 |
| **M0 全部完成** | ✅ 见 [spike/m0-567-ui.png](spike/m0-567-ui.png) |
| M1-1 成员模型与面板 | ✅ 惰性迁移 + 成员卡 + 按人归因 |
| M1-2 @ 路由与每人会话 | ✅ @谁谁回；多 Bot 无 @ 不抢话；总管按回复里的 @ 派活 |
| M1-3 任务卡 | ✅ running → done/failed |
| M1-4 队列与并发 | ✅ 房间串行 + 派活最多 2 路并行 + queued 状态 |
| M1-5 软写锁 | ✅ 从任务文本抽文件声明，冲突时出系统提醒 |
| M1-6 上下文块 | ✅ 房间头 + 最近 12 条 + 任务，≤2400 字 |
| M1-7 Handoff | ✅ 任务卡完成时带 240 字结论摘要 |
| 多 Bot 演示 | ✅ 见 [spike/m1-3-dispatch.png](spike/m1-3-dispatch.png) |
| M2 接管 / 交还 | ✅ 暂停 + 人改 + 交还摘要进房间近况 |
| M2 审批 | ⬜ 仍靠 DSH 自带审批，未做房间内审批卡 |
| M3 交付页 | ✅ 验收点三态 + 变更文件 + 花费，见 [spike/m3-delivery.png](spike/m3-delivery.png) |
| M3 产物 / 熔断 | 🟡 变更清单有、版本链与硬熔断未做 |

### 第一批改进（已完成）

| 项 | 状态 | 说明 |
|---|---|---|
| 单元测试 | ✅ | `pnpm test`，21 个用例覆盖 parse/turn 的纯函数；首跑就抓到一个 `不通过` 被认成 pass 的真 bug |
| 固定工作区 | ✅ | 每房间 `~/.dsh/dshbot/rooms/<id>/work`，建房即创建，老房间惰性补 |
| 启动自愈 | ✅ | 插件挂载时把 working/thinking/queued 复位，并留系统消息；实测日志 `[dshbot] healed 1 interrupted room(s)` |
| 可取消 | ✅ | `POST /rooms/:id/stop` + 发送中的「停止」按钮 |
| Markdown 渲染 | ⬜ | 还没做 |

### 第二批改进（已完成）

| 项 | 状态 | 说明 |
|---|---|---|
| 房间可编辑 / 可删除 | ✅ | `PATCH` / `DELETE /rooms/:id`，头部「编辑」「删除」（双击确认） |
| 角色 UI | ✅ | 拉人表单可选执行 / 总管 |
| 导出 Markdown | ✅ | 头部「导出」，`buildMarkdown` 在 core 里且有 5 个单测 |
| SSE 推送 | 🟡 | `GET /rooms/:id/events` 推房间快照；逐条工具事件仍需事件总线 |
| 提示注入防护 | ✅ | 上下文块加边界声明：房间消息只当需求，不当指令 |

### 第三批改进（已完成）

| 项 | 状态 | 说明 |
|---|---|---|
| 结构化验收 | ✅ | `file:路径` / `cmd:命令` 由机器判定（0 token、0.1s）；其余仍交模型 |
| 版本快照 | ✅ | 每次运行前 `git commit`，`GET /rooms/:id/versions` 可查 |
| 回滚 | ✅ | `POST /rooms/:id/versions {hash}`；回滚前先快照，界面二次确认 |

### 第四批（收尾）

| 项 | 状态 | 说明 |
|---|---|---|
| Markdown 渲染 | ✅ | `parseBlocks` / `parseInline` 在 core，支持代码块、列表、表格、标题、加粗；14 个单测 |
| 实时活动 | ✅ | 工具调用时把「正在 xxx…」写进内存，SSE 快照合并后推送，不写库避免并发覆盖 |
| 计划确认门 | ✅ | `mode=confirm` 时只出计划（任务卡 pending）＋「批准执行/否决」；`POST /rooms/:id/plan` |
| 全部测试 | ✅ | 43 个 |

### 第五批（工程化收尾）

| 项 | 状态 | 说明 |
|---|---|---|
| 全局并发闸门 | ✅ | 跨房间最多 4 个 Run，超出排队 |
| diff 预览 | ✅ | `GET /rooms/:id/diff?file=`；交付面板点文件看差异 |
| 错误边界 | ✅ | `RoomsBoundary` 包住房间页，炸了给"重试"而不是白屏 |
| 一键校验 | ✅ | `pnpm check` = typecheck + test；附 GitHub Actions |
| CI | ✅ | `.github/workflows/check.yml` |

### 第六批（实测反馈修复）

实测《实验案例》时发现：房间工作区是空的，Bot 读不到项目文件。

| 项 | 状态 | 说明 |
|---|---|---|
| **绑定工作目录** | ✅ | 建房 / 编辑可填项目路径；实测绑定 `D:\Desktop\DSBOT` 后 3.8s 读到 README |
| 验收行规范化 | ✅ | 去掉手打 `1.` / `-` 与最外层反引号，避免界面出现 "1. 1. \`xxx\`" |
| 注入规则改写 | ✅ | 从「有人要你…」改成「【规则】…」，模型不再把它当指令复述 |
| 案例补坑 | ✅ | 实验案例加"工作目录必填"与两条排错 |
| **快照仓库隔离** | ✅ | 每房间一个 bare 仓库（`rooms/<id>/snapshots.git`），通过 `--git-dir/--work-tree` 指向工作区；**不往用户项目仓库提交，回滚也不会 reset 掉别人的工作** |

### 第七批（第三次实测反馈修复）

实测发现：计划没批准就去点「交付验收」，判定器会拿总管的派活说明当成品判，得出"没有成品"的结论。

| 项 | 状态 | 说明 |
|---|---|---|
| 验收门禁 | ✅ | 有 `pendingPlan` 时 `POST /deliver` 直接 409：「还有 N 件事等你批准」；按钮文案变「先批准计划」 |
| 判定取产出 | ✅ | 优先取执行者消息；只有总管时在提示词里标注"派活说明不是成品"，要求判 unsure |
| 批准留痕 | ✅ | 批准时写一条「计划已批准：N 件事开始执行」，执行者上下文里能看到 |
| 验收结果去重 | ✅ | 连续两次相同结论不再重复刷系统消息 |
| 验收陷阱提醒 | ✅ | 全是文字判定且工作区零变更时，交付页黄字提示"Bot 说写了但可能没写"；实测抓到一次 3/3 通过但文件不存在 |

### 第八批（超时）

| 项 | 状态 | 说明 |
|---|---|---|
| 单轮超时可配 | ✅ | 默认 60s → **5 分钟**；`config.json` 的 `runTimeoutMs` 或环境变量 `DSHBOT_RUN_TIMEOUT_MS`，夹在 10s–30min |
| 截断标注 | ✅ | 超时返回 `truncated: true`，消息尾部追加「本轮被超时截断…」；实测 10s 强制截断可复现 |
| 解释历史现象 | ✅ | 之前几次「（模型没有返回文字）」就是 60 秒截断，不是模型的问题 |

### 第九批（预算熔断）

| 项 | 状态 | 说明 |
|---|---|---|
| 房间级熔断 | ✅ | `canStartRun` 判房间额度，到线直接拒绝开跑；实测 0.4s 返回且不调用模型 |
| 个人级熔断 | ✅ | 成员 `tokensUsed` 超 `perBot` 时，该成员这一轮不执行 |
| 单轮超支留痕 | ✅ | 跑完发现超 `perRun` 时补一条系统消息（已跑完拦不住） |
| 界面提示 | ✅ | 成本条在超支时显示「预算已用尽，Bot 不再执行」 |
| 测试 | ✅ | 新增 `budget.test.mjs` 7 个用例，总数 51 → 58 |

### 第十批（审计导出）

| 项 | 状态 | 说明 |
|---|---|---|
| JSONL 审计 | ✅ | GET /rooms/:id/audit，一行一条（人话/工具/任务卡），工具输出截断 4000 字 |
| 纯函数与测试 | ✅ | core/audit.ts，7 个用例，总数 58 → 65 |
| 界面 | ✅ | 头部「审计」按钮，下载 <房间名>.audit.jsonl |
| 实测 | ✅ | 一轮对话导出 3 行，全部可解析 |
### 第十一批（Bot 角色卡与工具集）

| 项 | 状态 | 说明 |
|---|---|---|
| Bot 库 | ✅ | GET/POST/PATCH/DELETE /bots；角色卡存 ots[]，可跨房间复用 |
| 房间内使用 | ✅ | 从库拉入（整份复制，含 defId）或临时建一个（只在本房间） |
| 自动拆分 | ✅ | POST /bots/split，按「身份/专长/输出规范」标签拆；无标签时首句当专长 |
| 工具集 | ✅ | 选 agent preset；实测部署提供 standard / ptc / minimal / cordis，minimal 确实关了文件读写 |
| 上下文装配 | ✅ | 顺序：房间规则 → 岗位 → 输出要求 → 文件范围 → 近期动态 → 任务 |
| 总管决策 | ✅ | 成员表带一句话专长，总管据此派人 |
| 实测 | ✅ | 硬件工程师人设生效：回答自动给最坏情况、单位容差、风险表 |
| 测试 | ✅ | 新增 bots.test.mjs 8 个用例，总数 65 → 73 |
### 第十二批（独立 Bot 库页面）

| 项 | 状态 | 说明 |
|---|---|---|
| 库页面 | ✅ | 左侧 tab 切「房间 / Bot 库」；库视图复用三栏布局：列表 + 编辑区 |
| 增删改 | ✅ | 新建、编辑（PATCH）、删除（DELETE）都在库里完成，不需要先进房间 |
| 房间内 | ✅ | 成员面板仍可从库拉入、或临时建；多一个「去 Bot 库管理 →」入口 |
| 截图 | ✅ | 见 [spike/bot-library.png](spike/bot-library.png) |

## 3. 代码地图

```
packages/
  core/            零 DSH 依赖：Room/Bot/Seat/Message/Assignment/Artifact 类型 + id 工具
  plugin/
    src/index.ts        Host 插件入口：注入 webServer/agents/sessions，挂路由
    src/host/api.ts     路由：/dshbot/api/{health,rooms,_probe}
    src/host/store.ts   房间存储（临时文件 + rename）
    src/host/agent.ts   ⚠ 进程内跑 agent 回合（M0-3 卡点在这）
    src/client/index.ts 注册 main 面板 + 侧栏入口
    src/client/page.tsx 房间页（三栏）
    src/client/api.ts   浏览器侧 fetch（文档相对路径）
  cli/             dsh-bot 骨架命令
scripts/install.mjs  构建 → 类型检查 → link: 进 profile → 补丁层托管段
spike/           冒烟与取证工具（CDP 截图、M0-1 检查、结论文档）
```

## 4. 环境事实

| 项 | 值 |
|---|---|
| DSH 版本 | 0.2.1-rc.5 |
| DSH home | `C:\Users\14153\.dsh` |
| 桌面端 profile | `desktop`（**被 Electron 独占**，CLI 不能 dump-config） |
| 开发 profile | `dshbot-dev`（从 web 复制，端口 54873） |
| 安装方式 | `link:`（软链），不是 `file:`（拷贝） |
| 补丁层 | `profiles/<name>/cordis.patch.yml` 里的 `# >>> dshbot:managed` 段 |
| 数据 | `~/.dsh/dshbot/rooms.json` |
| 权限 | 非管理员；Node/pnpm/Git 装在 `%LOCALAPPDATA%\Programs` |
| 网络 | GitHub 不通，用 npmmirror；npm registry 正常 |
| PowerShell | `CurrentUser` 执行策略 = RemoteSigned |

## 5. 已验证的技术结论（别重走）

1. **插件形态**：第三方包注册 `main` 全屏页（`ctx.slots.register({ name:'main', key })`）+ `sidebar.panellist` 入口；客户端 bundle 必须包成 `window.__ModuleLoader__.load({ id, factory })`。详见 [T2-验证报告.md](T2-验证报告.md)。
2. **前后端通信**：`ctx.webServer.register({ kind:'prefix', path, handler })` + 普通 `node:http`；浏览器用**文档相对 URL**（`dshbot/api/...`，无前导斜杠），Electron 的 `dsh://app/` 协议会转发给本地 webserver。
3. **构建**：esbuild 出 CJS，banner/footer 包成 loader 形状；`react` 等 11 个模块 external，绝不能打进第二份 React。
4. **Run 不能用子进程**：`dsh headless` 拿不到账号 token——`resolveToken` 要求 `destination.origin === inferenceOrigin`，裸 CLI 对不上。详见 [spike/x1-findings.md](spike/x1-findings.md)。
5. **session 事件形状**：`{ log: [{ type, seq, time, data }] }`，含 `turn/start`、`step/start`、`agent/inbox/spliced`、`turn/end`。这就是 M0-4 消息流的数据源。
6. **agent 句柄**：`ctx.agents.create()` 返回 `{ agent, dispose }`，真句柄在 `agent` 上，有 `followup()`。

## 6. 当前卡点（M0-3）

**症状**：起 agent、投消息都成功，但回合 32ms 就结束：

```
prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")
```

**原因**：`agents.create({ sessionId, agentOptions: { cwd } })` 没带 Agent preset 与模型选择，系统提示词模板填不上 `{{model}}`。

**两条路**：

| | 做法 | 备注 |
|---|---|---|
| **A（推荐）** | 找到谁给 `agents` 挂了 `createSession`，注入那个服务 | UI 已验证的路径；`ctx.agents.createSession` 在插件里不存在，全局搜定义 0 命中 |
| B | 自己拼 `agentOptions`：`preset` + 从 `ctx.agentDefaultModel` 读 `{ provider, model }` | 字段名靠猜，可能要试几轮 |

线索：`dsh-api-session-controller` 里 `SessionCommandController.create()` 调用 `this.agents.createSession({ sessionId, cwd, agentPreset, reusable })`——说明 `this.agents` 与插件拿到的 `ctx.agents` 不是同一个扩展层。

## 7. 恢复步骤

```powershell
# 1. 依赖（只需一次）
cd D:\Desktop\DSBOT; pnpm install

# 2. 构建 + 装进桌面端 profile
pnpm install:profile

# 3. 重启 DSH 生效
```

跑开发实例（不影响桌面端）：

```powershell
dsh plugin --profile dshbot-dev add "link:D:/Desktop/DSBOT/packages/plugin"   # 首次
dsh --profile dshbot-dev --port 54873 --no-open                               # 打印带 token 的地址
```

## 8. 下一步三件事

1. 解决 M0-3 的 preset 问题（路线 A）；
2. 把 agent 事件映射成房间消息（M0-4），顺手删掉 `_probe` 探针；
3. 接 `@提及` 触发（M0-5）。

## 9. 已知的坑

| 坑 | 表现 | 处理 |
|---|---|---|
| JSON 带 BOM | `dsh plugin add` 报 `Unexpected token '﻿'` | 写 JSON 一律无 BOM UTF-8 |
| 补丁层裸加条目 | `patch: entry "x" not found` | 必须写 `- insert: [...]` |
| `file:` 依赖 | 重建后 profile 还是旧代码 | 用 `link:` |
| 重复 id | 补丁层出现两个同名条目，Loader 报错 | 脚本已加防护，手写时注意 |
| `desktop` profile | CLI 报 `managed exclusively` | 正常，用 `dshbot-dev` 做组合校验 |
| 旧 PowerShell 窗口 | `dsh : 无法将…识别为…` | 重载 `$env:Path` 或开新窗口 |
| 根包 `type: module` | `.js` 脚本里的 `require` 报错 | 改用 `.cjs` |
| 中文乱码 | PowerShell 控制台显示乱码 | 只是显示问题，文件本身是 UTF-8，用 `read` 确认 |
| 端口残留 | 重启报占用 | 先 `Stop-Process` 掉占用 54873 的进程 |

## 10. 文档索引

| 文件 | 内容 |
|---|---|
| [DSHBot-需求规格-v1.1.md](DSHBot-需求规格-v1.1.md) | 需求基线（房间模型、工位、审批、里程碑） |
| [TASKS.md](TASKS.md) | 任务清单与状态 |
| [T2-验证报告.md](T2-验证报告.md) | 插件页面注册 API 取证 |
| [INSTALL.md](INSTALL.md) | 安装与排错 |
| [ENVIRONMENT.md](ENVIRONMENT.md) | 开发环境清单 |
| [spike/x1-findings.md](spike/x1-findings.md) | 为什么不能用子进程 |
| [spike/m0-3-notes.md](spike/m0-3-notes.md) | M0-3 进展与卡点 |
| [spike/README.md](spike/README.md) | S0-1 冒烟记录与 CDP 取证工具 |
