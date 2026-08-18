# Experiment 展示名称 —— Architecture

## identity 与展示的两条路径

```text
Experiment source
  ├─ path → experimentId → selection / identity / reuse
  └─ displayName + description → resolved presentation → Human / JSON
                                                     │
                                                     ▼
                                      Run presentation Attachment
                                                     │
                                                     ▼
                                         show / view / static report
```

discovery 在执行任何 provider I/O 前同时产生 identity 与 presentation。
identity 路径只读取定义路径和执行配置。
presentation 路径只读取 `displayName` 与 `description`。
两条路径不能以名称、description 或历史 Run 相互补值。

`ExecutionTarget`、`ExecutionReusePlan` 和 scheduler 使用 `experimentId`。
presentation 可以随 target 传到 writer，但不会进入 plan comparison、source barrier 或 gap reason。

## Run-owned 快照

writer 为每个新 Run 写入 `niceeval.experiment-presentation`，envelope 的 `schemaVersion` 为 `1`。
Attachment 与 Run 在同一 seal transaction 发布，且其 ID 必须与 Core 相等。
它保存显示值，不保存 description，也不建立新的 Experiment identity。

reference Member 沿 origin Attempt 读取 execution facts，但当前 Run 仍使用自己的 presentation snapshot。
因此 displayName-only 改动可以建立带当前标题的新 Run，同时携带同一历史 Attempt。
该变化不修改 origin Run、locator、Verdict、Usage 或 reuse eligibility。

新 writer 缺少 Attachment 时拒绝 seal。任一已发布 Run 缺少 Attachment 时，renderer 使用 Core 的完整 ID，
状态为 `fallback-missing`。Record v1 没有 family inventory，因而无法区分较早 writer 的省略与发布后的删除。

Attachment 的 unsupported 或 invalid 状态进入 Report problems surface，状态为 `unavailable`；renderer 仍保留
完整 ID 作为身份文本，但不把它标记为 recorded displayName。Record root/Core 失败、已知 family 的
migration-required，以及 I/O 或 open 失败会阻断 Report，不能降级成上述两种局部状态。

## 选择、dry 与并发

`exp list` 和 `exp --dry` 从当前定义取得展示值。
只有既有 ID selector 可以收窄 Experiment。
名称、description 和 Human 标题从不参与选择。

`show` 与 `view` 沿用现行两条选择路径：不带 selection 时形成当前项目的全部匹配 Runs，一个或多个精确
`--run <RunId>` 审计指定历史 Run。两条路径都不读取展示文本或 description，也不按时间挑选结果。

同一 Record root 的多个 writer 继续各自追加唯一 Run directory，不因展示名称引入新的互斥。
重复 displayName 不产生共享锁、registry、排序变化或跨 Invocation 协调。
只读 Report 读取已发布 Run snapshot，不读取 writer 的局部 target。

## 失败、迁移与删除

无效 displayName 是 discovery error，命令不建立 Invocation、Run、Sandbox 或 terminal receipt。
重复 displayName 不是错误。
缺失 displayName 只回落完整 Experiment ID；没有短名称、最后路径段或 description fallback。

新 Run Attachment 不要求回填已发布 Run。
任一 published Run 的 missing Attachment 都具有固定 fallback 语义。
已损坏或不支持的 Attachment 不允许通过当前源码修复或回填；阻断读取的失败仍按 Record/Analysis 契约退出。

删除以下路径：

- 由 displayName 或 description 形成 Experiment identity、reuse identity 或 selector；
- 按名称、description、时间或其它未声明线索选择 Run；
- 以展示名称建立唯一 registry、短 ID 或自动消歧；
- 由 terminal JSON receipt 交接展示名称或名称到 Run 的映射。

## 生产入口验收

真实 CLI/E2E 旅程包含普通定义、名称重复、名称缺失、无效名称与历史 Run。
每个切片核对 list、dry、运行反馈、show、view 和静态 Report 的 Human 与 JSON 一致，并核对 terminal JSON receipt 保持 canonical `runIds`。
另一条切片只改 displayName，验证它不改变 selector、identity 或 carried 决定。
验收不新增 Eval Assertion。
