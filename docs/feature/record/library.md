# Record Library

本页定义 Agent 怎样增量产生事实、Runner 怎样返回 receipt、第三方 harness 怎样写 Record，以及读取面怎样产生带依据的 Projection。
容器、payload 与 Store 原子语义见 [Architecture](architecture.md)。

## Agent Turn stream

Adapter 的 `send` 返回一条只向前推进的异步流。
它包含零到多条事件，以及恰好一个末尾 Outcome。

```ts
type AgentTurnFrame =
  | { type: "event"; event: StreamEvent }
  | { type: "outcome"; outcome: TurnOutcome };

type AgentTurnStream = AsyncIterable<AgentTurnFrame>;

interface TurnOutcome {
  status: "completed" | "failed" | "waiting";
  data?: JsonValue;
  usage?: Usage;
  evidenceCoverage?: TurnEvidenceCoverage;
}

interface SandboxAgent {
  readonly name: string;
  readonly kind: "sandbox";
  readonly evidenceCoverage: EvidenceCoverage;
  send(input: TurnInput, ctx: SandboxAgentContext): AgentTurnStream;
}

interface DirectAgent {
  readonly name: string;
  readonly kind: "direct";
  readonly evidenceCoverage: EvidenceCoverage;
  send(input: TurnInput, ctx: AgentContext): AgentTurnStream;
}
```

stream 满足以下规则：

1. Adapter 保持原始发生顺序，不按类型或墙钟重排。
2. 最后一帧是唯一 Outcome，其后不能再 yield。
3. 无法形成可信 Outcome 时，迭代器 reject `SendFailure`。
4. reject 前已 yield 的事件继续作为 partial Observation 保存，不复制进 error。
5. `waiting` 必须有尚未解决的 input request；回答轮沿用同一 Agent Session。
6. Adapter 不截断或脱敏事件；Record serialization policy 统一执行 transformation。

无法增量取得原生事件的 Adapter 使用 `batchTurn`：

```ts
function batchTurn(
  run: () => Promise<{
    events: readonly StreamEvent[];
    outcome: TurnOutcome;
  }>,
): AgentTurnStream;
```

batch 只改变可见时点，不改变 Record、Claim 或证据涵盖语义。

## Eval 作者看到的 Turn

`t.send()` 消费一条完整 Agent Turn stream，再把事件和 Outcome 组成 Turn。
作者面不暴露 Hub、Record cursor 或物理 segment。

```ts
interface Turn {
  readonly events: readonly StreamEvent[];
  readonly data?: JsonValue;
  readonly status: "completed" | "failed" | "waiting";
  readonly usage?: Usage;
  readonly evidenceCoverage?: TurnEvidenceCoverage;
}
```

断言在完整内存事件上运行。
Record transformation、Live 过滤与 OTel 缺失不能改变 `Turn.events` 或当时形成的 Claim。

## AgentContext 的三种反馈

```ts
interface ProgressUpdate {
  message: string;
  current?: number;
  total?: number;
}

interface DiagnosticInput {
  key: string;
  code: string;
  level: "warning" | "error";
  message: string;
  data?: Readonly<Record<string, JsonValue>>;
}

interface Telemetry {
  readonly endpoint: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
}

interface AgentContext {
  readonly session: AgentSession;
  readonly telemetry?: Telemetry;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  fact(key: string, value: string | number | boolean): void;
}
```

| API | 信息类别 | durable | 规则 |
|---|---|---|---|
| `progress` | ephemeral feedback | 否 | live 只保留同 scope 最新值 |
| `diagnostic` | Observation | 是 | 每次发生都保留，读面可以按 key 投影 |
| `fact` | Observation | 是 | 同 key 更新仍追加；latest-fact Projector 取最后 sequence |

三种反馈都不能冒充 Runner 的 LifecyclePhase。
要让执行失败就抛 typed error；要改变判定就形成 Assertion、Judge 或 Verdict Claim。

## Store、handle 与读取 capability 的错误边界

以下 error class 是 Record public async entry 的唯一 failure surface。每个 failure 都有稳定
`code`、入口 operation、`retryable` 和原始 `cause`；`cause: null` 表示纯契约失败，不把宿主
错误伪装成新的 code。

```ts
type NonEmptyArray<T> = readonly [T, ...T[]];

interface RecordFailureMeta<Operation extends string> {
  readonly operation: Operation;
  readonly retryable: boolean;
  readonly cause: unknown | null;
}

type RecordStoreOperation = "create" | "open" | "close";
type RecordOpenOperation = "open-record" | "open-record-graph";
type RecordReadOperation =
  | "read-entity"
  | "read-stream"
  | "read-claim"
  | "read-provenance"
  | "iterate"
  | "resolve-attempt";
type RecordLookupOperation = "parse-locator" | "resolve-attempt";
type RecordProjectOperation = "project";
type RecordVerificationOperation = "verify-record-graph";
type RecordSourceOperation = "create-source-set" | "read-source" | "close-source-set";

type RecordStoreRootIssue =
  | "empty"
  | "not-absolute"
  | "malformed-url"
  | "file-url-host"
  | "query-or-fragment";

type RecordStoreFailure =
  | (RecordFailureMeta<"create" | "open"> & {
      readonly code: "record-store-root-invalid";
      readonly root: string | URL;
      readonly issue: RecordStoreRootIssue;
    })
  | (RecordFailureMeta<"create" | "open"> & {
      readonly code: "record-store-url-scheme-unsupported";
      readonly root: URL;
      readonly scheme: string;
    })
  | (RecordFailureMeta<"create"> & {
      readonly code: "record-store-already-exists";
      readonly root: string;
    })
  | (RecordFailureMeta<"open"> & {
      readonly code: "record-store-missing";
      readonly root: string;
    })
  | (RecordFailureMeta<"open"> & {
      readonly code: "record-store-invalid-format";
      readonly root: string;
      readonly declared?: string;
    })
  | (RecordFailureMeta<"open"> & {
      readonly code: "record-store-corrupt";
      readonly root: string;
      readonly component: "marker" | "metadata" | "journal" | "layout";
    })
  | (RecordFailureMeta<RecordStoreOperation> & {
      readonly code: "record-store-permission-denied";
    })
  | (RecordFailureMeta<RecordStoreOperation> & {
      readonly code: "record-store-unavailable" | "record-store-io-failure";
    });

type RecordBootstrapComponent =
  | "layout"
  | "committed-root-membership"
  | "graph-root"
  | "subject"
  | "catalog"
  | "locator-index"
  | "previous";

type RecordVerificationComponent = "graph-root" | "strong-closure";

type RecordBootstrapFailureCode =
  | "record-open-bootstrap-missing-object"
  | "record-open-bootstrap-corrupt"
  | "record-open-bootstrap-unsupported-digest"
  | "record-open-bootstrap-unsupported-schema"
  | "record-open-bootstrap-unsupported-capability";

type RecordOpenFailure =
  | (RecordFailureMeta<RecordOpenOperation> & {
      readonly code: "record-empty";
    })
  | (RecordFailureMeta<"open-record-graph"> & {
      readonly code: "record-graph-record-id-mismatch";
      readonly ref: RecordGraphRef;
      readonly actualRecordId: string;
    })
  | (RecordFailureMeta<"open-record-graph"> & {
      readonly code: "record-graph-not-committed";
      readonly ref: RecordGraphRef;
    })
  | (RecordFailureMeta<RecordOpenOperation> & {
      readonly code: RecordBootstrapFailureCode;
      readonly ref?: RecordGraphRef;
      readonly component: RecordBootstrapComponent;
      readonly object?: DescriptorV1;
    })
  | (RecordFailureMeta<RecordOpenOperation> & {
      readonly code: "record-open-invalid-store" | "record-open-closed";
    })
  | (RecordFailureMeta<RecordOpenOperation> & {
      readonly code: "record-open-permission-denied";
    })
  | (RecordFailureMeta<RecordOpenOperation> & {
      readonly code: "record-open-unavailable" | "record-open-io-failure";
    })
  | (RecordFailureMeta<RecordOpenOperation> & {
      readonly code: "record-open-resource-limit";
      readonly component: RecordBootstrapComponent;
      readonly ref?: RecordGraphRef;
      readonly object?: DescriptorV1;
      readonly limit: RecordWalkerResourceLimit;
      readonly observed: number;
    });

type RecordReadFailure =
  | (RecordFailureMeta<RecordReadOperation> & {
      readonly code: "record-read-closed";
    })
  | (RecordFailureMeta<RecordReadOperation> & {
      readonly code: "record-graph-invalid";
      readonly violations: NonEmptyArray<RecordGraphViolation>;
    })
  | (RecordFailureMeta<RecordReadOperation> & {
      readonly code: "record-read-permission-denied";
      readonly reason:
        | "capability-invalid"
        | "operation-denied"
        | "auth-session-expired";
    })
  | (RecordFailureMeta<RecordReadOperation> & {
      readonly code:
        | "record-read-missing-object"
        | "record-read-corrupt"
        | "record-read-unsupported-digest"
        | "record-read-unsupported-schema"
        | "record-read-unsupported-capability"
        | "record-read-unavailable"
        | "record-read-io-failure";
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<RecordReadOperation> & {
      readonly code: "record-read-resource-limit";
      readonly ref?: DescriptorV1;
      readonly limit: RecordWalkerResourceLimit;
      readonly observed: number;
    });

type RecordLookupFailure =
  | (RecordFailureMeta<"parse-locator"> & {
      readonly code: "record-locator-malformed";
      readonly value: string;
    })
  | (RecordFailureMeta<"resolve-attempt"> & {
      readonly code: "record-locator-not-found";
      readonly locator: AttemptLocator;
    })
  | (RecordFailureMeta<RecordLookupOperation> & {
      readonly code: "record-lookup-closed" | "record-lookup-invalid-handle";
    });

type RecordProjectFailure =
  | (RecordFailureMeta<RecordProjectOperation> & {
      readonly code:
        | "record-project-record-closed"
        | "record-project-record-invalid-handle";
    })
  | (RecordFailureMeta<RecordProjectOperation> & {
      readonly code:
        | "record-project-attempt-closed"
        | "record-project-attempt-invalid-handle";
    })
  | (RecordFailureMeta<RecordProjectOperation> & {
      readonly code: "record-project-attempt-record-mismatch";
      readonly expected: RecordGraphRef;
      readonly actual: RecordGraphRef;
    });

type RecordGraphVerificationFailure =
  | (RecordFailureMeta<RecordVerificationOperation> & {
      readonly code: "record-verification-invalid-handle" | "record-verification-closed";
    })
  | (RecordFailureMeta<RecordVerificationOperation> & {
      readonly code: "record-verification-permission-denied";
    })
  | (RecordFailureMeta<RecordVerificationOperation> & {
      readonly code: "record-verification-unavailable" | "record-verification-io-failure";
    })
  | (RecordFailureMeta<RecordVerificationOperation> & {
      readonly code: "record-verification-unsupported-digest";
      readonly component: RecordVerificationComponent;
      readonly ref: DescriptorV1;
    })
  | (RecordFailureMeta<RecordVerificationOperation> & {
      readonly code: "record-verification-resource-limit";
      readonly component: RecordVerificationComponent;
      readonly ref?: DescriptorV1;
      readonly limit: RecordWalkerResourceLimit;
      readonly observed: number;
    });

type RecordSourceFailure =
  | (RecordFailureMeta<"create-source-set"> & {
      readonly code: "record-source-empty" | "record-source-invalid-handle";
    })
  | (RecordFailureMeta<"read-source"> & {
      readonly code: "record-source-invalid-handle";
    })
  | (RecordFailureMeta<"create-source-set"> & {
      readonly code: "record-source-duplicate-ref";
      readonly ref: RecordGraphRef;
    })
  | (RecordFailureMeta<"read-source"> & {
      readonly code: "record-source-missing";
      readonly ref: RecordGraphRef;
    })
  | (RecordFailureMeta<"read-source"> & {
      readonly code: "record-source-closed";
    })
  | (RecordFailureMeta<RecordSourceOperation> & {
      readonly code: "record-source-permission-denied";
    })
  | (RecordFailureMeta<RecordSourceOperation> & {
      readonly code: "record-source-unavailable" | "record-source-io-failure";
    });

class RecordStoreError extends Error {
  readonly failure: RecordStoreFailure;
}
class RecordOpenError extends Error {
  readonly failure: RecordOpenFailure;
}
class RecordReadError extends Error {
  readonly failure: RecordReadFailure;
}
class RecordLookupError extends Error {
  readonly failure: RecordLookupFailure;
}
class RecordProjectError extends Error {
  readonly failure: RecordProjectFailure;
}
class RecordGraphVerificationError extends Error {
  readonly failure: RecordGraphVerificationFailure;
}
class RecordSourceError extends Error {
  readonly failure: RecordSourceFailure;
}

type RecordEvidenceProofOperation =
  | "resolve-evidence"
  | "close-claim-basis"
  | "select-path"
  | "archive"
  | "verify"
  | "write-index";

type RecordEvidenceProofFailure =
  | (RecordFailureMeta<"resolve-evidence"> & {
      readonly code: "proof-target-invalid";
      readonly evidence: EvidenceRef;
    })
  | (RecordFailureMeta<"resolve-evidence"> & {
      readonly code: "proof-source-read-failed";
      readonly evidence: EvidenceRef;
      readonly sourceFailure: RecordReadFailure;
    })
  | (RecordFailureMeta<"verify"> & {
      readonly code: "proof-source-graph-invalid";
      readonly violations: NonEmptyArray<RecordGraphViolation>;
    })
  | (RecordFailureMeta<"close-claim-basis"> & {
      readonly code: "proof-cycle";
      readonly claimId: string;
    })
  | (RecordFailureMeta<"select-path"> & {
      readonly code: "proof-path-unavailable";
      readonly evidence: EvidenceRef;
    })
  | (RecordFailureMeta<RecordEvidenceProofOperation> & {
      readonly code: "proof-resource-limit";
      readonly limit: RecordWalkerResourceLimit;
      readonly observed: number;
    })
  | (RecordFailureMeta<"archive"> & {
      readonly code: "proof-archive-corrupt";
      readonly issue:
        | "base64"
        | "decoded-length"
        | "descriptor"
        | "digest"
        | "media-decoder"
        | "archive-id-collision";
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<"verify"> & {
      readonly code: "proof-index-invalid";
      readonly issue: "object-table" | "proof-page" | "edge-order" | "proof-bytes";
    })
  | (RecordFailureMeta<"write-index"> & {
      readonly code: "proof-write-failed";
    })
  | (RecordFailureMeta<RecordEvidenceProofOperation> & {
      readonly code: "proof-permission-denied" | "proof-unavailable" | "proof-io-failure";
    });

class RecordEvidenceProofError extends Error {
  readonly failure: RecordEvidenceProofFailure;
}
```

