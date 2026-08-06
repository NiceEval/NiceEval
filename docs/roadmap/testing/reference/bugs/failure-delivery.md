# Bug 组：失败事实必须穿过调度、进程与输出模式

这一组用 `ExperimentFatalError` 被伪装成用户中断作正例，用 `--quiet` 吞掉坏结果作同形反证。
两条 bug 的内部原因不同，公开错误事实相同：结果已经失败，但用户收到的进程结果或输出流没有如实交付失败身份与正文。

## 正例：实验失败变成 Ctrl+C

MemoryBench 真机曾出现一条实验的复用 sandbox setup 抛 `ExperimentFatalError`，终端却只剩 `interrupted`，进程退出 130；错误正文消失，无关实验也被连带中断。

fix 实现在 `b24b22d2`。
复用池的 `acquire()` 拒绝先被折回本 attempt 的 `errored` 结果与实验闸；收束处再用“纯中断”区分真实 Ctrl+C，不能把同时含 defect 与兄弟中断的 cause 当作用户中断。

fix 前已有实验闸、attempt 失败和用户中断测试，但复用池租借失败发生在 attempt 主体之前。
拒绝直接穿过调度 Effect 边界，最外层又把混合 cause 吞成中断；每个局部测试都绿，跨边界关系没人证明。

最早的用户侧 proof 不需要知道 Effect cause：

```ts
runnerBehavior(oneFatalExperimentDoesNotMasqueradeAsInterrupt, async () => {
  const run = await cli("pnpm exec niceeval exp fatal-with-bystander --rerun all --json", {
    expect: 1,
  });
  const events = ndjsonEvents(run.stdout);

  expectObserved(events.eventTypes()).toBeAbsent("interrupted");
  expectObserved(events.attempt("lease-fatal/r-1").verdict()).toEqualValue("errored");
  expectObserved(events.attempt("bystander/b-2").verdict()).toEqualValue("passed");
  expectObserved(events.diagnostic("lease-fatal").message())
    .toContainValue("shared tunnel is down");
});
```

真实 Ctrl+C 另有一条对照 proof，必须退出 130 且出现 `interrupted`。
因此不能把期望码从 1 改成“任意非零”放行；1 与 130 是两个公开结果。

## 同形反证：`--quiet` 下坏结果全程无声

fix commit `49271b52` 前，`--quiet` 会摘掉 Console / Live reporter，但 attempt 进度仍直写 stderr。
起 sandbox 失败时，进度看起来活着，最终 errored 却没有任何结果行；监控方无法区分“还在跑”和“已经失败”。

修复增加最小 Quiet reporter，只把 failed / errored 写到 stderr。
fix 同时新增 5 个纯函数单测，但用户侧仍应证明真实 CLI 的流归属：

```ts
runnerBehavior(quietStillDeliversBadResults, async () => {
  const run = await cli("pnpm exec niceeval exp deliberate-error --rerun all --quiet", {
    expect: 1,
  });

  expectObserved(stderrView(run.stderr).badResultIds())
    .toShowRows(["deliberate-error"]);
  expectObserved(stdoutView(run.stdout).badResultIds()).toShowExactRows([]);
});
```

两条案例共用第 1 轮已有的真实 `cli()`、分离 stdout / stderr / exit 与结构读面。
不新增 `fatalWasVisible()` 或 `quietPrintedError()`。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 比退出码类别、判定身份和流归属，不锁调度栈或整段文案 |
| 不能改断言放行 | errored 必须为 1，真实中断才是 130；quiet 坏结果必须在 stderr |
| 观察失败显式报错 | NDJSON 缺 summary / diagnostic，或 stderr 解析不到结果行，先报 observe |
| 用户侧直接定位 | 列命令、exit、signal、experiment / eval 身份、stderr 尾部与 locator |
| 设施不造假 | 子进程真实运行；bystander 是同次 Invocation；不注入 runner cause |
| 用户已有用法不改 | 复用普通 Experiment、sandbox setup 与 `--quiet` |
