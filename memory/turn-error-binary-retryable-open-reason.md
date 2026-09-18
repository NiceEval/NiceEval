---
format: concord.document/v1
id: turn-error-binary-retryable-open-reason
title: turn 错误分类:二分决策 + 开放 reason,推翻三词封闭枚举
createdAt: 2026-07-22T12:08:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/turn-error-binary-retryable-open-reason.md
  commit: 5f98e3db8e585d4e07a19a0e22790929b8953dce
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---
# turn 错误分类:二分决策 + 开放 reason,推翻三词封闭枚举

**裁决**(2026-07-22,用户 review 定案):turn 失败的分类结果是判别联合 `TurnErrorClass = { retryable: true, reason: string } | { retryable: false, reason?: string }`——顶层只有可重试/不可重试一个决策轴(执行体唯一消费面),`reason` 是开放词表的细分诊断(内建兜底产出 `rate_limit` / `network`,adapter 分类器可自造词),只进 activity 与耗尽摘要,不进任何分支。同场增加 attempt 级总重试上限(8 次,与单 send 封顶 4 次叠成两层预算)。

**曾选方案**:`TurnErrorKind = "rate_limit" | "network" | "unknown"` 封闭三词枚举 + `isRetryableTurnError(kind)` 派生可重试性(同日上午定稿并提交,commit 34ac9cf);重试预算只有 send 级封顶、无 attempt 总上限。

**否决理由**:封闭枚举把决策(重不重试)和诊断(为什么)拧在一个词表里——adapter 细分自家错误(队列满、模型预热)时被迫塞进 rate_limit/network 两个桶,或者框架被迫无限扩枚举;而「要不要重试」是封闭问题,二分即穷尽,`retryable` 直接落在类型上比靠 `isRetryableTurnError` 从词表反推更诚实。只有 send 级预算时,多轮 eval 每轮都撞限流会重试 4×N 次,把 attempt 泡在退避里蚕食 deadline——环境系统性出问题该如实 errored,attempt 级总上限是止损位。

**落点**:`docs/feature/error-classification/`(README 分类节、architecture 类型/分类链/退避与槽位/观察面、library、use-case 三篇,`stream-drop-unknown.md` 随术语改名 `stream-drop-no-retry.md`)、`docs/engineering/testing/unit/eval.md` 覆盖类别、`plan/error-classification.md`。
