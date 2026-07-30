# Fixture 与反馈：setup / teardown 与长步骤报告

## 解决什么问题

有些准备工作不属于 `test(t)` 的正文：装依赖、在外部服务里建临时 repo、预热数据。
`EvalDef.setup` / `teardown` 是准备这条 eval 任务 Fixture 的成对生命周期 Hook，每 attempt 一次；`t.progress` / `t.diagnostic` 让长步骤和降级情况在运行反馈里可见；`t.skip` 在前置条件不满足时把 attempt 标成跳过而不是失败。

## 全流程

1. 任务素材的准备放 `setup`——它拿到完整 `Sandbox`，在 `test(t)` 之前跑，写入算 eval 归因、不进 agent diff：

   ```typescript
   // evals/pr-review/close-stale.eval.ts
   import { defineEval } from "niceeval";
   import type { Sandbox } from "niceeval/sandbox";

   // 并发 attempt 共享本模块:句柄按 sandbox 键控,不用普通模块变量
   const fixtures = new WeakMap<Sandbox, { repoUrl: string; destroy(): Promise<void> }>();

   export default defineEval({
     async setup(sandbox, ctx) {
       ctx.progress({ message: "seeding fixture repo" });
       const fixture = await createFixtureRepo("pr-review/close-stale");  // 沙箱外的临时资源
       fixtures.set(sandbox, fixture);
       await sandbox.runCommand("git", ["clone", fixture.repoUrl, "."]);   // 被测 checkout 直接落 workdir 根
     },
     async teardown(sandbox) {
       await fixtures.get(sandbox)?.destroy();   // setup 抛错也会进来:没建成就跳过
     },
     async test(t) { /* 驱动 agent 清理 stale PR,断言 */ },
   });
   ```

2. 大多数 Fixture**不需要** `teardown`：写进沙箱的文件、装的依赖随沙箱销毁自动没了。
   需要收尾的是**沙箱外**的资源（临时 repo、bucket、队列 topic），不收就泄漏。
   `teardown` 在 `setup` 时点走到过就一定触发——`setup` 抛错、`test` 抛错都不豁免，所以收尾代码要容忍「没建成」。

3. 并发纪律：同一条 eval 的多个 attempt 并发执行且共享本模块，`setup` 的句柄以 `sandbox` 实例作键（sandbox 与 attempt 一一对应），不放普通模块变量——会互相覆写。

4. `test(t)` 里 eval 自己执行的长步骤用 `t.progress` 报短期状态，降级但可继续的情况用 `t.diagnostic` 留永久记录：

   ```typescript
   t.progress({ message: "uploading fixtures", current: 1, total: 3 });
   await t.sandbox.uploadDirectory("fixtures/project");

   if (check.degraded) {
     t.diagnostic({ code: "fixture-check-degraded", level: "warning",
       message: "Fixture preflight used the fallback checker" });
   }
   ```

5. 前置条件不满足、这次运行评不了时用 `t.skip(reason)` 明确跳过，不让它烂成一次误导性的失败。

## 边界

- `progress` / `diagnostic` 只报告、不断言：`diagnostic` 即使 `level: "error"` 也不改 verdict。
  要影响结论就写断言或抛异常。
- `teardown` 抛错或超过清理上限只记 `teardown-failed` 诊断，不改已产出的判定；要让收尾动作影响结论，在 `setup` / `test` 里抛。
- 层次分工：环境预置（不知道跑哪个 eval）在 `sandbox.setup`，agent 安装在 `agent.setup`，**这条任务**的素材才在 `EvalDef.setup`（四层时序见 [Runner · 环境预置](../../../runner.md#环境预置不进运行器但按顺序调它)）。

## 相关阅读

- [README](../README.md#defineeval-的形状) —— `setup` / `teardown` 的时序与归因契约。
- [Context · 向运行反馈长步骤](../library/context.md#向运行反馈长步骤) —— `progress` / `diagnostic` 的字段与限制。
- [Experiments · 生命周期反馈](../../experiments/library.md#生命周期代码怎样向这次运行反馈) —— 完整反馈契约。
