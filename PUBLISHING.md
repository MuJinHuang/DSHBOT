# 发布清单（GitHub）

这份清单给维护者用。代码本身已经按"可发布"准备，剩下的是仓库侧配置。

## 0. 发布前检查

```powershell
pnpm check            # 144 个用例必须全绿
pnpm drill            # 假宿主全链路
pnpm build
```

- 搜一遍不该进仓库的东西：`git grep -n -E "token=|sk-|password|C:\\\\Users"`；
- 确认 `docs/assets/` 的截图不含用户名、本机路径或真实房间内容；
- 确认 `packages/plugin/package.json` 的 `version` 与要打的 tag 一致（CI 会校验）。

> **历史清理建议**：如果这个仓库在开发期提交过带本机路径/用户名的截图或文档，
> 首次公开前最好用新仓库或 `git filter-repo` 清理历史；只删当前文件不会从旧提交里消失。

## 1. 建仓库并推上去

```powershell
git remote add origin https://github.com/<owner>/dshbot.git
git push -u origin main
```

然后在 GitHub 仓库设置里补：

- Description：`A DSH plugin for role-based bot rooms: plan, split work, deliver files.`
- Topics：`dsh`、`deepseek-harness`、`plugin`、`multi-agent`、`ai-agents`
- Website：可以先留空
- Social preview：用 `docs/assets/rooms.png`
- 开启 **Private vulnerability reporting**（Security 页面）

## 2. 把仓库地址补进元数据

拿到地址后，在 `packages/plugin/package.json` 与根 `package.json` 里补：

```json
"repository": { "type": "git", "url": "https://github.com/<owner>/dshbot.git" },
"homepage": "https://github.com/<owner>/dshbot#readme",
"bugs": { "url": "https://github.com/<owner>/dshbot/issues" }
```

`README.md` 里的 Releases 链接用的是相对路径，换仓库不用改。

## 3. 打 tag 触发 Release

```powershell
# 先本地验证产物
pnpm check
pnpm docs:build
pnpm stage:release

git tag v1.0.0
git push origin v1.0.0
```

`.github/workflows/release.yml` 会：

1. `pnpm install --frozen-lockfile` + `pnpm check` + `pnpm docs:build`；
2. 校验 tag 与 `packages/plugin/package.json` 的 version 一致；
3. 用 `pnpm stage:release` 产出 `dshbot-plugin-1.0.0.zip`、`dshbot-plugin-1.0.0.tgz`、`SHA256SUMS.txt`（跨平台，不依赖系统 zip）；
4. 用 `gh release create` 建 Release，正文取 `CHANGELOG.md`。

发布后下载 zip，按 [INSTALL.md](INSTALL.md) 在干净 profile 里装一遍，确认：

- `dsh plugin add` 没有 "declares no dsh.bundle" 警告；
- profile 的 `dsh.profile.bundles` 出现 `@dshbot/plugin`；
- 重启后侧栏出现 🏠，宿主日志有 `[dshbot] host side loaded`。

## 4. 可选：发 npm

包名是 `@dshbot/plugin`，需要先拥有 `@dshbot` scope。

```powershell
cd packages/plugin
pnpm build
Copy-Item ../../LICENSE ./LICENSE
npm publish --access public
Remove-Item ./LICENSE
```

发布前确认 `private` 已移除、`files` 含 `lib` / `cordis.patch.yml` / `locale` / `icon.svg`。

## 5. 文档站

文档源在 `docs-site/`，构建产物在 `site/`（已 gitignore）：

```powershell
pnpm docs:build
```

GitHub 仓库 **Settings → Pages → Build and deployment → Source: GitHub Actions**。
之后 push 到 `main` 会触发 `.github/workflows/pages.yml`，发布到
`https://<owner>.github.io/<repo>/`。

页面导航在 `scripts/build-docs.mjs` 的 `pages` 数组里维护；新增 Markdown 后加一行。

## 6. 发布后

- 在 README 顶部加 CI / Release badge；
- 把 `docs/assets/` 截图同步到 Release 说明或社交预览；
- 新功能按 [CONTRIBUTING.md](CONTRIBUTING.md) 的约定走 PR；
- 下一阶段（N3）候选：Bot 记忆、技能、更细的权限/审批。

## 已知待补

- 英文文档目前只有 README；内部设计文档仍是中文；
- UI 冒烟依赖本机 DSH + Edge/Chrome，没有放进 CI；
- 还没有 GitHub remote、`v1.0.0` tag 和线上 Pages；建仓后补 README CI badge；
- 发布包已在本地新 profile 验证（`/health`、`/models`），但还没在第二台干净机器上装过。
