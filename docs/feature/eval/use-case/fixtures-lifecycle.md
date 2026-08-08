# Fixture 与反馈：prepare 与长步骤报告

## 解决什么问题

有些准备工作不属于 `test(t)` 的正文：装依赖、在外部服务里建临时 repo、预热数据。
`sandbox` layer 的 `.prepare()` 承载这类逐 Attempt 的题目准备，cleanup 用 `context.onCleanup()` 就地登记。
`t.progress` / `t.diagnostic` 让长步骤和降级情况在运行反馈里可见；`t.skip` 在前置条件不满足时把 attempt 标成跳过而不是失败。

静态起始文件在第一次 `send` 前通过普通 Sandbox API 上传:

```typescript
export default defineEval({
  async test(t) {
    await t.sandbox.uploadDirectory(new URL("starter/", import.meta.url), "/app");
    await t.send("完成 /app 中的任务。");
  },
});
```

## 全流程

1. 动态任务素材的准备放 `sandbox` layer 的 `.prepare()`——命令在每条 Attempt 进入 `test(t)` 之前执行，写入算 eval 归因、不进 agent diff：

   ```typescript
   // evals/pr-review/close-outdated.eval.ts
   import { defineEval } from "niceeval";
   import { sandboxLayer } from "niceeval/sandbox";

   export default defineEval({
     sandbox: sandboxLayer().prepare(async (sandbox, context) => {
       context.progress({ message: "seeding fixture repo" });
       const fixture = await createFixtureRepo("pr-review/close-outdated");  // Sandbox 外的临时资源
       context.onCleanup(() => fixture.destroy());                        // 取得成功后就地登记回收
       await sandbox.runCommand("git", ["clone", fixture.repoUrl, "."]);  // 被测 checkout 直接落 workdir 根
     }),
     async test(t) { /* 驱动 agent 清理过期 PR,断言 */ },
   });
   ```

2. 大多数 Fixture**不需要**登记 cleanup：写进沙箱的文件、装的依赖随 Sandbox 实例及伴随资源回收自动消失。
   需要收尾的是**沙箱外**的资源（临时 repo、bucket、队列 topic），不收就泄漏。
   `context.onCleanup()` 只在命令成功取得资源后登记，Runner 按全局准备顺序逆序执行；没执行到的命令不产生虚假 cleanup（时序见[三方准备时序](../../sandbox/lifecycle.md#cleanup)）。

3. `prepare()` 每条 Attempt 都重新执行，开启 Sandbox 复用也一样。
   昂贵动作写成真实检查：命中后快速返回，缺失时安装并复检（频次契约见 [Sandbox Layer](../../sandbox/layers.md#作者只学三个规则)）。

4. `test(t)` 里 eval 自己执行的长步骤用 `t.progress` 报短期状态，降级但可继续的情况用 `t.diagnostic` 留永久条目：

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
  要影响判定就写断言或抛异常。
- cleanup 抛错只追加诊断，不改已产出的判定；要让收尾动作影响判定，在 `prepare()` / `test` 里抛。
- 直接传入的 callback 不增加可追踪 identity，但不阻断跨 Run 沿用结果；要让实现或动态输入变化自动作废结果，用 `defineSandboxCommand()`（见 [Sandbox Layer](../../sandbox/layers.md#稳定-identity-与-opaque-callback)）。
- 层次分工：实验条件的准备在 Experiment layer 的 `prepare()`，Agent 安装在 `agent.ensure`，**这条任务**的素材才在 Eval layer 的 `prepare()` 或 `test(t)`（三方时序见[三方准备时序](../../sandbox/lifecycle.md)）。

## 相关阅读

- [Sandbox Layer](../../sandbox/layers.md) —— `prepare()`、command identity 与 `onCleanup` 的契约单源。
- [Context · 向运行反馈长步骤](../library/context.md#向运行反馈长步骤) —— `progress` / `diagnostic` 的字段与限制。
- [Experiments · 生命周期反馈](../../experiments/library.md#生命周期代码怎样向这次运行反馈) —— 完整反馈契约。
