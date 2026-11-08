# S0-1 冒烟结果：第三方插件全链路

**结论：通过。** 一个本地 npm 包，装进独立 profile 后，能在 DSH Web GUI 里注册全屏页、挂侧栏入口、被点开、并跑起 React 状态。

## 证据链

| # | 环节 | 证据 |
|---|---|---|
| 1 | Host 侧加载 | 进程 stdout：`[dshbot-hello] host side loaded, cwd=D:\Desktop\DSBOT` |
| 2 | 进启动图 | `window.__DSH_BOOT__` 里有 `{"id":"@dshbot/hello","url":"plugins/??@dshbot/hello/client.js&rev=…","inject":[...]}` |
| 3 | Bundle 被服务 | `GET /plugins/??@dshbot/hello/client.js&rev=…` → 200，3044 字节，`text/javascript` |
| 4 | 浏览器执行 | 控制台：`[dshbot-hello] client side loaded` |
| 5 | 页面渲染 | 点侧栏图标后主区域出现「DSHBot · hello」，React 计数从 0 变 1 |

截图：[hello-screenshot.png](hello-screenshot.png)

## 复现步骤

```powershell
# 1. 独立 profile（已创建，可跳过）
Copy-Item -Recurse "$env:DSH_HOME\profiles\web" "$env:DSH_HOME\profiles\dshbot-dev"

# 2. 装插件
dsh plugin --profile dshbot-dev add "file:D:/Desktop/DSBOT/spike/hello"

# 3. 在 cordis.patch.yml 里插入条目（见下）
# 4. 起服务
dsh --profile dshbot-dev --port 54873 --no-open

# 5. 取证
node spike/cdp-shot.cjs "http://127.0.0.1:54873/?token=<启动时打印的 token>" spike/hello-screenshot.png
```

`cordis.patch.yml` 的正确写法是 **`insert` 列表**，不是裸条目：

```yaml
- insert:
    - id: dshbot-hello
      name: '@dshbot/hello'
```

## 踩到的五个坑

1. **patch 不能直接加条目**
   裸写 `- id: x / name: y` 会报 `patch: entry "x" not found`。补丁层只按 id 改已有条目，新增必须走 `- insert: [...]`。

2. **没有 `dsh.bundle` 的包不会自动成为 profile 层**
   `dsh plugin add` 会警告 `declares no dsh.bundle — installed as a plain dependency`。装完还得手工 insert。正式包要么带 `dsh.bundle`，要么把这一步做进安装流程。

3. **BOM 会让 `dsh plugin add` 直接崩**
   PowerShell 的 `Set-Content -Encoding UTF8` 写入带 BOM，Node 的 `JSON.parse` 报 `Unexpected token '﻿'`。所有写 JSON 的地方必须用无 BOM UTF-8。

4. **SPA 启动会抹掉 query**
   带 `?token=…&hello=1` 打开，起来后 `location.href` 变成 `http://127.0.0.1:54873/`。所以**不能靠 query 参数传状态**，切面板要用 `ctx.layout.selectPanel()` 或点 UI。

5. **首启弹窗会挡住页面**
   新 profile 第一次打开有「预览版说明」模态。自动化取证必须先点掉「继续」，否则截到的是弹窗。

## 附带的工具经验

- `msedge --headless=new --screenshot` 会挂住不退出（25 个进程僵在那里）。改用 CDP 驱动就稳定了，`spike/cdp-shot.cjs` 可复用。
- CDP 还能抓 `Runtime.consoleAPICalled`，等于免费拿到前端日志，比截图更适合断言。

## 对正式插件的含义

- 客户端 bundle 就是手写的那个形状：`window.__ModuleLoader__.load({ id, factory: (require) => {...} })`，导出 `apply` / `inject`。
- `inject` 至少要 `["slots", "layout"]`，缺了服务就拿不到注册能力。
- 正式插件的构建产物必须落在 `lib/client.js`，且 `react` 系列 external（已验证宿主那份 React 可用，hooks 正常）。
- 房间页可以直接照抄这次的结构：`main` slot 的 key + `sidebar.panellist` 的同名 id。

## 未验证

- `dsh.bundle` 形态的自动装配（下一步做正式包时验证）；
- 多插件同页共存与插槽子条目（`children`）；
- HMR：`pnpm run dev:web` 下的免刷新更新。
