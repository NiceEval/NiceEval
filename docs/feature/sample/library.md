# Sample —— Library

Sample 是已经生成的选择值。它只引用 Record 已经提交的事实；Attempt、Contribution、EvidenceValue、Graph 与 membership proof 的类型都由 [Record](../record/library.md) owner 定义。

本页是 Sample 的唯一公开类型 owner。Reports 只消费这里的 `MaterializedSample`、`SampleRef` 与 coverage，不重建它们。

## Record-owned 输入

以下类型不在 Sample 重复声明：

- [`RecordHandle`、`RecordGraphRef` 与 `RecordSourceSet`](../record/library.md#打开-record)；
- [`AttemptRef` 与 `RunContributionHandle`](../record/library.md#runcontribution-与-attempt-handle)；
- [`EvidenceRef`、`EvidenceValue`、`UnavailableCause` 与 `NonEmptyArray`](../record/library.md#evidencevaluevalue-与-verification-两轴)；
- [`EntityMembershipProofV1`](../record/architecture.md#merkle-entity-catalog)；
- [`RecordEvidenceProofIndexRefV1` 与 `RecordEvidenceProofError`](../record/architecture.md#完整镜像与选择性证明)。

`RunContributionHandle` 已经含有 `node`、`contributionId`、`revision`、`runId`、`evalId`、`membershipSlot`、`mode` 与完整 `AttemptRef`。Sample 只引用这个 owner shape，绝不摘抄出第二个 Contribution 接口。

```ts
import type {
  AttemptRef,
  EntityMembershipProofV1,
  EvidenceRef,
  ExpectedMembershipSlotSelectorV1,
  NodeRefV1,
  NonEmptyArray,
  RecordEvidenceProofError,
  RecordEvidenceProofIndexRefV1,
  RecordEvidenceRegistryInput,
  RecordGraphRef,
  RecordHandle,
  RecordReadError,
  RecordSourceError,
  RecordSourceSet,
  RunContributionHandle,
  UnavailableCause,
} from "niceeval/record";
```

## 选择器、source 集合与 `SampleRef`

```ts
interface SampleSelection {
  readonly runs?: readonly string[];
  readonly evals?: readonly string[];
  readonly experiments?: readonly string[];
}

interface SampleSelector {
  readonly runs?: readonly string[];
  readonly evals?: readonly string[];
  readonly experiments?: readonly string[];
}

type SampleSources = readonly [RecordGraphRef, ...RecordGraphRef[]];

declare const sampleDigestBrand: unique symbol;

type SampleDigest = string & {
  readonly [sampleDigestBrand]: "sha256-lowercase-64";
};

interface SampleRef {
  readonly schema: "niceeval.sample-ref/1";
  readonly digest: SampleDigest;
}

function parseSampleDigest(value: string): SampleDigest;
```

`SampleSelection` 作用于固定 source Graph 的 current Run 与其 durable expected membership slot；
`SampleSelector` 只筛选 Sample denominator 中已经固定的 slot。两者都只做 exact string match，不做
prefix、glob、大小写折叠或 locator 推断。单个字段内是 OR，不同字段间是 AND；字段省略表示该维度
全部匹配。它们拒绝未知字段，数组去重后按每个 string 的 JCS UTF-8 bytes 升序；空数组规范化为省略
字段。selector string 没有命中是合法的空选择，不是输入错误。两者都不是任意回调。

`SampleSources` 必须非空。实现逐个对完整 `RecordGraphRef` 做 JCS，删除相同 canonical bytes 的重复项，再按这些 UTF-8 bytes 升序排列。这个顺序是 identity 的一部分，不能按 Store head、路径或调用顺序排列。

`SampleDigest` 的唯一合法字节形态是 `sha256:` 加 64 个小写十六进制字符。`parseSampleDigest()` 与所有 Bundle decoder 都拒绝其它算法、长度、大写字符和非十六进制字符；branded string 只防止 TypeScript 侧误传，不能替代运行时检查。

`SampleRef` 只能由 `materializeSample()`、`narrowSample()`、`unionSamples()` 或经过完整校验的
`openSampleBundle()` 产生。精确 digest preimage 在[构造入口](#materializedsample-与构造入口)定义；
调用方不能手工伪造 ref。

## 成员、address 与 member identity

```ts
interface SampleMembershipAddressV1 {
  readonly schema: "niceeval.sample-membership-address/1";
  readonly recordId: string;
  readonly runId: string;
  readonly membershipSlot: string;
}

interface SampleMembershipSlotV1 {
  readonly schema: "niceeval.sample-membership-slot/1";
  readonly source: RecordGraphRef;
  readonly address: SampleMembershipAddressV1;
  readonly run: {
    readonly node: NodeRefV1;
    readonly experimentId: string;
  };
  readonly evalId: string;
}

interface SampleMemberIdentityV1 {
  readonly schema: "niceeval.sample-member-identity/1";
  readonly source: RecordGraphRef;
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly contribution: RunContributionHandle;
  readonly attempt: AttemptRef;
}

interface SampleMembershipProofV1 {
  readonly schema: "niceeval.sample-membership-proof/1";
  readonly run: {
    readonly node: NodeRefV1;
    readonly catalog: EntityMembershipProofV1;
  };
  readonly contribution: {
    readonly catalog: EntityMembershipProofV1;
    readonly edgeOrdinalFromRun: number;
  };
  readonly adoptedAttempt: {
    readonly edgeOrdinalFromContribution: number;
  };
}

interface SampleMembership {
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly identity: SampleMemberIdentityV1;
  readonly contribution: RunContributionHandle;
  readonly attempt: AttemptRef;
  readonly membershipProof: SampleMembershipProofV1;
}
```

address 的逻辑身份固定为 `recordId + runId + membershipSlot` 的 JCS 结构，不能字符串拼接。它只用于识别同一逻辑 membership，不是完整成员 identity。

`SampleMembershipSlotV1` 是 denominator row 的完整 identity，即使 current Contribution 尚不存在也能
成立。它保存完整 source Graph、逻辑 address、current Run node、experimentId 与 expected evalId。
materializer 只能从该 Run payload 的 `expectedMembershipSlots` 形成它，不能从 Experiment 配置、Eval
registry 或调用时数组补猜。

member identity 的 `source` 是完整 `RecordGraphRef`，`slot` 是上述完整 slot identity。
`contribution` 直接使用 Record-owned `RunContributionHandle`，因此 JCS 同时纳入其 node、
contributionId、revision、run、eval、slot、mode、Attempt 与 basis Claim。`attempt` 是同一个完整
`AttemptRef`，含完整 Graph、AttemptId、locator 与 adopted node。

跨 Store 或 Bundle 验证不能使用 JavaScript 引用相等。实现必须分别比较 `identity.source`、`identity.address`、`identity.contribution`、`identity.attempt` 与 membership 对应对象的 JCS canonical bytes。

比较后还必须逐字段复核 Record owner 不变量：

- slot.source、identity.source、contribution 的完整 `record` 与 Attempt 的完整 `record` 都相等；
- membership.address、identity.address 与 slot.address 的 JCS bytes 相同；address 的 recordId、runId、
  membershipSlot 分别等于 source.recordId 与 contribution 的 owner 字段；
- slot.run.node 解码为 current Run payload；其 runId 与 address.runId 相同，experimentId 与
  slot.run.experimentId 相同；
- 该 Run 的 expectedMembershipSlots 中恰有一项同时匹配 address.membershipSlot 与 slot.evalId；
- contribution 的 node、contributionId、revision、runId、evalId、membershipSlot、mode、basisClaims 与 adopted Attempt 全部来自同一 `RunContributionHandle`；
- contribution.evalId 必须等于 slot.evalId；
- contribution 的完整 AttemptRef 与 membership attempt 的 JCS bytes 相同；
- `membershipProof.run.catalog` 验证 source catalog、`kind: "run"`、runId、leaf 与 `slot.run.node`；
- `membershipProof.contribution.catalog` 验证同一 source catalog、`kind: "contribution"`、
  contributionId、leaf 与 contribution node。Run GraphNode 在 `edgeOrdinalFromRun` 的 strong edge
  必须是该 membershipSlot 的 current Contribution；
- Contribution GraphNode 在 `edgeOrdinalFromContribution` 的 strong edge 必须使用
  `niceeval.contribution-adopted-attempt`，并指向 membership 的 `attempt.adopted`。

两个 catalog proof 的 `source` 必须逐字等于 member identity source；各 proof 的 key preimage、leaf
owner 与 entity edge 都由 Record owner 规则复算。两个 ordinal 都必须是对应 canonical GraphNode
dependency page chain flatten 后的有效无符号整数。relation、ordinal、target 与 payload item 必须满足 Record 的
Run / Contribution edge layout。这样 Bundle verifier 不需要 source Store，也不能从 runId 或数组位置
补猜 strong path。

adopted Attempt 不要求是 source catalog 的 current Attempt。Contribution 保存采用时 revision；离线
verifier 通过已认证 Contribution 的 `niceeval.contribution-adopted-attempt` edge 与归档 object 验证它。
catalog 后来推进到同 attemptId 的新 revision，不改变既有 Sample membership。

这样使用 Record owner 的字段和 proof，而不复制它们的类型。

不同 logical address 的成员永远不同，即使它们采用同一个 Attempt。同一 address 但完整 member identity 不同，包含 source Graph、Contribution revision 或 adopted node 不同的情形，默认是 conflict。

## coverage 与 derivation provenance

```ts
interface SampleIncludedMember {
  readonly state: "included";
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly membership: SampleMembership;
}

interface SampleExcludedMember {
  readonly state: "excluded";
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly membership?: SampleMembership;
  readonly selectors: readonly [SampleSelector, ...SampleSelector[]];
}

interface SampleUnavailableMember {
  readonly state: "unavailable";
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly membership?: SampleMembership;
  readonly causes: NonEmptyArray<UnavailableCause>;
  readonly basedOn: readonly EvidenceRef[];
}

type SampleCoverageMember =
  | SampleIncludedMember
  | SampleExcludedMember
  | SampleUnavailableMember;

interface SampleCoverage {
  readonly denominator: readonly SampleCoverageMember[];
  readonly included: readonly SampleIncludedMember[];
  readonly excluded: readonly SampleExcludedMember[];
  readonly unavailable: readonly SampleUnavailableMember[];
}

type SampleConflictPolicy = "error" | "keep-first" | "keep-last";

interface SampleCoverageIdentityV1 {
  readonly schema: "niceeval.sample-coverage-identity/1";
  readonly slot: SampleMembershipSlotV1;
  readonly member: SampleMemberIdentityV1 | null;
}

interface SampleConflictResolution {
  readonly address: SampleMembershipAddressV1;
  readonly candidates: readonly [
    SampleCoverageIdentityV1,
    SampleCoverageIdentityV1,
    ...SampleCoverageIdentityV1[],
  ];
  readonly selected: SampleCoverageIdentityV1;
  readonly policy: Exclude<SampleConflictPolicy, "error">;
}

type SampleProvenance =
  | {
      readonly kind: "materialized";
      readonly source: RecordGraphRef;
      readonly selection: SampleSelection;
    }
  | {
      readonly kind: "narrowed";
      readonly parent: SampleRef;
      readonly selector: SampleSelector;
    }
  | {
      readonly kind: "union";
      readonly inputs: readonly [SampleRef, ...SampleRef[]];
      readonly conflictPolicy: SampleConflictPolicy;
      readonly resolutions: readonly SampleConflictResolution[];
    };
```

`denominator` 是本次选择必须交代的完整、有序 slot 集合。每个 address 在其中恰好出现一次；每项
address 与 slot.address 必须相等。denominator 按 address 的完整 JCS UTF-8 bytes 升序。

`included`、`excluded` 与 `unavailable` 是 denominator 按 state 形成的三个互斥、保序子序列。三者
合起来恰好等于 denominator；不得只给一个计数。

`members` 必须逐项等于 `coverage.included.map(item => item.membership)`，并保持同序。成员不能从其它
输入产生。coverage item 带 membership 时，item 的 address/slot 还必须分别与
membership.address/slot 的 JCS bytes 相等。

excluded 项保留完整 slot、可取得的 membership，以及所有造成排除的规范化 `SampleSelector`。
selectors 按完整 JCS bytes 去重升序且非空。

unavailable 项保留完整 slot、全部 causes 与 basedOn。能取得 membership 时也保留完整 membership 与
`SampleMembershipProofV1`。causes 与 basedOn 分别按完整 JCS bytes 去重升序。不得用 `null`、零值或
单一主因代替。

`SampleProvenance` 是 derivation 的规范 spine；union 的分支历史只通过 input SampleRef 承诺，不内联
input provenance。materialized 项保存 source 与规范化 `SampleSelection`；narrowed 项保存 parent ref 与
selector；union 项保存输入 ref、policy 与每次非默认选择的 resolution。

外层 provenance 保留 derivation 顺序；union 的 `inputs` 与 `resolutions` 分别按各项 JCS bytes
升序。resolution candidates 是同一 logical address 下至少两项唯一的 `SampleCoverageIdentityV1`，
并按 JCS bytes 排序。selected 必须恰好是其中一项。materialized、narrowed、union 三种 kind 不能混同。

外层数组的唯一构造方程如下：

| operation | 输出 `provenance` |
|---|---|
| `materializeSample()` | 恰为 `[materializedEntry]` |
| `narrowSample(parent, selector)` | 恰为 `[...parent.provenance, narrowedEntry]` |
| `unionSamples(inputs, policy)` | 恰为 `[unionEntry]` |

unionEntry.inputs 从全部已验证 input 的 `identity` 取得。实现先检查相同 digest 是否对应不同 preimage；
若是，返回 `sample-digest-collision`。随后才按完整 SampleRef JCS bytes 去重升序。重复传入同一 Sample
只在 inputs 中保留一次；即使去重后只有一项，union 仍产生上述单项 union provenance，而不是返回原
Sample 或内联其历史。unionEntry 位于 index 0，不能在前后拼接任一 input provenance。之后再 narrow
时，只能按表中方程把 narrowedEntry 追加到该单项后。

## `MaterializedSample` 与构造入口

```ts
declare const materializedSampleBrand: unique symbol;

interface MaterializedSample {
  readonly [materializedSampleBrand]: "niceeval.materialized-sample/1";
  readonly identity: SampleRef;
  readonly sources: SampleSources;
  readonly members: readonly SampleMembership[];
  readonly coverage: SampleCoverage;
  readonly provenance: readonly [SampleProvenance, ...SampleProvenance[]];
}

interface SampleDigestPreimageV1 {
  readonly schema: "niceeval.sample-digest-preimage/1";
  readonly sources: SampleSources;
  readonly members: readonly SampleMembership[];
  readonly coverage: SampleCoverage;
  readonly provenance: readonly [SampleProvenance, ...SampleProvenance[]];
}

interface SampleInputIssue {
  readonly path: readonly (string | number)[];
  readonly code:
    | "not-object"
    | "unknown-field"
    | "not-array"
    | "item-not-string"
    | "empty-string";
  readonly expected: string;
  readonly actualKind: string;
}

interface MaterializedSampleIssue {
  readonly path: readonly (string | number)[];
  readonly code:
    | "invalid-brand"
    | "invalid-ref"
    | "not-jcs-value"
    | "digest-mismatch"
    | "non-canonical-order"
    | "source-mismatch"
    | "membership-invariant"
    | "coverage-partition"
    | "provenance-invalid";
  readonly expected: string;
}

/** The only runtime-validation failure for a caller-supplied MaterializedSample. */
interface SampleValidationFailure {
  readonly code: "sample-invalid";
  readonly issues: NonEmptyArray<MaterializedSampleIssue>;
}

class SampleValidationError extends Error {
  readonly failure: SampleValidationFailure;
  constructor(failure: SampleValidationFailure);
}

function validateMaterializedSample(value: unknown): MaterializedSample;

type SampleConstructionFailure =
  | {
      readonly code: "sample-selection-invalid";
      readonly operation: "materialize";
      readonly issues: NonEmptyArray<SampleInputIssue>;
    }
  | {
      readonly code: "sample-selector-invalid";
      readonly operation: "narrow";
      readonly issues: NonEmptyArray<SampleInputIssue>;
    }
  | {
      readonly code: "sample-record-invalid-handle";
      readonly operation: "materialize";
    }
  | {
      readonly code: "sample-record-closed";
      readonly operation: "materialize";
    }
  | {
      readonly code: "sample-invalid";
      readonly operation: "narrow";
      readonly issues: NonEmptyArray<MaterializedSampleIssue>;
    }
  | {
      readonly code: "sample-invalid";
      readonly operation: "union";
      readonly inputIndex: number;
      readonly issues: NonEmptyArray<MaterializedSampleIssue>;
    }
  | {
      readonly code: "sample-union-input-invalid";
      readonly operation: "union";
      readonly issue:
        | "samples-not-array"
        | "empty-input"
        | "invalid-conflict-policy";
      readonly actualKind: string;
    }
  | {
      readonly code: "sample-union-conflict";
      readonly operation: "union";
      readonly address: SampleMembershipAddressV1;
      readonly candidates: readonly [
        SampleCoverageIdentityV1,
        SampleCoverageIdentityV1,
        ...SampleCoverageIdentityV1[],
      ];
    }
  | {
      readonly code: "sample-digest-collision";
      readonly operation: "union";
      readonly digest: SampleDigest;
      readonly inputIndexes: readonly [number, number, ...number[]];
    };

class SampleConstructionError extends Error {
  readonly failure: SampleConstructionFailure;
  constructor(failure: SampleConstructionFailure);
}

function materializeSample(
  source: RecordHandle,
  selection: SampleSelection,
): Promise<MaterializedSample>;

function narrowSample(
  sample: MaterializedSample,
  selector: SampleSelector,
): MaterializedSample;

function unionSamples(
  samples: readonly [MaterializedSample, ...MaterializedSample[]],
  conflictPolicy?: SampleConflictPolicy,
): MaterializedSample;
```

`SampleDigestPreimageV1` 是 `SampleRef` 的唯一 digest preimage。实现先显式构造这个对象；
`identity`、runtime brand、对象原型与任何缓存都不在 preimage 中。`sources` 按完整 GraphRef 的 JCS
bytes 排序，coverage.denominator 按 address JCS bytes 排序，三个 coverage partition 保持 denominator
子序列；`members` 恰为 included membership 的同序映射。provenance 保留 derivation 顺序。其余对象
key 由 JCS 排序。

实现对 `SampleDigestPreimageV1` 执行 RFC 8785 JCS，以无 BOM 的 UTF-8 编码得到唯一 bytes，再计算
SHA-256。`SampleRef.digest` 是 `sha256:` 与 32-byte digest 的 64 位小写十六进制表示拼接而成。
decoder 必须重建同一 preimage、逐字节复核 canonical bytes 并重新计算 digest。

`MaterializedSample` 是 runtime-branded、canonical-copy 后 deep-freeze 的值。`narrowSample()` 与
`unionSamples()` 先检查 brand，再复核完整结构、不变量、canonical order 与 digest；普通对象即使
字段看似相同也是 `invalid-brand`。`openSampleBundle()` 只有在验证持久化 payload 后才安装 brand，
因此离线重开不会放宽这条边界。

`validateMaterializedSample()` 是这条 runtime 边界的唯一公开入口。它先验证 Sample 自己的 runtime
brand。

它逐项复核 canonical plain-JCS structure、sources/member/coverage/provenance 的顺序与不变量。
随后从唯一 preimage 重算 identity digest。

成功时只返回原来的 canonical、frozen value。它不会为普通对象补装 brand、canonical-copy 或修复字段。
任一失败都只 throw `SampleValidationError`，其 `failure.code` 恒为 `sample-invalid`。
`issues` 必须非空并按 path、再按 code 的 UTF-8 bytes 稳定排序。

所有接收 caller-supplied `MaterializedSample` 的边界都必须先调用这个 Sample-owned validator，不能
另写一套字段级校验。

特别是 Reports 在 `plan()`、`aggregate()` 或 `exportReport()` 读取 sample 的任一字段前必须调用它。
失败时把同一个 `SampleValidationError` 及未改写的 `failure` 作为 Reports-owned typed failure 的 cause
包装。Reports 不得把伪造 Sample 当作空 Sample、零 coverage 或普通 unavailable，也不得自行判定哪个
字段损坏。

`narrowSample()` 与 `unionSamples()` 保留 `SampleConstructionError` 的 operation-specific
`sample-invalid` failure，供其各自的输入位置与 `inputIndex` 表达。
它们使用同一组 `MaterializedSampleIssue` 语义，但不把构造期 failure 改写成
`SampleValidationError`。

`SampleConstructionError` 是三个构造入口自己的穷尽输入 failure。issues 先按 path，再按 code 的
UTF-8 bytes 稳定排序；它们不使用自由文本充当判别依据。

| 入口 | `SampleConstructionFailure` |
| --- | --- |
| `materializeSample()` | `sample-selection-invalid`、`sample-record-invalid-handle`、`sample-record-closed` |
| `narrowSample()` | `sample-selector-invalid`、`sample-invalid` |
| `unionSamples()` | `sample-union-input-invalid`、`sample-invalid`、`sample-union-conflict`、`sample-digest-collision` |
| `validateMaterializedSample()` | `SampleValidationError`：`sample-invalid` |

selection / selector 只接受 plain object 与 `runs`、`evals`、`experiments` 三个字段。字段值必须是
string 数组；每项必须是非空 string。未知字段、错误容器、错误 item 类型与空 string 都进入对应
typed issue。重复项去重，空数组规范化为省略字段，这两种情况不是错误。

`materializeSample()` 先校验 selection，再检查 Record runtime brand 与 lifecycle。伪造对象、其它
capability kind 或缺少真实 brand 是 `sample-record-invalid-handle`；只有 Record create/open 返回后
进入 closed lifecycle 的真实 handle 才是 `sample-record-closed`。两者互斥。

brand 与 lifecycle 校验完成后，Record entity、stream、Claim、Provenance 或 iterator 的实际 lazy
read failure 直接传播 Record-owned `RecordReadError`。Sample 不捕获、包装或改写其
`RecordReadFailure`。若 handle 在 preflight 之后并发 close，由 Record 读取入口的原子 lifecycle
检查裁决；若实际读取报告 `record-read-closed`，它仍作为 `RecordReadError` 直接传播。

`materializeSample()` 的 `sources` 恰有一项：传入 handle 的完整 `source.ref`。handle 已经固定到一个
Graph；函数不接受单独的 `RecordGraphRef`，因为 ref 是 identity，不是读取 capability。

materialization 的 selection 方程固定如下：

1. 枚举 source catalog 的 current Run entity。`runs` 与 RunPayload.runId exact match，`experiments` 与
   RunPayload.experimentId exact match；字段内 OR、字段间 AND。两字段都未给出时保留全部 Run。
2. 对每个保留 Run 枚举其完整 `expectedMembershipSlots`。`evals` 与 expected slot.evalId exact match；
   未给出时保留全部 expected slot。没有任何匹配 Run/slot 时生成合法的空 denominator。
3. 每个匹配项从 source、Run node、Run experimentId、expected evalId 与 membershipSlot 形成唯一
   `SampleMembershipSlotV1`，再按 slot.address JCS bytes 排序。这个有序集合恰是 denominator；
   目录、时间、Experiment 当前配置、已有 Contribution 数量和 selector 输入顺序都不能增加或删除行。
4. 对每个 slot 形成 coverage：
   - 若同一 membershipSlot 有 current Contribution strong edge，校验 evalId 后形成 included membership
     与完整 `SampleMembershipProofV1`。
   - 若没有，形成无 membership 的 unavailable row。其唯一 cause 是
     `{ kind: "not-recorded", evidence }`，`basedOn` 恰为 `[evidence]`。
   - evidence 以 source Graph 为 source，以 current Run node 为 object target。selector 恰为
     `{ schema: "niceeval.expected-membership-slot-selector/1", value: { runId, membershipSlot, evalId } }`。
   - durable Run expectation 与 payload 中缺少对应 contribution 共同证明该缺口；Sample 不能自报。
5. 初次 materialization 的 excluded 恰为空；members、included 与 unavailable 必须严格满足前述
   coverage partition 方程。

`narrowSample()` 不读取 Record。它保留 parent 的完整 `sources` 与 denominator address/slot，按每行
address.runId、slot.evalId、slot.run.experimentId 应用同一 exact-match 方程，并追加 narrowed provenance。

匹配项保持 parent state；已经 excluded 的项不会恢复 included。未匹配项变为 excluded，保留可取得的
membership，并把本次 normalized selector 加入 selectors 的 JCS-sorted unique 集合。

该操作不换 Graph、不挑新 slot、不删除 unavailable 行，也不丢 parent denominator。输出 members 仍
恰为 included 的同序映射。

`unionSamples()` 只接收已经生成的 Sample。它把全部 input `sources` 合在一起，按本页的 JCS rule
规范化为一个非空集合，并把所有 denominator row 按 logical address 分组。每行的 conflict candidate
固定为 `{ schema, slot, member: membership?.identity ?? null }`；同组按完整 candidate JCS bytes 去重
升序。

输出 provenance 必须使用本节的 `[unionEntry]` 方程。input SampleRef 的 collision 检查、去重和排序先于
coverage 分组；input provenance 不参与拼接，但由这些 SampleRef 的 digest 传递绑定。

同组只有一个 candidate 时直接选择它；有多个时，默认 `error` 返回全部 canonical candidates。
`keep-first` 与 `keep-last` 只能选择排序后的第一项或最后一项，并在 union provenance 写出 resolution；
其它 candidate 的 coverage 不得泄漏到 selected row。

selected candidate 的全部输入行按以下优先级合并：

1. 任一 included 则 included；
2. 否则任一 unavailable 则 unavailable，causes 与 basedOn 分别合成 JCS-sorted unique 集合；
3. 否则 excluded，selectors 合成非空 JCS-sorted unique 集合。

selected candidate 的 member 为 null 时 included 非法。member 非 null 时，所有保留 membership 必须
逐字等于该 identity。

最终 denominator 按 address JCS bytes 排序，partition 与 members 再由它机械投影。不同 address 永不
折叠。

默认 `error` 的冲突以 `sample-union-conflict` 报告完整 address 与 canonical coverage candidates，不抛普通
`Error`。不同输入声称相同 `SampleRef.digest`、但 canonical sample preimage bytes 不同，是
`sample-digest-collision`；实现不得把两者去重或任选一份。

因此 union 没有单数 `graph` 字段。Reports 必须把 `sources` 视为完整输入集合，不能从其中猜一个“主 Graph”。

## Sample Bundle

```ts
declare const sampleBundleStoreBrand: unique symbol;

interface SampleBundleStore extends AsyncDisposable {
  readonly [sampleBundleStoreBrand]: "niceeval.sample-bundle-store/1";
  readonly format: "niceeval.sample-bundle-store/1";
  close(): Promise<void>;
}

type SampleBundleStoreOperation =
  | "create"
  | "open"
  | "close"
  | "export"
  | "read";

type SampleBundleStoreRootIssue =
  | "empty"
  | "not-absolute"
  | "malformed-url"
  | "file-url-host"
  | "query-or-fragment";

interface SampleBundleRef {
  readonly schema: "niceeval.sample-bundle-ref/1";
  readonly digest: SampleDigest;
}

interface SampleBundleManifest {
  readonly schema: "niceeval.sample-bundle-manifest/1";
  readonly sample: SampleRef;
  readonly sources: SampleSources;
  readonly members: readonly SampleMembership[];
  readonly coverage: SampleCoverage;
  readonly provenance: readonly [SampleProvenance, ...SampleProvenance[]];
  readonly evidenceProofs: RecordEvidenceProofIndexRefV1;
}

interface SampleBundleDigestPreimageV1 {
  readonly schema: "niceeval.sample-bundle-digest-preimage/1";
  readonly manifest: SampleBundleManifest;
}

interface SampleBundle {
  readonly ref: SampleBundleRef;
  readonly sample: MaterializedSample;
  readonly manifest: SampleBundleManifest;
}

type SampleBundleStoreFailure =
  | {
      readonly code: "sample-bundle-store-invalid-root";
      readonly operation: "create" | "open";
      readonly root: string | URL;
      readonly issue: SampleBundleStoreRootIssue;
    }
  | {
      readonly code: "sample-bundle-store-url-scheme-unsupported";
      readonly operation: "create" | "open";
      readonly root: URL;
      readonly scheme: string;
    }
  | {
      readonly code: "sample-bundle-store-already-exists";
      readonly operation: "create";
      readonly root: string;
    }
  | {
      readonly code: "sample-bundle-store-missing";
      readonly operation: "open";
      readonly root: string;
    }
  | {
      readonly code: "sample-bundle-store-invalid-format";
      readonly operation: "open";
      readonly root: string;
      readonly declared?: string;
    }
  | {
      readonly code: "sample-bundle-store-closed";
      readonly operation: "export" | "read";
    }
  | {
      readonly code: "sample-bundle-store-invalid-handle";
      readonly operation: "export" | "read";
    }
  | {
      readonly code: "sample-bundle-missing";
      readonly operation: "read";
      readonly ref: SampleBundleRef;
    }
  | {
      readonly code: "sample-bundle-invalid-ref";
      readonly operation: "read";
      readonly value: string;
    }
  | {
      readonly code: "sample-bundle-corrupt";
      readonly operation: "open" | "export" | "read";
      readonly ref?: SampleBundleRef;
      readonly issue:
        | "store-index"
        | "bundle-payload"
        | "digest-mismatch"
        | "ref-collision"
        | "sample-invalid"
        | "evidence-proof";
    }
  | {
      readonly code: "permission-denied";
      readonly operation: SampleBundleStoreOperation;
    }
  | {
      readonly code: "store-unavailable" | "store-io-failure";
      readonly operation: SampleBundleStoreOperation;
      readonly retryable: boolean;
      readonly message: string;
    };

class SampleBundleStoreError extends Error {
  readonly failure: SampleBundleStoreFailure;
  constructor(failure: SampleBundleStoreFailure);
}

function createSampleBundleStore(
  root: string | URL,
): Promise<SampleBundleStore>;

function openSampleBundleStore(
  root: string | URL,
): Promise<SampleBundleStore>;

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
  input?: RecordEvidenceRegistryInput,
): Promise<SampleBundle>;
```

```ts
import { resolve } from "node:path";
import { createSampleBundleStore } from "niceeval/sample";

// This absolute local root must not exist before create.
const bundleRoot = resolve(process.cwd(), ".niceeval-sample-bundle");
await using bundleStore = await createSampleBundleStore(bundleRoot);
```

`SampleBundleStore` 是 runtime-branded、`AsyncDisposable` 的独立 Store capability。
它没有 Record 的 Graph、writer 或 current-member API。
只有 `createSampleBundleStore()` 与 `openSampleBundleStore()` 能构造合法 capability。
公开的 `format` 字段不能让 structural object 或其它 Store kind 通过运行时品牌检查。

Store wrapper 的 async close 只释放自己的 local retain，并且对 lifecycle 幂等；重复 close 复用首次 settled result，不会再次释放或返回 `sample-bundle-store-closed`。close 开始后不再创建新的 export/read child retain。已经通过入口校验并取得 retain 的 export 或 read 可以独立完成，最后一个 retain 释放后才关闭 backend；已经返回的 `SampleBundle` 是完整 immutable value，不依赖 Store 继续存活。

两种 local factory 都在触碰文件系统或 backend 前先验证并规范化 root。string root 必须是非空的
绝对本地 path。

`URL` root 必须是没有 host、query 或 fragment 的 `file:` URL。合法 `file:` URL 先转成规范化的
绝对本地 path，之后所有拥有 `root: string` 的 failure 都报告这个值。

空值、相对 path、畸形 URL、带 host 的 file URL 与 query/fragment 分别落入封闭的
`SampleBundleStoreRootIssue`。其它 URL scheme 是 `sample-bundle-store-url-scheme-unsupported`，其中
`scheme` 保存实际 scheme。

两类 root failure 都只带 `create` 或 `open` operation。它们绝不降格为 missing、permission 或 IO。
local factory 也不接受任意远端 URL。

`createSampleBundleStore()` 只接受不存在的 root。任一已存在的文件系统项——空或非空目录、普通 file、symbolic link、同格式 Bundle Store 或其它 Store——都以 operation 为 `create` 的 `sample-bundle-store-already-exists` 拒绝；create 不领养、清空或补全已有目录。

`openSampleBundleStore()` 只接受已有、声明精确 Bundle format 且 layout 可验证的 root。root 不存在是
`sample-bundle-store-missing`。

普通目录、普通 file、无 marker 或声明错误 format 是 `sample-bundle-store-invalid-format`。声明正确但
store index、bundle payload 或其 digest 损坏是 `sample-bundle-corrupt`。open 绝不初始化、修复或把普通
目录转换成 Store。

Store 自身的创建、打开、关闭、目标写入与 Bundle 读取失败 reject `SampleBundleStoreError`，并使用穷尽的
`SampleBundleStoreFailure`。

每个 failure 都带 `operation`。其封闭全集是 `create`、`open`、`close`、`export`、`read`。
root failure 只属于 create/open；`sample-bundle-store-closed` 与 invalid-handle 只属于 export/read。
close 只可能给出 operation 为 close 的 backend failure。

已存在、缺失、格式错误、closed、invalid handle、无权限、损坏、不可用与 IO 失败都不会伪装成空 Bundle
或 `not-recorded`。

| 入口 | 只会 reject |
| --- | --- |
| `createSampleBundleStore()` | `SampleBundleStoreError`：操作为 `create` 的 `sample-bundle-store-invalid-root`、`sample-bundle-store-url-scheme-unsupported`、`sample-bundle-store-already-exists`、`permission-denied`、`store-unavailable`、`store-io-failure` |
| `openSampleBundleStore()` | `SampleBundleStoreError`：操作为 `open` 的 `sample-bundle-store-invalid-root`、`sample-bundle-store-url-scheme-unsupported`、`sample-bundle-store-missing`、`sample-bundle-store-invalid-format`、`sample-bundle-corrupt`、`permission-denied`、`store-unavailable`、`store-io-failure` |
| `SampleBundleStore.close()` / async dispose | `SampleBundleStoreError`：操作为 `close` 的 `permission-denied`、`store-unavailable`、`store-io-failure`；重复调用复用首次 settled result，不产生 closed failure |
| `exportSample()` | 先直接传播 `SampleValidationError`；随后按本节的固定 phase 直接传播 target `SampleBundleStoreError`、`RecordSourceError`、`RecordReadError` 或 `RecordEvidenceProofError` |
| `openSampleBundle()` | `SampleBundleStoreError`：`sample-bundle-store-invalid-handle`、`sample-bundle-store-closed`、`sample-bundle-invalid-ref`、`sample-bundle-missing`、`sample-bundle-corrupt`，或操作为 `read` 的 `permission-denied`、`store-unavailable`、`store-io-failure` |

`sample-bundle-store-invalid-handle` 与 `sample-bundle-store-closed` 互斥。伪造值或其它 Store kind 即使带有相同 `format` 或自报 closed，也只能是 invalid handle；只有 create/open 返回、通过 runtime brand 校验后又进入 closed lifecycle 的 capability 才是 closed。

`exportSample()` 的 failure precedence 是固定且顺序执行的，前一 phase 失败时绝不开始后一 phase：

1. 先运行 `validateMaterializedSample(sample)`，此时不读取 target 或 sources，也不做任何 target/source IO。它失败时直接传播 `SampleValidationError`，不包装成 Store 或 Record error。
2. 再检查 target 的 runtime brand 与 lifecycle，并取得 export child retain。伪造或 closed target 直接是 operation 为 export 的 `SampleBundleStoreError`；这一步之后才允许读取 source。
3. 对 `sample.sources` 中每项向 Record-owned `RecordSourceSet` 取得匹配 reader。SourceSet 的 brand、lifecycle 或 source-membership 问题直接传播 `RecordSourceError`。
4. 用已取得 reader 读取并复核固定 Graph 中 Sample membership 与 membership proof 所需的事实。此处的 lazy Record read failure 直接传播 `RecordReadError`，不伪装成 source 缺失或 Bundle 损坏。
5. 随后才构建、递归闭合、archive、验证并形成统一 evidence proof index。这一 proof phase 的 failure
   直接传播 `RecordEvidenceProofError`。
   proof 内部的 evidence source read failure 保留为其 `proof-source-read-failed` cause，不再同时作为
   直接 `RecordReadError` 泄漏。
6. 最后写入 target。写入、现有 ref collision 或 target backend failure 只以 operation 为 export 的 `SampleBundleStoreError` 返回，且不得留下 partial index entry。

因此同一次调用只会从最早失败 phase 返回一个 owner error；Sample、Record source、Record read、proof 与 target Store error 既不 catch/rewrite 对方，也不会因并发检查竞争成不稳定的 error surface。

`exportSample()` 另外消费 Record-owned `RecordSourceSet`。SourceSet 可以含额外 reader，但导出只读取
`sample.sources` 中逐个完整匹配的 `RecordGraphRef`。

`exportSample()` 不接收 registry input；它只继承 SourceSet 已捕获的 exact registry instance。Reports 的
`exportReport()` 遵守同一规则。相同 capability key 不能让两个 registry instance 共享 proof、memo 或
session。

缺少任一 source、reader 已关闭或 SourceSet 自身无效直接传播 `RecordSourceError`。已取得 reader 后的
实际 member/proof prerequisite read 是上列的 `RecordReadError`。

构建、递归闭合、archive、验证或写入统一 proof index 失败直接传播 `RecordEvidenceProofError`。
这些 Record-owned error 都不包装成 `SampleBundleStoreError`，也不改写成 Bundle Store 损坏。

SourceSet 的 runtime brand、lifecycle 与 source membership 只由 Record owner 判定。
伪造值或其它 capability kind 直接传播 operation 为 `read-source`、code 为
`record-source-invalid-handle` 的 `RecordSourceError`。
真实 closed SourceSet 直接传播 `record-source-closed`。
缺少 Sample 要求的完整 GraphRef 直接传播 `record-source-missing`。
Sample 不为这三种情形另造 failure code。

`exportSample()` 与 `openSampleBundle()` 只接受 create/open 成功返回且尚未 close 的 target/source Store capability。入口先检查 runtime brand，再检查 lifecycle，因此伪造 handle 与真实 closed handle 的 failure 不会因对象字段巧合而重叠。

`openSampleBundle()` 的第三个参数是显式 `RecordEvidenceRegistryInput`。它在入口时捕获 exact registry
instance；省略时捕获 builtin singleton。Bundle 的后续 reader/session 不能按 Store、capability key 或全局
变量替换该 instance。纯结构的 bundle/proof parse 与 verify 不调用 registry callback。

一个 Store 可保存多个 immutable Bundle。`exportSample()` 可以写入已打开的非空 `input.target`：相同 `SampleBundleRef` 对应完全相同 canonical bytes 时幂等成功；不同 bytes 返回 `sample-bundle-corrupt`，绝不覆写。
`SampleBundleRef` 只由成功 export 返回。`openSampleBundle()` 只读取 target Store 内已保存的 bundle，不重新执行 Record selection。

`SampleBundleRef` 的唯一 digest preimage 是
`SampleBundleDigestPreimageV1 { schema, manifest }`。bundle 的 `ref`、打开后安装的 Sample runtime
brand、Store index、物理路径和 backend metadata 都明确排除。manifest 中的 `sample` 与
`evidenceProofs` 是各自内容寻址对象的完整 ref，因此 bundle digest 传递绑定它们指向的 bytes。

Store 保存的 bundle payload bytes 必须恰好是该 preimage 的 RFC 8785 JCS 无 BOM UTF-8 bytes。
实现对这些 bytes 计算 SHA-256，并按 `sha256:` 加 64 位小写十六进制形成 `SampleBundleRef.digest`。

写入前先重算 SampleRef、proof index ref 与 bundle ref。任一不符都以 operation 为 export 的
`sample-bundle-corrupt` 拒绝，不留下 partial index entry。

这里不是第二条 caller-supplied Sample validation surface。它在 export 的第一 phase 已完成，不会被
target 写入错误掩盖。

同一 ref 已存在且 payload bytes 完全相同是幂等成功。相同 digest 对应不同 canonical bytes，
包括两个不同 byte sequence 都通过同一 SHA-256 的情形，是 `sample-bundle-corrupt / ref-collision`；
实现不得覆写、任选一份或用深比较结果替代 byte 比较。读取时 payload 与请求 ref 不匹配是
`digest-mismatch`，Sample 自身校验失败是 `sample-invalid`，proof index 或归档验证失败是
`evidence-proof`。

`openSampleBundleStore()` 校验 layout 与 index。`openSampleBundle()` 再校验以下内容：

- 指定 payload 的 canonical bytes 与 bundle digest；
- 内嵌 Sample digest；
- membership、coverage 与 provenance 不变量；
- proof index 的传递内容哈希。

全部验证只依赖 Bundle Store 自身；它不访问源 Record，也不重新运行 selection。
通过后 decoder 才 canonical-copy、deep-freeze 并为返回的 `sample` 安装
`materializedSampleBrand`。

decoder 可以复用 `validateMaterializedSample()` 的结构、不变量与 digest 规则。但这里的输入是 durable
Bundle payload，不是 caller-supplied `MaterializedSample`。

失败必须映射为 operation 为 `read` 的 `SampleBundleStoreError`，其 code 是
`sample-bundle-corrupt`，issue 是 `sample-invalid`。`openSampleBundle()` 绝不泄漏
`SampleValidationError`。

同理，`openSampleBundleStore()` 在打开时发现声明正确却已损坏的 index/layout，会使用 operation 为
`open` 的 `sample-bundle-corrupt`。

`SampleBundleManifest` 保存完整 sources、members、denominator、included、excluded、unavailable、
provenance、membership proof 与统一的 `evidenceProofs` index。
`SampleBundleDigestPreimageV1` 是唯一 durable bundle payload；Store 不在另一种隐藏 subject 中追加
selector、handle 或活动 Graph 字段。

Bundle 的 direct evidence set 只能从 manifest 机械重建，方程固定如下：

1. 枚举 `members`、`coverage.denominator`、`included`、`excluded` 与带 membership 的 `unavailable` 中
   每个完整 `SampleMembership`；相同 membership identity 只处理一次。
2. 对每个 membership 加入三个 object `EvidenceRef`：source 都是 `identity.source`，target node 分别是
   `slot.run.node`、`contribution.node` 与 `attempt.adopted`。它们逐项对应 current Run、current
   Contribution 与 adopted Attempt。
3. 对该 contribution 的每个 `basisClaims` 加入 Claim `EvidenceRef`：source 是同一个 identity source，
   target 的 node 与 claimId 逐项来自 `ClaimRef`。
4. 加入每个 unavailable coverage item 的全部 `basedOn`，以及它每个 cause 上存在的 `evidence`。
5. 对完整 EvidenceRef 的 RFC 8785 JCS 无 BOM UTF-8 bytes 去重并升序排列。没有其它 Sample、selector、
   provenance 或 reader trace 能增加 direct entry。

每个 membership 的三个 object proof 必须与两个 catalog leaf、Run → Contribution edge 和
Contribution → adopted Attempt edge 一致。这样 Sample identity 所声称的“当前成员”不是只靠内嵌
object 自报；缺任一 object EvidenceRef、强边或所需 catalog proof 都使 Bundle 无效。

这项一致性按 archive bytes 机械验证，不依赖 source Store：

1. Run 与 current Contribution object proof 都必须走 Record 规定的 current-entity catalog path。各自
   path 中的 catalog、branch、leaf、key preimage 与 entity-current edge 必须逐字重建两个内嵌 catalog
   proof。`membershipProof.run.catalog` 与 `membershipProof.contribution.catalog` 不能成为未经绑定的
   另一份断言。
2. Record object-proof archive 方程要求 target GraphNode payload 与其完整 dependency-page chain 入表。
   Run object proof 的 archives 必须含 `edgeOrdinalFromRun` 所在 EdgePage。该 flattened ordinal 的
   relation 是 `niceeval.run-current-contribution`，target 是 contribution.node。
3. Contribution object proof 的 archives 同理必须含 `edgeOrdinalFromContribution` 所在 EdgePage。该
   flattened ordinal 必须是 `niceeval.contribution-adopted-attempt`，target 等于 attempt.adopted。
4. adopted Attempt object proof 提供目标 GraphNode/payload bytes。它可以经 Contribution strong path
   抵达，不要求是 catalog current Attempt。两个 edge 的 from/to descriptor 必须分别与对应 object
   proof 的 target bytes 相等。

proof index 的 shared object table 仍必须恰好等于全部 proof `archives` 的 union。上述 catalog
branch/leaf、Run dependency pages 与 Contribution dependency pages 由三个 object proof 的精确 archive
集合带入。

导出器不得另设未被 proof 引用的 membership side table。canonical object path 即使已在 catalog
终止，也不能漏掉 target dependency pages。

目标 Store 中的 `RecordEvidenceProofV1` 可以分别证明 event、object、Claim 或 authenticated absence。
`RecordEvidenceProofIndexV1` 的 entry 集合必须恰好等于上述 direct set 加上 Claim closure。这个 closure
由 Record owner 对每个 `basedOn` 递归得到，无缺项也无额外项。

归档 wrapper 保存 source Graph、原始 bytes 与路径证明，但源 Claim、stream GraphNode 或其它源对象
不能成为目标 Store 的活动节点。复制、递归 basis 闭合、proof 校验或写入失败会使 export 失败，不能
改写为 `not-recorded`。

## 边界

- 每个 `RecordGraphRef` 都是 durable revision，没有 open 或 sealed 状态。
- Attempt 永远属于 origin Run；carried、accepted 与 renamed 只由 Record-owned Contribution 表达。
- Sample 不保存 Projection memo、ReportData 或 renderer 选择。
- SampleBundle 不是 Record，`openRecord()` 不能打开它。

## 相关阅读

- [README](README.md) —— 固定选择的用户心智。
- [局部补跑](use-case/partial-rerun.md) —— 一个固定 source Graph 怎样生成成员。
- [收窄样本](use-case/收窄样本.md) —— 保留 sources 与 denominator 的纯变换。
- [Record Library](../record/library.md) —— Attempt、Contribution、Projector 与 EvidenceValue owner。
- [Reports Library](../reports/library.md) —— 多 source Sample 的计划化呈现。
