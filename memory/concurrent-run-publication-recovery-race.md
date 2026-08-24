---
format: niceeval.memory/v1
id: concurrent-run-publication-recovery-race
title: 并发 Run 发布被 recovery 误判为 inventory 损坏
createdAt: 2026-08-24T21:48:41+08:00
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "E2E red: GitHub Actions run 32733524084 installed main candidate e4ea74e7a5b5b5c04290175a0de91670147cf341 and failed e2e/runner/test/shared-state-lifecycle.test.ts through niceeval exp shared-state-second --json with Staged Run does not match its publish recovery inventory."
      - "E2E red refinement: GitHub Actions run 32735973760 installed candidate b22a1d9980f52b19423367918208a92f93345bcf and failed e2e/runner/test/shared-state-recovery.test.ts through niceeval exp shared-state-crash-third --rerun all --json when the same atomic rename surfaced as typed read-file ENOENT for the staging complete marker."
      - "E2E green: candidate SHA-256 409294aa1f3297272c0d5229f8a6c627431dd1c49eee04906ae874eeeba8fb9f ran pnpm e2e test --repo runner -- --run test/shared-state-recovery.test.ts with 1 file / 9 tests passed and clean scratch removal; the earlier lifecycle owner also passed 1 file / 4 tests on candidate 1f84f9717a251ac4ae1208a7f4c2443debb37c4dadc50afd1a099aca0f670dba."
promotions: []
---
# 并发 Run 发布被 recovery 误判为 inventory 损坏

## 问题

两个安装后 NiceEval Invocation 并发追加同一 Record 时，其中一方可能在公开 `niceeval exp` 入口以 `record-io-error` 失败，错误为 `Staged Run does not match its publish recovery inventory`。Run 的作者写入和 recovery 都持有共享 append lease，所以这不是非法并发。

## 根因

活跃 writer 完成 staging 后，会把目录原子发布到不可变 destination。Recovery actor 可能已经观察到 complete staging，但在逐项校验期间，writer 恰好完成 rename；后续 staging 读取因此合法地变成 missing。旧逻辑把任何 staging 校验未完成都立即解释为 inventory 损坏，没有重新观察 staging/destination 状态，也没有转去校验刚发布的不可变 destination。

## 修复边界

只有在重新观察到 staging 已消失且同 Run destination 已成为目录时，recovery 才把 staging 校验未完成解释为并发发布，并继续使用原 recovery document 对 destination 做完整 manifest、digest、路径和 inventory 校验。其它状态组合仍保持 typed `RecordRecoveryInvalid`，真实损坏不能被吞掉。

## 回归凭据

GitHub Actions run 32733524084 从安装后的 main candidate 经公开 `niceeval exp shared-state-second --json` 取得红灯；长期 owner 是 `e2e/runner/test/shared-state-lifecycle.test.ts`。

## Resolution history

<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `b22a1d9980f52b19423367918208a92f93345bcf`

```json
{
  "kind": "fixed",
  "proof": [
    "E2E red: GitHub Actions run 32733524084 installed main candidate e4ea74e7a5b5b5c04290175a0de91670147cf341 and failed e2e/runner/test/shared-state-lifecycle.test.ts through niceeval exp shared-state-second --json with Staged Run does not match its publish recovery inventory.",
    "E2E green: candidate SHA-256 1f84f9717a251ac4ae1208a7f4c2443debb37c4dadc50afd1a099aca0f670dba ran pnpm e2e test --repo runner -- --run test/shared-state-lifecycle.test.ts with 1 file / 4 tests passed and clean scratch removal."
  ]
}
```