`proof-resource-limit` 只在实现或 target Store 明示的上限被超过时产生。`limit` 原样说明该上限，
`observed` 是本次 export 的实际值；v1 不另行规定 proof 数、object 数、path 深度、Claim 深度或
archive 字节数的固定全局上限。

| 入口 | 只会 reject |
|---|---|
| `createRecordStore()` | `RecordStoreError`：`record-store-root-invalid`、`record-store-url-scheme-unsupported`、`record-store-already-exists`，或 operation 为 `create` 的 `record-store-permission-denied`、`record-store-unavailable`、`record-store-io-failure` |
| `openRecordStore()` | `RecordStoreError`：`record-store-root-invalid`、`record-store-url-scheme-unsupported`、`record-store-missing`、`record-store-invalid-format`、`record-store-corrupt`，或 operation 为 `open` 的 `record-store-permission-denied`、`record-store-unavailable`、`record-store-io-failure` |
| `RecordStore` close / async dispose | `RecordStoreError`：operation 为 `close` 的 `record-store-permission-denied`、`record-store-unavailable`、`record-store-io-failure`；重复 close 复用第一次 settled result，不产生 closed 或 already-exists failure |
| `openRecord()`、`openRecordGraph()` | `RecordOpenError` |
| lazy entity/stream/Claim/Provenance read and async iterator | `RecordReadError` |
| `resolveAttempt()` 的 locator parse、RecordHandle brand/state 与已验证 index nonmembership | `RecordLookupError` |
| `resolveAttempt()` 的 locator index page traversal 与 adopted Attempt read | `RecordReadError` |
| `RecordHandle.project()` 的 Record / Attempt capability 输入 | `RecordProjectError` |
| `verifyRecordGraph()` | `RecordGraphVerificationError` |
| `createRecordSourceSet()` and SourceSet reader/close | `RecordSourceError` |
| `exportSample()` | Record-owned failure 只包括 `RecordSourceError`、`RecordReadError` 或 `RecordEvidenceProofError`；Sample validation 与 target Store failure 由 Sample owner 定义 |

Sample 的 `exportSample()` 在 source capability phase 直接传播 `RecordSourceError`，在固定 Graph 的
membership/prerequisite lazy-read phase 直接传播 `RecordReadError`。随后 proof phase 直接传播
`RecordEvidenceProofError`。

Reports 的 `exportReport()` 不直接传播这三个 Error。Projection read 的 `RecordReadError` 进入 Reports
owner 的 typed projection failure cause。`RecordSourceError` 与 `RecordEvidenceProofError` 的 failure
分别原样嵌入 `RecordSourceFailure` 或 `RecordEvidenceProofFailure`，再由 Reports 的导出错误返回。
Record 不定义 Reports 的外层错误类型、其它输入或输出。

Sample 形成 proof index 时，`RecordEvidenceProofError` 的 failure 映射固定如下：

| export 阶段 | `RecordEvidenceProofFailure.code` |
|---|---|
| 读取 EvidenceTarget 与对应数据 | `proof-target-invalid`、`proof-source-read-failed` |
| 检查 source graph 与递归 Claim basis | `proof-source-graph-invalid`、`proof-cycle` |
| 选择 canonical strong path | `proof-path-unavailable`、`proof-resource-limit` |
| archive raw bytes | `proof-archive-corrupt`、`proof-permission-denied`、`proof-unavailable`、`proof-io-failure` |
| 验证或写入 proof index | `proof-index-invalid`、`proof-write-failed`、`proof-resource-limit` |

打开 Store 时只验证 marker、物理 metadata、journal 与 Layout JCS。
Store kind 或 version 错误是 `record-store-invalid-format`。
Store 声称精确 format，但物理 marker、metadata、journal 或 Layout 损坏时是
`record-store-corrupt`。

Store wrapper close 只释放它自己的 retain，并对 lifecycle 幂等。close 开始后不能创建新的
public child capability；已取得独立 retain 的 handle、writer 与 SourceSet reader 可以完成。真实
closed Store 只会由接收 Store capability 的其它入口按各自 owner failure 表达，factory 与重复 close
都不产生 `record-store-closed`。

