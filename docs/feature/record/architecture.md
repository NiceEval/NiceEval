# Record 架构

## 信息模型先于文件模型

Record 保存三类权威内容，读取时再产生 Projection。

| 信息 | 回答的问题 | 例子 |
|---|---|---|
| Provenance | 为什么是这次执行，使用了哪些输入与算法 | Experiment、Eval 源码、Agent、model、配置、价格表 |
| Observation | 实际发生了什么 | Agent 事件、命令输出、workspace change、耗时、实际账单、错误 |
| Claim | 当时依据哪些事实作出了什么判断 | Assertion、Judge、Verdict、估算成本、采用决定 |
| Projection | 固定 Record revision 可以怎样被读取 | 执行树、时间树、usage、diff、Verdict 读面 |

前三类进入 Record。
Projection、Live snapshot 和 Report artifact 都有自己的 owner，不回写成事实。
Projector 可以重算同一读模型，但不能用读取时的宿主运行条件改写历史 Claim。

## frozen typed-object core

Record、Report、Run、Attempt 和 Claim 都是 typed payload，不进入 bootstrap。
core 只冻结 Store 的 format marker、bound Layout、Graph root、强依赖与 committed-root
radix 所需的字节形状。一个 root 永远表示 immutable durable revision；没有 `open`、
`sealed` 或其它生命周期字段。

```ts
type DigestV1 = string; // exactly "sha256:" + 64 lowercase hexadecimal characters
type RadixNibbleV1 =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "a" | "b" | "c" | "d" | "e" | "f";
type RadixPathV1 = string; // 0..64 lowercase hexadecimal nibbles

interface DescriptorV1 {
  mediaType: string;
  digest: DigestV1;
  size: number;
}

declare const nodeRefBrand: unique symbol;
type NodeRefV1 = DescriptorV1 & {
  readonly mediaType: "application/vnd.niceeval.graph-node.v1+jcs";
  readonly [nodeRefBrand]: "niceeval.graph-node/1";
};

type EdgePageRefV1 = DescriptorV1 & {
  readonly mediaType: "application/vnd.niceeval.edge-page.v1+jcs";
};
type GraphRootRefV1 = DescriptorV1 & {
  readonly mediaType: "application/vnd.niceeval.graph-root.v1+jcs";
};
type CommittedRootPageRefV1 = DescriptorV1 & {
  readonly mediaType: "application/vnd.niceeval.committed-root-page.v1+jcs";
};

interface StrongEdgeV1 {
  readonly relation: string;
  readonly target: NodeRefV1;
}

interface EdgePageV1 {
  readonly schema: "niceeval.edge-page/1";
  readonly edges: readonly StrongEdgeV1[];
  readonly pages: readonly EdgePageRefV1[];
}

interface GraphNodeV1 {
  readonly schema: "niceeval.graph-node/1";
  readonly payload: DescriptorV1;
  readonly dependencies: EdgePageRefV1 | null;
}

interface GraphRootV1 {
  readonly schema: "niceeval.graph-root/1";
  readonly subject: NodeRefV1;
}

interface StoreFormatMarkerV1 {
  readonly schema: "niceeval.record-store-marker/1";
  readonly format: "niceeval.record-store";
  readonly version: 1;
}

interface CommittedRootKeyV1 {
  readonly schema: "niceeval.committed-root-key/1";
  readonly graph: GraphRootRefV1;
}

interface CommittedRootBranchV1 {
  readonly schema: "niceeval.committed-root-page/1";
  readonly node: "branch";
  readonly prefix: RadixPathV1;
  readonly children: readonly {
    readonly nibble: RadixNibbleV1;
    readonly page: CommittedRootPageRefV1;
  }[];
}

interface CommittedRootLeafV1 {
  readonly schema: "niceeval.committed-root-page/1";
  readonly node: "leaf";
  readonly key: RadixPathV1;
  readonly keyPreimage: CommittedRootKeyV1;
  readonly owner: {
    readonly kind: "committed-root";
    readonly graph: GraphRootRefV1;
  };
  readonly graph: GraphRootRefV1;
}

type CommittedRootPageV1 =
  | CommittedRootBranchV1
  | CommittedRootLeafV1;

interface LayoutV2 {
  readonly format: "niceeval";
  readonly schema: "niceeval.layout/2";
  readonly recordId: string;
  readonly generation: number;
  readonly head: GraphRootRefV1;
  readonly committedRoots: CommittedRootPageRefV1;
}
```

`createRecordStore()` 只创建 `StoreFormatMarkerV1` 和对象命名空间。它不创建 `LayoutV2`、
head、recordId 或 genesis object，因此带 marker 的 Store 起初是 unbound。首次
`expected: null` 成功 commit 才创建 bound Layout。`openRecordStore()` 不初始化或修复普通目录，
只重开带精确 marker 且物理表示有效的 unbound 或 bound Store。

`LayoutV2` 只存在于 bound Store。它的 head 与 committed-root radix root 在同一元数据事务中
替换，head 必须是该 radix 的成员。committed-root page 是 frozen bootstrap object，不是
`GraphNodeV1` payload；GC 在每个 leaf GraphRootRef 开始前，先验证其 typed page ref 与 page
内部 radix edge。tree append-only，因此任何 receipt ref 都能重新打开。

### typed reference 与规范字节

`mediaType + digest + size` 共同组成 typed reference。
digest 只定位字节，不能单独决定业务类型；相同 digest、不同 media type 的引用不能在缓存或 visited set 中合并。

core JSON 使用 RFC 8785 JCS。
decoder 必须拒绝未知 core 字段、重复 key、非法 UTF-8、非安全整数、非规范数字和不规范 Unicode 排序。
领域扩展只能进入新的 typed payload，不能给 frozen core 增加字段。

`size` 是原始落盘字节数，必须是 JSON safe integer。
Record format v1 的 conforming writer 对每个 `DescriptorV1`、Merkle commitment、radix key、
archive ID、proof key 与其它内容摘要都只使用 SHA-256。字符串形态唯一是 `sha256:` 加 64 个小写
十六进制字符；radix path 是同一 32-byte digest 的 64 个小写十六进制字符，不带算法前缀。
同一 canonical bytes 因而只有一个 v1 descriptor digest，writer 不能从 registry、配置或 Store
能力协商选择另一算法。其它算法只能随新的 format/schema 版本引入。

路径读取器先验证 digest 算法、编码和长度，再形成存储路径；v1 中其它算法返回 `unsupported-digest`。
它不能把未经校验的 digest 字符串拼进文件路径。

所有 core object、payload、segment、chunk 和 asset 都满足：

```ts
const RECORD_FILE_MAX_BYTES = 16 * 1024 * 1024;
```

对象超过上限时使用分页、segment 或 chunk index，不扩大单文件预算。

已知领域 payload 的 dependency list 统一使用一个分页函数。实现先按 payload owner 的规则形成完整
有序 strong-edge 序列。空序列编码为 `GraphNodeV1.dependencies: null`；非空序列每 128 项切一页。

首块由 `GraphNodeV1.dependencies` 指向。每个非末页恰有 128 条 `edges`，并以唯一的 `pages[0]`
指向下一页。末页有 1..128 条 `edges` 与 `pages: []`。禁止第二个 child page、空页、短非末页或
替代性切分。

文中的“edge ordinal”若未标为 page-local，均指沿该链 flatten 后从 0 开始的 ordinal。radix、archive
与 proof index 已另行冻结页形状，不套用这条领域 dependency chain。

### strong closure

`GraphNodeV1.payload` 对 generic walker 是 opaque bytes。
payload 依赖的 node 必须同时出现在 `dependencies` 的 strong edge 中；未知 payload 不能把 typed reference 藏在 body 里。

```ts
type RecordWalkerLimitName = "objects" | "depth" | "bytes";

interface RecordWalkerResourceLimit {
  readonly name: RecordWalkerLimitName;
  readonly maximum: number;
}
```

`RecordWalkerResourceLimit` 是 traversal 的唯一资源预算形状。`objects` 计算去重后实际访问的
descriptor，`depth` 计算从 Graph root 开始的最大 edge 深度，`bytes` 计算已读取 raw bytes 的累计值。
实现或 Store 可以选择其中任意上限，但不能把上限改写成未命名的 transport quota。

verifier、完整镜像、GC 和选择性导出共用同一个 walker：

1. 验证 Graph root descriptor 与原始字节。
2. 读取 subject node、payload descriptor 与 dependency pages。
3. 无条件跟随每条 strong edge 和 child edge page。
4. 用完整 typed reference 去重，并实施对象数、深度和累计字节预算。

预算耗尽返回 `resource-limit { limit: RecordWalkerResourceLimit, observed }`。
缺对象返回 `missing-object`；digest 或 size 不符返回 `corrupt`。
这些状态不能改写成“未采集”。

### 验证与信任边界

digest、strong closure 和 Merkle proof 证明字节完整性、引用关系与包含关系。
它们都以调用方提供的 `RecordGraphRef` 为信任起点，不能单独证明 producer 身份、Claim 内容正确或调用方有读取权限。

receipt、受信通道或 attestation 可以把 GraphRef 绑定到 producer identity。
签名和 timestamp 使用独立 typed attestation payload；它们引用已经提交的 GraphRef，不进入 frozen core，也不改变原 Graph digest。
Store 在返回任何对象字节或 membership proof 前执行认证与授权，访问策略不写进内容寻址 identity。

`verification.state: "full"` 只表示 Projector 相对于该 GraphRef 完整验证了所需依据。
它不把 evaluator 的 Claim 变成客观事实，也不替调用方建立 GraphRef 的外部信任。

### Record graph verification 与最小 bootstrap

v1 只公开不带 options 的 `verifyRecordGraph(handle)`。它返回穷尽结果，不是 truthy boolean：

```ts
type RecordGraphVerification =
  | { readonly state: "valid" }
  | {
      readonly state: "invalid";
      readonly violations: NonEmptyArray<RecordGraphViolation>;
    };

type RecordGraphViolationCode =
  | "core-canonical-invalid"
  | "graph-root-invalid"
  | "graph-node-invalid"
  | "descriptor-invalid"
  | "descriptor-digest-mismatch"
  | "descriptor-size-mismatch"
  | "missing-object"
  | "strong-closure-invalid"
  | "strong-edge-invalid"
  | "committed-root-membership-invalid"
  | "committed-root-key-invalid"
  | "generation-revision-invalid"
  | "revision-chain-invalid"
  | "record-previous-invalid"
  | "revision-edge-contract-invalid"
  | "record-subject-edge-contract-invalid"
  | "domain-edge-contract-invalid"
  | "radix-key-invalid"
  | "radix-branch-invalid"
  | "radix-leaf-invalid"
  | "radix-edge-contract-invalid"
  | "radix-successor-invalid"
  | "digest-collision"
  | "claim-basis-cycle"
  | "known-payload-schema-invalid"
  | "known-payload-invariant-invalid";

interface RecordGraphViolation {
  readonly code: RecordGraphViolationCode;
  readonly path: readonly string[];
  readonly message: string;
}
```

`valid` 表示输入 GraphRef 的 descriptor 与 raw bytes、generic strong closure，以及
frozen-core canonical form 全部通过。

它还表示所有已知领域 radix、revision 与 edge invariant 都通过。violation 按
`{ code, path, message }` 的 JCS UTF-8 bytes 稳定排序，绝不丢弃。

`RecordGraphViolationCode` 是 v1 的封闭词表。
它分别报告 core canonical form、descriptor、strong edge 与 committed-root membership。
它也分别报告 generation/revision、radix canonical form、revision chain、edge contract、
digest collision、Claim basis cycle 与已知 payload 的 schema/invariant。

未知领域 payload 只要 GraphNode、Descriptor 与 strong closure 合法，仍可 valid。只有依赖其
语义的 decode 或 Projector 是 unsupported；generic verification、mirror 与 GC 不读取它的业务
schema。

permission、IO、backend unavailable 或 resource exhaustion 必须 reject
`RecordGraphVerificationError`，不能伪装为 invalid。`valid` 不表达 producer、receipt 或
attestation。

打开只做 minimal bootstrap：Layout snapshot、committed-root membership path、GraphRoot、
subject、RecordSubject，以及它直接引用的 catalog、locator 与 previous dependency。locator index 的
bootstrap ref 属于 direct bootstrap。

它的 radix payload、后继 branch / leaf page、leaf 指向的 Attempt 与其它 entity、stream、Claim、
Provenance 保持 lazy。损坏的 Layout、root、subject 或 direct bootstrap dependency 是 open failure。
稍后才读到的错误 locator page、Attempt、iterator item 或 payload decode 归 lazy read path。

minimal bootstrap 的 failure 以第一个不可继续的 component 分类：missing object、corrupt bytes/
edge、unsupported digest、unsupported schema 或 unsupported capability。
它们属于 `RecordOpenError`，不能改成 lazy read 或 generic graph-invalid。

bootstrap 之后的相同五类问题只在实际 entity、stream、Claim、Provenance、iterator item 或
payload decoder 被访问时成为 `RecordReadError`。iterator 在这个首次 failure 后永久完成，已交付的
item 不失效。

## Record 单位与 revision

一个 `RecordStore` 管理一个内容对象命名空间和一个可选的 bound Layout。
它对应一份 `.niceeval` 长期事实根，可以跨 Invocation、Experiment 和 Run 追加。
unbound Store 尚没有 Record；Report、SampleBundle 与 mirror target 都使用各自独立的 Store。

