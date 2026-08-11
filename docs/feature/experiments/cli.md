# Experiments —— CLI 反馈模型

`niceeval exp` 选择已签入的 Experiment，建立一个 `invocationId`，并为每个选中的 Experiment 建立 Run。命令结束时返回轻量的 `InvocationReceipt`；完整结果通过 receipt 的 `runIds` 从 Record 读取。

Record 不保存可恢复的 Invocation、live session 或第二套聚合结果。运行中的面板只是当前进程内的反馈。

## 命令

```sh
niceeval exp [<experiment-prefix>] [<eval-prefix>] [flags]
niceeval exp list [<experiment-prefix>] [--json]
niceeval exp <experiment-prefix> --dry [--json]
```

位置参数先选择 Experiment ID 或路径前缀，再收窄 Eval ID 前缀。它们只能缩小 Experiment 自己的 `evals` 选择，不能把未选中的 Eval 加回计划。

### `exp list`

`exp list` 只做发现和配置求值，不建立 Invocation、不取锁、不启动 Sandbox，也不写 Record。每行显示 Experiment、Agent、model、attempts、已选 Eval 数和 labels；不打印凭据或完整 flags。

精确 Experiment ID 优先。否则目录段精确匹配，最后一段允许前缀匹配。Experiment 零命中与 Eval 零命中都是具名错误，不降级为空 Invocation。

### `--dry`

`--dry` 用取得 shared maintenance lease 的 frozen reader 运行 `project-target/v1`，展示 policy identity、effective options，以及每个目标成员的 reuse 或 gap：

```text
PLAN
compare/codex  memory/commit0  ordinal 0  reuse/carried @01J8ZK3M6P4T7V9X2C5N8QW0RY
compare/codex  memory/commit0  ordinal 1  gap: identity-mismatch
```

reuse planning 先要求受支持的 eligibility schema 与匹配的 `reuseContract` domain，再比较 input/config identity。缺失、损坏、不支持或 domain 不同都形成带真实 issues 的具名 gap；不会猜成“从未运行”。`--dry` 不建立 Invocation、不写 Record，也不取得 writer lock。

## `niceeval accept`

```sh
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY @123456789ABCDEFGHJKMNPQRST
```

accept 用 `explicit-adoption/v1` 对全部 locator 与当前 target 做完整预检。任一项失败都零业务写入，不能降级成 execution gap。通过后为关联 Experiment 建立 Run，用 reference Member 引用源 Attempt，并在 `niceeval.membership-provenance` 保存 accepted、配置差异、policy identity 与操作者理由；执行事实不复制。

| 错误 | 反馈 |
|---|---|
| `malformed-locator` | 要求完整 `@` 加 26 个大写 Crockford 字符 |
| `locator-not-found` | 当前 Record 没有该 Attempt |
| `accept-ineligible` | 列出 Verdict、timeout、配置或计划的阻断条件 |
| `duplicate-accept-member` | 指出重复的目标 slot |

动态 query、差异类别和隐含批量 accept 都不支持。

## 运行中反馈

Runner 从当前进程内的事件流维护 TTY 面板：progress 可以替换，阶段与计数可以更新。持久业务事实则写入 Run 或 Attempt 的通道。

| 信息 | 当前进程 | Record |
|---|---|---|
| counters、active Attempt、短 detail | 更新 | 不单独保存 |
| `progress()` | 合并或丢弃 | 不保存 |
| diagnostic、运行时观测、phase event | 显示 | 写入相应事件通道 |
| assertion、Verdict、usage | 显示摘要 | 写入具名 Attempt 通道 |
| Invocation 结束 | 显示终态 | API 返回 receipt |

进程退出后不能用后台监看或 session 查询重建这块 live 状态。需要长期查看的内容必须已经进入 Record 通道；需要分享则生成静态 Report。

### Attempt 阶段

Runner 只投影实际生命周期阶段，Adapter、Sandbox provider 与用户 Hook 不能伪造 phase：

| phase | Human 文案 |
|---|---|
| `sandbox.queue` | waiting for sandbox |
| `sandbox.create` | creating sandbox |
| `sandbox.prepare.*` | preparing sandbox |
| `agent.ensure` | preparing agent |
| `agent.setup` | agent setup |
| `eval.run` / `agent.run` | running eval |
| `workspace.diff` | capturing diff |
| `assertions.evaluate` | evaluating assertions |
| `sandbox.cleanup` / `sandbox.stop` | releasing sandbox |

Experiment `setup` 与 `teardown` 显示为 Run 范围活动。同一 Record root 已有其它写 Invocation 时，命令以 `record-writer-busy` 失败；它不等待或读取对方 local session。只读命令仍可读取已发布 Run。

## 结束反馈与 receipt

TTY 结束反馈显示 Invocation completion、Run ID、终态计数和下一步命令。它不持久化成另一份结果文档。

```ts
interface InvocationReceipt {
  readonly invocationId: string;
  readonly runIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}
```

receipt 不复制 locator、Verdict、usage、cost 或 Attempt 计数。需要这些值时，以 `runIds` 运行 `explicit-runs/v1` analysis selection，或调用 `niceeval show --run <runId>`。

## `--json`

`exp --json` 输出当前进程的 NDJSON 反馈，最后恰好一条 receipt：

```json
{"type":"progress","invocationId":"01J8...","message":"running","current":1,"total":3}
{"type":"diagnostic","invocationId":"01J8...","code":"sandbox-retry","level":"warning","message":"retrying"}
{"type":"receipt","receipt":{"invocationId":"01J8...","runIds":["01J9..."],"startedAt":"2026-08-09T10:00:00.000Z","completedAt":"2026-08-09T10:01:00.000Z","completion":"completed"}}
```

progress 与 diagnostic 形状服务当前 Invocation，不是 Record 解码协议。机器调用方以进程退出状态和最后的 receipt 判断命令是否结束，再用 Record reader 读取业务数据。

CI 用退出状态判断门禁，使用 `--junit` 输出平台注解。JUnit 由临时文件原子替换生成，不成为 Record 的事实 owner。

## 参数影响

| 类别 | 参数 | 作用 |
|---|---|---|
| 选择 | 位置参数 | 收窄 Experiment 与 Eval |
| 调度 | `--attempts`、`--max-concurrency`、`--budget` | 影响本次派发 |
| timeout | `--timeout` | 进入本次 project-target policy，可能使目标 slot 形成 gap |
| 采用 | `--rerun` | 进入本次 policy，决定哪些 Verdict 可以形成 reuse |
| Sandbox | `--keep-sandbox` | 进入本次 policy，让全部目标 slot 形成 gap |
| 输出 | `--json`、`--junit` | 改变交付形式，不改业务事实 |

argv、配置发现或 selector 无法形成 Invocation 时，命令以非零状态输出 `error:` 与 `fix:`。因为尚未建立 `invocationId`，这类错误没有 receipt。

## 相关阅读

- [Architecture](architecture.md) —— Invocation、Run、Member 与锁。
- [缓存与携带](cache.md) —— carried / accepted 的资格和写入。
- [Record CLI](../record/cli.md) —— `show`、locator 与 Record 维护命令。
- [Record Library](../record/library.md) —— receipt、reader、writer 与通道。
