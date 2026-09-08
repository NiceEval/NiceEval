---
format: niceeval.memory/v1
id: run-recovery-absence-required-member
title: Run recovery absence 被错误要求闭合到 Member
createdAt: 2026-09-06
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_CCR8T5ZQTPHWACVM
      - netake_063TJ9Y46C50V729
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-journey.test.ts#necase_H632V0FG1N2KEBJ5"]}
promotions: []
---
## 现象

公开 `niceeval run recover --yes` 成功收口包含已发布 Attempt 的 active Run 后，后续 `niceeval exp --dry --json` 以 `record-database-invalid` 失败，报告 absence Slot 未闭合到匹配 Member。

## 根因

Run recovery 正确地为未发布 Slot 提交 `interrupted-before-publication` absence，并清除旧 writer 的未发布 aggregate。Record 兼容读取却把 `run_slot_absences` 当作必须关联持久 Member 的 publication；这与“没有已发布 Attempt 的 Slot 不创建 Member”的 Feature 契约相反，也使 recovery 主动清理后的合法 Record 无法参与 reuse planning。

## 修复

兼容读取从 Run-owned absence publication 通过当前 Member codec 投影无 Attempt 的终态 Core；已发布 Attempt binding 仍严格要求匹配的持久 Member。这样无需改写既有数据库即可恢复读取，同时不放宽 Attempt publication 闭包。
