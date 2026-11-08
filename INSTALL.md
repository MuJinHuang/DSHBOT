# 安装指南

DSHBot 是一个 DSH 插件包。安装 = **装进某个 profile + 在补丁层里插一条 Loader 条目**。

## 0. 前提

| 项 | 要求 |
|---|---|
| DSH | 0.2.1-rc.5（本机版本），插件 API 可能随版本变 |
| 你的 GUI 用哪个 profile | 本机是 `desktop`（`C:\Users\14153\.dsh\profiles\desktop`） |
| CLI | `D:\应用\其他应用\DeepSeek_Harness\resources\runtime\cli\bin\dsh.cmd` |

> `dsh` 不在 PATH 里。要么用全路径，要么把它所在目录加进 PATH：
> ```powershell
> [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';D:\应用\其他应用\DeepSeek_Harness\resources\runtime\cli\bin', 'User')
> ```

## 1. 装包

### A. 本地目录（开发期）

```powershell
dsh plugin --profile desktop add "link:D:/Desktop/DSBOT/packages/plugin"
```

**必须用 `link:`，不要用 `file:`。** `file:` 在 pnpm 里是拷贝（硬链接），重建产物后 profile 里还是旧代码；`link:` 是真软链，构建完重启就生效。

`scripts/install.mjs` 用的就是 `link:`，并且会自动把旧的 `file:` 依赖换掉。

### B. 从 npm（发布后）

```powershell
dsh plugin --profile desktop add @yourscope/dsh-bot
```

成功后 `profiles/desktop/package.json` 的 `dependencies` 会多一条。

## 2. 插一条 Loader 条目

编辑 `C:\Users\14153\.dsh\profiles\desktop\cordis.patch.yml`：

```yaml
- insert:
    - id: dshbot-hello
      name: '@dshbot/hello'
```

**注意不是这样**（会报 `patch: entry "dshbot-hello" not found`）：

```yaml
- id: dshbot-hello        # ❌ 错
  name: '@dshbot/hello'
```

补丁层只能按 id **修改**已有条目，**新增**必须放在 `insert:` 里。

## 3. 重启 DSH

关掉 DSH 应用再打开。刷新网页不够——Loader 条目是启动时组合的。

> ⚠️ 你正在用的 GUI 就是这个 profile。装之前先备份 `cordis.patch.yml`，装坏了能立刻还原。

## 4. 验证

1. 侧栏出现一个 🛖 图标；
2. 点它，主区域出现「DSHBot · hello」页面；
3. 页面上的按钮点一下，文字从「点我验证 React 状态」变成「React 正常，点了 1 次」。

任何一步不对，看第 6 节的排查。

## 5. 卸载

```powershell
dsh plugin --profile desktop remove @dshbot/hello
```

再从 `cordis.patch.yml` 里删掉那段 `insert`，重启。

## 6. 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `dsh : 无法将"dsh"项识别为…` | 当前窗口没重载 PATH（已开着的终端不会读新变量） | `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`，或开新窗口 |
| `error: profile "desktop" is managed exclusively by the Electron application` | `desktop` 被桌面应用独占，CLI 不能组合它的配置 | 正常现象，不影响 `plugin add`；要校验 patch 就复制到 `dshbot-dev` 上跑 `--dump-config` |
| `patch: entry "x" not found` | 直接写了条目没包 `insert:` | 改成 `- insert: [...]` |
| `Unexpected token '﻿'` | JSON 文件带 BOM | 存成无 BOM UTF-8 |
| 警告 `declares no dsh.bundle` | 包没声明 bundle 层 | 正常，手工做第 2 步即可 |
| 装完侧栏没变化 | 没重启，或装错了 profile | 确认 `desktop`，重启应用 |
| 页面白屏 / 控制台 404 | `lib/client.js` 不存在 | 先构建，产物必须落在这个路径 |
| 控制台报 `Cannot find module` | externals 漏配 | `react` 系列必须 external，不能打包进来 |

## 7. 隔离安装（推荐给开发调试）

不想动正在用的 GUI，就复制一份 profile 单独跑：

```powershell
Copy-Item -Recurse "$env:DSH_HOME\profiles\web" "$env:DSH_HOME\profiles\dshbot-dev"
dsh plugin --profile dshbot-dev add "file:D:/Desktop/DSBOT/spike/hello"
# 同样的 insert 写到 dshbot-dev/cordis.patch.yml
dsh --profile dshbot-dev --port 54873 --no-open
```

启动时会打印 `?token=…` 的地址，浏览器打开即可。用完关掉，不影响主 GUI。

本机已经有一份 `dshbot-dev`，S0-1 就是在这上面验的。

## 8. 正式插件会简化到什么程度

S0-2 会给包加上 `dsh.bundle` 声明，届时：

```powershell
dsh plugin --profile desktop add @yourscope/dsh-bot
```

一条命令装完，**不用手写 patch**，卸载同理。现在的两步流程是过渡态。
