# Bug 组：诊断身份与故障原点不能从展示状态反推

这一组用 diagnostic 去重 key 泄漏成公开 code 作正例，用 failure phase 取最后 lifecycle 阶段作同形反证。
两条都是“已有内部字段看起来接近公开事实，调用方顺手复用后语义失真”。

## 正例：warning code 每条都不同

旧反馈模型只有 `key`：它既负责按 experiment / eval 去重，又被 JSON renderer 当作公开 `warning.code`。
于是用户拿到 `lock-taken-over:compare/codex|memory/x`，无法按稳定 code 分支；同一诊断落盘却又使用干净的 `lock-taken-over`。

修复分多次完成：反馈模型拆出 `code`，sandbox fallback 与 Invocation completion 改按 code；`436090c5` 最后补齐 attempt 级诊断调用点，同时把运行器当前 phase 写入事件。
可选字段让漏改调用点不触发 typecheck，正是缺口反复出现的原因。

```ts
runnerBehavior(warningKeepsStableCodeAndSeparateIdentity, async () => {
  const run = await cli("pnpm exec niceeval exp diagnostic-fixture --rerun all --json");
  const warning = ndjsonEvents(run.stdout).warning("memory-warmup-degraded");

  expectObserved(warning.code()).toEqualValue("memory-warmup-degraded");
  expectObserved(warning.identity()).toEqualValue({
    experimentId: "compare/codex",
    evalId: "memory/x",
  });
  expectObserved(warning.phase()).toEqualValue("sandbox.setup");
});
```

proof 不解析 code 的冒号，也不从 message 正则提取身份。
缺任一具名字段时在 observe 阶段失败。

## 同形反证：最后经过的阶段不是失败原因

fix commit `d3792749` 前，runner 把 teardown 前最后一个 lifecycle phase 当作 failure phase。
`eval.run` 已抛错的 attempt 后续仍经过断言求值，永久通知便错误显示 `assertions.evaluate`；普通 gate failed 也被伪造一个 phase。

真正公开事实已经在错误产生时绑定为 `error.origin.phase`。
修复让 errored 直接使用该 origin，failed 作为断言 outcome 不带 phase。

同一 NDJSON 读面即可作反证：

- errored 的 phase 等于结构化 error origin。
- failed 没有 phase；字段省略时不能伪造 `unknown assertions.evaluate`。
- 后续 telemetry / teardown 事件不改变前述事实。

因此不新增 `lastMeaningfulPhase()`；“meaningful”会再次让测试从时间线猜原因。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | code、identity、origin 各断各的，不锁去重 key 或展示顺序 |
| 不能改断言放行 | code 是公开枚举；phase 来自错误原点；failed 必须省略 |
| 观察失败显式报错 | 缺字段与值不符分开；省略 phase 只在 failed 合法 |
| 用户侧直接定位 | 列 warning / failure 原始事件、locator、code、identity 与 phase |
| 设施不造假 | 真实 JSON renderer；不直接调用 reducer 构造最终对象 |
| 用户已有用法不改 | 复用普通 `ScopedFeedback.diagnostic` 与失败 Eval |