root 在触碰 Store 前规范化。空值、非绝对路径、畸形 URL、带 query/fragment 的 root 与非法
file host 是 `record-store-root-invalid`；未知 URL scheme 是
`record-store-url-scheme-unsupported`。两者不会降格成 missing、permission 或 IO。
bundled local factory 只接受绝对本地 path 或无 host 的 `file:` URL。
远端 backend 必须先在自己的 integration 中产生 runtime-branded `RecordStore`，不能把任意 URL
偷渡给 local factory。

`openRecord()` 与 `openRecordGraph()` 负责 empty、explicit graph 与 minimal-bootstrap failure。
`openRecordGraph()` 先比对 `ref.recordId` 与 bound Layout；不相等只会是
`record-graph-record-id-mismatch`。minimal bootstrap 的每个失败先按第一个不可继续的 component
定位。
它再归为 missing-object、corrupt、unsupported-digest、unsupported-schema 或
unsupported-capability，绝不合并成宽泛的 invalid。

lazy entity、stream、Claim、Provenance 与 decoder read 只会报告明确的失败 code。
它们是 missing-object、corrupt、unsupported-digest、unsupported-schema、
unsupported-capability、permission、unavailable、IO 或 resource-limit。

每个 resource-limit 都携带触发 walker 的 `limit: RecordWalkerResourceLimit` 与本次 `observed`。
open 还保留 bootstrap `component`、请求 `ref` 与可得 `object`。lazy read 保留可得 `ref`。
full verification 保留 `component` 与可得 `ref`。

full verification 在形成任何 backend path 前校验每个 descriptor 是否符合 format v1 固定的 SHA-256
编码与长度。其它算法只 reject `record-verification-unsupported-digest`，并保留首次遇到的
`component` 与完整 `ref`。它不是 `RecordGraphVerification { state: "invalid" }`、missing object、
corrupt 或 IO。

unknown payload 只要 core 与 strong closure 合法，`verifyRecordGraph()` 仍返回 valid。
直接解码它时是 `record-read-unsupported-schema` 或 `record-read-unsupported-capability`。
依赖它的 Projector 则由框架形成 unavailable。

所有 Record async iterator 都在首次 lazy read failure 后终止。该次 `next()` reject 唯一的
`RecordReadError`；此前已经 yield 的 value 继续有效，之后每次 `next()` 稳定返回
`{ done: true, value: undefined }`，不得重复同一错误。

`resolveAttempt()` 有两个顺序且不重叠的 error surface。parse locator、RecordHandle 的 runtime brand /
state 都属于 lookup surface；malformed、closed 或伪造 handle 只会是 `RecordLookupError`。

随后它经该 handle 的 read lease 遍历 locator radix。每个已读取 branch 或 leaf object 都必须验证；
这些 object 的 missing、corrupt、unsupported 或 permission 直接是 `RecordReadError`。
unavailable、IO 或 resource-limit 也属于同一 error family。其 `failure.operation` 固定为
`"resolve-attempt"`，不能解释为 not found。

全部已读取 index page 必须有效。canonical empty root、prefix mismatch、missing child 或
mismatched leaf 其中之一还必须证明 nonmembership。满足两项条件后，才以 `RecordLookupError` 的
`record-locator-not-found` reject。

找到 leaf 后，对
adopted Attempt 的读取、验证与 decode 仍是同一个 `RecordReadError` surface，operation 同样固定为
`"resolve-attempt"`。

已返回的 AttemptHandle 之后按需读取 Provenance、Observation 或 Claim 时，仍是各自的 lazy
`RecordReadError`，不会回写为 lookup failure。
`ambiguous-locator` 只存在于 CLI 搜索多个 explicit source 时。

## Runner 返回 receipt

正常 Runner 必须配置 RecordStore。
Invocation 建立前的发现、配置和 preflight 错误继续 reject typed error；建立后始终返回 `InvocationReceipt`。

```ts
type RecordWriteOperation =
  | "create-writer"
  | "begin-invocation"
  | "begin-run"
  | "reserve-attempt"
  | "write-observation"
  | "write-claim"
  | "adopt"
  | "finish"
  | "put-object"
  | "renew"
  | "commit"
  | "abort"
  | "dispose";

type RecordWriteFailure =
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-head-conflict";
      readonly expected: GraphRootRefV1 | null;
      readonly actual: GraphRootRefV1 | null;
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-id-mismatch";
      readonly expectedRecordId: string;
      readonly actualRecordId: string;
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-writer-busy";
      readonly openChildren: readonly string[];
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-writer-closed";
    })
  | (RecordFailureMeta<"finish" | "abort"> & {
      readonly code: "writer-terminal-intent-conflict";
      readonly frozen: "finish" | "abort";
      readonly requested: "finish" | "abort";
      readonly frozenParameters: JsonValue;
      readonly requestedParameters: JsonValue;
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-lease-lost";
      readonly transactionId: string;
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-graph-invalid";
      readonly violations: NonEmptyArray<RecordGraphViolation>;
    })
  | (RecordFailureMeta<"put-object"> & {
      readonly code: "record-typed-ref-byte-conflict";
      readonly ref: DescriptorV1;
    })
  | (RecordFailureMeta<"put-object"> & {
      readonly code: "record-digest-collision";
      readonly digest: DigestV1;
      readonly refs: readonly DescriptorV1[];
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-write-missing-object" | "record-write-unsupported-digest";
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-write-resource-limit";
      readonly limit: string;
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-write-permission-denied";
    })
  | (RecordFailureMeta<"dispose"> & {
      readonly code: "record-write-cleanup-failed";
    })
  | (RecordFailureMeta<RecordWriteOperation> & {
      readonly code: "record-write-unavailable" | "record-write-io-failure";
    });

type RecordCommit =
  | {
      state: "not-recorded";
      error: RecordWriteFailure;
    }
  | {
      state: "partial";
      graph: RecordGraphRef;
      error: RecordWriteFailure;
      durableThrough: {
        schema: string;
        value: JsonValue;
      };
    }
  | {
      state: "complete";
      graph: RecordGraphRef;
    };

class RecordWriteError extends Error {
  readonly failure: RecordWriteFailure;
  readonly commit:
    | Extract<RecordCommit, { state: "not-recorded" }>
    | Extract<RecordCommit, { state: "partial" }>;
}

interface AttemptReceipt {
  invocationId: string;
  originRunId: string;
  experimentId: string;
  attemptId: AttemptId;
  locator: AttemptLocator;
  evalId: string;
  ordinal: number;
  execution: "completed" | "abandoned";
  record: RecordCommit;
}

type AttemptReceiptSnapshot = Readonly<AttemptReceipt>;

interface RunReceipt {
  invocationId: string;
  runId: string;
  experimentId: string;
  completion: "completed" | "incomplete" | "interrupted";
  record: RecordCommit;
  attempts: readonly AttemptReceipt[];
}

interface InvocationReceipt {
  invocationId: string;
  completion: "complete" | "incomplete" | "interrupted";
  record: RecordCommit;
  runs: readonly RunReceipt[];
  terminalSnapshot: LiveSnapshot;
}
```

`not-recorded` 没有 GraphRef。
`partial` 暴露最后 durable revision 与具名 marker；`complete` 才承诺该 receipt scope 的 required facts 和终态关系都可验证。

`AttemptReceiptSnapshot` 与 `AttemptReceipt` 使用同一穷尽形状；名称只标记它在 Attempt 收尾时发出。
最终 Invocation receipt 可以为同一 attemptId 生成更完整的新值，不能原地修改已经发出的 snapshot。
snapshot 携带 Invocation、origin Run、Experiment 与 Eval 的窄身份，足以让 reporter 稳定分组。
Agent、model、配置与事实值不复制进 receipt；需要它们时按 record GraphRef 打开 Provenance 或运行 Projector。

Runner 的最终唯一返回是 InvocationReceipt。
attempt 结束时 reporter 收到 `AttemptReceiptSnapshot`；收尾重试可以让最终 receipt 中同一 Attempt 的状态更完整，但不能改写早期 snapshot。

```ts
interface Reporter {
  onRecord?(record: LiveRecord): void | Promise<void>;
  onAttemptReceipt?(receipt: AttemptReceiptSnapshot): void | Promise<void>;
  onInvocationReceipt?(receipt: InvocationReceipt): void | Promise<void>;
}
```

Reporter 消费同一 LiveRecord 或窄 receipt，不接收宽结果对象。
机器文件 reporter 保存 LiveRecord NDJSON 与末尾 InvocationReceipt，不维护第二套运行 schema。

## 高层 Record writer

`createRecordWriter` 是 Runner 和第三方 harness 的领域入口。
它接受已定的 Provenance、Observation、Claim 和 lifecycle 操作，内部生成 catalog、payload、strong edge 与 CAS revision。
调用方不能借它拼任意 Graph。

