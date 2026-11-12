# DSHBot — 项目指令（新会话自动加载）

> 这个文件会被 DSH 的 `dsh-agent-instructions` 自动注入到每次新会话。
> 写法原则：只写"不做会踩坑"的东西，别写说明书（说明书在 docs 里）。

## 这是什么

DSH 插件：在 DSH 里开"房间"，拉多个有岗位设定的 Bot 协作完成任务。
仓库根 `D:\Desktop\DSBOT`，pnpm monorepo（core / plugin / cli）。

## 新会话先读这四份（按顺序，别全读）

1. `STATE.md` — 现在能跑什么、进度、**无人值守协作约定**
2. `下一阶段任务.md` — N1 已完成，下一阶段候选与实测结论、成本参考
3. `TASKS.md` — 任务明细（**状态列以代码为准**）
4. `README.md` — 能力清单

`git log --oneline -10` 看最近改了什么。**不要重做已完成的部分。**

## 硬规则

- **不要重启 DSH**。Agent 跑在 DSH 进程里，重启＝杀死自己。开发和验证一律在独立实例上做。
- **两个实例用不同数据目录**，否则同时写 `rooms.json` 会互相覆盖：
  ```powershell
  $env:DSHBOT_DATA_DIR = "$env:TEMP\dshbot-dev-data"
  dsh --profile dshbot-dev --port 54873 --no-open
  ```
- **每完成一项就提交**，用小步 conventional commit（`feat:` / `fix:` / `docs:`）。
- **文档与代码同步提交**。文档过期时，房间里的 Bot 会把过期状态当真汇报——文档就是事实来源。
- 提交前必须 `pnpm check` 全绿（类型 + 构建 + 109 个测试）。
- 安装：`node scripts/install.mjs`（幂等，同步 profile 的 bundle 层并清理旧补丁段）。装完要**用户**重启才生效。
- Windows 上写 `.ps1` 必须带 UTF-8 BOM，否则 Windows PowerShell 按 ANSI 解码，中文全乱。

## 改代码前必须知道的设计约束

- **一只 Bot 一个 session**，每轮现拼上下文块（房间头 + 最近 12 条 + 岗位 + 任务，≤2400 字）。不要把别人的历史灌进去。
- **工具集跟 agent preset 走**，不是白名单。当前部署有 `standard / ptc / minimal / cordis`（`minimal` 关了文件读写）。
- **快照用独立 bare 仓库**（`rooms/<id>/snapshots.git` + `--git-dir/--work-tree`）。绝不往用户项目 git 里提交，回滚也不能 `reset --hard` 掉别人的工作。
- **验收谓词优先**：`file:路径` / `cmd:命令` 由机器判（0 token），其余才交给模型。模型判的是"文字里有没有提到"，不是"事情做成了"。
- **计划要人工确认**（`mode=confirm`）。批准动作必须写一条系统消息，否则执行者读到的还是"计划已生成"。
- **预算熔断**在 `runMember` 开跑前检查房间与个人额度，到线直接拒绝。

## 已经踩过的坑（别再踩）

1. 房间工作区默认是空的 → 必须能绑定真实目录，否则 Bot 只会报"源文件缺失"。
2. 验收标准没覆盖"要文件" → 会 3/3 通过但文件不存在。要文件就写 `file:`。
3. 计划没批准就点验收 → 判定器会拿总管的派活说明当成品。已加 409 门禁。
4. 单轮 60 秒硬超时 → 改代码任务被腰斩，表现成"模型没有返回文字"。现默认 5 分钟可配。
5. 建房自动塞无角色卡的"小柯" → 会撞名、会抢主笔。库里有 Bot 时不再塞。
6. 并行派活没有依赖顺序 → 复核者先于写手跑，只能报"文件缺失"。靠提示词约束，尚未做 DAG。
7. `@dshbot/core` 主入口曾依赖 `node:crypto` → 客户端打包炸。已改用 Web Crypto，别再引入 Node 内置模块。

## 常用命令

```powershell
pnpm check            # 类型 + 构建 + 测试
pnpm build            # 只构建
node scripts/install.mjs           # 装进 desktop profile
node spike/session-cost.cjs        # 量本次/全部会话花了多少 token 与钱
node spike/desktop-test.mjs 59565  # 端到端演练（建房→派活→验收）
```

## 成本意识

`deepseek-flash` 高峰 ¥2/1M 输入、¥8/1M 输出；空闲时段半价（工作日 9–12、14–18 之外）。
长会话里"重放上下文"是主要开销——**能开新会话就别在超长会话里硬撑**。
