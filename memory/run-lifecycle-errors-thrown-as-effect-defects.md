---
format: concord.document/v1
id: run-lifecycle-errors-thrown-as-effect-defects
title: Run 删除与恢复的预期领域错误成为 Effect defect
createdAt: 2026-09-05
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: |-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - "Installed public Run Host case necase_JNE1HTBAPBV34014: inventory neinv_9WF1Q8Y3FQZR0N9W; takeover netake_QX7V472MF2F3H30B; candidate sha256 ad830d005f1e9763021bd5992ac682325fdb932b940467656d908824c331c422. Independent red bound in current regression evidence."
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-journey.test.ts#necase_JNE1HTBAPBV34014"]}
    proof:
      - "Installed public Run Host case necase_JNE1HTBAPBV34014: inventory neinv_9WF1Q8Y3FQZR0N9W; takeover netake_QX7V472MF2F3H30B; candidate sha256 ad830d005f1e9763021bd5992ac682325fdb932b940467656d908824c331c422. Independent red bound in current regression evidence."
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-journey.test.ts#necase_JNE1HTBAPBV34014"]}
    source:
      path: memory/run-lifecycle-errors-thrown-as-effect-defects.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:772406b73d8e66df64cd17bea2877da1d64629a1d70e959194e3d777ad45f0a3
---
开发 review 发现 `run/host/lifecycle-adapter.ts` 在 `Effect.gen` 中直接 throw 六个 `RunDeleteError` / `RunRecoverError`：数据库已有但 Run 缺失、删除 active Run、恢复 terminal Run、owner 仍活跃或未证明终止等分支因此进入 defect，公开调用方的 `Effect.catchTag` 无法按领域错误恢复。

正常拒绝应进入 typed error channel，不能改变 active Run、终态 Run 或其已发布事实。复用独立 Run Host consumer 的公共生命周期目标，在已安装候选中先证明 catchTag 失败，再修 throw 为 typed failure，并验证失败后仍可在同一进程操作其它 cwd。

已只读枚举 GitHub open/closed Issues；未发现同义 Run Host 错误处理项。当前是源码确认的根因，公开红灯与最终接管尚待取得；不声明 fixed。