```ts
interface ProvenanceInput<T extends JsonValue = JsonValue> {
  mediaType: string;
  schema: string;
  value: T;
}

interface ObservationInput<T extends JsonValue = JsonValue> {
  binding: Pick<
    StreamBindingV1,
    "bindingId" | "role" | "requirement" | "streamId"
  >;
  event: Omit<
    ObservationEvent<T>,
    "stream" | "scope" | "transformations"
  >;
}

interface ClaimRef {
  record: RecordGraphRef;
  claimId: string;
  node: NodeRefV1;
}

interface RunContributionRef {
  record: RecordGraphRef;
  contributionId: string;
  membershipSlot: string;
  node: NodeRefV1;
  attempt: AttemptRef;
}

interface AttemptIdentity {
  attemptId: AttemptId;
  locator: AttemptLocator;
  originRunId: string;
  evalId: string;
  ordinal: number;
}

interface RecordWriterOptions {
  store: RecordStore;
  recordId: string;
  producer: {
    namespace: string;
    name: string;
    version: string;
  };
}

function createRecordWriter(options: RecordWriterOptions): RecordWriter;

declare const recordWriterBrand: unique symbol;
declare const invocationWriterBrand: unique symbol;
declare const runWriterBrand: unique symbol;
declare const attemptWriterBrand: unique symbol;

type RecordWriterState = "open" | "disposing" | "closed";
type ChildWriterState =
  | "open"
  | "terminal-intent-pending"
  | "terminal-checkpoint-complete"
  | "disposed";

interface RecordWriter extends AsyncDisposable {
  readonly [recordWriterBrand]: "niceeval.record-writer/1";
  readonly state: RecordWriterState;
  beginInvocation(input: {
    readonly invocationId: string;
  }): Promise<InvocationWriter>;
}

interface InvocationWriter extends AsyncDisposable {
  readonly [invocationWriterBrand]: "niceeval.invocation-writer/1";
  readonly state: ChildWriterState;
  beginRun(input: {
    readonly runId: string;
    readonly experimentId: string;
    readonly provenance: ProvenanceInput;
    readonly expectedMembershipSlots: readonly ExpectedMembershipSlotV1[];
  }): Promise<RunWriter>;
  finish(input: {
    readonly completion: "complete" | "incomplete" | "interrupted";
    readonly terminalSnapshot: LiveSnapshot;
  }): Promise<InvocationReceipt>;
  abort(input: {
    readonly reason: Claim;
    readonly terminalSnapshot: LiveSnapshot;
  }): Promise<InvocationReceipt>;
}

interface RunWriter extends AsyncDisposable {
  readonly [runWriterBrand]: "niceeval.run-writer/1";
  readonly state: ChildWriterState;
  reserveAttempt(input: {
    readonly attemptId?: AttemptId;
    readonly evalId: string;
    readonly ordinal: number;
    readonly provenance: ProvenanceInput;
  }): Promise<AttemptWriter>;
  adopt(input: {
    readonly membershipSlot: string;
    readonly mode: "carried" | "accepted" | "renamed";
    readonly attempt: AttemptRef;
    readonly basisClaims: readonly ClaimRef[];
  }): Promise<RunContributionRef>;
  observe(event: ObservationInput): Promise<void>;
  claim(claim: Claim): Promise<ClaimRef>;
  finish(input: {
    readonly completion: "completed" | "incomplete" | "interrupted";
  }): Promise<RunReceipt>;
  abort(input: { readonly reason: Claim }): Promise<RunReceipt>;
}

interface AttemptWriter extends AsyncDisposable {
  readonly [attemptWriterBrand]: "niceeval.attempt-writer/1";
  readonly state: ChildWriterState;
  readonly identity: AttemptIdentity;
  readonly locator: AttemptLocator;
  observe(event: ObservationInput): Promise<void>;
  claim(claim: Claim): Promise<ClaimRef>;
  finish(input: {
    readonly execution: "completed" | "abandoned";
    readonly membershipSlot: string;
    readonly terminalClaims: readonly ClaimRef[];
  }): Promise<AttemptReceiptSnapshot>;
  abort(input: {
    readonly membershipSlot: string;
    readonly terminalClaims: readonly ClaimRef[];
  }): Promise<AttemptReceiptSnapshot>;
}
```

首次 binding 一律使用 `expected: null` CAS，不提供 initialize-only API。并发首次写同一 recordId
时，失败 writer 读取 actual 后重建 revision；若 actual Record 的 identity 不同则是
`record-id-mismatch`。catalog 与 locator key 永不删除，只能新增或推进到已验证的 direct
successor。写入前遇到 digest collision 是 `record-digest-collision`，不会提交。

四个 writer 都是 runtime-branded `AsyncDisposable`。根 `RecordWriter` 只能经历
`open → disposing → closed`。其它 writer 可观察的状态只有 `open`、
`terminal-intent-pending`、`terminal-checkpoint-complete` 与 `disposed`。

每个 child 的首次 `finish()` 或 `abort()` 都在它的直接 parent 建立一条 parent-owned terminal
intent。intent 冻结 operation、完整 canonical 参数、最后 durable GraphRef 与独立 backend retain。
它的内部状态只有 `pending`、`durable` 与 `abandoned`，不作为另一个公共 writer 暴露。

同一活 wrapper 用相同 terminal 调用时：durable intent 幂等返回缓存的 immutable receipt；pending
intent 进行 reconciliation，并返回新的 immutable receipt snapshot。此前 receipt 从不原地修改。
不同 operation 或参数只以 `writer-terminal-intent-conflict` reject。

child wrapper dispose 只释放它自己的 local retain，并立即进入 `disposed`。它随后不能重试、不能
读取状态，也不能再次 terminal；这些调用都是 `record-writer-closed`。若它已有 pending intent，
该 intent 与其 staging retain 留在仍活着的直接 parent，绝不因 child dispose 取消。

父 `finish()` 与 `abort()` 先 reconcile 自己 ledger 中全部 pending child intent，包括 wrapper 已
disposed 的 child。open child wrapper 仍使父操作以 `record-writer-busy` reject；disposed child
不算 open。reconciliation 失败保留 ledger 与 frozen 参数，并传播对应的 `RecordWriteError` /
`RecordCommit`，供仍活着的父在同一 terminal intent 下重试。

只有持有该 ledger 的直接 parent 开始 close/dispose，才可以把尚未 durable 的 child intent 标成
`abandoned` 并释放其 retain。child 自己的 dispose、兄弟 writer 的 terminal，以及 GC 都不能丢弃
它。parent 的父若仍活着，parent 自己已经冻结的 terminal intent 继续由那个更高一级 ledger
持有。

根 writer 开始 dispose 时进入 `disposing`，停止创建 InvocationWriter，并处理它拥有的 child
ledger；结束后进入 `closed`。child dispose 不因 cleanup 失败恢复可用状态。释放 local retain 或
parent-owned retain 的 cleanup 失败只以 `record-write-cleanup-failed` 报告，未提交 staging 仍按
lease grace 交给 GC。

`InvocationWriter.finish()` 与 `InvocationWriter.abort()` 都把传入的 terminalSnapshot 冻结到
Invocation terminal intent。它原样写入形成的 `InvocationReceipt.terminalSnapshot`。
abort 不得从旧 snapshot、reason 或 Live channel 临时推导该字段。

Provenance 的 `mediaType + schema` 必须命中已注册 codec；codec 校验 value，并从该 schema 的具名引用形成 strong edge。
未知 codec 或 value 中未声明的引用返回 `record-graph-invalid`，不能按任意 JSON 落盘。

Observation writer 从所属 RunWriter 或 AttemptWriter 补入 scope，校验 binding 在同一 owner 内身份稳定，分配 sequence，再执行 serialization transformation。

`beginRun()` 把 `expectedMembershipSlots` 规范化后写入 Run revision 0；它不是 Sample 或 Reports 在读取
时补出的配置。数组按 membershipSlot UTF-8 bytes 排序且唯一。每个 membershipSlot 与 evalId 都必须
是非空 string。Run 的后继 revision 原样保留该数组。

`finish({ completion: "incomplete" | "interrupted" })` 可以在某个 expected slot 尚无 current
Contribution 时结束。该缺口会成为 Sample 的 authenticated `not-recorded` coverage，而不是从分母消失。

`completion: "completed"` 必须为每个 expected slot 提交 current Contribution，否则以完成不变量
失败。

`RunWriter.claim()` 与 `AttemptWriter.claim()` 分别补入 Run scope 与 Attempt scope；调用方提供完整 Claim id、evaluator、basis 与 producedAt。
carry、accept 与 rename 的依据先由同一个 `RunWriter` 写成 Run-scoped Claim，再把返回的 `ClaimRef` 传给 `adopt()`；不能用调用方自报的字符串或未提交 Claim 代替。

`reserveAttempt` 在返回前完成 identity reservation CAS。
因此调用方拿到 AttemptWriter 时，attemptId 与 locator 已经 durable，可以安全开始外部副作用。

`finish` 冻结 terminal intent 后关闭 required stream、写 terminal Claim、Attempt revision 和
`executed` Contribution，再形成 receipt snapshot。首次终态尚未 durable 时返回 partial 或
not-recorded；活 wrapper 可重试同一 intent，且其活着的直接 parent 也会在自己的 terminal
reconciliation 中继续它。其它写方法以 `RecordWriteError` reject；其 commit 保存同一范围最后一次
durable GraphRef，不能把已提交 checkpoint 表达成 not-recorded。

RunWriter 的 `adopt` 不复制 Attempt。
它校验 AttemptRef 的完整 RecordGraphRef、attemptId 与 adopted node，并形成带 basis Claim 的 Contribution。
AttemptRef 必须来自同一 recordId，且其 GraphRef 已登记在当前 Store 的 committedRoots。
跨 Record 输入只能进入显式 `MaterializedSample`，不能形成 Contribution 的跨 Store strong edge。

## 打开 Record

`createRecordStore(root)` 只创建未绑定 Record 的 Store marker 与 object namespace。
`openRecordStore(root)` 只重开已存在且 format 正确的 unbound 或 bound Store。
二者返回同一种 runtime-branded `RecordStore` capability，且都只会以 `RecordStoreError` reject。

`openRecord(store)` 在调用点固定 bound Layout 的 head。
unbound Store 以 `RecordOpenError` 的 `record-empty` reject。
`openRecordGraph(store, ref)` 固定调用方给出的 explicit revision。

