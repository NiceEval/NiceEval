---
format: concord.document/v1
id: e2b-command-completion-marker-source-echo
title: e2b-command-completion-marker-source-echo
createdAt: 2026-08-02T21:44:33+08:00
createdAtSource:
  kind: first-recorded
  path: memory/e2b-command-completion-marker-source-echo.md
  commit: dc971981f9c29482229966c11e43231800e2c4f9
description: E2B completion wrapper 的源码或转义诊断包含 marker 字面量时，被 parser 当成非法 exit code 而退休真实命令
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
    statement: "**已修**：`src/sandbox/e2b.ts` 用字节转义在 bash supervisor 内还原 marker，避免
      wrapper 源码直接出现完整 marker；parser
      对候选帧只接受严格十进制且可安全表示的数字，非法候选作为普通输出继续扫描，stdout/stderr
      两路合法帧必须给出同一退出码。`src/sandbox/e2b.test.ts` 把生产 wrapper 原样交给真实
      `/bin/bash`，按小块转发真实两路输出，覆盖 0、非零、正文、跨 chunk 与 Codex 长命令/heredoc。"
    proof: []
    source:
      path: memory/e2b-command-completion-marker-source-echo.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:9fb33aa6f711436c06bdc4d59b0b7b0afbe6b0c58418cd5bc12382c27e61ba2f
---

**现象（2026-08-02，真实 attempt）**：E2B command completion 报
`e2b command completion marker carried an invalid exit code: "\\x27 \\\"$__niceeval_e2b_command_exit\\\" \\x27"`，命令本身已经有可用的 bash 输出。

**根因**：wrapper 把 marker 的完整 prefix、退出码变量和 suffix 写在同一组 shell 源码里。E2B 的 event stream 或 bash 转义诊断回显这段源码时，parser 只寻找第一组 prefix/suffix，便把变量表达式当成退出码；它没有继续寻找后面的真实数字帧。

**已修**：`src/sandbox/e2b.ts` 用字节转义在 bash supervisor 内还原 marker，避免 wrapper 源码直接出现完整 marker；parser 对候选帧只接受严格十进制且可安全表示的数字，非法候选作为普通输出继续扫描，stdout/stderr 两路合法帧必须给出同一退出码。`src/sandbox/e2b.test.ts` 把生产 wrapper 原样交给真实 `/bin/bash`，按小块转发真实两路输出，覆盖 0、非零、正文、跨 chunk 与 Codex 长命令/heredoc。
