# `--json`：让 coding agent 跑、查、改、复验

coding agent 不需要解读 TTY 重绘。
它需要稳定的 Invocation identity、规范 Attempt locator、按需读取证据的入口，以及最终 receipt。

`exp --json` 输出当前进程的 NDJSON 反馈，末尾恰好一条 `InvocationReceipt`。
完整词表见 [CLI · 机器怎么读](../cli/README.md#机器怎么读--json)。

## 全流程

1. 先检查计划，确认选择没有扩大：

   ```sh
   niceeval exp compare memory/commit0 --dry --json
   ```

2. 执行并读取进度反馈与末尾 receipt：

   ```sh
   niceeval exp compare memory/commit0 --json
   ```

   `progress` 与 `diagnostic` 服务当前进程；最后一条 `receipt` 携带完整 `InvocationReceipt`。
   长任务的心跳通过 `active` 给出当前 Experiment、Eval、从零开始的 attempt ordinal、phase 与本次 Attempt 已运行的毫秒数。最多列出 64 条，`activeOmitted` 明确报告省略数量；消费方不把心跳当作持久结果。

   ```json
   {"event":"progress","elapsedMs":30000,"total":2,"reused":0,"running":1,"elsewhere":0,"queued":1,"passed":0,"failed":0,"errored":0,"skipped":0,"active":[{"experimentId":"compare/codex","evalId":"memory/commit0","attempt":0,"phase":"eval.run","elapsedMs":29000}],"activeOmitted":0}
   {"event":"warning","code":"judge-precheck-failed","level":"error","message":"Judge precheck failed…","phase":"judge.precheck","experimentId":"compare/codex","evalId":"memory/commit0","planned":1,"errored":1}
   {"type":"receipt","summary":{"startedAt":"2026-08-09T10:00:00.000Z","completedAt":"2026-08-09T10:01:00.000Z","passed":2,"failed":0,"errored":0,"skipped":0,"durationMs":60000,"beforeCaches":{"total":0,"hit":0,"prepared":0,"failed":0}},"receipt":{"invocationId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","createdRunIds":["8f3d6f62-1d34-4cf3-99c7-84ba3c483706"],"publicationCutoff":"opaque-cutoff","startedAt":"2026-08-09T10:00:00.000Z","completedAt":"2026-08-09T10:01:00.000Z","completion":"completed"}}
   ```

3. 只用规范 locator 构造固定 request，并展开必要证据：

   ```sh
   niceeval query run --request <attempt-request.json>
   ```

4. 修改后重新运行受影响选择。
   指纹变化时默认计划会执行受影响成员；仅外部条件变化时选择 `--rerun` 或 `--rerun all`。

5. 以退出状态和 `InvocationReceipt` 判断完成。
   一条进度计数、Human 文案或单个 passed Verdict 都不能替代完整 receipt。

## 边界

- 运行流不是第二套结果格式。业务事实由 receipt 的 `createdRunIds` 与 `publicationCutoff` 固定，再由 query 或 View 读取。
- progress 只是当前进程状态，不能当作 Run 或 Attempt 事实。
- failure 的完整 assertion、conversation、diff 与 usage 按需经固定 Inspection request 读取，不把整段执行内容塞回 NDJSON。
- 受控 `SIGINT` 仍以最后一条 receipt 结束；它的 `completion` 为 `interrupted`，`createdRunIds` 仍穷尽列出已提交 create transaction 的 Run，并在 cutoff 下保留已发布 Attempt。argv、配置发现或 selector 失败则没有 NDJSON receipt，直接以非零 `error:` 结束。

## 相关阅读

- [Experiments CLI · `--json`](../cli/README.md#--json) —— 当前进程反馈与 receipt 的形状。
- [`--json`（CI 门禁）](machine-output-ci-gate.md) —— 退出码与 JUnit 的消费方式。