```ts
interface RecordGraphRefV1 {
  readonly recordId: string;
  readonly graph: GraphRootRefV1;
}

type RecordGraphRef = RecordGraphRefV1;

interface RecordSubjectV1 {
  readonly schema: "niceeval.record/1";
  readonly recordId: string;
  readonly revision: number;
  readonly previous: NodeRefV1 | null;
  readonly catalog: NodeRefV1;
  readonly locatorIndex: NodeRefV1;
}
```

第一次成功 commit 写入 `revision: 0`，`LayoutV2.generation: 1` 和 `previous: null`。
revision 0 没有 previous strong edge。之后每次成功 commit 恰好新增一个 RecordSubject，
恒有 `generation = revision + 1`。unbound Store 没有 generation。

RecordSubject 的 dependency EdgePage 绝不分页，`pages` 必为 `[]`。edge 的顺序也属于
canonical 形状：

1. 第 0 项是 `niceeval.record-catalog`，指向 `catalog`。
2. 第 1 项是 `niceeval.record-locator-index`，指向 `locatorIndex`。
3. 仅当 revision 大于 0 时，第 2 项是 `niceeval.record-previous`，指向 `previous`。

后继 subject 的 previous 必须正好是 expected head 的 subject node。payload 字段与该 edge
target 也必须完全相同。CAS 冲突后，writer 读取 actual head 后重建完整 revision，不能把旧
subject 接到新的 head。

`subject.previous` 表达领域 lineage。
旧 GraphRoot object 的保留由 Store 的 append-only committed-root radix 负责；仅保留前一
subject 不能替代这项职责。所有 receipt、Sample 和 Report 都保存完整
`RecordGraphRefV1`，读取时绝不改选 latest 或 most recent revision。

## Merkle entity catalog

Record 使用 Merkle radix tree 保存当前实体 revision。
key 是以下 JCS 对象的 SHA-256 digest，不是字符串拼接：

```ts
type EntityKind = "run" | "attempt" | "stream" | "claim" | "contribution";

interface EntityCatalogKeyV1 {
  readonly schema: "niceeval.entity-catalog-key/1";
  readonly kind: EntityKind;
  readonly id: string;
}

interface EntityCatalogSelectorV1 {
  readonly schema: "niceeval.entity-catalog-selector/1";
  readonly value: EntityCatalogKeyV1;
}

interface EntityCatalogBranchV1 {
  readonly schema: "niceeval.entity-catalog/1";
  readonly node: "branch";
  readonly prefix: RadixPathV1;
  readonly children: readonly {
    readonly nibble: RadixNibbleV1;
    readonly node: NodeRefV1;
  }[];
}

interface EntityCatalogLeafV1 {
  readonly schema: "niceeval.entity-catalog/1";
  readonly node: "leaf";
  readonly key: RadixPathV1;
  readonly keyPreimage: EntityCatalogKeyV1;
  readonly owner:
    | { readonly kind: "record"; readonly recordId: string }
    | { readonly kind: "run"; readonly runId: string }
    | { readonly kind: "attempt"; readonly attemptId: AttemptId };
  readonly entity: NodeRefV1;
}

type EntityCatalogPayloadV1 =
  | EntityCatalogBranchV1
  | EntityCatalogLeafV1;
```

entity key 是 `JCS({ schema: "niceeval.entity-catalog-key/1", kind, id })` 的 SHA-256，
恰为 64 个小写 hex nibble，不带 `sha256:` 前缀。leaf 必须保存该完整 key preimage 和 owner，
decoder 复算 key、kind、ID、owner、payload media type 与 current entity edge；同一 tree 中每个
key 恰有一个 leaf，且 key 永不删除。

`EntityCatalogLeafV1.owner` 不是开放 metadata。v1 从已解码 payload 机械得到唯一 owner：

| `keyPreimage.kind` | `keyPreimage.id` | 唯一 `owner` |
|---|---|---|
| `run` | `RunPayloadV1.runId` | `{ kind: "record", recordId }` |
| `attempt` | `AttemptPayloadV1.identity.attemptId` | `{ kind: "run", runId: AttemptPayloadV1.originRunId }` |
| `stream` | `ObservationStreamIndexV1.streamId` | scope 为 Run 时 `{ kind: "run", runId }`；scope 为 Attempt 时 `{ kind: "attempt", attemptId }` |
| `claim` | `ClaimPayloadV1.claim.id` | scope 为 Run 时 `{ kind: "run", runId }`；scope 为 Attempt 时 `{ kind: "attempt", attemptId }` |
| `contribution` | `RunContributionV1.contributionId` | `{ kind: "run", runId: RunContributionV1.runId }` |

表中的 `recordId` 必须等于 subject 的 recordId。validator 必须同时复核 kind、ID、owner 与 payload；
任何其它 owner shape、从调用方传入的 owner 或只核对 entity target 的实现都是
`radix-leaf-invalid`。这张映射也冻结了 v1 的 owner 迁移边界；改变 owner 必须建立新实体，而不是更新
同一个 catalog key。

实体与 locator radix payload 都包在 canonical `GraphNodeV1` 中。三棵 radix 的逻辑输入都是按
完整 64-nibble key 唯一的 leaf 集合；构造器先按 key 的 UTF-8 bytes 升序，并拒绝重复 key。

canonical build 是纯函数，规则固定如下：

1. 空集合只允许出现在 tree root，唯一形状是 branch `prefix: ""`、`children: []` 与
   `dependencies: null`。任何非 root 空 subtree 都无效。
2. 单元素集合唯一编码成 leaf，不包 branch。
3. 两个以上 leaf 的 branch `prefix` 必须恰好是全部后代 key 的最长公共前缀。它小于 64 nibble；
   构造器按 `key[prefix.length]` 分组，形成 2 至 16 个 child。
4. child nibble 使用小写 hexadecimal，严格升序且唯一。单元素组直接形成 leaf；多元素组递归使用
   该组全部 key 的最长公共前缀。因此 child branch 的 prefix 必须以
   `parent.prefix + child.nibble` 开头，并且恰为该 child 全部后代 key 的最长公共前缀。
5. branch prefix 是从 root 开始的绝对 path。禁止 unary branch、替代性 prefix 切分、把 leaf
   额外包一层 branch，或保留不属于后代 key 的 prefix；同一 leaf 集合因而只有一个 root ref。

entity 与 locator 的 `set(key, value)` 先验证同 key 的旧 leaf。只允许把 value 推进到本节规定的
direct successor，再对更新后的唯一 leaf 集合应用同一个 canonical build。committed-root 的
`add(key, value)` 只接受新 key；同 key 同 value 是幂等 no-op，同 key 不同 value 是 invalid。
实现可以复用未变化 subtree，但产出的 bytes 与从完整排序集合重建必须逐字节相同。插入顺序、
事务批次与复用策略不能改变 root ref。

非空 branch 恰有一个 EdgePage，`pages: []`。它的 edges 与 children 顺序逐项相同，relation 为
`niceeval.radix-child:<nibble>`。entity leaf 恰有一个 relation 为
`niceeval.entity-current` 的 edge，target 与 `entity` 相同。

新 immutable revision 可让 entity tree 对同一个 key 改指一个已验证的 direct successor，不能
删除或改写历史 tree。catalog membership proof 只暴露 path 上的 branch、nibble 与 sibling
descriptor；它不携带 sibling payload、领域 ID 或 owner metadata。nonmembership proof 则以首个
不匹配 prefix、缺失 child 或相异 leaf 证明该 key 不在固定 root；它同样重算全部已披露 branch。
proof 的 source、tree ref、full key preimage、terminal node 与有序 path 都属于验证输入。

```ts
interface RadixMembershipProofStepV1 {
  branch: NodeRefV1;
  prefix: string;
  selectedNibble: string;
  siblings: readonly {
    nibble: string;
    node: NodeRefV1;
  }[];
}

interface EntityMembershipProofV1 {
  readonly schema: "niceeval.entity-membership-proof/1";
  readonly source: RecordGraphRef;
  readonly catalog: NodeRefV1;
  readonly key: RadixPathV1;
  readonly keyPreimage: EntityCatalogKeyV1;
  readonly leaf: NodeRefV1;
  readonly path: readonly RadixMembershipProofStepV1[];
}

type RadixNonMembershipTerminalV1<Ref extends DescriptorV1> =
  | { readonly kind: "empty-root" }
  | { readonly kind: "prefix-mismatch"; readonly branch: Ref }
  | {
      readonly kind: "missing-child";
      readonly branch: Ref;
      readonly nibble: RadixNibbleV1;
    }
  | { readonly kind: "mismatched-leaf"; readonly leaf: Ref };

interface EntityNonMembershipProofV1 {
  readonly schema: "niceeval.entity-nonmembership-proof/1";
  readonly source: RecordGraphRef;
  readonly catalog: NodeRefV1;
  readonly key: RadixPathV1;
  readonly keyPreimage: EntityCatalogKeyV1;
  readonly path: readonly RadixMembershipProofStepV1[];
  readonly terminal: RadixNonMembershipTerminalV1<NodeRefV1>;
}
```

verifier 先确认 source Graph 的 subject 指向同一个 catalog。它再逐步验证 branch bytes、prefix、
selected nibble 与 sibling descriptor。membership 的 path 包含通向 leaf 的全部 branch。

nonmembership 的 path 只包含已经选择现存 child 的祖先 branch；terminal 是接下来实际读取的 root、
branch 或 leaf。

`prefix-mismatch` 要求完整 key 不以 terminal branch 的 absolute prefix 开头。
`missing-child` 要求 prefix 完全匹配、key 在该位置的 nibble 等于 terminal.nibble，且 branch 没有该 child。
`mismatched-leaf` 要求 terminal leaf 的完整 key 与查询 key 不同。empty root 必须是固定 tree root 的
canonical empty branch。

最后，verifier 复算 leaf key preimage、owner 与 entity strong edge。
membership 的 `source + catalog + keyPreimage + leaf + path` 是 proof identity；nonmembership 把
`terminal` 替换 leaf 纳入 identity。两者都不能只保存 sibling digest 或调用方自称的实体 ID。

## Attempt locator index

locator index 是另一棵 Merkle radix tree，不与 entity catalog 共页。
它的 key 是 `{ schema: "niceeval.attempt-locator-key/1", locator }` 的 JCS SHA-256 digest。

```ts
interface AttemptLocatorKeyV1 {
  readonly schema: "niceeval.attempt-locator-key/1";
  readonly locator: AttemptLocator;
}

interface AttemptLocatorIndexBranchV1 {
  readonly schema: "niceeval.attempt-locator-index/1";
  readonly node: "branch";
  readonly prefix: RadixPathV1;
  readonly children: readonly {
    readonly nibble: RadixNibbleV1;
    readonly node: NodeRefV1;
  }[];
}

interface AttemptLocatorIndexLeafV1 {
  readonly schema: "niceeval.attempt-locator-index/1";
  readonly node: "leaf";
  readonly key: RadixPathV1;
  readonly keyPreimage: AttemptLocatorKeyV1;
  readonly owner: {
    readonly kind: "attempt";
    readonly attemptId: AttemptId;
  };
  readonly locator: AttemptLocator;
  readonly attemptId: AttemptId;
  readonly attemptRevision: NodeRefV1;
}

type AttemptLocatorIndexPayloadV1 =
  | AttemptLocatorIndexBranchV1
  | AttemptLocatorIndexLeafV1;

type AttemptId = string; // exactly 32 lowercase hexadecimal characters
type AttemptLocator = string; // "@" followed by 26 canonical Crockford characters

interface AttemptLocatorSelectorV1 {
  readonly schema: "niceeval.attempt-locator-selector/1";
  readonly value: {
    readonly locator: AttemptLocator;
  };
}

interface AttemptLocatorNonMembershipProofV1 {
  readonly schema: "niceeval.attempt-locator-nonmembership-proof/1";
  readonly source: RecordGraphRef;
  readonly index: NodeRefV1;
  readonly selector: AttemptLocatorSelectorV1;
  readonly key: RadixPathV1;
  readonly keyPreimage: AttemptLocatorKeyV1;
  readonly path: readonly RadixMembershipProofStepV1[];
  readonly terminal: RadixNonMembershipTerminalV1<NodeRefV1>;
}
```

locator key 是 `JCS({ schema: "niceeval.attempt-locator-key/1", locator })` 的 SHA-256，恰为
64 个小写 hex nibble。

branch、prefix、排序、empty root 与 EdgePage 规则和 entity catalog 完全相同。locator leaf 的
唯一 edge relation 是 `niceeval.attempt-current`，target 与 `attemptRevision` 相同。

在已打开的 RecordHandle 中，`resolveAttempt()` 用 lazy read lease 逐页遍历这个 radix。
只有全部已读取 page 已证明 canonical empty root、prefix mismatch、missing child 或 mismatched leaf，
查找才是 nonmembership。locator proof 使用完整
`AttemptLocatorNonMembershipProofV1`；path 与 terminal 的验证规则和 entity catalog 完全相同。
任何 branch / leaf object 的 read failure 仍是 read failure，不能改写成 locator absence。

verifier 先要求 source Graph 的 subject 以 `niceeval.record-locator-index` strong edge 指向同一个
`index`。`selector.value.locator`、`keyPreimage.locator` 与调用方查询的 locator 必须逐字相等。
`key` 必须等于 `JCS(keyPreimage)` 的 SHA-256 64-nibble 小写 hex。

