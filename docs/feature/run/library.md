# Run Library

`niceeval/run/host` 是 Node.js 应用的公开 Host 入口，提供高层、受支持的 `runHost`。替代 CLI、Node Web host 与深度应用集成使用同一组领域操作，不能取得
SQLite、transaction、generic writer、migration、generation 或物理路径。该入口不承诺在浏览器或其它非 Node 运行时加载；跨运行时的只读协议使用 `niceeval/run`。

```ts
interface RunHost {
  readonly list: (request: RunListRequest) => Effect<RunListResult, RunReadError>;
  readonly get: (request: RunGetRequest) => Effect<RunResult, RunReadError>;
  readonly delete: (request: RunDeleteRequest) => Effect<RunDeleteReceipt, RunDeleteError>;
  readonly recover: (request: RunRecoverRequest) => Effect<RunRecoverReceipt, RunRecoverError>;
}
```

```ts
import { Effect } from "effect";
import { runHost } from "niceeval/run/host";

const page = await Effect.runPromise(runHost.list({ cwd: process.cwd() }));
console.log(page.runs.map((run) => run.runId));
```

四个操作返回惰性的 Effect：构造 Effect 不探测项目或获取资源，执行时才读取请求 cwd 的当前状态。
每次执行独立取得并关闭资源；成功、typed failure 与 interruption 都完成所属资源的收尾。
同一应用可以顺序或并发访问不同 cwd，也可以在自己的 Layer 中组合操作，不会把一个项目的数据库实例用于另一个项目。
调用方不需要提供私有 Service、额外 Scope 或 NiceEval runtime。

无效 Run ID、缺失 Run、无效 continuation、删除 active Run、恢复 terminal Run 或仍活跃的 owner，都是领域拒绝。
它们通过相应 `RunReadError`、`RunDeleteError` 或 `RunRecoverError` 的失败通道返回，可由 `Effect.catchTag` 处理后继续操作。
正常领域拒绝不作为 defect 抛出，也不改写既有 Run 事实。

Runner 通过内部、owner-scoped capability 创建 Run、发布 Attempt 与收口；这些写能力不导出给 Eval、Adapter、Plugin
或第三方 Host。运行事实只经 NiceEval 具名 typed collector、Adapter 能力或其它已发布领域 API 进入。

NiceEval 不导出通用 durable definition/session、Record Host、snapshot/export 或 maintenance API。`runHost` 的结果是
关闭的领域值；任何调用方都不能提交 SQL、表名、文件路径或持久格式扩展。

`niceeval/run` 是 Run machine document 的只读、纯协议入口。它导出 `RUN_PROTOCOL`、
`RunListDocument`、`RunGetDocument`、两者的 Schema 与唯一 `decodeRunDocument(input)` decoder。
正式 TypeScript document、Run summary/detail/slot 类型直接由这组 Run Schema 派生。

decoder 严格接受 CLI `run list --json` 的 `operation: "run.list"` 或 `run show --json` 的
`operation: "run.get"`。错误 protocol、operation、闭合集取值、嵌套多余字段和顶层多余字段都会被拒绝。

该入口不包含 `runHost`、SQLite、writer、delete、recover 或 migration 能力；需要生命周期操作的应用仍显式使用
`niceeval/run/host`。
