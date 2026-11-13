# 安装

DSHBot 是一个 DSH 插件。安装 = 把包装进某个 profile + 让 DSH 的 Loader 认识它。

从 v0.2 起包内声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动注册 Loader 层，**不需要手改补丁文件**。

## 前提

| 项 | 要求 |
|---|---|
| DSH | 0.2.1-rc.5 验证通过 |
| 操作系统 | 当前只在 Windows 上验证 |
| profile | 桌面端默认 `desktop`；开发调试建议 `dshbot-dev` |
| CLI | DSH 安装目录下 `resources\runtime\cli\bin\dsh.cmd` |
| Node / pnpm | 安装 Release **不需要**；从源码开发才需要 |
| Git | 可选；没有时版本快照 / diff / 回滚降级 |

## 从 Release 安装（推荐）

1. 从仓库 Releases 下载 `dshbot-plugin-v0.2.0.zip`，解压到一个固定目录；
2. 装进 profile：

```powershell
dsh plugin --profile desktop add "link:%USERPROFILE%\dshbot\dshbot-plugin-0.2.0"
```

3. **完全重启 DSH**（不是刷新页面）。

也可以用 tarball，不需要解压：

```powershell
dsh plugin --profile desktop add "file:C:\path\to\dshbot-plugin-0.2.0.tgz"
```

## 验证

- 侧栏出现 🏠「房间」；
- 宿主日志出现 `[dshbot] host side loaded, api at /dshbot/api`；
- `profiles\desktop\package.json` 的 `dsh.profile.bundles` 里有 `@dshbot/plugin`。

## 从源码安装

```powershell
git clone <仓库地址>
cd DSHBOT
pnpm install
pnpm check
pnpm install:profile
# 重启 DSH
```

`pnpm install:profile` 会用 `link:` 指向 `packages/plugin`，并自动清理旧版手写补丁段。

## 卸载

```powershell
dsh plugin --profile desktop remove @dshbot/plugin
```

重启 DSH。数据不会被删除；要彻底清空，删除 `%USERPROFILE%\.dsh\dshbot`。

## 常见问题

| 现象 | 处理 |
|---|---|
| `dsh` 不是命令 | 用全路径，或把 `resources\runtime\cli\bin` 加进 PATH |
| 侧栏没有「房间」 | 确认 profile、bundle 层，重启 DSH |
| 页面白屏 / 404 | 检查 `lib/client.js` 是否存在；源码安装先 `pnpm build` |
| 中文乱码 | 文件保存为 UTF-8 无 BOM |
| 想隔离调试 | `$env:DSHBOT_DATA_DIR="$env:TEMP\dshbot-dev-data"; dsh --profile dshbot-dev --port 54873 --no-open` |