`missing-child` 的 `nibble` 必须等于该 key 在 terminal branch prefix 后的下一 nibble。proof identity 是
`source + index + selector + key + keyPreimage + path + terminal`；任何一项都不能由调用方补猜。

leaf 完整保存 key preimage 与 owner。reader 复算它们，也验证 Attempt payload 中的 locator 与
leaf 相同。新 immutable revision 可把相同 locator key 推进到已验证的 direct Attempt successor。
key 不会删除，单 tree 中也不会重复。

`attemptId` 是执行前生成的 128-bit 随机身份，payload 使用 32 个小写十六进制字符保存这 16 bytes。
`AttemptLocator` 是这 128 bit 的完整 Crockford Base32 编码，不是截断摘要：

- canonical alphabet 为 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`；
- body 固定 26 个大写字符，首字符的高两位必须为零；
- CLI 形式固定为 `@` 加 body；
- parser 接受 ASCII 小写后再规范化，不接受 `I`、`L`、`O`、`U`；
- locator 只在本 Record 内寻址，不从路径、时间或 Graph digest 推导。

Runner 必须先通过 CAS 提交 identity reservation，再发 `attempt.started` 或执行外部副作用。
无关 head 变化导致冲突时，writer 保留同一 attemptId 并重建索引。
只有 locator 已被另一身份占用，且本身份尚未对外可见时，才能重新生成 attemptId。

## committed-root radix、bootstrap 与 GC

committed-root key 固定为 `JCS({ schema: "niceeval.committed-root-key/1", graph })` 的
SHA-256 64-nibble path，其中 `graph` 是完整 `GraphRootRefV1`。

它使用前文 `CommittedRootPageV1` 的 branch/leaf union，而非 roots array。
`LayoutV2.committedRoots` 是唯一的 typed bootstrap page ref。

branch 的 prefix、child 排序、2..16 fan-out、无 unary branch、empty root 与 singleton leaf
规则和 catalog 相同。leaf 的 `keyPreimage`、owner 与 graph 必须逐项相等，并由 decoder 重算。

这棵树只能 add。commit 把新的 GraphRootRef 加入新 immutable radix root，历史 page 不会原地
修改或删除。

membership proof 重算 page path、key preimage 与 leaf graph。nonmembership proof 使用
`RadixNonMembershipTerminalV1<CommittedRootPageRefV1>`，并在 empty root、prefix mismatch、
missing child 或 mismatched leaf 停止。

Layout bootstrap 先验证 marker、Layout JCS、typed committed-root page 与 head membership。随后，
它从每个 leaf GraphRootRef 统一走 strong closure。

GC 的 mark roots 是所有 committed leaf、尚未过期 staging、read retain 与显式 pin。普通 catalog
的 current 指针和 subject.previous 都不能替代 committed radix 的 retention。

所有 radix proof 都拒绝不规范 branch、错误 absolute prefix、缺少或多余 edge、非 canonical
child 顺序、key/preimage 不符和不可达 terminal。proof 只证明固定 tree root 包含或不包含，不
证明 producer、receipt 或 attestation。

| tree | membership 必须复核 | nonmembership terminal |
|---|---|---|
| entity catalog | source subject 的 catalog、key preimage、leaf owner、current edge 与 branch path | empty root、prefix mismatch、missing child 或 mismatched leaf |
| attempt locator | source subject 的 locator index、locator preimage、leaf owner、current Attempt edge 与 branch path | empty root、prefix mismatch、missing child 或 mismatched leaf |
| committed root | Layout typed page root、完整 GraphRootRef key preimage、leaf owner 与 page path | empty root、prefix mismatch、missing child 或 mismatched leaf |

任一 proof 都以实际 root bytes 逐层重算，而不接受调用方给出的 path、sibling、key 或 terminal。

## 领域 payload

以下 media type 各自版本化：

| payload | media type |
|---|---|
| Record subject | `application/vnd.niceeval.record.v1+jcs` |
| Entity catalog | `application/vnd.niceeval.entity-catalog.v1+jcs` |
| Attempt locator index | `application/vnd.niceeval.attempt-locator-index.v1+jcs` |
| Run | `application/vnd.niceeval.run.v1+jcs` |
| Attempt | `application/vnd.niceeval.attempt.v1+jcs` |
| RunContribution | `application/vnd.niceeval.run-contribution.v1+jcs` |
| Observation stream index | `application/vnd.niceeval.observation-stream-index.v1+jcs` |
| Observation segment page | `application/vnd.niceeval.observation-segment-page.v1+jcs` |
| Observation segment | `application/vnd.niceeval.observation-segment.v1+jcs` |
| Claim | `application/vnd.niceeval.claim.v1+jcs` |
| Provenance | 由各 owner 发布独立 media type |

recordId 在首次成功 commit 绑定 Store 时确定，此后不能改变。
invocationId、runId、streamId、contributionId 与 claimId 在 Record 内唯一；bindingId 在自己的 Run 或 Attempt 内唯一。
evalId 与 experimentId 是外部声明身份，可以出现在多个 revision 和 Run 中，不承担实体去重职责。

Run、Attempt 和 stream 的 revision 从 0 开始。

revision 0 的 previous 为 null。每个后继的 revision 必须比前驱恰好大 1。
previous 指向同一实体的直接前驱，并写 strong edge。

实体 identity、owner 与 scope 不能改变。
terminal state 不能退回 active，也不能换成另一种 terminal state。

`revision` 和 `previous` 是每种 revisioned entity 的序列化 lineage envelope，并直接出现在该实体的
v1 payload 中；它们不是只存在于内存 handle 或 GraphNode 外部的隐含字段。
AttemptPayload 除这两个 envelope 字段外的业务字段只有 identity、origin Run、Provenance ref、
lifecycle state 与 stream bindings。
其中 lifecycle state 只能是 `active | completed | abandoned`。
`passed`、`failed`、`errored` 和 `skipped` 只属于 Verdict Claim。

### StreamBinding

一个 Run 或 Attempt 可以绑定多条 stream。

```ts
type StreamRequirement = "required-for-completion" | "supplemental";

interface StreamBindingV1 {
  bindingId: string;
  role: string;
  requirement: StreamRequirement;
  streamId: string;
  index: NodeRefV1;
}
```

`role` 是带版本的开放 token。
内建 role 至少包括 `lifecycle`、`model-io`、`finalizer`、`telemetry` 和 `artifact`。
每个 owner 恰有一个 `lifecycle` binding，并且它是 `required-for-completion`。

`bindingId` 在 owner 内唯一。
role 默认可以重复；需要单例的 producer schema 另行声明。
binding 创建后不能改变 role、requirement 或 streamId。

owner 的后继 revision 可以把 open binding 单调推进到同 streamId 的后继 index。
closed 或 abandoned binding 不能重开或替换。
迟到事实使用新的 supplemental bindingId 与 streamId，并用 Claim 说明关联。

### Run、Attempt 与 Contribution

```ts
type RunState = "active" | "completed" | "incomplete" | "interrupted";
type AttemptState = "active" | "completed" | "abandoned";

interface ExpectedMembershipSlotV1 {
  readonly membershipSlot: string;
  readonly evalId: string;
}

interface ExpectedMembershipSlotSelectorV1 {
  readonly schema: "niceeval.expected-membership-slot-selector/1";
  readonly value: {
    readonly runId: string;
    readonly membershipSlot: string;
    readonly evalId: string;
  };
}

interface RunPayloadV1 {
  schema: "niceeval.run/1";
  runId: string;
  revision: number;
  previous: NodeRefV1 | null;
  invocationId: string;
  experimentId: string;
  provenance: NodeRefV1;
  state: RunState;
  streams: readonly StreamBindingV1[];
  expectedMembershipSlots: readonly ExpectedMembershipSlotV1[];
  contributions: readonly {
    membershipSlot: string;
    contributionId: string;
    node: NodeRefV1;
  }[];
}

interface AttemptIdentityV1 {
  readonly attemptId: AttemptId;
  readonly locator: AttemptLocator;
  readonly evalId: string;
  readonly ordinal: number;
}

interface AttemptPayloadV1 {
  readonly schema: "niceeval.attempt/1";
  readonly revision: number;
  readonly previous: NodeRefV1 | null;
  readonly identity: AttemptIdentityV1;
  readonly originRunId: string;
  readonly provenance: NodeRefV1;
  readonly state: AttemptState;
  readonly streams: readonly StreamBindingV1[];
}

type ContributionMode = "executed" | "carried" | "accepted" | "renamed";

interface RunContributionV1 {
  schema: "niceeval.run-contribution/1";
  contributionId: string;
  revision: number;
  previous: NodeRefV1 | null;
  supersedes: NodeRefV1 | null;
  runId: string;
  evalId: string;
  membershipSlot: string;
  mode: ContributionMode;
  attempt: {
    attemptId: AttemptId;
    adopted: NodeRefV1;
  };
  basisClaims: readonly {
    claimId: string;
    node: NodeRefV1;
  }[];
}
```

Run payload 的 `streams` 按 bindingId UTF-8 bytes 升序且唯一；`expectedMembershipSlots` 与
`contributions` 都按 membershipSlot UTF-8 bytes 升序且唯一。expected slot 在 revision 0 建立后不能
增加、删除或改变 evalId；每个 contribution 必须命中一个 expected slot，且两边 evalId 相同。
Contribution 的 `basisClaims` 先按 claimId、再按完整 node ref 的 JCS UTF-8 bytes升序；完全相同项
不得重复。

Run GraphNode 先形成以下完整 edge 序列，再使用本章统一的 128-edge dependency chain：

1. previous 非 null 时先写 `niceeval.run-previous`；
2. 写唯一 `niceeval.run-provenance`；
3. 按 payload streams 顺序写 `niceeval.run-stream-index`；
4. 按 payload contributions 顺序写 `niceeval.run-current-contribution`。

Contribution GraphNode 同样先形成以下完整 edge 序列，再使用统一 dependency chain：

1. previous 非 null 时写 `niceeval.contribution-previous`；
2. supersedes 非 null 时写 `niceeval.contribution-supersedes`；
3. 写唯一 `niceeval.contribution-adopted-attempt`；
4. 按 payload basisClaims 顺序写 `niceeval.contribution-basis-claim`。

每条 edge target 必须逐项等于对应 payload NodeRef。Run current-contribution edge 还绑定同一 payload item
的 membershipSlot 与 contributionId；Contribution adopted-attempt edge 还绑定 payload attemptId。decoder
按以上 relation、ordinal、target 与 payload field 共同验证，不能只看 target 是否可达。

Attempt GraphNode 的完整 edge 序列也唯一：

1. previous 非 null 时先写 `niceeval.attempt-previous`；
2. 写唯一 `niceeval.attempt-provenance`；
3. 按 payload streams 顺序写 `niceeval.attempt-stream-index`。

该序列使用同一 dependency chain。revision、previous、provenance、每个 binding index、relation 与
flattened ordinal 必须逐项相等。

revision 0 的 previous 必须为 null。后继 revision 必须指向同 attemptId 的直接前驱；identity 与
originRunId 全部不变。

Invocation 只存在于 Run provenance、Live 和 receipt，不进入 entity catalog。
一次 Invocation 可以产生零到多个 Run；每个 Run 恰属一个 Invocation 与一个 Experiment。

Attempt 永远归 origin Run。
`executed` contribution 创建并采用该 Run 新执行的 Attempt；其它 mode 采用已有 Attempt，不复制事实、不改变 owner。
adopted Attempt 必须来自同一个 recordId，并且它的 GraphRef 已登记在同一 Store 的 committedRoots。
跨 Record 数据只能先通过显式导出生成 Sample 或 SampleBundle，不能让 Contribution 形成隐藏的跨 Store 强边。

每个 `membershipSlot` 在 Run 内唯一，并稳定映射同一个 contributionId。
Run node 只对已有 Contribution 的 slot 写 current revision strong edge；其 payload contributions 必须是
expectedMembershipSlots 的子集。Sample 在固定 GraphRef 中枚举完整 expected set，因此每个 expected
slot 恰有一个 coverage row：有 current edge 时含 member，没有时是 authenticated not-recorded。

Contribution revision 严格线性：

- revision 0 的 previous 与 supersedes 都是 null；
- 后继的 previous 与 supersedes 都指向直接前驱，并写 strong edge；
- contributionId、runId、evalId、membershipSlot、mode 和 attemptId 永不改变；
- adopted 只能推进到同一 Attempt 的已验证后继 revision；
- basisClaims 保存完整 typed NodeRef，不能只写 claimId。

迟到事实先形成同 attemptId 的新 Attempt revision。
writer 再形成同 contributionId 的新 Contribution revision，并更新同 runId 的 Run revision。
completed Run 的 lifecycle 事实和 completion 不被改写；新的 supplemental binding 与 adoption Claim 解释新增事实。

历史 GraphRef 仍读取旧 Run、Contribution 和 Attempt。
选择不同 attemptId 不是迟到事实更新，必须进入新的 Run 或新的 membership slot。

### revision 与 strong edge 矩阵

| owner node | 必须写 strong edge 的引用 |
|---|---|
| Record subject | previous subject、catalog root、locator index root |
| catalog branch / leaf | child branch或当前 entity |
| locator branch / leaf | child branch或当前 Attempt |
| Run | previous、provenance、每条 stream index、每个 current Contribution |
| Attempt | previous、provenance、每条 stream index |
| Contribution | previous、supersedes、adopted Attempt、每条 basis Claim |
| stream index | previous index、first segment page |
| segment page | 每条 segment、next page |
| segment | 每个 `externalObjects` node |
| Claim | 每个本地 EvidenceTarget 指向的 node |

payload 中的 NodeRef 与 dependency edges 必须逐项一致。所有本节已知 payload 都使用前文唯一 edge
顺序与 canonical dependency chain。

替代分页、空 EdgePage、漏 edge、多 edge、错误 relation 或错误 page/flattened ordinal 都是
`domain-edge-contract-invalid`。
领域 ID 可以作为普通字段出现，但不能冒充 strong edge。

## Observation stream

```ts
type StreamState = "open" | "closed" | "abandoned";

