# Bug 组：进程结果必须经过真实进程边界

这一组用 `show --json` pipe 截断作正例，用重试后错误退出码作同形反证。
两者根因不同，但都说明只测内部返回值不能证明用户收到的 process result。

## 正例：`show --json` 经 pipe 截断

MemoryBench 在 2026-07-30 复现同一份 505081 字节 JSON：重定向到文件完整，管给 `jq` 或 Python 只剩 131072 字节。
fix commit `d8d5a84b` 把 `src/cli.ts` 的 `process.exit(code)` 改为设置 `process.exitCode` 并自然退出。

fix 前公开入口已经给出错误事实：`niceeval show --history --json | jq` 不能交付合法 JSON。
这不是排版问题，而是机器出口的完整性契约已经破坏。

当时的 `src/show/json.test.ts` 直接调用 `runShow()`，把 `out` 与 `err` 收进字符串。
它能证明 JSON 生成器的字段和内容，却绕过 Node 子进程、stdout pipe 与退出时 flush，所以产品坏时仍绿。
仓库 E2E 的子进程调用也没有把大 `show --json` stdout 接到真实 pipe 后再 parse。

最早应当失败的是 observe，不是字段断言。
只要用户收到的 stdout 不能 parse，后续 `fieldNames()` 或 eval 语义断言都没有执行资格。

```ts
reportBehavior(showJsonIsConsumableThroughAPipe, async () => {
  const { stdout } = await cli(
    "pnpm exec niceeval show --exp large-history --history --json",
    { pipe: true },
  );
  const summary = jsonSummary(stdout);
  expectObserved(summary.evalIds()).toShowRows(["large-history/task"]);
});
```

失败应直接写出 Behavior、命令、`pipe: true`、收到的字节数、parse offset 与 stdout 证据路径。
不得退回文件重定向重跑，也不得把 parse error 改成允许的产品结果。

## 同形反证：结果全绿但进程 exit 1

fix commit `6307c501` 修复另一条进程边界错误。
一个 `runs: 2, earlyExit: true` 的 eval 第一次失败、第二次通过后，最终 eval 全绿，但 CLI 仍按原始 attempt 计数退出 1。

当时 runner 与 report 各自的测试都可以绿：前者正确保存每次 attempt，后者正确按 eval 折叠。
漏掉的是二者与真实进程退出码之间的关系。
最早失败点是 outcome，错误信息应同时列出 eval 级折叠、attempt 原始计数与实际 exit。

```ts
reportBehavior(retryAbsorbsOneFailedAttempt, async () => {
  const result = await cli("pnpm exec niceeval exp retry-once --rerun all --json", { expect: 0 });
  const events = ndjsonEvents(result.stdout);
  expectObserved(events.eval("retry-once/task").verdict()).toEqualValue("passed");
  expectObserved(events.eval("retry-once/task").attemptVerdicts()).toEqualValue(["failed", "passed"]);
});
```

同一个 `cli()` 原语同时捕获两条旧 bug，证明它不是为 128 KiB 单例定制。
关键不是新增 `toFlushStdout()` 或 `toExitAfterRetry()` 两个 matcher，而是保证用户真实收到的 argv、stdout、stderr、signal 与 exit 属于同一份不可拆 evidence。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | JSON 只按 parse 与声明字段比较；耗时、缩进和字段顺序不参与。退出码只与 eval 折叠结果关联 |
| 不能改断言放行 | parse 失败不能改成期望值；全绿结果的 exit 0 是跨层不变量，不能把 `expect: 0` 改成 `nonzero` |
| 观察失败显式报错 | invoke、observe 与 outcome 分段；无输出、截断、parse 失败和语义不符不会折成同一错误 |
| 用户侧直接定位 | 失败含可复制命令、真实流、字节数、parse offset、eval 身份与退出码 |
| 设施不造假 | `pipe: true` 必须由子进程 stdout 连接真实 pipe；禁止用内存回调或文件重定向冒充 |
| 用户已有用法不改 | 复用原命令和现有结果；不修改 Eval、报告或产品代码 |
