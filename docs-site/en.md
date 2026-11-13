# DSHBot Rooms

[中文](index.md) · English

**Open a room inside DSH, invite role-based bot teammates, say one sentence, and let them split the work.**

You set the goal, approve the plan, review the deliverables.

## What it is

DSHBot is a DSH plugin that turns a multi-agent chat into a checkable workflow:

| Step | What happens |
|---|---|
| **Room = task** | One goal plus machine-checkable acceptance (`file:path`, `cmd:command`) |
| **Plan gate** | The host proposes tasks; approve all or only some |
| **DAG** | `[depends:@name]` markers; tasks run in layers, upstream conclusions flow downstream |
| **Per-bot model** | Model + reasoning effort per bot, validated against the deployment catalog |
| **Delivery** | Changed files, diff, snapshots, rollback, audit JSONL, Markdown export |

## Install

Prerequisites: DSH 0.2.1-rc.5 on Windows, a profile.

```powershell
dsh plugin --profile desktop add "link:C:\path\to\dshbot-plugin-1.0.0"
# fully restart DSH
```

See the repository `README.en.md` for the full guide.

## Development

```powershell
pnpm install
pnpm check
pnpm drill
pnpm smoke:ui
pnpm docs:build
```

`pnpm smoke:ui` starts an isolated DSH with a temp data dir and drives headless Edge/Chrome.
`node spike/live-dag-check.mjs --port 54873` runs a real-model DAG check (costs tokens).

## Limits

- Local single-user; the plugin API is loopback-only and unauthenticated.
- `cmd:` acceptance executes commands as your user.
- No true write locks or tool-approval hooks yet (DSH API limits).
- Windows is the validated platform.

License: MIT.