interface ObservationStreamIndexV1 {
  schema: "niceeval.observation-stream-index/1";
  streamId: string;
  revision: number;
  previous: NodeRefV1 | null;
  scope:
    | { kind: "run"; runId: string; experimentId: string }
    | {
        kind: "attempt";
        runId: string;
        experimentId: string;
        attemptId: AttemptId;
        evalId: string;
        agentSessionId?: string;
        turnId?: string;
      };
  state: StreamState;
  leafCount: number;
  throughSequence: number | null;
  merkleRoot: DigestV1;
  firstSegmentPage: NodeRefV1 | null;
}

interface ObservationSegmentPageV1 {
  schema: "niceeval.observation-segment-page/1";
  streamId: string;
  entries: readonly {
    firstSequence: number;
    lastSequence: number;
    segment: NodeRefV1;
  }[];
  next: NodeRefV1 | null;
}

interface ObservationSegmentV1 {
  schema: "niceeval.observation-segment/1";
  streamId: string;
  firstSequence: number;
  events: readonly ObservationEvent[];
  externalObjects: readonly NodeRefV1[];
}
```

sequence 从 0 连续递增。
空流的 leafCount 为 0，throughSequence 为 null；非空流满足 `throughSequence = leafCount - 1`。
segment 必须非空；其中第 i 条 event 的 streamId 与 segment 相同，sequence 等于 `firstSequence + i`。
page entry 的 firstSequence、lastSequence 必须与目标 segment 完全一致。
page 和 segment 在整个 prefix 中无缺口、无重叠；page 对 segment 与 next 写 strong edge。

一条事件不能跨 segment。
event 的规范字节是其对象独立执行 JCS 后的结果，不包含 segment 外壳。
`externalObjects` 是全部 event schema 解码后引用的外部 NodeRef 的集合，按完整 ref 的 JCS UTF-8 bytes
升序、去重；没有外部对象时是 `[]`。segment node 的 dependency edges 必须精确列出该数组，不能扫描
任意 JSON 猜引用，也不能藏入 payload 中未列出的 typed object。

stream 家族的完整 edge 序列与分页固定如下：

1. Stream index：previous 非 null 时先写 `niceeval.stream-previous`，随后在 firstSegmentPage 非 null
   时写 `niceeval.stream-segment-page-first`。
2. Segment page：按 entries 顺序写 `niceeval.stream-segment`，最后在 next 非 null 时写
   `niceeval.stream-segment-page-next`。
3. Segment：按 `externalObjects` 顺序写 `niceeval.observation-external-object`。

三者都把以上完整序列交给统一的 128-edge dependency chain。payload item、relation、flattened ordinal
与 target 必须逐项相等；空序列必须是 `dependencies: null`。

Segment page entries 按 firstSequence 严格升序。除最后一页外，next 不能为 null；next 链不得成环或
跳过 sequence。

Stream index 的 firstSegmentPage 为 null 当且仅当 leafCount 为 0。非空时，从 page 链重建出的 entries
必须连续对应 `0..throughSequence`，也不能多出 segment。

open stream 的每个 index revision 承诺当时已经 durable 的 prefix。
后继只能 append，不能修改既有叶、回退 sequence 或改变 scope。
closed 与 abandoned 是终态。

### Merkle commitment

event tree v1 固定使用 SHA-256。
`ascii()` 和 `utf8()` 不带结尾零字节；`u32be()`、`u64be()` 是无符号大端整数；digest operand 使用 32-byte 原始值，不拼 digest 字符串。

每个事件叶使用规范 event bytes 计算：

```text
leaf = SHA256(
  0x00
  || ascii("niceeval:event-leaf:v1")
  || u32be(byteLength(utf8(streamId)))
  || utf8(streamId)
  || u64be(sequence)
  || u64be(byteLength(canonicalEventBytes))
  || canonicalEventBytes
)

node = SHA256(
  0x01
  || ascii("niceeval:event-node:v1")
  || left
  || right
)

emptyTree = SHA256(0x02 || ascii("niceeval:event-empty:v1"))

commitment = SHA256(
  0x03
  || ascii("niceeval:event-tree:v1")
  || u64be(leafCount)
  || treeRoot
)
```

空流的 treeRoot 是 emptyTree；非空流从相邻叶开始逐层两两合并。
某层最后一个 node 没有右 sibling 时原样提升到下一层，不能 duplicate-last。
`ObservationStreamIndexV1.merkleRoot` 是 `sha256:` 加 commitment 的 64 个小写十六进制字符。

proof 必须承诺 leaf ordinal 与 leafCount。
每个 sibling 也使用 `sha256:` 规范字符串携带；verifier 按 ordinal 逐层确定左右顺序，并拒绝 proof 长度、提升位置或最终 commitment 不一致。

event 的证据身份是 `{streamId, sequence, eventId}`。
eventId 必须等于 canonical event bytes 中解码出的 `id`；writer 还要拒绝同一 stream 中重复 eventId。
单条 inclusion proof 不负责证明全流 eventId 唯一，真实性不依赖这项全局性质。

v1 不定义 Claim 或 Observation 的二级 query index。Projector 若要证明“所有满足条件的事件”，必须
遍历固定 stream index 承诺的完整 prefix，并让该 prefix 的每个 segment 都进入 basedOn；它不能只带
命中的几条 event 并声称查询完备。只有 closed stream 的完整 prefix 能证明终局完备；open stream
只能证明固定时点的已提交 prefix。任何依赖“以后也不会再出现”的判断都必须返回 incomplete / unavailable。

## Observation envelope 与 transformation

```ts
interface RedactionPolicyIdV1 {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}

type EvidenceTransformationV1 =
  | {
      readonly kind: "redacted";
      readonly selector: VersionedSelector;
      readonly policy: RedactionPolicyIdV1;
    }
  | {
      readonly kind: "truncated";
      readonly selector: VersionedSelector;
      readonly inputBytes: number;
    };

interface ObservationEvent<T extends JsonValue = JsonValue> {
  format: "niceeval.observation";
  id: string;
  name: string;
  schema: string;
  stream: { id: string; sequence: number };
  scope: ObservationStreamIndexV1["scope"];
  time: {
    observedAt: string;
    monotonicOffsetNs: string;
    occurredAt?: string;
  };
  source: {
    component: string;
    version?: string;
    adapter?: string;
    mapperVersion?: string;
  };
  correlation?: {
    parentEventId?: string;
    traceId?: string;
    spanId?: string;
  };
  transformations: readonly EvidenceTransformationV1[];
  body: T;
}

interface TransformedEvidenceV1 {
  readonly schema: "niceeval.transformed-evidence/1";
  readonly result: NodeRefV1;
  readonly transformations: readonly [
    EvidenceTransformationV1,
    ...EvidenceTransformationV1[],
  ];
}
```

`RedactionPolicyIdV1` 的三个字符串都非空且不含 NUL。`inputBytes` 是 JSON-safe unsigned integer，
表示该 truncated step 在全部前序 step 之后看到的即时 selected input 字节数。JSON 按 RFC 8785 JCS
bytes 计量，包含字符串引号与转义；非 JSON 的计量由精确 representation capability 唯一定义。
它不是最初未 transformation 值的宽泛输入长度。持久化内容不保存 original ref、value、hash 或 length，
也没有顶层 `selector`、`resultSelector` 或同义替代字段。

`ObservationEvent.transformations` 可以为空。非空的 event 序列与 wrapper 序列都满足同一规则：
全部 selector 的 `schema` 字符串逐字相同；所有 `redacted` 条目都在所有 `truncated` 条目之前；
输入顺序与重复条目都保留。未知 selector schema 与未知 policy ID 按原有 JSON 结构保存，不改写为
某个已知选择器或 policy。

内存中的 composition 先展平 inner sequence，再接上 outer sequence，不重排任一 step。两侧必须确认
同一个 logical evidence root；否则 writer 以 `logical-root-mismatch` 拒绝，不能把两个根拼成一个 wrapper。

`TransformedEvidenceV1` 使用 media type
`application/vnd.niceeval.transformed-evidence.v1+jcs`。它的 GraphNode 只有 ordinal 0 的一条
strong edge：`niceeval.transformed-evidence-result` 指向 `result`。它恰有一个 dependency EdgePage，
且 `pages: []`。wrapper 不分页，和所有对象一样受 16 MiB 的 `RECORD_FILE_MAX_BYTES` 限制。

结果 node 不能是另一个 `TransformedEvidenceV1` wrapper。payload 内的 `result` 与这条 edge target
必须逐项相等。

protocol 导出 `validateEvidenceTransformationSequenceV1`、`validateTransformedEvidenceV1` 与
`validateTransformedEvidenceResultEdgeV1`，供 writer 与 verifier 调用。它们只检查可见的本地形状和 edge
合同。读取目标 payload 后确认非嵌套 wrapper 属于跨对象检查，不能被单纯 Schema shape 伪装成已经证明。

`name` 与 body `schema` 独立版本化。未知事件作为 opaque event 保留，不让无关 Projector 或整个 Run
失效。

Adapter 产生完整内存事件。Record serialization policy 在持久化与离开进程前执行凭据替换和预算
transformation。redacted transformation 只保存 selector 与 policy ID，绝不保存原值或秘密。

单个 envelope 最大 1 MiB。更大的完整 payload 使用独立 typed object 与 strong edge，或按 event schema
的固定规则 transformation。大型非 event 证据使用 `TransformedEvidenceV1`，只保存结果 node 与
transformation metadata。

## LifecyclePhase 与 Usage

`LifecyclePhase` 是 Runner 绑定的闭集，不是 Adapter 扩展点。
开放工作类型使用独立 activity key。

```ts
type LifecyclePhase =
  | "judge.precheck"
  | "experiment.setup"
  | "experiment.teardown"
  | "sandbox.queue"
  | "sandbox.create"
  | "sandbox.prepare"
  | "sandbox.prepare.eval"
  | "sandbox.prepare.experiment"
  | "agent.ensure"
  | "workspace.baseline"
  | "agent.setup"
  | "telemetry.configure"
  | "eval.run"
  | "agent.run"
  | "workspace.diff"
  | "assertions.evaluate"
  | "telemetry.collect"
  | "agent.teardown"
  | "sandbox.cleanup"
  | "sandbox.suspend"
  | "sandbox.stop";
```

provider 或 Agent 实际返回的 Usage 是 Observation：

```ts
interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  requests?: number;
  costUSD?: number;
}
```

inputTokens、cacheReadTokens 与 cacheCreationTokens 是互斥输入桶。
reasoningTokens 是 outputTokens 的已含明细；costUSD 只保存 provider 实际返回的账单。
协议未提供的字段保持缺失，不能填 0 或 1。
基于价格表估算的金额是 Claim，必须引用 Usage、价格表与算法。

## Provenance、Claim、EvidenceTarget 与归档

```ts
interface VersionedSelector {
  readonly schema: string;
  readonly value: JsonValue;
}

interface StreamTailAbsenceSelectorV1 {
  readonly schema: "niceeval.stream-tail-absence-selector/1";
  readonly value: {
    readonly streamId: string;
    readonly afterSequence: number | null;
  };
}

type AuthenticatedAbsenceIndexV1 =
  | {
      readonly kind: "entity-catalog";
      readonly catalog: NodeRefV1;
      readonly selector: EntityCatalogSelectorV1;
      readonly nonmembership: EntityNonMembershipProofV1;
    }
  | {
      readonly kind: "attempt-locator";
      readonly index: NodeRefV1;
      readonly selector: AttemptLocatorSelectorV1;
      readonly nonmembership: AttemptLocatorNonMembershipProofV1;
    }
  | {
      readonly kind: "stream-tail";
      readonly index: NodeRefV1;
      readonly selector: StreamTailAbsenceSelectorV1;
      readonly closed: true;
      readonly pinnedThroughSequence: number | null;
      readonly completePrefix: AuthenticatedStreamTailProofV1;
    };

interface AuthenticatedStreamTailProofV1 {
  readonly schema: "niceeval.authenticated-stream-tail-proof/1";
  readonly source: RecordGraphRef;
  readonly selector: StreamTailAbsenceSelectorV1;
  readonly streamId: string;
  readonly index: NodeRefV1;
  readonly closed: true;
  readonly pinnedThroughSequence: number | null;
  readonly firstSegmentPage: NodeRefV1 | null;
  readonly path: readonly RecordEvidencePathStepV1[];
}

type EvidenceTarget =
  | {
      readonly kind: "event";
      readonly stream: { readonly streamId: string; readonly index: NodeRefV1 };
      readonly sequence: number;
      readonly eventId: string;
    }
  | {
      readonly kind: "object";
      readonly node: NodeRefV1;
      readonly selector?: VersionedSelector;
    }
  | {
      readonly kind: "claim";
      readonly node: NodeRefV1;
      readonly claimId: string;
    }
  | {
      readonly kind: "absence";
      readonly selector: VersionedSelector;
      readonly index: AuthenticatedAbsenceIndexV1;
    };

