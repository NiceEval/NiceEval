# Bug 组：调度契约是区间关系，不是单个计数

这一组用实验级并发曾钳制全局作正例，用 retry backoff 击穿串行闸作同形反证。
两条 bug 分别让并发过少和过多；同一条 attempt interval 原语应同时抓住二者。

## 正例：一个串行实验拖慢整批

fix commit `03de80d8` 前，CLI 取所有选中实验 `maxConcurrency` 的最小值作为全局并发。
只要组里一个实验声明 `maxConcurrency: 1`，无关实验也全部串行。

公开错误事实是配置的作用域错误：文档承诺「这一格实验的并发上限」，实际却改变整次 Invocation。
fix 前测试只在 reporter shape 与 E2E config 中出现 `maxConcurrency`，没有两个实验的生命周期区间关系；fix commit 本身也未新增测试。

## 同形反证：退避释放了不该释放的实验闸

fix commit `9d7b352` 前，turn retry 退避会同时释放全局位与实验级闸。
`maxConcurrency: 1` 的 attempt A 仍保有 sandbox、尚未回存共享状态时，attempt B 已进入 sandbox setup，产生长时间重叠。

稳态串行测试仍可绿，因为只有进入 retry backoff 才会释放错误的 permit。
区分力测试后来单独落在 `6953d51`：它证明实验闸覆盖退避与 teardown，同时证明全局位在退避时仍让给无关实验。

## 最少用户侧原语

`exp --json` 已公开输出带身份与 `at` 的 attempt start / complete 事件。
读面只需把同一 attempt 的起止配成区间，不需要读取 semaphore、sandbox create 计数器或墙钟耗时阈值。

```ts
runnerBehavior(experimentGateOnlyLimitsItsOwnAttempts, async () => {
  const { stdout } = await cli("pnpm exec niceeval exp concurrency-fixture --force --json");
  const attempts = ndjsonEvents(stdout).attemptIntervals();

  expectObserved(attempts.maxOverlap({ experiment: "serial" })).toEqualValue(1);
  expectObserved(attempts.hasOverlap({ left: "serial", right: "baseline" })).toEqualValue(true);
});
```

同一查询抓两侧错误：全局被误钳时第二条为 false，实验闸被击穿时第一条大于 1。
retry 反例使用相同断言，只把 fixture 的 agent 设为第一次公开 send 返回可重试失败。

失败信息列出违反关系的 attempt identities 与 start / complete 事件行。
它不输出「耗时超过 N 秒」，因为机器负载变化不属于契约。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 比较 overlap 关系，不比较完成顺序、时长或固定 sleep |
| 不能改断言放行 | 串行实验的上限来自签入 fixture 契约；不能把 1 改成实际峰值，无关实验必须有一次可证明 overlap |
| 观察失败显式报错 | 缺 start / complete 配对在 observe 失败；关系不满足在 outcome 失败 |
| 用户侧直接定位 | 消息列 experiment、重叠 attempt、事件行与可复制命令 |
| 设施不造假 | fixture 用公开 adapter 产生 retry；时间轴只读 NDJSON，不注入 runner 计数器 |
| 用户已有用法不改 | 复用普通 experiment 与 `--json`；用户 Eval 不增加同步 Lifecycle Hook 或探针 |