两者都只做 Architecture 所列 minimal bootstrap，并返回 branded `AsyncDisposable` handle。
所有 child handle 固定同一 GraphRef。

```ts
function createRecordStore(
  root: string | URL,
): Promise<RecordStore>;

function openRecordStore(
  root: string | URL,
): Promise<RecordStore>;

function openRecord(
  store: RecordStore,
): Promise<RecordHandle>;

async function openRecordGraph(
  store: RecordStore,
  ref: RecordGraphRef,
): Promise<RecordHandle>;

function verifyRecordGraph(
  handle: RecordHandle,
): Promise<RecordGraphVerification>;

declare const recordHandleBrand: unique symbol;
type RecordCapabilityState = "open" | "closed";
type RecordHandleState = RecordCapabilityState;
interface RecordHandle extends AsyncDisposable {
  readonly [recordHandleBrand]: "niceeval.record-handle/1";
  readonly state: RecordHandleState;
  readonly ref: RecordGraphRef;
  readonly recordId: string;

  runs(): AsyncIterable<RunHandle>;
  attempts(): AsyncIterable<AttemptHandle>;
  resolveAttempt(locator: AttemptLocator): Promise<AttemptHandle>;

  project<Input extends JsonObject, Params extends JsonObject, T extends JsonValue>(
    attempt: AttemptRef | AttemptHandle,
    projector: AttemptProjector<Input, Params, T>,
    input?: Input,
  ): Promise<EvidenceValue<T>>;
}
```

活动 writer 更新 head 后，已打开 handle 不切换。需要当时 head 时重新 `openRecord(store)`；
需要复现 receipt、Sample 或 Report ref 时只用 `openRecordGraph(store, ref)`。

```ts
declare const recordSourceSetBrand: unique symbol;
declare const recordSourceReaderBrand: unique symbol;

type RecordSourceReaderState = RecordCapabilityState;

interface RecordSourceReader {
  readonly [recordSourceReaderBrand]: "niceeval.record-source-reader/1";
  readonly state: RecordSourceReaderState;
  readonly ref: RecordGraphRef;
  runs(): AsyncIterable<RunHandle>;
  attempts(): AsyncIterable<AttemptHandle>;
  resolveAttempt(locator: AttemptLocator): Promise<AttemptHandle>;
}

interface RecordSourceSet extends AsyncDisposable {
  readonly [recordSourceSetBrand]: "niceeval.record-source-set/1";
  readonly state: RecordCapabilityState;
  readonly refs: readonly [RecordGraphRef, ...RecordGraphRef[]];
  source(ref: RecordGraphRef): Promise<RecordSourceReader>;
}

function createRecordSourceSet(
  handles: readonly [RecordHandle, ...RecordHandle[]],
): Promise<RecordSourceSet>;
```

`createRecordSourceSet()` 只接受尚未 close 的 handle。它先以完整 GraphRef 的 JCS bytes 检查
重复输入，重复即为 `record-source-duplicate-ref`，不会静默 dedupe；随后才按同一 JCS UTF-8
bytes 排序。

每个 source fork 是 SourceSet 内部的一条固定 revision reader。SourceSet 是 retain owner：它为该
reader 持有 owner 为 `{ kind: "record-source-reader", ref }` 的 backend retain。`source()` 返回该
reader 的 borrowed、runtime-branded view。view 不能 dispose，也不取得自己的 backend retain；它的
`state` 始终投影 SourceSet 的 state。SourceSet 只持这些 reader，不持 Projector registry 或 memo。

reader 返回的 RunHandle 与 AttemptHandle 也是 borrowed capability。它们以 SourceSet 作为 owner，
`state` 始终投影同一个 SourceSet；已经读取的 metadata 与领域 `lifecycle` 仍是普通 immutable value。

`source()`、reader 的 `resolveAttempt()`、iterator 与这些 child handle 的 lazy read 共享同一个
admission gate。runtime brand 先于 gate 验证。`source()` 在 gate 内检查 open state 和 ref
membership，并在那里线性化返回 borrowed view。

`resolveAttempt()` 与 child lazy read 在 gate 内取得 operation retain。`runs()` 与 `attempts()` 产生
iterable 时不取得 retain；其
`[Symbol.asyncIterator]()` 首次启动时在 gate 内取得 retain，并持有到 iterator complete、`return()`
或 `throw()`。

SourceSet close 在同一 gate 内把 state 线性化为 `closed`。之后不再接纳 operation retain；已经取得
retain 的 source operation 不被取消，完成后才释放 retain。close 在所有这类 retain 释放后再释放每条
内部 reader retain。reader 及其已返回 child handle 的 capability state 同时变为 `closed`；它不关闭
调用方原来的 RecordHandle。

brand 合法但 close 已线性化后，`source()` 与新的 `resolveAttempt()` 都 reject
`RecordSourceError { failure: { operation: "read-source", code: "record-source-closed" } }`。
尚未启动的 iterator 在首次启动时也产生同一个 failure。

已返回 RunHandle 或 AttemptHandle 在 close 之后开始的 lazy read reject
`RecordReadError { failure: { code: "record-read-closed", operation } }`。close 之前已在 gate 内取得
operation retain 的 child read 可以完成，并保留它原本的 `RecordReadError` 或成功结果。

gate 已通过后才发现 ref 不属于 SourceSet 时，failure 是 operation 为 `read-source` 的
`record-source-invalid-handle`。已验证 membership 对应的固定 revision 不存在时，failure 是
`record-source-missing`。reader 在取得 raw-object read lease 前的 permission、unavailable 或 IO failure
也走同一 `RecordSourceError` surface。

operation retain 已取得后，一旦实际调用 `readObject()`，对象失败只映射为 `RecordReadError`。
这包括 missing、corrupt、unsupported、permission、unavailable、IO 与 resource-limit。

`runs()` 或 `attempts()` 使用 operation `iterate`。source reader 的 locator traversal 使用
`resolve-attempt`。已返回 Handle 的后续 entity、stream、Claim 或 Provenance lazy read 使用各自的
read operation。它们不因 SourceSet 随后 close 而改写成 `RecordSourceError`。

因此 `exportSample()` 直接传播这个 read-source failure。Reports 仍把同一个 typed failure 包入自己的
export error，不能把它降格成 source 缺失或普通导出失败。

直接打开的 RecordHandle 在自身生命周期里用共享 atomic registry/memo 支持 nested project：同一
Handle、同一 `ProjectionIdentityV1` 只执行一次；同一 ID 的不同 Projector object 稳定失败。
不同 `exportReport` 建立相互隔离的 cross-source session，`exportSample` 不创建 projection
session。

`state` 是 RecordHandle、RunHandle 与 AttemptHandle 唯一的 capability state。RunHandle 与
AttemptHandle 的 owner 是创建它们的 RecordHandle 或 SourceSet。关闭 owner 会原子地使它派生的
child `state` 进入 `closed`；child 没有独立 dispose。

它们的 `lifecycle` 是已读取 Run 或 Attempt payload 的领域状态，关闭 capability 时不会改变。只读
metadata 可以保留为此前取得的普通值。后续 capability read 必须先检查 owner state，并经 owner 的
admission gate 取得 operation retain。

### Run、Contribution 与 Attempt handle

```ts
declare const runHandleBrand: unique symbol;
declare const attemptHandleBrand: unique symbol;

type RunLifecycle = "active" | "completed" | "incomplete" | "interrupted";
type AttemptLifecycle = "active" | "completed" | "abandoned";

interface RunHandle {
  readonly [runHandleBrand]: "niceeval.record-run-handle/1";
  readonly state: RecordCapabilityState;
  readonly record: RecordGraphRef;
  readonly node: NodeRefV1;
  readonly runId: string;
  readonly invocationId: string;
  readonly experimentId: string;
  readonly lifecycle: RunLifecycle;
  readonly expectedMembershipSlots: readonly ExpectedMembershipSlotV1[];
  contributions(): AsyncIterable<RunContributionHandle>;
}

interface RunContributionHandle {
  readonly record: RecordGraphRef;
  readonly node: NodeRefV1;
  readonly contributionId: string;
  readonly revision: number;
  readonly runId: string;
  readonly evalId: string;
  readonly membershipSlot: string;
  readonly mode: "executed" | "carried" | "accepted" | "renamed";
  readonly attempt: AttemptRef;
  readonly basisClaims: readonly ClaimRef[];
}

interface AttemptRef {
  record: RecordGraphRef;
  attemptId: AttemptId;
  locator: AttemptLocator;
  adopted: NodeRefV1;
}

interface AttemptHandle {
  readonly [attemptHandleBrand]: "niceeval.record-attempt-handle/1";
  readonly state: RecordCapabilityState;
  readonly ref: AttemptRef;
  readonly identity: AttemptIdentity;
  readonly originRunId: string;
  readonly lifecycle: AttemptLifecycle;
  provenance(): Promise<ProvenanceSet>;
  observations(): ObservationSet;
  claims(): Promise<ClaimSet>;
}

interface ProvenanceValue {
  mediaType: string;
  schema: string;
  value: JsonValue;
}

interface ProvenanceSet {
  readonly entries: readonly EvidenceValue<ProvenanceValue>[];
}

interface ClaimSet {
  readonly claims: readonly EvidenceValue<Claim>[];
}
```

Record 顶层 `attempts()` 返回该 Graph 中 catalog 的 current Attempt revision。
Contribution 的 `attempt` 返回采用时 revision；Sample、Report 与 carry 语义使用后者。
需要诊断迟到事实时，在明确打开的 GraphRef 上查询对应 catalog revision，不能偷偷替换既有
Contribution 或按时间挑 latest。