interface EvidenceRef {
  readonly source: RecordGraphRef;
  readonly target: EvidenceTarget;
}

interface Claim<T extends JsonValue = JsonValue> {
  readonly id: string;
  readonly kind: string;
  readonly schema: string;
  readonly value: T;
  readonly evaluator: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly model?: string;
  };
  readonly basedOn: readonly EvidenceTarget[];
  readonly producedAt: string;
}

interface ClaimPayloadV1 {
  readonly schema: "niceeval.claim/1";
  readonly scope:
    | { readonly kind: "run"; readonly runId: string }
    | { readonly kind: "attempt"; readonly attemptId: AttemptId };
  readonly claim: Claim;
}
```

持久化 Claim 只保存 source-local target，不保存最终 GraphRootRef。event target 固定 stream
index revision、sequence 与 eventId。Claim node 对必需 index 写 strong edge。

Claim 是 immutable entity，没有 revision/previous。`claim.basedOn` 在写入前按完整 `EvidenceTarget` 的
JCS UTF-8 bytes 去重并升序；decoder 拒绝其它顺序。

Claim GraphNode 依次为每个 basedOn target 形成一条 edge，并使用统一 dependency chain：

| target kind | relation | edge target |
|---|---|---|
| event | `niceeval.claim-basis-event-index` | stream index |
| object | `niceeval.claim-basis-object` | node |
| claim | `niceeval.claim-basis-claim` | node |
| absence | `niceeval.claim-basis-absence-index` | variant 的 catalog/index |

relation、flattened ordinal 与 target 必须逐项对应同序 basedOn item。没有 basis 时 dependencies 必须为
null。

Reader 在固定 GraphRef 中验证 catalog membership 或 stream lineage，才组合 `EvidenceRef`。

absence 不是 `null`。它带 versioned selector 和已认证的 entity-catalog、attempt-locator 或
stream-tail index。

只有已验证 selector 缺失才是 absence。
entity 与 locator 查询必须有各自 radix 的 authenticated nonmembership。
stream-tail 只证明 closed stream 的终点之后没有事件；它必须归档完整 prefix，并以
`pinnedThroughSequence` 固定终点。

entity-catalog absence 外层 `EvidenceTarget.selector` 与 index 内 `selector` 的 JCS bytes 必须相等；
`selector.value` 与 `nonmembership.keyPreimage` 的 JCS bytes 必须相等。proof 的 `catalog` 必须等于
index catalog；`key` 必须按 entity catalog key 规则复算。kind、id 或任一 selector bytes 不同都不是
同一 absence。selector wrapper 与 key preimage 是两层不同 schema，禁止把整个 wrapper 误写成
key preimage。

attempt-locator absence 外层 selector、index 内 selector 与 nonmembership proof selector 的 JCS bytes
必须相等。`selector.value.locator` 必须逐字等于 `keyPreimage.locator`；key preimage 的 schema 仍是
`niceeval.attempt-locator-key/1`。proof key 还必须满足 locator index 的复算规则。

stream-tail absence 按以下等式绑定：

1. 外层 selector、index variant selector 与 completePrefix selector 的 JCS bytes 相等。
2. 三处 index 是同一个 NodeRef；completePrefix.source 等于 EvidenceRef.source。
3. selector.value.streamId、completePrefix.streamId 与已归档 stream payload 的 streamId 逐字相等。
4. selector.value.afterSequence、两处 pinnedThroughSequence 与 stream payload.throughSequence 四者相等；
   空流时都为 null。
5. stream payload 的 state 是 closed，firstSegmentPage 与 proof 相等，path 终止于该 index。

这个 proof 只表达“终点之后无事件”。它不能证明完整 prefix 中任意 eventId、name 或 predicate 不存在。

v1 没有一般性的 Claim/Observation predicate absence：精确 Claim ID 缺失可用 entity-catalog；事件
集合的终点完备性只能用 closed stream-tail。其它 predicate 缺失必须保持 unavailable，不能伪造索引
proof。

stream-tail 的 `index`、`firstSegmentPage` 与 `pinnedThroughSequence` 必须逐字等于已归档的
closed `ObservationStreamIndexV1`。从 first page 到该边界的每个 segment page 与 segment 都必须
进入 proof archive，不能只归档命中的事件。

目标 object 缺失或 digest 损坏永远是 corrupt read。Attempt identity 与 Provenance 都使用
`kind: "object"` 的 evidence，不把它们降格成 event 或调用方声称的 metadata。

```text
Graph root -> Claim -> stream index
            不存在 Claim -> 同一个 Graph root digest
```

这个分层避免内容哈希自引用。历史 Claim 的 value 与 basis verification 是两条轴；Claim node
可读时可返回历史 value，basis 无法复核时才降为 unverified。Claim node 自身缺失或损坏时，
value 才 unavailable。

### archive node 与 canonical bytes

archive 专用 media type 是它们承载的 `GraphNodeV1.payload` Descriptor 的 media type，绝不是
`NodeRefV1.mediaType`。每个下列公开 ref 都是 branded `NodeRefV1`；运行时 decoder 必须先验证
该 ref 指向 GraphNode，再验证 payload 的 exact media type，不能只信 TypeScript 品牌。

```ts
declare const archivedBytesChunkBrand: unique symbol;
declare const archivedChunkPageBrand: unique symbol;
declare const archivedObjectBrand: unique symbol;
declare const archivedObjectTableBrand: unique symbol;
declare const archivedObjectTablePageBrand: unique symbol;
declare const recordEvidenceProofBrand: unique symbol;
declare const recordEvidenceProofIndexBrand: unique symbol;
declare const recordEvidenceProofIndexPageBrand: unique symbol;

type ArchivedBytesChunkNodeRefV1 = NodeRefV1 & {
  readonly [archivedBytesChunkBrand]: "niceeval.archived-bytes-chunk/1";
};
type ArchivedChunkPageNodeRefV1 = NodeRefV1 & {
  readonly [archivedChunkPageBrand]: "niceeval.archived-chunk-page/1";
};
type ArchivedObjectNodeRefV1 = NodeRefV1 & {
  readonly [archivedObjectBrand]: "niceeval.archived-object/1";
};
type ArchivedObjectTableNodeRefV1 = NodeRefV1 & {
  readonly [archivedObjectTableBrand]: "niceeval.archived-object-table/1";
};
type ArchivedObjectTablePageNodeRefV1 = NodeRefV1 & {
  readonly [archivedObjectTablePageBrand]: "niceeval.archived-object-table-page/1";
};
type RecordEvidenceProofNodeRefV1 = NodeRefV1 & {
  readonly [recordEvidenceProofBrand]: "niceeval.record-evidence-proof/1";
};
type RecordEvidenceProofIndexRefV1 = NodeRefV1 & {
  readonly [recordEvidenceProofIndexBrand]: "niceeval.record-evidence-proof-index/1";
};
type RecordEvidenceProofIndexPageNodeRefV1 = NodeRefV1 & {
  readonly [recordEvidenceProofIndexPageBrand]: "niceeval.record-evidence-proof-index-page/1";
};

interface ArchiveIdPreimageV1 {
  readonly schema: "niceeval.archive-id/1";
  readonly descriptor: DescriptorV1;
}

type ArchiveIdV1 = string; // "sha256:" + lowercaseHex(SHA256(JCS(ArchiveIdPreimageV1)))

interface ArchivedBytesChunkV1 {
  readonly schema: "niceeval.archived-bytes-chunk/1";
  readonly archiveId: ArchiveIdV1;
  readonly ordinal: number;
  readonly decodedBytes: number;
  readonly dataBase64: string;
}

interface ArchivedChunkPageV1 {
  readonly schema: "niceeval.archived-chunk-page/1";
  readonly archiveId: ArchiveIdV1;
  readonly firstOrdinal: number;
  readonly chunks: readonly ArchivedBytesChunkNodeRefV1[];
  readonly next: ArchivedChunkPageNodeRefV1 | null;
}

interface ArchivedObjectV1 {
  readonly schema: "niceeval.archived-object/1";
  readonly archiveId: ArchiveIdV1;
  readonly descriptorJcsBase64: string;
  readonly decodedBytes: number;
  readonly chunkCount: number;
  readonly firstChunkPage: ArchivedChunkPageNodeRefV1 | null;
}

interface ArchivedObjectTableEntryV1 {
  readonly archiveId: ArchiveIdV1;
  readonly descriptor: DescriptorV1;
  readonly object: ArchivedObjectNodeRefV1;
}

interface ArchivedObjectTableV1 {
  readonly schema: "niceeval.archived-object-table/1";
  readonly entryCount: number;
  readonly firstPage: ArchivedObjectTablePageNodeRefV1 | null;
}

interface ArchivedObjectTablePageV1 {
  readonly schema: "niceeval.archived-object-table-page/1";
  readonly entries: readonly ArchivedObjectTableEntryV1[];
  readonly next: ArchivedObjectTablePageNodeRefV1 | null;
}
```

| payload | 精确的 GraphNode payload media type |
|---|---|
| `ArchivedBytesChunkV1` | `application/vnd.niceeval.archived-bytes-chunk+json;v=1` |
| `ArchivedChunkPageV1` | `application/vnd.niceeval.archived-chunk-page+json;v=1` |
| `ArchivedObjectV1` | `application/vnd.niceeval.archived-object+json;v=1` |
| `ArchivedObjectTableV1` | `application/vnd.niceeval.archived-object-table+json;v=1` |
| `ArchivedObjectTablePageV1` | `application/vnd.niceeval.archived-object-table-page+json;v=1` |
| `RecordEvidenceProofV1` | `application/vnd.niceeval.record-evidence-proof+json;v=1` |
| `RecordEvidenceProofIndexV1` | `application/vnd.niceeval.record-evidence-proof-index+json;v=1` |
| `RecordEvidenceProofIndexPageV1` | `application/vnd.niceeval.record-evidence-proof-index-page+json;v=1` |

raw archive bytes 使用 `ARCHIVE_CHUNK_BYTES = 1_048_576`。每页最多
`ARCHIVE_PAGE_ENTRIES = 128` 个 chunk、table entry 或 proof entry。

`ArchiveIdV1` 固定为 `SHA256(JCS({ schema: "niceeval.archive-id/1", descriptor }))`，字符串形态恰为
`sha256:` 加 32-byte digest 的 64 个小写十六进制字符。`RecordEvidenceProofKeyV1` 使用同一形态。
preimage 不再额外拼入 raw bytes，因为完整 Descriptor 已以 digest 和 size 绑定原始字节。

`decodedBytes: 0` 合法，且必须有 `chunkCount: 0` 与 `firstChunkPage: null`。非空 object 按 1 MiB
切分，除末块外每个 chunk 恰满。ordinal 从 0 连续递增，所有 chunk 的 `decodedBytes` 之和恰等于
object 的 `decodedBytes` 与 Descriptor 的 size。

`dataBase64` 与 `descriptorJcsBase64` 只接受 RFC 4648 standard alphabet、必需 padding 且无
whitespace；canonical encoder 不能省略 padding 或使用 URL-safe alphabet。`descriptorJcsBase64`
解码后必须逐字节等于该 object Descriptor 的 RFC 8785 JCS 无 BOM UTF-8 bytes；decoder 重新编码并
复核相等。

decoder 逐块复核 data base64 形状、`decodedBytes`、非末块的 1 MiB 长度、concat size、descriptor
digest 与 media decoder。ChunkPage 除末页外恰有 128 chunk；TablePage 与 ProofIndexPage 除末页外
也恰有 128 entry。

ArchivedObjectTable 只有在空表时才有 `entryCount: 0` 和 `firstPage: null`，不存在 empty
table page。entry 先按 archiveId、再按 descriptor JCS UTF-8 bytes 排序；只有完整 descriptor
与 raw bytes 相同时才能 dedupe。相同 archiveId 对应不同 bytes 是 collision。每个 non-final
page 恰有 128 entry。其 object 是 inert archived bytes，不是 active source payload。

archive/proof GraphNode wrapper 在无 edge 时必须 `dependencies: null`。否则恰有一个
`pages: []` 的 EdgePage。edge list 必须精确：

- chunk leaf 无 edge。
- ArchivedObject 只有 `niceeval.archive-chunk-page-first`。
- ChunkPage 先按 chunk 顺序写每条 `niceeval.archive-chunk`，再写可选
  `niceeval.archive-chunk-page-next`。
- ObjectTable 只有 `niceeval.archive-object-table-page-first`。
- TablePage 先按 entry 顺序写每条 `niceeval.archive-object`，再写可选
  `niceeval.archive-object-table-page-next`。

所有 payload ref、edge target 与 ordinal 必须逐项一致。

### 统一的 Record evidence proof

```ts
type RecordEvidencePathStepV1 =
  | {
      readonly kind: "graph-subject";
      readonly from: GraphRootRefV1;
      readonly relation: "niceeval.graph-subject";
      readonly to: NodeRefV1;
    }
  | {
      readonly kind: "node-dependencies";
      readonly from: NodeRefV1;
      readonly relation: "niceeval.node-dependencies";
      readonly to: EdgePageRefV1;
    }
  | {
      readonly kind: "edge-page";
      readonly from: EdgePageRefV1;
      readonly pageOrdinal: number;
      readonly relation: "niceeval.edge-page-child";
      readonly to: EdgePageRefV1;
    }
  | {
      readonly kind: "strong-edge";
      readonly from: EdgePageRefV1;
      readonly edgeOrdinal: number;
      readonly relation: string;
      readonly to: NodeRefV1;
    };

