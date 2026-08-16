# Record 库存

`niceeval exp` 的 Run 交接已经由现行 [InvocationReceipt](../../feature/experiments/cli.md#结束反馈与-receipt) 完成。
本方向只补齐 receipt 交付前进程退出时的只读库存，让操作者从 frozen Record snapshot 找回已经发布的 Run。
它不选择分析对象、不推导最新结果，也不创建第二份运行结果。

## `niceeval record list` 的 Record 库存

唯一 grammar 为：

```sh
niceeval record list [--record <root>] [--json]
```

该命令只读一个 frozen Record snapshot。
它只枚举带 `complete` 的 candidate，不显示、warning 或问题化未发布 draft。
它不接受 `--experiment`、时间、状态、`--limit`、`--run` 或其它选择参数。
它不创建 Sample，不推导 newest/latest，也不调用 Analysis 或 Report。

`--dry` 不存在；传入它或任何 grammar 外输入都是 usage error。
命令不写 audit、缓存、receipt、运行时观测或其它 durable 内容。

### JSON 形状

JSON stdout 是一个 canonical JSON document。
顶层 document 是封闭 discriminated union：成功时为 snapshot，无法形成 root 级读取边界时为 global failure。

```ts
import type { RunId } from "niceeval/record";

type RecordInventoryCoreIssue =
  | { readonly code: "candidate-run-id-invalid" }
  | { readonly code: "candidate-run-id-duplicate" }
  | { readonly code: "run-core-document-invalid" }
  | { readonly code: "run-core-reference-invalid" }
  | { readonly code: "candidate-read-failed" };

type RecordInventoryProvenanceIssue =
  | { readonly code: "run-provenance-missing" }
  | { readonly code: "run-provenance-envelope-invalid" }
  | { readonly code: "run-provenance-payload-invalid" }
  | { readonly code: "run-provenance-closure-invalid" }
  | { readonly code: "run-provenance-invocation-id-invalid" }
  | { readonly code: "run-provenance-migration-required" }
  | { readonly code: "run-provenance-migration-unavailable" }
  | { readonly code: "run-provenance-schema-unsupported" };

type RecordInventoryIssue =
  | RecordInventoryCoreIssue
  | RecordInventoryProvenanceIssue;

type NonEmptyIssues<T> = readonly [T, ...T[]];

type RecordInventoryInvocation =
  | {
      readonly state: "available";
      readonly invocationId: string;
    }
  | {
      readonly state: "unavailable";
      readonly issues: NonEmptyIssues<RecordInventoryProvenanceIssue>;
    }
  | {
      readonly state: "migration-required";
      readonly from: string;
      readonly to: string;
      readonly command: "niceeval migrate";
      readonly issues: NonEmptyIssues<RecordInventoryProvenanceIssue>;
    }
  | {
      readonly state: "migration-unavailable";
      readonly from: string;
      readonly to: string;
      readonly issues: NonEmptyIssues<RecordInventoryProvenanceIssue>;
    }
  | {
      readonly state: "unsupported";
      readonly schemaId: string;
      readonly issues: NonEmptyIssues<RecordInventoryProvenanceIssue>;
    }
  | {
      readonly state: "invalid";
      readonly issues: NonEmptyIssues<RecordInventoryProvenanceIssue>;
    };

type RecordInventoryEntry =
  | {
      readonly kind: "published";
      readonly runId: RunId;
      readonly startedAt: string;
      readonly completedAt: string;
      readonly invocation: RecordInventoryInvocation;
    }
  | {
      readonly kind: "core-invalid";
      readonly candidateRunId?: RunId;
      readonly issues: NonEmptyIssues<RecordInventoryCoreIssue>;
    };

interface RecordInventoryProblem {
  readonly candidateRunId?: RunId;
  readonly issue: RecordInventoryIssue;
}

type RecordInventoryGlobalFailure =
  | { readonly code: "record-root-missing" }
  | { readonly code: "record-maintenance-busy" }
  | { readonly code: "record-migration-required" }
  | { readonly code: "record-migration-interrupted" }
  | { readonly code: "record-format-unsupported" }
  | { readonly code: "record-root-read-failed" }
  | { readonly code: "record-root-permission-denied" };

type RecordListDocumentV1 =
  | {
      readonly format: "niceeval.record-list";
      readonly schemaVersion: 1;
      readonly kind: "snapshot";
      readonly entries: readonly RecordInventoryEntry[];
      readonly problems: readonly RecordInventoryProblem[];
    }
  | {
      readonly format: "niceeval.record-list";
      readonly schemaVersion: 1;
      readonly kind: "global-failure";
      readonly failure: RecordInventoryGlobalFailure;
    };
```

`RecordInventoryCoreIssue` 与 `RecordInventoryProvenanceIssue` 是全部公开局部 issue code。
它们不携带 directory 名、path、原始 I/O 文字或其它私有 entry identity。

snapshot 的每个 complete candidate 恰形成一个 entry。
Core 可读时交付 `published`，其中始终有 `runId`、`startedAt`、`completedAt` 与 invocation union。
mandatory run-provenance 可读时，`invocation` 为 `available` 并带 `invocationId`。

Core 无效的 complete candidate 交付 `core-invalid`，不会被静默隐藏。
可构造的 public RunId 放入 `candidateRunId`；不能构造时省略该字段。
所有 Core issue 同时写入 entry 的 `issues` 与 snapshot 的 `problems`。

provenance 失败不移除 `published` entry 的 `runId`、`startedAt` 或 `completedAt`。
它以 invocation union 的对应 state 和非空 closed issues 交付；issues 也逐项出现在 snapshot 的 `problems`。

### 排序、可读输出与退出码

`published.runId` 与有 `candidateRunId` 的 `core-invalid` entry 按 `compareRunIdCanonicalBytes` 排序。
没有 `candidateRunId` 的 `core-invalid` entry 排在有 ID entry 之后。
它们按已排序 issue code 序列的 canonical bytes 排序，不使用私有目录名作为排序键。
结构上相同的两个无 ID entry 在 JSON 中不可区分，因此互换次序不改变 canonical value。

`problems` 先按可用 `candidateRunId` 排序，再按其 closed issue code 的 canonical bytes 排序。
缺少 `candidateRunId` 的问题排在有 ID 问题之后，仍只按公开 issue code 排序。
entries 与 problems 都不按时间排序，也不截断。

人类输出逐行显示每个 complete candidate。
它显示 published entry 的 Run ID、开始和完成时间，以及 invocationId 或其不可用状态。
它也显示全部 `core-invalid` entry 与全部局部问题；没有 `candidateRunId` 时明确写成“Run ID 不可用”。

只有 `published` entry 的 Run ID 组成可复制的下一步命令。
命令只重复 `--run`，不含任何 selector、`--latest` 或时间条件：

```text
niceeval show --run 01H... --run 01J...
niceeval view --run 01H... --run 01J...
```

| 退出码 | 条件 |
| --- | --- |
| 0 | 已形成 snapshot；任何局部 problems 都保留在成功 document 中。 |
| 1 | 形成 global read failure；JSON 输出唯一的 global-failure document。 |
| 2 | grammar、未知参数或任何选择参数错误，包括 `--dry`。 |

### Snapshot、并发与幂等

Record 库存以一次 FrozenRecordView 建立读边界。
每个 Run 在 `complete` 创建时线性化；库存要么看见完整 published Run，要么完全不看见它。
与库存并发的 publication 若发生在该 snapshot 边界之前，Run 必须出现。
若 publication 发生在边界之后，该 Run 只会出现在下一次库存读取。

局部 candidate 的 Core 或 provenance 损坏保留为 entry 与 problem，不扩大为 root failure。
无法形成 root 级 frozen snapshot 才是 global failure。

对同一 frozen snapshot 重复调用具有幂等结果：相同 entries、相同 problems、相同排序。
库存本身不取得 writer ownership，不发布 Run，也不写入 audit trail。

## 非目标与硬边界

本方向不新增 Eval Assertion。
它不让 Sample、Analysis、Report 或 selector 承担 Record 库存或 stranded Run 恢复。
它不提供按 Experiment、Run、状态或时间缩小 Record 库存的参数。

`--latest` 与 `latest-runs` 不属于本方向的命令 grammar 或选择模型。
本契约不定义 alias、fallback 或并存语义。

## DX 与 frog

frog 只保存可复现的 DX 摩擦条目，不是 receipt、Record 库存或审计数据的 owner。
这项 DX 的证据是正常 Invocation 的完整交接，以及强杀后按 invocationId 找回 stranded Run。
命令本身不创建、更新或依赖 frog 条目。

## 验收 owner 与生产可观察结果

验收 owner 是真实 CLI E2E，不新增 Eval Assertion。
E2E 必须验证下列可观察结果：

- 正常 `niceeval exp` 的人类输出和 NDJSON receipt 都交接本次全部 published Run ID；receipt 是最后且唯一的 terminal event。
- 受控失败与中断仍交付先前 published ID，且 receipt 不改变原 Invocation 退出码。
- 在 `complete` 创建后、receipt 交付前强杀进程；Record 库存以 `available` invocationId 显示该 stranded Run。
- complete candidate 的 Core 无效时仍有 `core-invalid` entry、可用的 candidateRunId 与全部 closed issues。
- run-provenance 不可用、需要 migration、不可 migration、unsupported 或 invalid 时，published entry 保留 Run identity，并交付对应 invocation state 与 problems。
- 未发布 draft 不出现在 entries 或 problems；`--experiment`、时间、状态、`--limit`、`--run`、`--dry` 与其它选择输入全部以 exit 2 拒绝。
- 与 publication 并发的库存只暴露完整、去重且按 canonical bytes 排序的 snapshot；重复读取不产生任何 Record 或 audit 写入。

生产验收以终端文本、canonical JSON、退出码和重开 Record 后的可读取 Run 为证据。
不得依赖目录时间、进程内状态、隐式选择或未公开的存储格式读取。