### 原始 Observation

```ts
interface ObservationSet {
  readonly streams: readonly ObservationStream[];
  events(options?: {
    bindingIds?: readonly string[];
    names?: readonly string[];
  }): AsyncIterable<ObservationRead>;
}

interface ObservationStream {
  readonly bindingId: string;
  readonly role: string;
  readonly requirement: "required-for-completion" | "supplemental";
  readonly streamId: string;
  readonly state: "open" | "closed" | "abandoned";
  readonly throughSequence: number | null;
}

type ObservationRead =
  | { state: "available"; event: ObservationEvent; evidence: EvidenceRef }
  | { state: "unavailable"; causes: NonEmptyArray<UnavailableCause> };
```

直接遍历服务脚本取证。
Report、`show` 和 `view` 使用 Projector，不按原始 event name 或 schema 分支。

## EvidenceValue：value 与 verification 两轴

```ts
type UnavailableCause =
  | { kind: "not-recorded"; evidence?: EvidenceRef }
  | { kind: "incomplete"; evidence: EvidenceRef }
  | { kind: "truncated"; evidence: EvidenceRef; selectors: readonly VersionedSelector[] }
  | { kind: "redacted"; evidence: EvidenceRef; selectors: readonly VersionedSelector[] }
  | { kind: "missing-object"; evidence: EvidenceRef }
  | { kind: "corrupt"; evidence: EvidenceRef }
  | { kind: "unsupported-digest"; evidence: EvidenceRef }
  | { kind: "unsupported-schema"; evidence: EvidenceRef }
  | { kind: "unsupported-capability"; evidence: EvidenceRef }
  | { kind: "permission-denied"; evidence: EvidenceRef }
  | { kind: "resource-limit"; evidence?: EvidenceRef };

type VerificationIssue =
  | Exclude<UnavailableCause, { kind: "not-recorded" }>
  | { kind: "basis-unavailable"; evidence: EvidenceRef };

type Verification =
  | { state: "full"; issues: readonly [] }
  | {
      state: "limited" | "unverified";
      issues: NonEmptyArray<VerificationIssue>;
    };

declare const evidenceValueBrand: unique symbol;

type EvidenceValue<T extends JsonValue = JsonValue> =
  | {
      readonly [evidenceValueBrand]: "niceeval.evidence-value/1";
      state: "available";
      value: T;
      basedOn: readonly EvidenceRef[];
      verification: Verification;
      sourceTrust?: SourceTrust;
    }
  | {
      readonly [evidenceValueBrand]: "niceeval.evidence-value/1";
      state: "unavailable";
      causes: NonEmptyArray<UnavailableCause>;
      basedOn: readonly EvidenceRef[];
      sourceTrust?: SourceTrust;
    };

interface SourceTrust {
  readonly producer?: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
  };
  readonly receipt?: RecordGraphRef;
  readonly attestations?: readonly DescriptorV1[];
}
```

这个 private brand 只由 Record framework 安装。调用方能判别和读取 EvidenceValue，但不能把普通
JSON、UnavailableCause 或手写 basedOn 伪造成结果。

所有 causes 与 issues 都保留。
UI 可以使用稳定主因顺序，但不能丢弃其它原因：

```text
corrupt
missing-object
unsupported-digest
unsupported-schema
unsupported-capability
permission-denied
redacted
truncated
incomplete
resource-limit
not-recorded
```

映射规则：

- value 从未采集时是 unavailable not-recorded；
- Projector 需要终态，而 stream 未完成时是 unavailable incomplete；
- prefix-safe Projector 可以返回 available + limited；
- transformation 删除必要输入时是 unavailable truncated 或 redacted；
- 已建立 handle 后，ACL 拒绝某个必要 evidence object 时是 unavailable permission-denied，不能伪装成 not-recorded；
- 剩余内容足以求值时是 available + limited；
- Claim value 已读出，但 basis 无法复核时仍是 available + unverified；
- Claim node 自身缺失或损坏时才让 value unavailable。

renderer 只展示 EvidenceValue，不重做这些判断。
`verification: "full"` 只相对调用方接受的 GraphRef 表示本次 basis 完整；succinct proof 也可以
是 full。
EvidenceValue 始终只有 value availability 与 basis verification 两轴。
producer identity、receipt 和 attestation 只作为独立 `SourceTrust` metadata，不进入
VerificationIssue，也不增加第三条 verification 轴。

## 追踪式 Projector

公开 Projector 只能通过 `defineAttemptProjector` 构造。
`projectNormalized` 不能直接访问 AttemptHandle、Store 或对象查找接口，只能使用 `ProjectionReadContext`。

```ts
interface ProjectorId {
  namespace: string;
  name: string;
  version: string;
}

type ProjectorParameterNormalization<Params extends JsonObject> =
  | {
      readonly state: "success";
      readonly parameters: Params;
    }
  | {
      readonly state: "invalid";
      readonly issues: NonEmptyArray<ProjectorInputIssue>;
    };

interface ProjectorParameters<
  Input extends JsonObject,
  Params extends JsonObject,
> {
  readonly schema: string;
  readonly defaults: Params;
  normalize(input?: Input): ProjectorParameterNormalization<Params>;
}

declare const attemptProjectorBrand: unique symbol;

type AnyAttemptProjector = AttemptProjector<
  JsonObject,
  JsonObject,
  JsonValue
>;

interface AttemptProjectorDefinition<
  Input extends JsonObject,
  Params extends JsonObject,
  T extends JsonValue,
> {
  readonly id: ProjectorId;
  readonly parameters: ProjectorParameters<Input, Params>;
  readonly dependencies?: readonly AnyAttemptProjector[];
  projectNormalized(
    ctx: ProjectionReadContext,
    parameters: Params,
  ): Promise<T>;
}

interface AttemptProjector<
  Input extends JsonObject,
  Params extends JsonObject,
  T extends JsonValue,
> {
  readonly [attemptProjectorBrand]: "niceeval.attempt-projector/1";
  readonly id: ProjectorId;
  readonly parameterSchema: string;
  readonly dependencies: readonly AnyAttemptProjector[];
}

function defineAttemptProjector<
  Input extends JsonObject,
  Params extends JsonObject,
  T extends JsonValue,
>(
  definition: AttemptProjectorDefinition<Input, Params, T>,
): AttemptProjector<Input, Params, T>;
```

`projectNormalized` 只能返回 `Promise<T>`。作者不能构造 `EvidenceValue`、unavailable 或
`basedOn`；正常 `T` 由框架包装为 available，读取无法满足时也只能由框架包装为 unavailable。
`T` 是 Projection payload，不能用长得像 EvidenceValue 的 JSON 代替框架语义。

`normalize()` 是同步的 Result protocol。它只能返回 `success` 或 `invalid`；前者交出完整
canonical parameters，后者使 `RecordHandle.project()` reject `ProjectorInputError`。normalizer 不以
throw 或自由文本表示输入错误。

参数 normalizer 必须：

1. 纯确定，不读取时间、宿主运行条件、文件或网络；
2. 拒绝未知字段；
3. 在 `success` 前用 `defaults` 填满全部规范化参数；
4. 为每个 `invalid` result 提供至少一个结构化 issue；
5. 对无参数 Projector 在 success 中返回规范值 `{}`；
6. 经过统一 canonical validate、JCS encode/decode 成 plain JSON 后 deep-freeze。

parameter schema 或 normalization 语义变化必须提升 Projector version。
第三方 namespace 使用 npm package name 或受控绝对 URI；内建 namespace 为 `niceeval`。

定义的 input、defaults、schema、version 与 memo identity 共同闭合 Projector identity。每个
`projectNormalized` result 和 nested result `T` 同样先 canonical validate、JCS encode/decode 为
plain JSON，再 deep-freeze 后才进入 memo 或返回调用方。

`dependencies` 是 Projector object，不是 ID 字符串。definition 省略它时按空数组处理；构造器先
验证所有 branded object、复制完整数组并执行 DFS，最后 deep-freeze 该副本。调用方之后修改输入
数组不能增加、移除或替换依赖。

错误归属按阶段互斥。definition 阶段只负责无效 object dependency 或依赖图 cycle。
registry registration 阶段只负责同一完整 ID 的不同 object。author execution 阶段只负责向
`ctx.project()` 传入未声明的 object dependency。相同故障不会在两个 family 或两个阶段重复报告。
session 在执行作者函数前注册 root 的完整依赖闭包；`ctx.project()` 先做 exact object membership
检查，再决定是否调用已注册 dependency。因此 duplicate 不会落入 undeclared dependency。