interface RecordEvidenceArchiveRefV1 {
  readonly archiveId: ArchiveIdV1;
  readonly descriptor: DescriptorV1;
}

interface RecordEvidenceProofBaseV1 {
  readonly schema: "niceeval.record-evidence-proof/1";
  readonly source: RecordGraphRef;
  readonly graphRoot: GraphRootRefV1;
  readonly subject: NodeRefV1;
  readonly catalog: NodeRefV1;
  readonly objectTable: ArchivedObjectTableNodeRefV1;
  readonly target: EvidenceTarget;
  readonly path: readonly RecordEvidencePathStepV1[];
  readonly archives: readonly RecordEvidenceArchiveRefV1[];
}

interface EventEvidenceProofV1 extends RecordEvidenceProofBaseV1 {
  readonly kind: "event";
  readonly target: Extract<EvidenceTarget, { readonly kind: "event" }>;
  readonly streamIndex: NodeRefV1;
  readonly segment: NodeRefV1;
  readonly event: {
    readonly streamId: string;
    readonly sequence: number;
    readonly eventId: string;
    readonly segmentEventOrdinal: number;
  };
  readonly leafCount: number;
  readonly merklePath: readonly DigestV1[];
}

interface ObjectEvidenceProofV1 extends RecordEvidenceProofBaseV1 {
  readonly kind: "object";
  readonly target: Extract<EvidenceTarget, { readonly kind: "object" }>;
  readonly object: RecordEvidenceArchiveRefV1;
}

interface ClaimEvidenceProofV1 extends RecordEvidenceProofBaseV1 {
  readonly kind: "claim";
  readonly target: Extract<EvidenceTarget, { readonly kind: "claim" }>;
  readonly claim: RecordEvidenceArchiveRefV1;
  readonly basedOn: readonly EvidenceRef[];
}

interface AbsenceEvidenceProofV1 extends RecordEvidenceProofBaseV1 {
  readonly kind: "absence";
  readonly target: Extract<EvidenceTarget, { readonly kind: "absence" }>;
  readonly absence: AuthenticatedAbsenceIndexV1;
}

type RecordEvidenceProofV1 =
  | EventEvidenceProofV1
  | ObjectEvidenceProofV1
  | ClaimEvidenceProofV1
  | AbsenceEvidenceProofV1;

interface RecordEvidenceProofIndexV1 {
  readonly schema: "niceeval.record-evidence-proof-index/1";
  readonly objectTable: ArchivedObjectTableNodeRefV1;
  readonly proofCount: number;
  readonly firstPage: RecordEvidenceProofIndexPageNodeRefV1 | null;
}

type RecordEvidenceProofKeyV1 = DigestV1; // "sha256:" + lowercaseHex(SHA256(JCS(EvidenceRef)))

interface RecordEvidenceProofIndexEntryV1 {
  readonly key: RecordEvidenceProofKeyV1;
  readonly evidence: EvidenceRef;
  readonly proof: RecordEvidenceProofNodeRefV1;
}

interface RecordEvidenceProofIndexPageV1 {
  readonly schema: "niceeval.record-evidence-proof-index-page/1";
  readonly entries: readonly RecordEvidenceProofIndexEntryV1[];
  readonly next: RecordEvidenceProofIndexPageNodeRefV1 | null;
}
```

所有 reader trace 都是 `EvidenceRef`。nested trace flatten 后按完整 EvidenceRef 的 JCS UTF-8 bytes
升序并去重；nested Projector 不会创建另一种 projection-proof。

每份 proof 的 `archives` 是下列集合的精确 union，不能带未引用项：

1. base 的 graphRoot、subject、catalog，以及 target/变体字段直接列出的每个 source descriptor 的原始
   bytes；
2. `path` 每步 `from` 与 `to` 的原始 bytes；
3. 验证上述 NodeRef 所必需的每个 GraphNode payload descriptor 与 payload 原始 bytes；
4. object/Claim target GraphNode 的完整 canonical dependency-page chain，但不递归加入 edge target；
5. 该 proof 变体直接披露的 event segment、radix path/terminal、closed stream 完整 prefix，以及这些
   披露对象的 GraphNode/payload/dependency-page bytes。

第 4 项让 object proof 不只证明“某个 GraphNode bytes 存在”，还足以离线复核该已知 payload 自己的
edge contract；递归对象仍必须由独立 EvidenceRef/proof 引入。集合先按 archiveId、再按完整 descriptor
的 JCS UTF-8 bytes 升序；同一完整 pair 只出现一次，相同 archiveId 对应不同 descriptor 或 bytes 是
collision。encoder 在分页与摘要前完成规范化，decoder 按同一方程重建集合并拒绝乱序、重复、缺项或
额外项。

`path`、event `merklePath` 与 Claim `basedOn` 是有语义的有序路径，不参与集合排序。它们分别由
Graph root 到 target、leaf 到 commitment，以及源 Claim payload 的原顺序唯一决定。所有
`DigestV1` 字段全部按 format v1 的固定 SHA-256 形状验证；archive id、proof key 与 Merkle sibling
同样只能是 `sha256:` 加 64 个小写十六进制字符。

`source.graph` 必须等于 `graphRoot`。path 非空，第一步必须是唯一的 `graph-subject`：from 等于
graphRoot、to 等于 subject，并且已归档 GraphRoot payload 的 subject 也逐项相等。后续每两步满足前一步
to 与后一步 from 的完整 Descriptor JCS bytes 相等。

四种 transition 的验证语义固定：

- `node-dependencies` 等于已归档 GraphNode 的非 null dependencies；
- `edge-page` 的 pageOrdinal 是已归档 EdgePage.pages 的有效 page-local ordinal，且 target 相等；
- `strong-edge` 的 edgeOrdinal 是已归档 EdgePage.edges 的有效 page-local ordinal，relation 与 target
  逐项相等；
- graph-subject 只出现一次，并位于首项。

path 中所有 ordinal 都是 JSON safe unsigned integer。

已归档 subject payload 的 catalog 必须等于 proof.catalog。各变体终点如下：

| proof kind | path 必经节点 | path 终点 |
|---|---|---|
| event | target.stream.index 与 segment-page chain | proof.segment |
| object | 无额外固定节点 | target.node |
| claim | 无额外固定节点 | target.node |
| entity-catalog absence | proof.catalog | absence.catalog |
| attempt-locator absence | subject locator edge | absence.index |
| stream-tail absence | stream lineage | absence.index |

radix nonmembership 与完整 stream prefix 从终点继续由各自 proof 字段验证，不伪装成 strong-edge path
step。

若 object/Claim target 是 source catalog 的 current entity，合法候选 path 必须经过 proof.catalog、
对应 radix branch/leaf 与 `niceeval.entity-current` edge。历史 adopted revision 不在 current catalog 时，
才允许经其它已认证 strong path抵达。

所引用的 node、payload、page 与 canonical bytes 都必须按精确 archives 方程在 object table 中可重开。

四个变体的离线验证字段固定如下：

- event proof 固定 stream index、segment、事件三元组与 `segmentEventOrdinal`。verifier 从 object
  table 重开 segment GraphNode 与其 payload Descriptor。
  - 它用注册的 `application/vnd.niceeval.observation-segment.v1+jcs` decoder 取得
    `ObservationSegmentV1`。
  - ordinal 必须是有效无符号整数，`events[ordinal]` 必须存在，并满足
    `ordinal = sequence - firstSequence`。
  - 该 event 解码出的 streamId、sequence、id 必须与 proof 三元组逐项相等。
  - verifier 只对该 event 对象执行 RFC 8785 JCS，再以所得 canonical event bytes、`leafCount` 与
    `merklePath` 复核 stream commitment。
  - v1 不创建 synthetic event Descriptor，也不为 event bytes 建独立 archive。
- object proof 的 `object` archive 必须与 target node 的完整 Descriptor 相等；其 archives 还必须含
  target GraphNode payload 与完整 dependency-page chain。
  - selector 省略时证明整个 object。
  - `niceeval.expected-membership-slot-selector/1` 保留为内建 exact object representation key，且只接受
    Run payload。selector.value.runId 必须等于 payload.runId。
  - expectedMembershipSlots 中必须恰有一项同时等于 selector 的 membershipSlot 与 evalId。
  - payload.contributions 不得含该 membershipSlot；完整 dependency-page chain 也不得有对应的
    current-contribution edge。任一条件不满足都会使 selector proof 无效。
  - 其它 object selector 使用 `(selectorSchema, mediaType)` 的精确 representation capability，对
    archive 中的完整 payload 验证选择结果。
  - selector codec 缺失时，语义 EvidenceValue 是 `unsupported-schema`。codec 已知但精确
    representation capability 缺失时，才是 `unsupported-capability`。两种情况下结构 proof 仍可通过，
    不能把 artifact 说成 invalid，也不新增 `proof-unsupported`。已安装 capability 发现 selector 非法或
    archive 选择结果不符时，才是 proof target 或 artifact invalid。
  - `TransformedEvidenceV1` wrapper proof 可以只归档 metadata。它的语义 verifier 必须逐项确认
    wrapper payload `result`、wrapper strong-edge target 与 result EvidenceRef target 相等。
- Claim proof 的 `claim` archive 必须与 target node 相等。`basedOn` 是按 JCS bytes 去重并升序的
  `EvidenceRef`；每一项都必须在同一个 proof index 有唯一 entry，绝不递归内联另一个 proof。
- absence proof 的 `absence` 必须与 target.index 完全相同。entity 与 locator 查询必须携带对应 radix
  的 authenticated nonmembership。stream-tail 只接受 `closed: true`、
  `pinnedThroughSequence` 和完整 prefix proof。
  stream-tail 的 completePrefix.path 必须与 outer proof.path 的 JCS bytes 相等，不能提交两条不同的
  GraphRoot-to-index path。

proof index 使用与 object table 相同的 128-entry paging rule。每个 entry 的 `key` 固定为
`SHA256(JCS(evidence))`。

proof-index builder 只接收调用 owner 显式给出的 canonical direct EvidenceRef 集合。它先按完整
EvidenceRef 的 JCS UTF-8 bytes 去重并排序，再递归加入每个 Claim proof 源 payload 的全部 `basedOn`，
直至闭合。index entries 必须与这个 closure 一一对应：每个 direct 或递归 EvidenceRef 恰有一项，且
不得出现 closure 外项。每个 proof 只证明其 entry 的单个 `evidence`；不存在另一个 reader-trace 字段
可扩大或缩小它的证明范围。

entry 先按 key、再按完整 EvidenceRef 的 JCS UTF-8 bytes 排序。同 key 的不同 EvidenceRef JCS
bytes 是 collision，必须拒绝。proof ref 对应的完整 proof bytes 不同也必须拒绝。
每个 entry 的 proof `source` 与 `target` 必须逐项等于其 `evidence`，并且 key 必须复算相等。

未消费任何 EvidenceRef 时，`proofCount` 必为 0、`firstPage` 必为 null，且不存在 empty page。
只要消费 member 或 coverage evidence，`proofCount` 必非 0，proof index 也必须 nonempty。

ProofIndex EdgePage 先写唯一的 `niceeval.evidence-object-table` edge，再写可选
`niceeval.evidence-proof-index-page-first`。IndexPage 先按 entry 顺序写每条 proof 的
`niceeval.evidence-proof` edge，再写可选 `niceeval.evidence-proof-index-page-next`。

ProofIndex 的 `objectTable`、它的 table edge，以及每个 entry proof 的 `objectTable` 必须相同。
object table entries 必须恰好是全部 index proof 的 `archives` union，按 archive table 规则规范化；
不得遗漏任一 proof 所需 archive，也不得带没有被任何 proof 引用的额外 object。

Proof 恰有 shared-table edge `niceeval.evidence-object-table`，target 与 payload 的 `objectTable`
逐项相等。Proof 不得另写 archived object edge。除末页外，每个 proof index page 恰有 128 entry；
empty proof page 不存在。

在上述“current entity 必须经 catalog”的候选约束内，target 有多条 path 时，exporter 选择总 step 数
最少的 simple path；simple 表示任一完整 descriptor 都不能作为 step.from 重复出现。并列时比较完整
discriminated `RecordEvidencePathStepV1[]` 的 JCS UTF-8 bytes，取字典序最小者。page 切分、ordinal 与
relation 都因此进入裁决，不能把不同 path 规范成同一条抽象 strong-edge 序列。

Claim proof 递归闭合所有 `basedOn` EvidenceRef，并按 JCS key 去重 proof graph。
Claim basis cycle 在 verification 中是 `claim-basis-cycle`，在 export 中是 `proof-cycle`。

实现或 target Store 明示的资源上限超过时，以 `proof-resource-limit { limit, observed }` 失败。
exporter 绝不输出 partial artifact。

offline proof 只凭 artifact Store、proof index 与 archived bytes 重新打开。它验证 descriptor 与
raw-byte integrity，但不激活 source media type、不联络 source Store，也不把复制的 source
GraphNode 当作 live node。

## 完成判据

一个 owner 可以有 required 与 supplemental stream。
supplemental 缺失、open 或失败不会自动改变 Verdict，但依赖它的 Projector 必须如实降级。

Attempt completed 同时要求：

1. lifecycle stream 有唯一 terminal-completed 事件；
2. 每条 required binding 都 closed；
3. terminal Claim 与当前 RunContribution 已 durable。

Attempt abandoned 要求 lifecycle 有 terminal-abandoned。
所有 required binding 必须 closed 或显式 abandoned，不能仍为 open。

Run completed 同时要求：

1. 自己的 lifecycle 有 terminal-completed；
2. 自己的 required binding 全部 closed；
3. 每个 expected membership slot 都有已提交的 current Contribution；
4. 所有 executed child Attempt 已进入终态。

Run incomplete 与 interrupted 的原因进入 Claim 和 receipt。
Run 不拥有 reused Attempt，只拥有相应 Contribution。

## RecordStore 事务

`niceeval/record` 只公开 runtime-branded `RecordStore` capability。它不是 structural backend
object，也不公开 transaction、read lease、GC snapshot 或原始 Layout 操作：

```ts
declare const recordStoreBrand: unique symbol;
type RecordStoreState = "open" | "closing" | "closed";

