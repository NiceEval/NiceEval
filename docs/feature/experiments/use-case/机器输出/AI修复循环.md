---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# `--json`：让 coding agent 跑、查、改、复验

coding agent 不需要解读 TTY 重绘。
它需要稳定的 Invocation identity、规范 Attempt locator、按需读取证据的入口，以及最终 receipt。

`exp --json` 输出当前进程的 NDJSON 反馈，末尾恰好一条 `InvocationReceipt`。
完整词表见 [CLI · 机器怎么读](../../cli.md#机器怎么读--json)。

## 全流程

1. 先检查计划，确认选择没有扩大：

   ```sh
   niceeval exp compare memory/commit0 --dry --json
   ```

2. 执行并读取进度反馈与末尾 receipt：

   ```sh
   niceeval exp compare memory/commit0 --json
   ```

   `progress` 与 `diagnostic` 服务当前进程；最后一条 `receipt` 是完整 `InvocationReceipt`。

   ```json
   {"type":"progress","invocationId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","message":"running","current":1,"total":2}
   {"event":"warning","code":"judge-precheck-failed","level":"error","message":"Judge precheck failed…","phase":"judge.precheck","experimentId":"compare/codex","evalId":"memory/commit0","planned":1,"errored":1}
   {"type":"receipt","receipt":{"invocationId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","runIds":["8f3d6f62-1d34-4cf3-99c7-84ba3c483706"],"startedAt":"2026-08-09T10:00:00.000Z","completedAt":"2026-08-09T10:01:00.000Z","completion":"completed"}}
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

- 运行流不是第二套结果格式。业务事实由 receipt 的 `runIds` 选择，再由固定 query 或 View 读取；`SIGINT` receipt 也只列已发布 Run。
- progress 只是当前进程状态，不能当作 Record 事实。
- failure 的完整 assertion、conversation、diff 与 usage 按需经 Record reader 读取，不把整段执行内容塞回 NDJSON。
- 受控 `SIGINT` 仍以最后一条 receipt 封口；它的 `completion` 为 `interrupted`，`runIds` 只含已经 seal 的 Run。argv、配置发现或 selector 失败则没有 NDJSON receipt，直接以非零 `error:` 结束。

## 相关阅读

- [Experiments CLI · `--json`](../../cli.md#--json) —— 当前进程反馈与 receipt 的形状。
- [`--json`（CI 门禁）](CI门禁.md) —— 退出码与 JUnit 的消费方式。