```ts
class ProjectorDefinitionError extends Error {
  readonly code:
    | "projector-definition-invalid"
    | "projector-schema-invalid"
    | "projector-defaults-invalid"
    | "projector-dependency-invalid"
    | "projector-dependency-cycle";
  readonly id?: ProjectorId;
}

type ProjectorInputIssueCode =
  | "input-not-object"
  | "unknown-field"
  | "invalid-field"
  | "normalization-result-invalid"
  | "normalization-not-object"
  | "normalization-noncanonical";

type ProjectorInputExpected =
  | { readonly kind: "object" }
  | { readonly kind: "known-field" }
  | { readonly kind: "schema-rule"; readonly id: string }
  | { readonly kind: "normalization-result" }
  | { readonly kind: "plain-json-object" }
  | { readonly kind: "canonical-json" };

interface ProjectorInputIssue {
  readonly code: ProjectorInputIssueCode;
  readonly path: readonly (string | number)[];
  readonly expected?: ProjectorInputExpected;
}

class ProjectorInputError extends Error {
  readonly code: "projector-input-invalid";
  readonly id: ProjectorId;
  readonly schema: string;
  readonly issues: NonEmptyArray<ProjectorInputIssue>;
  readonly cause: unknown | null;
}

class ProjectorRegistrationError extends Error {
  readonly code: "projector-registration-invalid" | "duplicate-projector-id";
  readonly id?: ProjectorId;
}

class ProjectorReadError extends Error {
  readonly code: "projector-read-unavailable" | "projector-read-io-failure";
  readonly retryable: boolean;
  readonly cause: unknown;
}

class ProjectorExecutionError extends Error {
  readonly code:
    | "projector-normalization-threw"
    | "projector-execution-failed"
    | "projector-undeclared-dependency"
    | "projector-result-not-json";
  readonly cause: unknown;
}
```

`ProjectorInputError.issues` 永不为空，按 path 的 JCS UTF-8 bytes、再按 code 稳定排序。
`expected` 是封闭结构；`schema-rule.id` 是该 parameter schema 发布的稳定 rule ID，不是 validator
message。调用方只依赖 `code`、`path` 和该结构显示或测试输入错误。

framework 会验证 returned Result。`invalid` 的 issues 为空或本身不符合这个 union 时，framework 以唯一的
`{ code: "normalization-result-invalid", path: [] }` issue reject。

`success` 的 parameters 不是 plain object 时，framework 使用 `normalization-not-object`。它不是
canonical JSON 时，framework 使用 `normalization-noncanonical`。

任意从 `normalize()` 抛出的值只有一个映射：`ProjectorExecutionError`
`{ code: "projector-normalization-threw", cause }`。它不会转抄 thrown Error 的文本，也不会伪装成
`ProjectorInputError` 或 unavailable。

definition、input、registration、read 与 execution 是五个不重叠的 Projector error family。
unexpected user code 只成为 `ProjectorExecutionError`，不能伪装成 unavailable。

`RecordHandle.project()` 的入口和后续阶段固定如下：

| 阶段 | 唯一 owner 与结果 |
|---|---|
| RecordHandle runtime brand / open state | `RecordProjectError`: `record-project-record-invalid-handle` 或 `record-project-record-closed` |
| AttemptHandle runtime brand / open state，或 AttemptRef 的 shape 与本 Graph membership | `RecordProjectError`: `record-project-attempt-invalid-handle` 或 `record-project-attempt-closed` |
| Attempt 的完整 `RecordGraphRef` 不等于 handle 的固定 ref | `RecordProjectError`: `record-project-attempt-record-mismatch` |
| root dependency closure 的 runtime brand 与同 ID object registration | `ProjectorRegistrationError` |
| normalizer returned invalid Result 或规范化结果无效 | `ProjectorInputError` |
| normalizer throw，或作者函数 / result 的执行错误 | `ProjectorExecutionError` |
| 已验证事实不足、损坏、权限受限或 resource limit | framework 形成 `EvidenceValue` unavailable / limited |
| 读取期间 backend unavailable 或 IO | `ProjectorReadError` |
| 已进入 read 的 capability 被撤销、操作遭拒或 auth session 失效 | `RecordReadError` |

project 先完成前三行，再验证并登记整个 Projector closure，最后才运行 normalizer。它不重新执行
locator lookup，因而不会在这条入口泄漏 `RecordLookupError`。AttemptHandle 关闭只表示其 owner
RecordHandle 已关闭；AttemptRef 是数据值，没有独立 close，但必须属于这个固定 GraphRef。

已建立 handle 后，ACL 拒绝某个必要 evidence object 时，读取形成带 `permission-denied` 的
`EvidenceValue`。
capability 无效、操作本身无权或认证会话失效只 reject `RecordReadError`。`RecordOpenError` 只属于
`openRecord()` 与 `openRecordGraph()` 的最小 bootstrap，已建立 handle 的任何 lazy read 都不能返回它。
backend unavailable 与 IO 只 reject `ProjectorReadError` 并保留 retryable。
瞬时基础设施故障绝不进入历史 EvidenceValue。

`projectNormalized` 在运行后产出非 JsonValue 时，是 `ProjectorExecutionError` 的
`projector-result-not-json`。definition error 只负责 definition、schema、defaults 与静态
dependency object/cycle 的错误。参数形状与 normalize 结果只属于 `ProjectorInputError`。

### ProjectionReadContext

```ts
declare const trackedRead: unique symbol;
declare const trackedOptionalRead: unique symbol;

interface Tracked<T> {
  readonly value: T;
  readonly [trackedRead]: true;
}

type TrackedOptional<T> =
  | {
      readonly state: "present";
      readonly value: T;
      readonly [trackedOptionalRead]: true;
    }
  | {
      readonly state: "absent";
      readonly [trackedOptionalRead]: true;
    };
interface StreamBindingSelector {
  bindingIds?: readonly string[];
  roles?: readonly string[];
  requirements?: readonly (
    | "required-for-completion"
    | "supplemental"
  )[];
}

interface ProjectionReadContext {
  identity(): Promise<Tracked<AttemptIdentity>>;
  provenance(
    selector?: VersionedSelector,
  ): Promise<Tracked<ProvenanceValue>>;
  claims(
    filter: VersionedSelector,
    selector?: VersionedSelector,
  ): Promise<Tracked<readonly Claim[]>>;
  events(
    binding: StreamBindingSelector,
    filter: VersionedSelector,
    selector?: VersionedSelector,
  ): Promise<Tracked<readonly ObservationEvent[]>>;
  object<T>(
    ref: NodeRefV1,
    selector?: VersionedSelector,
  ): Promise<Tracked<T>>;
  optionalObject<T>(
    ref: NodeRefV1,
    selector?: VersionedSelector,
  ): Promise<TrackedOptional<T>>;
  require<T>(value: TrackedOptional<T>): Promise<Tracked<T>>;
  project<Input extends JsonObject, Params extends JsonObject, T extends JsonValue>(
    projector: AttemptProjector<Input, Params, T>,
    input?: Input,
  ): Promise<Tracked<EvidenceValue<T>>>;
}
```

每次成功、缺失或失败读取都由框架把 EvidenceRef、selector、membership、absence 与 verification issue
写入内部 trace。
Projector 作者不能手写、删除或替换 basedOn。identity、Provenance、历史 Claim 与 nested
Projector 的 trace 都进入同一有序去重链。

`Tracked<T>` 的 `.value` 是已验证的读取值；两个 unique-symbol 品牌阻止调用方伪造 wrapper。
`TrackedOptional<T>` 只公开 `present`、`absent` 与 present value，不公开单数 evidence；框架内部
仍保存完整、有序的 basis trace。框架在 context promise settle 时登记 trace，因此解构、筛选或
组合 `.value` 不会丢失已经发生的读取。`ctx.require()` 把 authenticated absence 规范化为
unavailable，作者不能自行伪造 causes。

必要读取失败时，context promise reject 框架内部的 `ProjectionReadFailure`。
`defineAttemptProjector` 边界独占地把它转成带全部 cause 的 unavailable `EvidenceValue`。
Projector 不能捕获后丢弃这种失败。允许缺失的 object 内 selector 必须使用 `optionalObject()`；一般
Claim/Observation filter 没有 optional absence API。

`optionalObject(ref)` 只在 object 内 selector 已验证缺失时返回 absent。
ref target 缺失或 digest 损坏是 corrupt read，不是 absence。

v1 不公开一般性的 `optionalClaims()` 或 `optionalEvents()`。`claims(filter)` 为验证列表完备性而遍历
固定 Graph 的完整 Claim catalog；`events(binding, filter)` 遍历所选 stream index 承诺的完整 prefix。
空数组是这些已追踪扫描的普通结果，不是调用方伪造的 absent。closed stream 能证明终局完备；open
stream 只能证明固定 revision 的 prefix，依赖未来不再追加的 Projector 必须得到 incomplete。

`ctx.project()` 只能调用 definition 冻结的 `dependencies` 数组中同一个 Projector object。未声明
nested dependency 只在 author execution 阶段以 `ProjectorExecutionError` 的
`projector-undeclared-dependency` reject；动态分支没有触发 cycle 也不能放宽声明。

外部业务数据必须先 snapshot 成 Record evidence。
Projector 内的网络、当前时间、随机数和任意文件读取都不属于 conforming API。

### Projection identity 与 memo

memo identity 是以下结构化元组的 JCS digest：

```ts
interface ProjectionIdentityV1 {
  record: RecordGraphRef;
  attemptId: AttemptId;
  adopted: NodeRefV1;
  projector: ProjectorId;
  parameterSchema: string;
  normalizedParameters: JsonObject;
}
```

identity 不拼字符串，也不能用 recordId 或 attemptId 代替完整 GraphRef 与 adopted node。
缓存只活在 registry + RecordHandle 生命周期；nested memo 同时缓存 value 和完整 trace。

内建 Projector 至少包括：

```ts
execution;
timing;
trace;
usage;
diff;
assertions;
verdict;
```

它们各自定义需要终态还是允许 prefix、哪些 transformation 会阻断求值，以及返回值的独立语义版本。

## Sample、Report 与交付物边界

Sample 选择固定 GraphRef 中的 current RunContribution，并把 AttemptRef 的 adopted node 保留下来。
多 Record 组合只接受 `MaterializedSample`；选择和冲突规则见 [Sample](../sample/library.md)。