interface RecordStore extends AsyncDisposable {
  readonly [recordStoreBrand]: "niceeval.record-store/1";
  readonly state: RecordStoreState;
}
```

下面是实现包之间的 backend SPI。它明确不从 `niceeval/record` 导出；public factory、handle 与
writer 只用它构造上面的 capability。所有 owner 都是 typed data，不允许把调用方提供的 string
当 retain owner：

```ts
/** @internal backend SPI: not exported from niceeval/record */
declare const recordStoreBackendBrand: unique symbol;
declare const backendRetainBrand: unique symbol;
declare const backendWriteLeaseBrand: unique symbol;
declare const backendTransactionBrand: unique symbol;
declare const backendReadLeaseBrand: unique symbol;
declare const backendMirrorInstallBrand: unique symbol;
declare const backendGcSnapshotBrand: unique symbol;
declare const backendGcBarrierBrand: unique symbol;

type RecordStoreBackendState = "open" | "closing" | "closed";

type BackendRetainOwner =
  | { readonly kind: "record-store" }
  | { readonly kind: "record-handle"; readonly ref: RecordGraphRef }
  | { readonly kind: "record-writer"; readonly recordId: string }
  | { readonly kind: "record-source-reader"; readonly ref: RecordGraphRef }
  | { readonly kind: "gc" };

interface BackendRetain<Owner extends BackendRetainOwner = BackendRetainOwner>
  extends AsyncDisposable {
  readonly [backendRetainBrand]: "niceeval.record-backend-retain/1";
  readonly owner: Owner;
  readonly state: "held" | "released";
  close(): Promise<void>;
}

interface BackendWriteLease {
  readonly [backendWriteLeaseBrand]: "niceeval.record-backend-write-lease/1";
  readonly transactionId: string;
  readonly fencingToken: string;
  readonly expiresAt: string;
  readonly expected: GraphRootRefV1 | null;
  readonly state: "active" | "lost" | "released";
}

interface BackendTransactionOwner {
  readonly kind: "write-transaction";
  readonly retain: BackendRetain<BackendWriteOwner>;
  readonly lease: BackendWriteLease;
}

type BackendTransactionState =
  | "active"
  | "committed"
  | "aborted"
  | "lease-lost"
  | "closed";

