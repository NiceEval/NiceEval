---
format: concord.document/v1
id: agent-setup-workspace-writes-pollute-diff
title: agent.setup 往 workspace 里装的东西会被当成「agent 生成的文件」记进 diff
createdAt: 2026-07-12T22:18:12+08:00
createdAtSource:
  kind: first-recorded
  path: memory/agent-setup-workspace-writes-pollute-diff.md
  commit: 2875814261652f0c69f35edb0d11b51abdcfa9bf
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [agent-setup-workspace-writes-pollute-diff](agent-setup-workspace-writes-\
      pollute-diff.md) — git 基线早于 `agent.setup`,所以 setup 往 workspace 装的 skill /
      AGENTS.md 会被当成 agent 产出记进 diff;修为写 `.git/info/exclude`(能放 `$HOME` 就别放
      workspace)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# agent.setup 往 workspace 里装的东西会被当成「agent 生成的文件」记进 diff

**现象**:给 claude-code 装 skill 后,`diff.json` / `t.sandbox.diff` 里出现几十个 skill 文件(`.claude/skills/**`),以及 adapter 新建的 `AGENTS.md`——它们不是被测 agent 干的,却被算进了它的产出。`notInDiff()` 这类负断言会被误伤,view 里的 diff 也被噪声淹没。

**根因**:**git 基线早于 `agent.setup`**。attempt 的固定段顺序是
`sandbox.setup` 钩子 → `initGitAndCommit()`(打基线)→ `eval.setup` → `agent.setup` → 逐轮 `send`
(见 `src/runner/attempt.ts`)。`sandbox.setup` 的改动因为排在基线**之前**,会被提交进基线、不进 diff——这是有意设计;但 `agent.setup` 排在基线**之后**,它往 workspace 里写的任何东西(装 skill、写 AGENTS.md)都落在基线之外,于是 `captureGeneratedFiles()` 一律当成 agent 产出。

**修法**(2026-07-12,随结构化 SkillSpec 一起落地):adapter 在 `agent.setup` 里装进 workspace 的东西,写进 `.git/info/exclude`(不是 `.gitignore`——那是 workspace 里的文件,会自己进 diff)。落点:`src/agents/` 的 skill / plugin 安装路径。

**适用场景**:任何 `agent.setup` 需要往 workspace(而非 `$HOME`)里放文件的 adapter。放 `$HOME` 的(如 `~/.codex/config.toml`、`~/.claude/`)天然在 workdir 之外,不受影响——**能放 `$HOME` 就别放 workspace**,这是更省事的规避。

关联:[[sandbox-lifecycle-hooks]](三层 setup 各自与 git 基线的先后)。
