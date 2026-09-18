---
format: concord.document/v1
id: ledger-gitignore-pathspec-and-gitlinks
title: Ledger 裸 pathspec 漏掉嵌套缓存，nested repo 静默变 gitlink
createdAt: 2026-07-16T21:29:58+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ledger-gitignore-pathspec-and-gitlinks.md
  commit: a957d2fbeff18b025c82807a1acbf08f2a047391
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
      [ledger-gitignore-pathspec-and-gitlinks](ledger-gitignore-pathspec-and-gi\
      tlinks.md) — ledger 裸 pathspec 只排根级缓存，嵌套 repo 又静默记成 gitlink 吞掉内部 diff；修为
      gitignore glob 编译 + mode 160000 fail fast"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# Ledger 裸 pathspec 漏掉嵌套缓存，nested repo 静默变 gitlink

**现象（2026-07-16，真实 terminal SWE-bench 迁移）**：Astropy checkout 放在 workdir 子目录时，私有 ledger 的外层 `git add` 把它记录为 mode `160000` gitlink，agent 在 repo 内改源码却不出现在 `diff.json`；改为 checkout 直接占据 workdir 根后证据恢复。另一次 run 的 328 个 diff 文件里大半是嵌套 `__pycache__/*.pyc`，默认 `__pycache__` 没排掉。

**根因**：`src/runner/ledger.ts` 把默认排除和 `EvalDef.diff` pattern 原样拼成 `:(exclude)<pattern>`。无 `/` 的 Git pathspec 在这个调用形态只覆盖 workdir 根，不等于文档承诺的 gitignore「任意深度同名项」；而嵌套已提交 repo 对外层 Git 是合法 gitlink，`git add` 只写 warning、exit 0，runner 只检查退出码所以完全看不见证据降级。

**裁决与修法**：默认项和 `diff.ignore/include` 先从 workdir 根的 gitignore 子集编译成显式 glob pathspec；无 `/` pattern 补 `**/`，目录同时覆盖自身与后代。每次 add（含 include 打洞）后检查 index mode `160000`，未被 ignore 的 gitlink fail fast，错误提示把 checkout 放 workdir 根，或整体 ignore 确实不评分的 nested repo。不能把 Git warning 升成普通 warning 后继续：内部修改已经不可见，这是判定证据完整性错误。