interface BackendTransaction extends AsyncDisposable {
  readonly [backendTransactionBrand]: "niceeval.record-backend-transaction/1";
  readonly owner: BackendTransactionOwner;
  readonly state: BackendTransactionState;
  putObject(ref: DescriptorV1, bytes: Uint8Array): Promise<void>;
  renew(): Promise<void>;
  commit(next: GraphRootRefV1): Promise<RecordGraphRef>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

type BackendReadOwner = Extract<
  BackendRetainOwner,
  { readonly kind: "record-handle" | "record-source-reader" }
>;
type BackendWriteOwner = Extract<
  BackendRetainOwner,
  { readonly kind: "record-store" | "record-writer" }
>;

type BackendReadFailure =
  | {
      readonly code: "backend-read-lease-not-active";
      readonly state: "expired" | "closed";
      readonly ref?: DescriptorV1;
      readonly cause: unknown | null;
    }
  | {
      readonly code:
        | "backend-read-object-missing"
        | "backend-read-object-corrupt"
        | "backend-read-object-unsupported-digest";
      readonly ref: DescriptorV1;
      readonly cause: unknown | null;
    }
  | {
      readonly code:
        | "backend-read-object-permission-denied"
        | "backend-read-object-unavailable"
        | "backend-read-object-io-failure";
      readonly ref: DescriptorV1;
      readonly cause: unknown | null;
    }
  | {
      readonly code: "backend-read-object-resource-limit";
      readonly ref: DescriptorV1;
      readonly limit: RecordWalkerResourceLimit;
      readonly observed: number;
      readonly cause: unknown | null;
    };

class BackendReadError extends Error {
  readonly failure: BackendReadFailure;
}

interface BackendReadLease extends AsyncDisposable {
  readonly [backendReadLeaseBrand]: "niceeval.record-backend-read-lease/1";
  readonly owner: BackendReadOwner;
  readonly retain: BackendRetain<BackendReadOwner>;
  readonly ref: RecordGraphRef;
  readonly state: "active" | "expired" | "closed";
  readObject(ref: DescriptorV1): Promise<Uint8Array>;
  renew(): Promise<void>;
  close(): Promise<void>;
}

interface BackendMirrorInstallOwner {
  readonly kind: "mirror-install";
  readonly retain: BackendRetain<BackendWriteOwner>;
  readonly lease: BackendWriteLease;
}

type BackendMirrorInstallState =
  | "active"
  | "installed"
  | "aborted"
  | "lease-lost"
  | "closed";

type BackendMirrorInstallFailure =
  | {
      readonly code: "backend-mirror-snapshot-layout-mismatch";
      readonly snapshot: RecordMirrorSnapshotV1;
      readonly layout: LayoutV2;
    }
  | {
      readonly code: "backend-mirror-initialize-conflict";
      readonly expected: null;
      readonly actual: LayoutV2;
    };

class BackendMirrorInstallError extends Error {
  readonly failure: BackendMirrorInstallFailure;
}

interface BackendMirrorInstall extends AsyncDisposable {
  readonly [backendMirrorInstallBrand]: "niceeval.record-backend-mirror-install/1";
  readonly owner: BackendMirrorInstallOwner;
  readonly state: BackendMirrorInstallState;
  readonly expected: null;
  readonly snapshot: RecordMirrorSnapshotV1;
  putObject(ref: DescriptorV1, bytes: Uint8Array): Promise<void>;
  renew(): Promise<void>;
  install(layout: LayoutV2): Promise<RecordGraphRef>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

type BackendGcRoot =
  | { readonly kind: "committed"; readonly graph: GraphRootRefV1 }
  | {
      readonly kind: "staging";
      readonly transactionId: string;
      readonly fencingToken: string;
      readonly roots: readonly DescriptorV1[];
    }
  | {
      readonly kind: "read-lease";
      readonly owner: BackendReadOwner;
      readonly ref: RecordGraphRef;
    }
  | { readonly kind: "persistent-pin"; readonly pinId: string; readonly root: DescriptorV1 };

interface BackendGcSnapshot {
  readonly [backendGcSnapshotBrand]: "niceeval.record-backend-gc-snapshot/1";
  readonly layout: LayoutV2 | null;
  readonly roots: readonly BackendGcRoot[];
}

interface BackendGcBarrier extends AsyncDisposable {
  readonly [backendGcBarrierBrand]: "niceeval.record-backend-gc-barrier/1";
  readonly retain: BackendRetain<{ readonly kind: "gc" }>;
  readonly state: "active" | "closed";
  readonly snapshot: BackendGcSnapshot;
  close(): Promise<void>;
}

interface RecordStoreBackend extends AsyncDisposable {
  readonly [recordStoreBackendBrand]: "niceeval.record-store-backend/1";
  readonly state: RecordStoreBackendState;
  retain<Owner extends BackendRetainOwner>(
    owner: Owner,
  ): Promise<BackendRetain<Owner>>;
  readLayout(retain: BackendRetain): Promise<LayoutV2 | null>;
  beginWrite(
    retain: BackendRetain<BackendWriteOwner>,
    expected: GraphRootRefV1 | null,
  ): Promise<BackendTransaction>;
  openRead(
    retain: BackendRetain<BackendReadOwner>,
    ref: RecordGraphRef,
  ): Promise<BackendReadLease>;
  beginMirrorInstall(
    retain: BackendRetain<BackendWriteOwner>,
    snapshot: RecordMirrorSnapshotV1,
  ): Promise<BackendMirrorInstall>;
  beginGcBarrier(
    retain: BackendRetain<{ readonly kind: "gc" }>,
  ): Promise<BackendGcBarrier>;
  close(): Promise<void>;
}
```

`BackendRetain.close()` 与所有 `[Symbol.asyncDispose]()` 都幂等，并只释放该 retain 一次。

public Store close 先把自己的 state 变成 closing，拒绝新的 public child capability，再释放 store
retain。已有 handle、writer、source reader、transaction 与 lease 用自己的 retain 继续有效。

backend 自身也有 runtime brand、`open → closing → closed` state 与幂等 `close()`。只有最后一个 retain
释放后才可进入 closing。它关闭的是 transport / process resource，绝不删除 Layout、object 或 committed
history。

transaction、read lease 与 barrier 在创建时各取得独立 retain。`BackendTransaction.abort()` 的首次
结果被缓存；之后的 abort、close 或 async dispose 不再执行第二次 staging 操作，并返回同一结果。
active transaction 的 close 等价于一次 abort 后释放 retain。commit 成功后再次 commit 不可执行。
但 close 仍幂等地只释放 retain。lease lost 后 transaction 标为 lease-lost，旧 token 永不能恢复。

`BackendReadLease.readObject(ref)` 是 public handle、SourceSet reader、bootstrap verifier 与 mirror
source 唯一的 raw object 入口。它先检查 active lease 和 exact typed ref，再返回已验证的 raw bytes。
它不解码 payload。

内部 walker 只能传入 bootstrap 或已验证 strong edge 发现的 descriptor，不能把任意 public input 传给它。

它只以 `BackendReadError` 的封闭 `BackendReadFailure` reject。public adapter 按调用 owner 映射为 Record
read / open failure，或 source / target 的 mirror failure，不能丢弃 `ref`、budget 或 transport 类别。

`BackendReadLease.close()` 和 barrier close 也都是幂等。read lease 只有 active 时可 renew 或读取；
expired lease 不能保护 GC。barrier 取得 immutable snapshot 后才允许 sweep，snapshot 只能在该 barrier
active 期间使用。barrier close 先结束阻塞、再释放 GC retain，callback throw 也必须走这条路径。

本地 backend 先为每个公开 Store 保留 store retain。每个 handle、writer 和 source reader 从它取得
独立 retain。`openRecord()` 先读 Layout、再用它固定的 GraphRef 打开 read lease；bootstrap 与后续
lazy read 都只通过该 lease 的 `readObject()`。write transaction 将 put 与 staging pin 原子化；GC 只
使用同一 barrier 内的 `BackendGcSnapshot`。

对 SourceSet，public SourceSet 是每个 `{ kind: "record-source-reader", ref }` retain 的 owner；
`source()` 返回的 branded reader view 是 borrowed capability，不拥有 retain。reader operation 在
SourceSet admission gate 取得逻辑 operation retain。close 先关闭 gate，再等已取得的 operation retain
完成，最后释放内部 reader retain。因此 close 不会取消已开始的 raw read，也不能让新的 reader
operation 取得已释放的 backend resource。

reader 返回的 RunHandle 与 AttemptHandle 同样借用 SourceSet lifetime。它们的 capability state 投影
SourceSet，lazy read 也必须经同一个 gate 取得 operation retain。close 后开始的 child read 因而稳定
失败为 `record-read-closed`；close 前已获准的 read 可以完成，而不会在执行中改写 owner error。

因此实现者不必猜测未定义的 lease、raw read、snapshot 或 parent ownership。

### put 与 fencing

`BackendTransaction.putObject` 先验证 media type、size 与 digest。同 typed reference 的相同字节
幂等成功。

同 typed ref 已存在而 raw bytes 不同是 `record-typed-ref-byte-conflict`。两个不同 raw byte
sequence 都通过同一 digest 的复核是 `record-digest-collision`。两者不能合并成普通 corrupt。

写时 collision 一律不提交。读到已存在 collision 是 `record-digest-collision` graph violation；
lazy read 以 `RecordReadError` 的 `record-graph-invalid` cause 暴露它。

写对象与把 ref 加入 durable staging set 是一个原子 Store 操作。
staging set 由 transactionId 与 fencingToken 标识。
lease 失效后，put、renew、commit 和首次 abort 都返回 `record-lease-lost`；abort 的缓存结果使
其后的 abort/close/async dispose 不会再次接触 staging。旧 token 不能恢复写权。

### commit 线性化

`BackendTransaction.commit(next)` 在一个短的线性一致事务中完成：

1. 验证 fencing token、lease 与 next Graph root 原始字节。
2. 重新遍历并验证 next 的完整 strong closure。
3. 验证 next subject.previous 正好指 expected head 的 subject。
4. 比较当前 head 与 expected；不相等返回 `record-head-conflict` 及 actual。
5. 构造只增加 next 的 committed-root tree。
6. 原子替换 generation、head 与 committedRoots，并删除 staging pin。

unbound Store 的首次 CAS 使用 expected = null。它只允许 revision 0、subject.previous = null，
并创建第一棵 committed-root radix 和 `generation: 1`。若另一个 writer 已先绑定同一 recordId，
loser 读取 actual head 后重建 revision；`record-head-conflict.expected` 可以是 null。若 actual
subject 的 recordId 不同，失败是 `record-id-mismatch`，没有 initialize-only API，也没有
初始化专用 failure。

冲突时不得登记 next root，也不得自动合并领域变化。
staging 保留到显式 abort 或 lease grace 到期，调用方可以复用内容寻址对象重建。

`RecordGraphRef` 只在这次事务成功后返回。
committedRoots 永不原地删除，因此任何已返回 receipt 的 GraphRef 都能继续在该 Store 重开。

### mirror snapshot 原子安装

`BackendMirrorInstall` 是仅供完整 mirror 使用的独立 primitive，不是 `BackendTransaction.commit()` 的
initialize overload。`beginMirrorInstall(retain, snapshot)` 固定取得 `expected: null` 的 write lease；
它可以用与普通 transaction 相同的 staging 规则写入 copied raw object，但不能 commit 单个 next root。

`install(layout)` 只接受与 typed snapshot 的 `recordId`、`generation`、`head` 和 `committedRoots`
规范字节完全相等的 `LayoutV2`。在同一个线性一致事务中，它会：

1. 复核 snapshot identity、Layout 和所有 committed-root page；
2. 复核每个 committed GraphRoot 及其完整 strong closure 都已在 target staging 或 target Store 中；
3. 比较 target Layout 仍为 null；
4. 原子写入整个 Layout、删除 staging pin，并返回 snapshot head 的 `RecordGraphRef`。

所以 mirror 可以安装任意已验证的 generation，而不是伪造一条 revision 0 genesis commit。layout / snapshot
不相等只会是 `BackendMirrorInstallError` 的 `backend-mirror-snapshot-layout-mismatch`，public mirror 映射它为
`mirror-snapshot-invalid`。步骤 3 失败只会是带 `expected: null` 与 `actual` Layout 的
`backend-mirror-initialize-conflict`，public mirror 映射它为 `mirror-target-initialize-conflict`。

普通 `BackendTransaction.commit(next)` 的 expected-null 路径仍只允许 revision 0、`previous: null`、
generation 1 与第一棵 committed-root radix。public writer 没有取得 BackendMirrorInstall 的入口，普通
commit 因而不能借 mirror 规则跳过 revision 或安装外来 history。

### 本地崩溃恢复

本地文件 Store 的对象 temp 与目标位于同一文件系统。
顺序固定为写 temp、fsync 文件、原子 rename、fsync 目录。
Store 元数据使用单调 fencing token 与 crash-safe journal。

元数据提交先 fsync 新 committed-root pages 和 Graph root，再写入 prepare marker。
随后在独占锁中复核 expected，原子替换完整 layout，fsync 目录，最后写入 commit marker。
恢复只允许看见旧 layout 或完整新 layout；不能出现 head 已更新而 committedRoots 未登记。

没有 commit marker 时，恢复按 layout generation 判断事务是否已经生效。
未生效 staging 在 grace 到期后才能回收；不能用对象 mtime 猜测安全点。

### read lease、pin 与 GC

同 Store 的 committed GraphRef 由 committedRoots 永久保护。
`BackendReadLease` 只保护获准读取的 staged 或 imported closure；persistent pin 保护尚未成为
Record revision 的显式导入。
它们不能替代 committedRoots，也不能让 receipt 暗中制造永久 pin。

GC 使用 `BackendGcBarrier` 的完整 Store barrier。
获取 barrier 是本轮 GC 的线性化点；获取前等待正在执行的单步 Store 操作结束。
持有期间阻塞：

- beginWrite、put、renew、commit 与 abort；
- `BackendReadLease` 的创建、续期和释放；
- pin、unpin、对象创建与对象删除。

GC 在线性一致 `BackendGcSnapshot` 中读取 committedRoots、未过期 staging、read lease 与
persistent pin。
它沿统一 walker mark，再 sweep 未标记对象和 orphan；元数据提交完成后才释放 barrier。
普通读取已有对象可以继续，但只有 barrier 获取时已经存在的 lease 受保护。

这个算法没有 snapshot-after-write 竞态区间。
远端 Store 必须提供等价的全局 barrier 或 serializable transaction，不能依赖 eventual list。

## Receipt 与部分持久化

Record commit 相对每个 receipt scope 表达三态：

```ts
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

Invocation 的 finish 与 abort 都显式接收正在形成的 terminalSnapshot。它冻结到该 Invocation 的
terminal intent，并逐字成为 receipt 的 terminalSnapshot；abort reason 不能替代或推导 snapshot。

not-recorded 表示该 scope 没有任何事实进入可重开的 head。
partial 保留最后可读 GraphRef，但不宣称 required facts 或终态完整。
complete 保证该 scope 的 required stream、terminal entity revision、必要 Claim、Contribution 与列出关系都能从 graph 验证。

早期 `AttemptReceiptSnapshot` 可以绑定 Graph A，最终 InvocationReceipt 可以绑定后继 Graph B。
重试收尾成功时，早期 snapshot 保持 partial；最终 receipt 中同 attemptId 的条目可以是 complete。
Graph B 的 subject previous chain 必须包含 Graph A 的 subject。

Invocation 建立前的发现或配置错误仍抛 typed preflight error。
Invocation 建立后，Runner 始终返回 InvocationReceipt。
RecordStore 是正常 Runner 的 required sink；没有 Store 不能返回虚构的 complete GraphRef。

## Live、Reducer 与 OTel

Observation Hub 是一次 Invocation 内的唯一事实入口。
它校验 scope、identity 与 sequence，再把同一 durable event 交给 Record、Reducer、Live 和可选 OTel exporter。

durable sink 施加 backpressure，不能因消费者慢而丢事件。
ephemeral progress 使用独立有界缓冲，只影响 live overlay，不占 durable sequence。

Reducer 是纯函数：

```ts
type Reducer<State> = (state: State, event: ObservationEvent) => State;
```

Live snapshot、TTY、`watch`、Invocation 索引和机器输出共享同一 reducer。
snapshot 保存 reducer 版本与每条 stream 的 throughSequence；失配时从 durable event 重建。

OTel 是 supplemental。
实际收到的 span 是 Observation；canonical GenAI 映射是带 mapper 版本的 Projection。
没有 OTel 只能让依赖它的 timing unavailable，不能改变 Agent 行为、执行错误或 Verdict。

## 完整镜像与选择性证明

### 镜像快照

```ts
declare const recordMirrorSnapshotBrand: unique symbol;

interface RecordMirrorSnapshotV1 {
  readonly schema: "niceeval.record-mirror-snapshot/1";
  readonly recordId: string;
  readonly generation: number;
  readonly head: GraphRootRefV1;
  readonly committedRoots: CommittedRootPageRefV1;
  readonly identity: DigestV1;
  readonly [recordMirrorSnapshotBrand]: "niceeval.record-mirror-snapshot/1";
}
```

`identity` 是排除 `identity` 自身后、其余字段组成的 JCS 对象的 SHA-256。

- `captureRecordMirrorSnapshot(source)` 创建 branded 持久化令牌，只抛
  `RecordMirrorSnapshotError`。
- `parseRecordMirrorSnapshot(value)` 检查语法、JCS 形状与 `identity`，并创建同一种 brand；它也只抛
  `RecordMirrorSnapshotError`。
- `mirrorRecord(source, target, { snapshot })` 必须传入已经 typed 的令牌，不存在省略令牌或 unknown
  value 重载；它只抛 `RecordMirrorError`。

该快照是稳定的重试边界，不是“重试时把当前源端 head 全部镜像”的请求。
capture 的 empty、closed、permission、unavailable、IO、unsupported 与 source-corrupt 都是
`RecordMirrorSnapshotError` 的互斥 discriminant。mirror 不重新 parse，因此不会把这类 failure
混入 `RecordMirrorError`。

镜像强制目标优先，顺序可观察：

1. 接收已有 typed snapshot，再读取目标端 Layout，尚不读取源端。
2. 若目标端已绑定的 Layout 在 recordId、generation、head 与 committedRoots 上和令牌的规范字节
   完全相等，则验证目标端完整已提交闭包并幂等返回；不得先读源端。
3. 完全相等的目标端若损坏，失败为 `mirror-target-corrupt`，绝不回退到源端。
4. 其它已绑定目标端以既有状态失败；只有未绑定目标端才继续验证和复制源端。
5. 源端验证令牌的 head 仍在当前 committed-root radix 中。
   它沿 `RecordSubject.previous` 走完整谱系，并检查 `generation = revision + 1`。
   它重建截至令牌 head 的所有 GraphRoot 与规范 committed-root radix。两者必须和令牌
   完全相等。
   随后它复制每个重建 GraphRoot 的完整强闭包，以及重建 radix 的全部引导页。
   这些字节都持久化后，才原子绑定目标端；不能只复制令牌 head。
6. target 用 `BackendMirrorInstall.install()` 原子安装完全匹配 typed snapshot 的 Layout；它固定使用首次
   `expected: null`。若这一步与另一个 writer 冲突，返回
   `mirror-target-initialize-conflict { expected: null, actual }`，不静默重读、改写现有 target 或改用新 head。

采集后源端可以继续前进，不会改变合法重试。语法自洽但 generation、谱系或 radix 不可能的令牌是
`mirror-snapshot-invalid`；令牌自身自洽但不在源端 committed 谱系中是
`mirror-snapshot-not-committed`。同一 Store 通常落入完全相等目标端的幂等路径；否则在访问源端前
走同一套目标优先失败路径。

mirror 的 source 只分 corrupt、closed、permission、unavailable、IO、resource-limit 与明确 unsupported。
target 只分 bound、corrupt、closed、permission、unavailable、IO、resource-limit 与首次 initialize conflict。
copy 与 bind 中的 target 问题保留 phase，不使用宽泛的 `*-failed` 或 unknown cause。两端 traversal 的
resource-limit 都复用 strong-closure walker 的对象、深度与累计字节预算，并带 `phase`、`limit` 与
`observed`。

`exportSample` 和 `exportReport` 创建独立 Store。它们的 evidence 字段是共享的
`RecordEvidenceProofIndexRefV1`，其封装图只归档实际消耗的 evidence、membership proof 与必需
path data。它绝不把源 Record 的 Claim、stream 或其它 GraphNode 当成目标端的活动源节点。
源端读取、验证或复制失败会 reject 整次 export，绝不变成 `not-recorded` 或 partial proof artifact。

## 版本与扩展防火墙

新增事件、Claim、Provenance、Projector、Report 页面、wrapper 或领域关系使用新 typed payload 或独立
payload 版本，不修改 frozen core。

新增 digest 算法必须发布新的 format/core 版本；不能更新 Record format v1 的算法集合或让 v1 writer
协商算法。

同一 payload media type 只能增加语义独立、缺失含义明确的可选字段。
字段改名、删除、改类型，或改变身份、依赖、权限与判断语义时，必须发布新 media type。

generic reader 对未知 payload 执行三件事：

1. 验证 node、payload descriptor 与完整 strong closure。
2. 原字节保留并复制，不 parse 后重新序列化。
3. 只把依赖该 payload 的能力标为 unsupported。

容器升版提案必须先通过 [schema 演进防火墙](reference/schema-evolution.md)。
普通领域功能、读取模型或交付物不能推动 bootstrap 升版。

## 架构验收不变量

1. Graph root 没有 open/sealed；每个 committed root 都可按完整 RecordGraphRef 重开。
2. head、committedRoots 与 generation 原子更新，committed roots append-only。
3. next subject.previous 正好指 expected head subject；冲突只能基于 actual 重建。
4. Attempt 永属 origin Run；carry、accept 和 rename 只通过 Claim 与 Contribution 表达。
5. Contribution、Run、Attempt 与 stream revision 都是可验证的单调链。
6. locator reservation 在任何外部副作用和公开事件之前完成。
7. event proof 从 source Graph root 一直验证到 canonical event bytes，不接受自称的 Merkle root。
8. source Claim 不保存同一个 Graph root digest，不产生内容哈希自引用。
9. Projector 的 basedOn 只能由追踪式读取生成，不能由作者删减。
10. value availability 与 basis verification 分开，所有 causes 与 issues 都保留。
11. not-recorded、partial 与 complete 按 receipt scope 承诺，不丢最后 durable GraphRef。
12. GC 全程持 barrier，不依赖 mtime、eventual list 或 snapshot 后复核猜安全点。
13. mirror 复制全部 committed root 历史；SampleBundle 与 Report 使用独立 Store。
14. generic walker、verifier、mirror 和 GC 对 unknown payload 使用同一 strong-edge 规则。
15. Live snapshot、Projection 和 Report artifact 都不能成为 Record 事实输入。
16. Projector 作者只返回 `T`；EvidenceValue、unavailable、basedOn 与 dependency trace 都由框架构造。
17. child wrapper dispose 不丢 pending terminal intent；活着的直接 parent 必须在 terminal 时 reconcile。
18. capture/parse 只抛 snapshot error，typed snapshot 的 mirror 只抛 mirror error，且首次 null CAS conflict 可见。
