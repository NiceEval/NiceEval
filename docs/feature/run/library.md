# Run Library

`niceeval/run/host` 提供高层、受支持的 `runHost`。替代 CLI、Web host 与深度应用集成使用同一组领域操作，不能取得
SQLite、transaction、generic writer、migration、generation 或物理路径。

```ts
interface RunHost {
  readonly list: (request: RunListRequest) => Effect<RunListResult, RunReadError>;
  readonly get: (request: RunGetRequest) => Effect<RunResult, RunReadError>;
  readonly delete: (request: RunDeleteRequest) => Effect<RunDeleteReceipt, RunDeleteError>;
  readonly recover: (request: RunRecoverRequest) => Effect<RunRecoverReceipt, RunRecoverError>;
}
```

Runner 通过内部、owner-scoped capability 创建 Run、发布 Attempt 与收口；这些写能力不导出给 Eval、Adapter、Plugin
或第三方 Host。运行事实只经 NiceEval 具名 typed collector、Adapter 能力或其它已发布领域 API 进入。

NiceEval 不导出通用 durable definition/session、Record Host、Record Snapshot 或 maintenance API。`runHost` 的结果是
关闭的领域值；任何调用方都不能提交 SQL、表名、文件路径或持久格式扩展。

`niceeval/run` 是 Run machine document 的只读、纯协议入口。它导出 `RUN_PROTOCOL`、
`RunListDocument`、`RunGetDocument`、两者的 Schema 与唯一 `decodeRunDocument(input)` decoder。
正式 TypeScript document、Run summary/detail/slot 类型直接由这组 Run Schema 派生。

decoder 严格接受 CLI `run list --json` 的 `operation: "run.list"` 或 `run show --json` 的
`operation: "run.get"`。错误 protocol、operation、闭合集取值、嵌套多余字段和顶层多余字段都会被拒绝。

该入口不包含 `runHost`、SQLite、writer、delete、recover 或 migration 能力；需要生命周期操作的应用仍显式使用
`niceeval/run/host`。
