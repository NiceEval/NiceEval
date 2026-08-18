# Experiment 展示名称 —— Library

## 作者输入与规范化输出

`displayName` 与 `description` 是 `ExperimentPresentationInput` 的两个独立字段。
该 interface 由 `defineExperiment()` 输入继承。
它不重述执行配置字段。

```ts
declare const ExperimentDisplayNameTypeId: unique symbol;

type ExperimentDisplayName = string & {
  readonly [ExperimentDisplayNameTypeId]: true;
};

interface ExperimentPresentationInput {
  readonly displayName?: string;
  readonly description?: string;
}

interface ResolvedExperimentPresentation {
  readonly experimentId: ExperimentId;
  readonly displayName: ResolvedExperimentDisplayName;
  readonly description?: string;
}

type ResolvedExperimentDisplayName =
  | { readonly source: "authored"; readonly value: ExperimentDisplayName }
  | { readonly source: "experiment-id"; readonly value: ExperimentId };

interface ExperimentOutputFieldsV1 {
  readonly experimentId: ExperimentId;
  readonly displayName: string;
}

type ExperimentPresentationError = {
  readonly code: "experiment-display-name-invalid";
  readonly reason:
    | "empty"
    | "leading-or-trailing-whitespace"
    | "control-character"
    | "too-long"
    | "invalid-unicode";
};

declare const experimentDisplayName: (
  input: string,
) => Either.Either<ExperimentDisplayName, ExperimentPresentationError>;
```

作者显式给出的 `displayName` 必须是单行 Unicode scalar text，长度为 1 至 160 UTF-8 bytes。
它不能有 leading 或 trailing whitespace、C0、C1、U+2028 或 U+2029。
`description` 保持自己的定义说明语义，不作为 `displayName` 的默认值。

校验保留 exact scalar sequence，不做 Unicode normalization。它按以下优先级只返回一个 reason：

1. unpaired surrogate 产生 `invalid-unicode`；
2. 空 string 产生 `empty`；
3. C0、C1、U+2028 或 U+2029 产生 `control-character`；
4. 首尾含 ECMAScript `String.prototype.trim` 字符集合中的任一字符，产生 `leading-or-trailing-whitespace`；
5. UTF-8 编码超过 160 bytes 产生 `too-long`。

discovery 为每个 Experiment 规范化得到一个 `ResolvedExperimentPresentation`。
若输入省略 `displayName`，规范化值使用 `{ source: "experiment-id", value: experimentId }`；
完整 ID 不受作者名称的 160 bytes、空白或控制字符 refinement 限制。
`ExperimentOutputFieldsV1` 总是输出两个字符串字段。

## identity 隔离

`experimentId` 由路径形成。
`displayName` 和 `description` 不进入以下任何值：

- Experiment ID、selector、Run Core 或 Member relation；
- input identity、config identity、Eligibility 或 `ExecutionReusePlan`；
- budget domain、并发限制、sharedState key、Sandbox pair 或 lifecycle；
- Record source identity 中这个 presentation 字段自身的编码。

执行字段若明确读取了同一个 JavaScript 常量，其求值结果仍按原有配置 identity 规则处理。
上述隔离只排除 `displayName` 与 `description` 字段本身，不能隐藏真实执行条件。

重复展示名称合法。
数组、JSON 与列表的规范顺序始终按 `experimentId`，不按展示文本或 description 排序。
展示名称不提供唯一性依据，也不能转换为 selector。

## Run 快照与交接边界

新 Run 写入自己的 presentation Attachment。
它只保存规范化后的展示值和对 Core identity 的交叉校验，不拥有 identity 或 description。

```ts
interface ExperimentPresentationAttachmentV1 {
  readonly experimentId: ExperimentId;
  readonly displayName: string;
}
```

`niceeval.experiment-presentation` 是 Run-owned RecordAttachment，envelope 的 `schemaVersion` 为 `1`。
writer 验证 Attachment 的 `experimentId` 与同一 Run Core 完全相等。
`displayName` 必须来自已校验的 authored brand，或与同一 Core 的完整 `experimentId` 完全相等。
它不参与 Analysis denominator、source barrier 或 reuse。

`InvocationReceipt` 不指向 Experiment；它是 Run publication 的终态交接值。
它只保留既定的 `invocationId`、canonical published `runIds`、`startedAt`、可选 `completedAt` 与 `completion`。

因此 terminal JSON receipt 缺少 Experiment presentation 不是例外或缺字段：它的 `runIds` 是唯一身份集合，不复制 Attempt、Verdict、Usage、cost、Report 聚合或展示名称。
需要名称映射的机器表面是 exp plan、运行事件与 Run-owned Attachment；Analysis 的
[`experimentPresentationView`](../../analysis/library.md#experiment-presentation-domainview)把所选 Run 的快照关闭成 Report summary。

## 旧 Run、迁移与生产入口验收

新 writer 必须在 seal transaction 中写入 `niceeval.experiment-presentation`；缺少该 family 时拒绝发布 Run。
任一已发布 Run 缺少该 family 时，reader 都进入 `fallback-missing`，使用完整 `experimentId` 作为展示名称。
Record v1 没有 family inventory，因此 reader 无法区分较早 writer 的省略与发布后的删除；两者使用同一缺失语义。
fallback 不读取当前 Experiment 源码，也不把 description 写回 Run。

unsupported 或 invalid Attachment 进入 `unavailable`，以完整 ID 保留身份文本并报告局部问题。
Record root/Core 失败、已知 family 的 migration-required，以及 I/O 或 open 失败会阻断 Analysis/Report；它们不能
伪装成 `fallback-missing` 或 `unavailable`。
新 Attachment 不要求 Record Core major migration。

删除把展示名称写入 Invocation receipt、identity、selector 或 reuse 输入的路径。
receipt consumer 继续按既定 receipt 契约消费 canonical published `runIds`；其它机器表面按各自 schema version 分流，不按字段存在性猜版本。

生产验收包含显式名称、缺失名称、重复名称、published Run fallback、unavailable、阻断错误和
displayName-only 改动后的 carried Run。
验收使用公开 CLI/E2E 旅程，不新增 Eval Assertion。