`exportSample(sample, { sources, target })` 写独立 SampleBundle Store。
`sources` 必须是显式传入的 `RecordSourceSet`，不能从 sample、target 或全局状态隐式取得。
`openSampleBundle(source, ref)` 只能读取 bundle 已复制的成员、coverage 和证据，不能重新运行 Record 的 current 选择。

Reports owner 的 `exportReport` 也必须在其输入中显式接收 `RecordSourceSet`。
Record 不定义 Reports 的其它输入字段或输出形状。

```ts
function exportSample(
  sample: MaterializedSample,
  input: {
    readonly sources: RecordSourceSet;
    readonly target: SampleBundleStore;
  },
): Promise<SampleBundleRef>;

function openSampleBundle(
  source: SampleBundleStore,
  ref: SampleBundleRef,
): Promise<SampleBundle>;
```

```ts
type MirrorSnapshotSourceComponent =
  | "layout"
  | "committed-roots"
  | "head-membership";

type RecordMirrorSnapshotFailure =
  | (RecordFailureMeta<"capture-mirror-snapshot"> & {
      readonly code: "mirror-snapshot-source-empty";
    })
  | (RecordFailureMeta<"capture-mirror-snapshot"> & {
      readonly code: "mirror-snapshot-source-closed";
    })
  | (RecordFailureMeta<"capture-mirror-snapshot"> & {
      readonly code: "mirror-snapshot-source-permission-denied";
    })
  | (RecordFailureMeta<"capture-mirror-snapshot"> & {
      readonly code: "mirror-snapshot-source-unavailable" | "mirror-snapshot-source-io-failure";
    })
  | (RecordFailureMeta<"capture-mirror-snapshot"> & {
      readonly code:
        | "mirror-snapshot-source-unsupported-digest"
        | "mirror-snapshot-source-unsupported-schema"
        | "mirror-snapshot-source-unsupported-capability";
      readonly component: MirrorSnapshotSourceComponent;
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<"capture-mirror-snapshot"> & {
      readonly code: "mirror-snapshot-source-corrupt";
      readonly component: MirrorSnapshotSourceComponent;
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<"parse-mirror-snapshot"> & {
      readonly code: "mirror-snapshot-malformed";
      readonly value: unknown;
      readonly issue: "shape" | "jcs" | "field";
    })
  | (RecordFailureMeta<"parse-mirror-snapshot"> & {
      readonly code: "mirror-snapshot-identity-invalid";
      readonly value: unknown;
    });

type MirrorTargetPhase = "read-layout" | "verify" | "copy" | "bind";
type MirrorSourcePhase = "verify" | "copy";
type MirrorSourceComponent =
  | "committed-roots"
  | "graph-root"
  | "record-lineage"
  | "strong-closure";

type RecordMirrorFailure =
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-snapshot-invalid";
      readonly snapshot: RecordMirrorSnapshotV1;
      readonly issue: "generation" | "lineage" | "committed-roots" | "identity";
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-snapshot-not-committed";
      readonly snapshot: RecordMirrorSnapshotV1;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-target-bound";
      readonly target: LayoutV2;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-target-corrupt";
      readonly component:
        | "layout"
        | "committed-roots"
        | "graph-root"
        | "strong-closure";
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-target-closed";
      readonly phase: MirrorTargetPhase;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-target-permission-denied";
      readonly phase: MirrorTargetPhase;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-target-unavailable" | "mirror-target-io-failure";
      readonly phase: MirrorTargetPhase;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-target-resource-limit";
      readonly phase: MirrorTargetPhase;
      readonly limit: RecordWalkerResourceLimit;
      readonly observed: number;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-source-corrupt";
      readonly component: MirrorSourceComponent;
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-source-closed" | "mirror-source-permission-denied";
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-source-unavailable" | "mirror-source-io-failure";
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-source-resource-limit";
      readonly phase: MirrorSourcePhase;
      readonly limit: RecordWalkerResourceLimit;
      readonly observed: number;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code:
        | "mirror-source-unsupported-digest"
        | "mirror-source-unsupported-schema"
        | "mirror-source-unsupported-capability";
      readonly component: MirrorSourceComponent;
      readonly ref?: DescriptorV1;
    })
  | (RecordFailureMeta<"mirror"> & {
      readonly code: "mirror-target-initialize-conflict";
      readonly expected: null;
      readonly actual: LayoutV2;
    });

class RecordMirrorSnapshotError extends Error {
  readonly failure: RecordMirrorSnapshotFailure;
}
class RecordMirrorError extends Error {
  readonly failure: RecordMirrorFailure;
}

function captureRecordMirrorSnapshot(
  source: RecordStore,
): Promise<RecordMirrorSnapshotV1>;

function parseRecordMirrorSnapshot(
  value: unknown,
): RecordMirrorSnapshotV1;

function mirrorRecord(
  source: RecordStore,
  target: RecordStore,
  input: { readonly snapshot: RecordMirrorSnapshotV1 },
): Promise<RecordGraphRef>;
```

| 入口 | 只会失败为 |
|---|---|
| `captureRecordMirrorSnapshot()` | `RecordMirrorSnapshotError` |
| `parseRecordMirrorSnapshot()` | `RecordMirrorSnapshotError` |
| `mirrorRecord()` | `RecordMirrorError` |

capture 只创建有 bound source 的 typed snapshot。source empty、closed、permission、unavailable、
IO、unsupported 与 corrupt 各有一个 `RecordMirrorSnapshotFailure` discriminant；它们绝不借用
`RecordMirrorError`。parse 只做 token 语法、JCS 与 identity 检查，也只抛同一个 snapshot Error。

`mirrorRecord()` 只接受已经由 capture 或 parse 得到的 typed snapshot，绝不再解读 unknown value，
所以不会抛 `RecordMirrorSnapshotError`。调用方用不安全断言伪造 token 时，镜像阶段只报告 typed
`mirror-snapshot-invalid`。

每个 mirror code 先由可观察阶段和 typed 条件确定；继承的 `cause` 只保留底层诊断，不能代替
discriminant 或产生 unknown failure。

令牌自身 generation、谱系或 committed-root tree 矛盾是 `mirror-snapshot-invalid`；语法自洽但不在
源端 committed 谱系中是 `mirror-snapshot-not-committed`。其它 `RecordMirrorFailure` 的互斥归类
如下：

| code | 唯一适用条件 |
|---|---|
| `mirror-target-bound` | 目标端已 bound，但规范 Layout 不等于令牌 |
| `mirror-target-corrupt` | 规范 Layout 等于令牌，但目标端 closure 的 descriptor、byte、edge 或 membership 无效 |
| `mirror-target-closed`、`mirror-target-permission-denied`、`mirror-target-unavailable`、`mirror-target-io-failure` | target 在 `phase` 所示操作不可用；copy/bind 也归 target，绝不使用宽泛 copy 或 commit 失败 |
| `mirror-target-resource-limit` | target 在 `phase` 所示操作超过统一 walker budget；携带越界的 `limit` 与 `observed` |
| `mirror-source-corrupt` | 源端 committed roots、graph root、lineage 或 strong closure 无效或缺对象 |
| `mirror-source-closed`、`mirror-source-permission-denied`、`mirror-source-unavailable`、`mirror-source-io-failure` | 未绑定目标路径中源端实际访问的明确失败 |
| `mirror-source-resource-limit` | source 在 `verify` 或 `copy` 超过统一 walker budget；携带越界的 `limit` 与 `observed` |
| `mirror-source-unsupported-*` | source 的 core 或 closure 需要当前 capability 不支持的 digest、schema 或 capability |
| `mirror-target-initialize-conflict` | 已完成 copy 后，首次 `expected: null` 原子绑定遇到另一个 writer 的 bound Layout |

两端的 resource-limit 都使用 [Architecture 定义的 `RecordWalkerResourceLimit`](architecture.md#strong-closure)。
`phase` 标识哪个端的哪个镜像步骤触发上限；`limit` 是对象数、深度或累计 raw bytes 的统一 budget，
`observed` 是本次 traversal 的实际值。mirror 不另立一套同名或隐式 quota，也不把这个错误压成
unavailable 或 IO。

镜像不接受 evidence 允许列表，且 `mirrorRecord` 没有省略 snapshot 的重载。它按
[Architecture 的目标优先顺序](architecture.md#完整镜像与选择性证明)工作，
同一 Store 也不享有特别 code。选择事实子集使用 exportSample；生成呈现交付物使用
[Reports 的 exportReport](../reports/library.md)。

Reports 固定为计划、数据、渲染三阶段。
计算与页面只消费已经求值的 EvidenceValue 或普通 Projection，不能打开 Record 发起计划外查询。

## 读取示例

```ts
import { join } from "node:path";
import {
  builtins,
  openRecord,
  openRecordGraph,
  openRecordStore,
} from "niceeval/record";

const root = join(process.cwd(), ".niceeval");
await using store = await openRecordStore(root);
await using headAtOpen = await openRecord(store);
const attempt = await headAtOpen.resolveAttempt(
  "@01J8ZK3M6P4T7V9X2C5N8QW0RY",
);

const verdict = await headAtOpen.project(attempt, builtins.verdict);

if (verdict.state === "available") {
  console.log(verdict.value, verdict.verification);
} else {
  console.error(verdict.causes);
}

await using sameRevision = await openRecordGraph(store, headAtOpen.ref);
```

这个脚本固定一次 head，并让 Projector 自动交代依据。
需要逐事件取证、跨 Record 去重或构建站点时，分别进入 [脚本审计](use-case/audit-from-script.md)、[Sample](../sample/README.md) 与 [Reports](../reports/README.md)。
