# 开发环境清单

> 安装日期：2026-11-06　机器：Windows 11 专业版 / AMD64　账号：普通用户（非管理员）

## 已安装

| 工具 | 版本 | 路径 | 方式 |
|---|---|---|---|
| Git | 2.56.0.windows.4 | `%LOCALAPPDATA%\Programs\Git` | PortableGit 解压（免 UAC） |
| Node.js | v24.22.2 (LTS Krypton) | `%LOCALAPPDATA%\Programs\nodejs` | 官方 zip 解压（免 UAC） |
| npm | 11.19.1 | 随 Node | — |
| pnpm | 11.28.5 | `%APPDATA%\npm` | `npm i -g`（用户前缀） |

pnpm 版本特意与 DSH 内置版本（11.28.5）对齐，避免锁文件格式差异。

## 环境变量

用户 PATH（已追加，原有 `WindowsApps` 保留）：

```
%LOCALAPPDATA%\Programs\Git\cmd
%LOCALAPPDATA%\Programs\nodejs
%APPDATA%\npm
```

npm 全局前缀：`%APPDATA%\npm`（写用户目录，不需要管理员）。

原始 PATH 备份：`%TEMP%\dshbot-setup\user-path-backup.txt`

## PowerShell 执行策略

`CurrentUser` 作用域设为 `RemoteSigned`（原为 Undefined/Restricted）。不设的话 `pnpm.ps1`、`npm.ps1` 等脚本包装器无法运行。

撤销：`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined`

## 网络现状

| 目标 | 状态 | 说明 |
|---|---|---|
| nodejs.org / registry.npmjs.org / npmmirror | 可达 | 依赖安装正常 |
| github.com | 视网络而定 | 不通时用 npmmirror 镜像，或用代理 |

> 推 GitHub / 用 GitHub CLI 需要能访问 github.com；按自己的网络环境准备代理或改用其他托管。

## Git 配置

已设：`init.defaultBranch=main`、`core.quotepath=false`。

**未设**：`user.name` / `user.email`（首次提交前需补）：

```powershell
git config --global user.name "你的名字"
git config --global user.email "you@example.com"
```

## 卸载

```powershell
Remove-Item "$env:LOCALAPPDATA\Programs\Git" -Recurse -Force
Remove-Item "$env:LOCALAPPDATA\Programs\nodejs" -Recurse -Force
Remove-Item "$env:APPDATA\npm" -Recurse -Force
# 再从用户 PATH 删除对应三条
```

## 已验证

- `git init → add → commit` 真实提交通过；
- `pnpm add` 从 npm registry 安装成功（3.2s）；
- 新开终端可直接调用 `git` / `node` / `npm` / `pnpm`。

> 注意：DSH 应用本身在启动时继承环境变量，**重启 DSH 后**其内部终端才会看到新 PATH；当前会话通过临时拼接 PATH 使用。
