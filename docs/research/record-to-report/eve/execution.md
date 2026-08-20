# Eve：一次 `eve eval` 的顺序

> 观察日期：2026-08-14
>
> 核对源码：`vercel/eve` `a29cc8e0864348fb7b02c2e8be718b7edd056e65`，`packages/eve` 0.31.3
>
> 返回 [目录](README.md)

本页写从 CLI 发起到进程退出的真实顺序。
作者面见 [channel、harness 与作者面](layers.md)。
写盘与失败见 [`.eve/evals` 信封](storage.md)。

官方入口：

- [Running Evals](https://eve.dev/docs/evals/running)
- [CLI](https://eve.dev/docs/reference/cli)
- [Targets](https://eve.dev/docs/evals/targets)
- [Reporters](https://eve.dev/docs/evals/reporters)

## 公开命令

```bash
eve eval                       # 发现全部 eval，启动本地 dev server
eve eval weather smoke         # id 或目录前缀
eve eval --url https://<app>   # 已有 server 或部署
```

## 执行顺序

源码顺序如下。

1. Commander 注册 `eval` 命令（`packages/eve/src/cli/run.ts`）。
   action 调用 `runEvalCommand`（[`packages/eve/src/evals/cli/eval.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/cli/eval.ts)）。
2. `resolveApplicationRoot()` 得到 app root，并加载 `.env` / `.env.local`。
3. `discoverAndImportEvals(appRoot, evalIds)` 递归扫描 `evals/**/*.eval.ts`。
   每个 default export 必须是 `_tag: "EveEval"`，或这种值的数组。
   单文件 id 来自相对路径；数组项 id 是 `<file-id>/<四位序号>`。
   重复 id 抛错。
4. `--tag` 先做包含过滤。
   一个不匹配的 include 是配置错误，退出码 2。
   `--exclude-tag` 再删除命中项。
   排除后一个都不剩时，命令成功退出，不跑 eval。
5. `--list` 打印过滤后的 eval，然后返回。
   它不启动 server，也不写 artifact。
6. `discoverEvalConfig` 读取唯一的 `evals/evals.config.ts`。
   文件缺失或 default export 不是 `_tag: "EveEvalConfig"` 时，退出码 2。
7. 求值并核验 target。
   无 `--url` 时，`createDevelopmentServer(appRoot, { host: "127.0.0.1", port: 0 })` 启动本地 server。
   `createEvalClient` 构造 `Client`。
   `resolveEvalTargetHandle` 轮询 `Client.health()`，间隔 250ms，超时 60s。
   随后 `Client.info()` 读取 `GET /eve/v1/info`。
   payload 必须是 `kind: "eve-agent-info"` 且 `version: 1`。
   本地 target 无 auth。
   远程 `--url` 只在 Vercel project id 对得上时带宿主凭证；任意 URL 保持匿名。
8. 组装 run-level reporter。
   默认 `Console()`。
   `--json` 去掉 Console。
   `--junit <path>` 再加 `JUnit({ filePath })`。
9. `runEvals` 用 config 补 judge 与 `timeoutMs`。
   默认并发 8，可被 `--max-concurrency` 或 config 替换。
   对每个 reporter 调 `onRunStart`。
   符号在 [`run-evals.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/run-evals.ts)。
10. 有界并发执行 `executeEval`。
    每个 eval 调 `executeTask`：
    - 建 `AssertionCollector` 与 `EvalSessionManager`
    - `createEvalContext` 得到 `t`
    - 跑 `evaluation.test(t)`，尊重 `AbortSignal.timeout`
    - `t.skip(reason)` 变成 `EvalSkipped`
    - `t.require` 失败变成 `EvalRequirementFailed`，不记作 execution error
    - 其它抛错记入 `error`，仍保留已捕获的 session
    - `collector.finalize(result)` 评 deferred scoped assertion
    - `computeEvalVerdict` 得到 `passed` / `failed` / `scored` / `skipped`
    完成一项后，把 `onEvalComplete` 排进串行 reporter 队列。
    慢 reporter 不占用执行池。
    符号在 [`execute-eval.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/execute-eval.ts)、[`execute-task.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/execute-task.ts)、[`verdict.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/verdict.ts)。
11. 结果按发现顺序排序。
    `buildSummary` 计数 `passed`、`failed`、`scored`、`skipped`、`errored`。
12. `resolveArtifactDirectory` 算出 `.eve/evals/<timestamp>/`。
    `writeArtifacts` 一次写完 [dump 信封](storage.md) 的全部文件。
13. 对每个 reporter 调 `onRunComplete`。
    Braintrust 在这里 `flush`、`summarize`、打印 experiment URL、`close`。
    JUnit 在这里写 XML。
14. `--json` 把内存里的 `EveEvalRunSummary` 打到 stdout。
    它不是重读磁盘。
15. `summary.failed > 0`，或 `--strict` 且 `summary.scored > 0` 时，退出码 1。
16. `finally` 关闭本地 dev server，并 `shutdownActiveSandboxHandles`。
    最后 `process.exit(exitCode)`。

## 完成与退出

完成标识是进程退出码，不是磁盘上的 committed flag。

| 退出码 | 含义 |
|---|---|
| 0 | 每个非 skipped eval 都过了 gate；`--strict` 时 soft threshold 也过了 |
| 1 | 任一 eval failed，或 `--strict` 下出现 `scored` |
| 2 | 配置错误：没有 eval、`--tag` 全空、缺 config、非法数字 |

`t.skip(reason)` 单独计数，不改变退出码。

发现符号在 [`discover.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/discover.ts)。
reporter 实现在 [`reporters/`](https://github.com/vercel/eve/tree/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/reporters)。
