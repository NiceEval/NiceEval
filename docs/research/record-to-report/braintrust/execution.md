# Braintrust Experiment 的真实执行顺序

本文只追踪一次 Experiment 从入口到进程收尾的 control flow；对象关系见 [layers.md](layers.md)，持久字段与写入 envelope 见 [storage.md](storage.md)。下述主路径以公开 TypeScript SDK 与 Rust `bt` CLI 为准，并用 Python runner 核对关键收尾行为。源码核对日期为 2026-08-14。

## 两种入口先在用户进程汇合

### `bt eval`

`bt eval` 不是向 Braintrust 提交一个由服务端调度的 job。Rust CLI 自己发现或展开 eval files，判断 JavaScript/Python 并选择 runner。它建立本机 Unix socket 或 TCP SSE channel，向子进程注入认证、filter、parameters 与 sampling，再 spawn language child process。stdout/stderr、progress、summary 与 `done` 由本机 channel 回传。[`run_eval_once` / `run_eval_process`, `src/eval.rs`, commit `d1b3619`](https://github.com/braintrustdata/bt/blob/d1b3619420cce553f18622d8812485ac5b1b0b3d/src/eval.rs#L638-L930)

加载 eval file 时，runner 临时打开 SDK 的 lazy-load mode。因而文件顶层的 `Eval()` 只把 evaluator/reporter 注册进 process-global registry，不立即取 data 或执行 task；全部文件加载后，runner 才选择并调用这些 definitions。[`Eval`, `js/src/framework.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/framework.ts#L650-L706)；[`runRegisteredEvals`, `scripts/eval-runner-impl.ts`, commit `d1b3619`](https://github.com/braintrustdata/bt/blob/d1b3619420cce553f18622d8812485ac5b1b0b3d/scripts/eval-runner-impl.ts#L2290-L2410)

若一个 invocation 选中多个 evaluator，默认由 JavaScript runner `Promise.all` 并行执行；`--terminate-on-failure` 才改成逐个执行并在第一项失败后停止。这个并行层位于每个 evaluator 自己的 case concurrency 之外。[`runRegisteredEvals`, commit `d1b3619`](https://github.com/braintrustdata/bt/blob/d1b3619420cce553f18622d8812485ac5b1b0b3d/scripts/eval-runner-impl.ts#L2360-L2407)

### SDK `Eval()` / `init()`

应用也可以直接 `await Eval(project, evaluator)`；此时没有 CLI runner，`Eval()` 自己取得 data、求值 parameters、`init()` Experiment、运行 evaluator、输出 reporter，最后 flush。更底层的 API 是 `init()` 后自己 `experiment.traced()` / `log()` / `logFeedback()`。[`Eval`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/framework.ts#L706-L815)；[Create experiments](https://www.braintrust.dev/docs/evaluate/run-evaluations)

无论从 CLI 还是 SDK 进入，task 与 scorer 默认都在调用者的 Node/Python process 里执行；公开路径没有 control-plane scheduler 接管这些函数。Braintrust 另有 hosted functions/`online scoring` 等服务端产品面，但不能据此把本地主路径描述成 remote job。

## 一次 evaluator 的时序与 owner

| 顺序 | owner | 动作与可观察边界 |
| --- | --- | --- |
| 1. 注册/选择 | CLI language runner | lazy-load eval modules，得到 evaluator definitions；应用直调 SDK 时跳过这层。 |
| 2. 取得输入 | SDK eval framework | 调用 data provider，求值 parameters；data 可以是 array、sync iterable 或 async iterable。若 data 是 `BaseExperiment()`，先以 `open: true` 打开旧 Experiment 并把它投影成 dataset。 |
| 3. 注册 Experiment | SDK `init()` + API service | lazy login；调用 `api/experiment/register`，提交 project/name、base、repo info、dataset id/对应的 concrete version、parameters id/version、metadata/tags。得到 project/experiment id。 |
| 4. 启动本地调度 | SDK `runEvaluatorInternal()` | 启动 eval-only span cache；创建 concurrency queue；边迭代 data 边为每个 datum × `trialCount` enqueue。`maxConcurrency` 未设时上界近似无限，设定时至少为 1。 |
| 5. 执行一个 case | SDK queue worker + 用户代码 | 建 root `eval` span，写 input/expected/tags/origin；建 child `task` span并调用 task；完成后在 score/classifier spans 中并行调用全部 scorers 与 classifiers。 |
| 6. 异步写入 | SDK span/logger + data-plane ingest | `span.log/end()` 把 merge row 放入 process-local background queue；logger 合并同 row 的 queued fragments，拆 batch，并行 POST `logs3`。它不等待整个 evaluator 才开始写。 |
| 7. drain | SDK eval framework | data iterator 完成后等待 queue drain；timeout/AbortSignal 与 queue completion race。配置 `maxConcurrency` 时，pending bytes 超阈值会额外 `flush()` 形成 backpressure。 |
| 8. summary | SDK + comparison API | queue 全部 drain 后，`experiment.summarize()` 先 flush，再调用 `/experiment-comparison2`，读取 scores/metrics 及 baseline comparison；summary 是读取结果，不是把 Experiment 标成 complete。 |
| 9. process 收尾 | SDK/runner/CLI | SDK `finally` 再 flush；runner 发 dependencies 与 local SSE `done`，关闭 channel，失败时设非零 exit code；Rust CLI 等 child 并呈现终端状态。 |

步骤 2–8 的权威实现是 [`runEvaluatorInternal`, `js/src/framework.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/framework.ts#L1061-L1690)。Python runner 同样在 `finally` flush 当前 Experiment，并在全部工作后 flush global state、发送 dependencies/`done`；这验证了相同的 lifecycle 意图，而不是保证两种语言每个异常细节相同。[`run_evaluator_task` / `main`, `scripts/eval-runner.py`, commit `d1b3619`](https://github.com/braintrustdata/bt/blob/d1b3619420cce553f18622d8812485ac5b1b0b3d/scripts/eval-runner.py#L1077-L1460)

## 一个 case 内到底写什么

framework 在调 task 前建立 dataset provenance。若 datum 来自 concrete Dataset row 且有 `id/_xact_id`，root span 的 `origin` 写入 dataset object id、row id、created 与 source transaction version。随后：

1. root `eval` span 先拿到 input、expected、tags、origin；若 datum 提供 `upsert_id`，它也成为 root event id；
2. `task` span 保存 input，成功时保存 output，异常时保存 error；root 再接收 output/metadata/tags；
3. scorers 与 classifiers 用两个 `Promise.all` branch 并发，每个函数又有自己的 typed span。score result 同时留在 score span 并汇总进 root scores；classification result 留在 classifier span 并汇总进 root classifications；
4. `experiment.traced()` 的 finally 自动 `end()` root span。自动 instrumentation 产生的 LLM/tool child spans 挂在当前 context 下。

这不是“task 完成后一次性提交一条 final case”：同一 `id` 的 span fragments 会在后台 logger 中 merge，多个 spans/batches 可以先后到达。`Experiment.log()` 的单-row shorthand 与 `startSpan()` 模式默认不能在同一 Experiment 并用；SDK 会报错，除非显式 `allowConcurrentWithSpans`。[`Experiment.log` / `traced`, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L7147-L7243)

## 写入 owner、原子性与顺序

SDK 的 `HTTPBackgroundLogger` 是 process-local singleton state 的 owner。Experiment 初始化会关闭 queue-size limit，源码理由是 Experiments “should never drop data”；普通 project logger 会重新启用 limit。这只能防止本地 queue 因大小上限主动丢 Experiment rows，不能保证进程崩溃或网络最终成功。[`init`, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L3820-L3905)

flush 的单位不是整个 Experiment 事务：

- queue drain 后先按 row id 合并本批 fragments，再按 item count/bytes 切多个 batch；这些 batch 并行提交；
- wire envelope 是 `{"rows": [...], "api_version": 2}`；oversize payload 可先上传 object storage，再发送 overflow reference；
- event batches 全成功后，附件才逐个上传。故 event 已可见而附件失败是允许出现的 partial state；官方附件协议也明确 uploader failure 可留下 dangling reference。[`HTTPBackgroundLogger.flushWrappedItemsChunk`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L3253-L3341)；[Attachment spec, commit `f50b53f`](https://github.com/braintrustdata/braintrust-spec/blob/f50b53f5400b6ddf1e91e0c6b7a0880ec71ae928/skills/instrumentation-spec/references/features/attachments.md)

同一个 `BraintrustState` 的多个 logger 调用可能并发，源码明确不保证它们的相对顺序；持久 merge 因而依赖 row id、`_xact_id` 与 merge flags，而不是调用发生顺序。公开 OpenAPI 只定义批量 insert/merge shape 与逐 row response，没有承诺跨 row、跨 batch、event+attachment 或 Experiment-level transaction。[OpenAPI insert routes, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L14016-L14215)

已有 span 的 `updateSpan()` 也不是 optimistic transaction：SDK 文档要求先等 original span fully written and flushed，否则 update 可能和原写入冲突。[`Experiment.updateSpan`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L7397-L7428)

## 完成标识：只有本地 lifecycle，没有持久 completion state

真实顺序是“queue drain → summary fetch → final flush → runner `done` → child exit”。其中：

- `done` 是 language runner 发给本机 Rust CLI 的 SSE event；
- exit code 是这个 invocation 的本地成败；
- `--first` / `--sample` 的 summary metadata 把 `isFinal` 设为 false，full run 设为 true，但该字段属于 CLI summary event，不在公开 `Experiment` resource 上；
- OpenAPI `Experiment` 没有 `status`、`completed_at`、sealed revision 或 required-case count；
- `Experiment.close()` 已 deprecated 且是 no-op，只返回 id。

因此可重开的 Experiment 能证明“哪些 rows 已持久化”，不能仅凭 resource 判断 producer 是否仍在写、CLI 是否成功退出、预期 cases 是否齐全。[`finish` / run-mode metadata, `scripts/eval-runner-impl.ts`, commit `d1b3619`](https://github.com/braintrustdata/bt/blob/d1b3619420cce553f18622d8812485ac5b1b0b3d/scripts/eval-runner-impl.ts#L1660-L1735)；[OpenAPI `Experiment`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1609-L1750)；[`Experiment.close`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L7448-L7465)

## 失败、partial 与 retry

### Case-level failure

task 抛错时，framework 把 error 写进 root/task path、继续结束该 case，并仍让 progress 前进；scorer/classifier 各自失败会在对应 span 写入 `typed scoring error`，其他 scorers 继续。

默认 `errorScoreHandler` 可以把尚未处理的 score 置为 0，但仅在 evaluator 采用该 handler 的路径生效。runner 在无自定义 reporter 时会从 collected results 看出有 error 并将 invocation 判失败；已完成的其他 cases 不回滚。[`defaultErrorScoreHandler` / `runEvaluatorInternal`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/framework.ts#L1048-L1600)

### Timeout、abort 与 process failure

evaluator timeout 或 `AbortSignal` 会和 queue drain race；获胜后 SDK `kill()` 尚未开始的 queue items并抛错。已经执行并 enqueue/flush 的 spans 留在 Experiment；没有 rollback 或 tombstone 标记它们属于一次取消的 invocation。CLI watch 只是文件变化后再发起新 run，也不是从未完成 case checkpoint 续跑。[`runEvaluatorInternal` cancellation path, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/framework.ts#L1530-L1648)

background logger 的 `beforeExit` flush 是 best effort；源码明确说显式 `process.exit()` 与 uncaught exception 不会触发。异常退出可以留下尚未送出的内存 rows。[`HTTPBackgroundLogger` constructor, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L3080-L3150)

### Transport retry 与最终丢批

logger 默认最多尝试 3 次（`BRAINTRUST_NUM_RETRIES` 表示额外 retry 次数并加 1），以指数 backoff 重试建 row/POST。超过次数就 warning、丢弃该 batch；可用 `BRAINTRUST_FAILED_PUBLISH_PAYLOADS_DIR` 把失败 payload 留在本地供人工恢复。多个并行 batch 可以一部分成功、一部分最终失败。[`HTTPBackgroundLogger.submitLogsRequest`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L3342-L3550)

默认 async-flush 模式会记 `activeFlushError`、调用 error callback/warn，但 `flush()` 只在 `BRAINTRUST_SYNC_FLUSH` 模式重新抛出；`Eval()` 最外层还对 final flush 使用 `.catch(console.error)`。所以“`await Eval()` 返回/CLI 显示 summary”不是强 delivery receipt。[`HTTPBackgroundLogger.flush` / `triggerActiveFlush`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L3228-L3243)

## Resume 的准确边界

公开 eval framework 没有 per-case checkpoint、automatic retry failed cases 或 resume token。显式 `update: true` 只告诉 `api/experiment/register` 继续指定的同名 Experiment；它不会计算缺少哪些 datum/trial，也不会阻止已存在 id 被 merge/replace。`open: true` 则返回 `ReadonlyExperiment`，并且和 `update` 互斥。[`init`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L3820-L4045)

因此需要续跑时，caller 必须自己选择剩余 cases，并为幂等合并提供稳定 event id（例如 datum `upsert_id`）；否则再次执行通常会追加新的 traces。`braintrust-migrate` 中的 checkpoint/resume 是另一个产品：它用公开 API 在组织之间复制数据，不是 Experiment runner 的恢复协议，也不是服务端数据库 migration。[`braintrust-migrate` README, commit `d6ae02f`](https://github.com/braintrustdata/braintrust-migrate/blob/d6ae02fdf82802c8babfedce8c492c6f05ed19ff/README.md)
