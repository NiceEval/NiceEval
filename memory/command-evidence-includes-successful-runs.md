---
name: command-evidence-includes-successful-runs
description: commands.json 从只记非零退出翻案为成功与失败都记,stdout/stderr 上限从「不截」改为 64 KiB/流独立截断;show --execution 新增中性 COMMAND 三态
metadata:
  type: project
---

**裁决**(2026-08-04):四个公开 `Sandbox.run*()` 方法的最外层调用无论成功还是非零退出都登记一条 `CommandExitEvidence`,不再只记非零退出。`stdout` / `stderr` 各自独立按 `COMMAND_STREAM_MAX_BYTES`(64 KiB)截断,超限打结构化 `truncated` 标记(`path: "stdout" | "stderr"`),与 `events.json` / `trace.json` 的 256 KiB(`ARTIFACT_VALUE_MAX_BYTES`)截断同构但上限更小、逐流独立判定。`niceeval show @<locator> --execution` 新增中性 `COMMAND` 标题(`exitCode === 0`),与既有 `NON-ZERO COMMAND · observed`(unchecked 非零)、`FAILED COMMAND`(checked 非零)并列三态;展示层 `classification` 判别值从 `"observed" | "failed"` 扩为 `"succeeded" | "observed" | "failed"`。

**起因**:受管命令(两层 prepare、lifecycle 命令、`ensure` / `install`)成功时的输出此前哪里都查不到,只能靠 `--keep-sandbox` 进现场手动重跑;失败才随 `commands.json` 冒出。MemoryBench 调试时被迫把输出重定向进文件再读。

**翻案的前一条裁决**:[commandsucceeded-received-excerpt-not-tail](commandsucceeded-received-excerpt-not-tail.md) 记录的 2026-07-30 裁决「`commands.json` 落盘不截(失败诊断的完整语义单位)」在这次改动中被推翻——那条裁决成立的前提是「只收非零退出,体量天然有界」,现在全量记录后高频循环里的成功命令能反复产出大输出,前提不再成立,因此改回逐流有界截断(64 KiB 比 events/trace 的 256 KiB 更紧)。

**实现落点**:`src/record/truncate.ts`(`truncateCommands` + `COMMAND_STREAM_MAX_BYTES`)、`src/record/writer.ts`(落盘时截断,与 events/trace 同一落点原则)、`src/runner/attempt.ts`(`withCommandTiming` 的 `recordCommandExit` 去掉 `exitCode === 0` 早退)、`src/show/render.ts` + `src/report/components/attempt-detail/compute.ts` + `src/report/definition/primitives/conversation.tsx`(三态分类与标题)。契约见 `docs/feature/record/architecture.md`「`commands.json`」「大值截断」与 `docs/feature/reports/show/execution.md`。

**踩坑**:成功命令全量记录后,`workspace.baseline` 的 ledger anchor commit 与 `agent.ensure` 的平台探测(`uname -s` 等)这些此前静默的背景命令现在也会成功落进 `commands.json`——`src/runner/attempt.test.ts` 里假设"数组只有测试自己那一条命令"的断言（`toHaveLength(1)`、`commands![0]`、`toEqual([...])` 全量比较）全部踩坑,改为按 `phase` / `display` 定位目标条目,或用 `expect.arrayContaining`。任何在 sandbox-kind attempt fixture 上断言 `result.commands` 精确形状的测试都要留意这条背景噪声。
