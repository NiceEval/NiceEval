---
format: concord.document/v1
id: exp-eval-prefix-segment-drift
title: "`niceeval exp` 把 ID 前缀实现成路径段前缀"
createdAt: 2026-07-16T21:29:58+08:00
createdAtSource:
  kind: first-recorded
  path: memory/exp-eval-prefix-segment-drift.md
  commit: a957d2fbeff18b025c82807a1acbf08f2a047391
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [exp-eval-prefix-segment-drift](exp-eval-prefix-segment-drift.md) — `exp` 把「eval ID 前缀」实现成路径段匹配，和文档/show/view 分叉；统一为裸字符串 prefix"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# `niceeval exp` 把 ID 前缀实现成路径段前缀

**现象（2026-07-16）**：`niceeval exp dev-e2b memory/terminal-swe-bench` 对 `memory/terminal-swe-bench-astropy-1` / `-2` 匹配 0，必须逐条写完整 id；文档一直称位置参数为「eval ID 前缀」。

**根因**：runner 的 `makeFilter()` 与 experiment `evals: string[]` 使用 `id === p || id.startsWith(p + "/")`，实际是路径段选择器；show/view 共用的 `evalPrefixPredicate()` 已明确使用裸 `id.startsWith(prefix)`，并把 `algebra` 命中 `algebra2` 写成契约。同一产品的运行与查看入口长出两套同名语义。

**裁决与修法**：eval ID prefix 全部统一为裸字符串前缀；路径段匹配只保留给 experiment id 的组选择与 `--experiment`。runner/CLI/结果选择共用同一个 predicate，真实 sibling 前缀场景锁回归，不能把公开文档降格成旧实现。
