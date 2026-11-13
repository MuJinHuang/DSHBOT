# 安装指南

DSHBot 是一个 **DSH 插件包**。安装 = 把包装进某个 profile + 让 DSH 的 Loader 认识它。

从 v0.2 起包内声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动注册 Loader 层，**不需要手改补丁文件**。

## 前提

| 项 | 要求 |
|---|---|
| DSH | 0.2.1-rc.5 验证通过；插件 API 可能随版本变 |
| 操作系统 | Windows（当前只在 Windows 上验证） |
| profile | 桌面端默认 `desktop`；开发调试建议单独 `dshbot-dev` |
| CLI | DSH 安装目录下 `resources\runtime\cli\bin\dsh.cmd`，以下简写 `dsh` |
| Node / pnpm | **不需要**（仅从源码开发时需要） |
| Git | 可选。没有时版本快照 / diff / 回滚降级 |

> `dsh` 可能不在 PATH 里。要么用全路径，要么把 `...\resources\runtime\cli\bin` 加进用户 PATH（新开终端生效）。

## 方式 A：安装 Release 压缩包（推荐）

1. 从仓库 **Releases** 下载 `dshbot-plugin-1.0.0.zip`（或 `.tgz`）。
2. 解压到一个固定目录，例如：

   ```powershell
   Expand-Archive .\dshbot-plugin-1.0.0.zip -DestinationPath "$env:USERPROFILE\dshbot"
   ```

   解压后应是 `%USERPROFILE%\dshbot\dshbot-plugin-1.0.0\`，里面有 `package.json`、`lib\`、`cordis.patch.yml`。

3. 装进 profile：

   ```powershell
   dsh plugin --profile desktop add "link:$env:USERPROFILE\dshbot\dshbot-plugin-1.0.0"
   ```

4. **完全重启 DSH**（不是刷新页面）。

成功后：
- 侧栏出现 🏠「房间」；
- `%USERPROFILE%\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 里有 `@dshbot/plugin`；
- 宿主日志出现 `[dshbot] host side loaded, api at /dshbot/api`。

> 用 `link:` 指向解压目录，升级时替换目录内容再重启即可；不需要重新 `plugin add`。
> 如果解压到了别的路径，把上面的 `link:` 换成实际绝对路径（用正斜杠）。

也可以直接用 Release 里的 tarball（不需要解压）：

```powershell
dsh plugin --profile desktop add "file:C:\path\to\dshbot-plugin-1.0.0.tgz"
```

`file:` 会把包拷进 profile，升级时重新执行这条命令即可。

## 方式 B：从源码安装（开发）

```powershell
git clone <repo>
cd DSHBOT
pnpm install
pnpm check                # 类型检查 + 构建 + 测试
pnpm install:profile      # 构建 → link 进 desktop profile → 迁移旧补丁
# 重启 DSH
```

`pnpm install:profile` 是幂等的：
- 用 `link:` 指向 `packages/plugin`（重建产物后重启即生效）；
- 自动把 `@dshbot/plugin` 加进 profile 的 `dsh.profile.bundles`；
- 如果补丁层里还留着旧版 `# >>> dshbot:managed` 段，会先备份再删掉（避免重复 id）。

指定别的 profile：

```powershell
$env:DSHBOT_PROFILE = 'dshbot-dev'
pnpm install:profile
```

如果 `dsh` 不在 PATH 里，安装脚本和 `plugin add` 都可以显式指定：

```powershell
$env:DSHBOT_DSH_CLI = 'C:\path\to\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
pnpm install:profile
```

## 升级

- **Release 安装**：替换解压目录内容 → 重启 DSH；
- **源码安装**：`git pull` → `pnpm install` → `pnpm install:profile` → 重启。

版本兼容请看 README 的「安装与兼容」。

## 卸载

```powershell
dsh plugin --profile desktop remove @dshbot/plugin
```

然后检查 `profiles\desktop\package.json` 的 `dsh.profile.bundles` 里不再有 `@dshbot/plugin`（新版本管理器会自动处理；旧版本可能残留，手动删掉即可）。重启 DSH。

房间数据不会被卸载删除；要彻底清空，删除 `%USERPROFILE%\.dsh\dshbot`。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `dsh : 无法将"dsh"项识别为…` | 当前终端没重载 PATH | 用全路径，或开新终端 |
| 侧栏没有「房间」 | 没重启 / 装错 profile / bundle 未注册 | 确认 `dsh.profile.bundles`；看宿主日志 |
| 日志里没有 `[dshbot]` | Loader 没加载插件 | 检查 profile 的 `dependencies` 和 `bundles` |
| `profile "desktop" is managed exclusively by the Electron application` | 桌面端独占 profile | 正常，只影响 `--dump-config` 之类的命令 |
| 页面白屏 / 控制台 404 | `lib/client.js` 缺失 | 用官方 Release，或源码 `pnpm build` |
| 旧的 `rooms.json` 里还有 `messages` | 还没触发迁移 | 启动后打开一次房间即可自动迁移（按 id 去重） |
| 中文乱码 / YAML 解析失败 | 文件被存成带 BOM 或 ANSI | 一律 UTF-8 无 BOM |
| `git` 相关功能为空 | 机器没装 git | 安装 git，或接受 diff/回滚降级 |

## 给开发者：隔离实例

不想动正在用的 GUI：

```powershell
$env:DSHBOT_DATA_DIR = "$env:TEMP\dshbot-dev-data"
dsh --profile dshbot-dev --port 54873 --no-open
```

用不同数据目录，避免两个实例同时写 `rooms.json`。
