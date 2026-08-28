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
