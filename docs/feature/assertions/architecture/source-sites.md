# Assertions —— source sites

本页是源码导航的精确 schema owner。它定义 Attempt-owned
`niceeval.assertion-source-sites/v1`，并说明它怎样与 Run-owned
`niceeval.sources/v1` 组合。两份 Attachment 都保存已经发生的审计事实，不保存可执行的作者调用图。

`niceeval.assertions/v1` 继续拥有 criterion、material 与 sealed result。source-sites 只把这份
Assertions Attachment 内的 `entryId` 映射到已执行的源码位置。它不能改写 Assertion、Verdict、Score
或 reuse behavior identity。

## Owner 与不可变语义 join

| Attachment | owner | 精确事实 |
|---|---|---|
| `niceeval.sources/v1` | origin Run | source manifest、每项的 canonical project-relative path、SHA-256 与 attachment-local source blob。 |
| `niceeval.assertion-source-sites/v1` | Attempt | Assertions attachment-local `entryId` 到 role-tagged site 的映射。 |

source-sites 的 `entryId` 只 join 同一 Attempt 的 Assertions entry。每个 trace frame 的
`sourceItemId` 与 digest 只 join 该 Attempt 的 origin Run Sources manifest。这些字段是 schema
声明的 immutable semantic join；它们不是 blob ref、Attachment address、Record path、owner handle
或读取 capability。

payload 不保存 absolute host path、`originRunId`、Sources manifest 的数组位置，或另一个
Attachment 的 `RecordBlobRef`。公开 reader 也不会因 payload 内有 join 就获得跨 owner 的 storage
访问能力。

## 精确 source-sites payload

`AssertionsDocumentV1` 与 `SourcesDocumentV1` 的完整形状分别由 [Assertions
architecture](../architecture.md) 与 [Sources manifest](../../record/architecture.md#sources-manifest)
拥有。本 Attachment 只定义它们之间的导航事实。

```ts
type SourceItemSnapshotRefV1 = {
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
};

type AssertionSourceFrameV1 = {
  readonly source: SourceItemSnapshotRefV1;
  readonly line: number;
  readonly column: number;
};

type AssertionSourceTraceV1 = {
  readonly frames: readonly [
    AssertionSourceFrameV1,
    ...AssertionSourceFrameV1[],
  ];
};

type AssertionSourceRoleV1 =
  | "declaration"
  | "threshold"
  | "score"
  | "gate"
  | "optional"
  | "stop";

type AssertionSourceOccurrenceV1 =
  | {
      readonly sourceOrder: number;
      readonly role: Exclude<AssertionSourceRoleV1, "stop">;
    }
  | {
      readonly sourceOrder: number;
      readonly role: "stop";
      readonly outcome: "continued" | "stopped" | "interrupted";
    };

type AssertionSourceSiteV1 = {
  readonly trace: AssertionSourceTraceV1;
  readonly occurrences: readonly [
    AssertionSourceOccurrenceV1,
    ...AssertionSourceOccurrenceV1[],
  ];
};

type AssertionSourceSitesEntryV1 = {
  readonly entryId: AssertionEntryId;
  readonly sites: readonly [AssertionSourceSiteV1, ...AssertionSourceSiteV1[]];
};

type AssertionSourceSitesDocumentV1 = {
  readonly entries: readonly AssertionSourceSitesEntryV1[];
};
```

producer 写入的每个 `sourceOrder` 是正 safe integer，并在一个 Attempt 的全部 runtime source event
中唯一。producer 将 `entries` 按 `entryId` canonical 排序，并且每个 `entryId` 至多一行。缺少某个
Assertions entry 的行表示该 entry 没有可用映射，而不是未执行的 Assertion。

每个 trace frame 都含 source item ref、digest、one-based line 与 one-based column。`frames[0]`
是作者入口，最后一帧是叶调用点。frame 只能指向 Sources manifest 中的 project-relative
source item，不能携带 host locator。

同一 trace 与 coordinate 的链式调用可以合并为一个 site。site 内 occurrence 必须按
`sourceOrder` 升序保存。组合 reader 按 `sourceOrder` 还原所有 site 的真实 occurrence 顺序，不能
用 site 数量、数组位置或 source coordinate 重新排序。

`declaration` 标明 entry 的登记。`threshold`、`score`、`gate` 与 `optional` 分别标明对应 modifier
实际执行的位置。`stop` 标明 `.orStop()` 实际执行的位置：`continued` 表示 continuation 继续，
`stopped` 表示设置 authoring stop latch，`interrupted` 表示 stop 等待被中断。不存在为未执行源码
补写的 declaration、modifier 或 stop occurrence。

## Runtime capture、seal 与 whole-Run publish

每个 Attempt 有一个单调 source-order allocator。registration、modifier、stop 与 `send` 都从同一
allocator 取得 runtime token。`send` 不生成 source-sites entry，所以相邻 site occurrence 的
`sourceOrder` 可以有缺口；缺口仍保留它与 send 的实际先后关系。

producer 在执行时只保留 runtime token 与已执行的 trace。seal 以后才把 token 关联到 durable
`entryId`。它不能从 Assertions entries 数组、`.key`、当前 worktree、静态 AST 或恢复的
producer/use graph 猜测这个关联。

`EvaluationRecordContract` 在 generic writer 前共同验证下列事实：

- source-sites 的每个 `entryId` 都是同一 Attempt 已封口 Assertions entry；
- 每个 frame 的 `sourceItemId` 存在于 exact origin Sources manifest，且 digest 与 manifest 和
  attachment-local blob bytes 一致；
- line、column、trace、role、stop outcome 与 source-order token 都符合本页形状；
- runtime token 到 durable `entryId` 的关联只包含已执行 occurrence；
- Sources、Assertions 与 source-sites 都在同一 Run 的 `complete` 标识之前通过验证。

generic writer 仍只验证 Core、owner、typed Attachment 与各自 closure。它不恢复 Assertion 运行时图，
也不把 source-site mapping 当成新的 Core 引用。

## 局部 unmapped 与 Assertion 隔离

source navigation 的输出把每个可读取 Assertions entry 单独标为 `mapped` 或 `unmapped`。Sources 或
source-sites Attachment 缺失、unsupported、invalid，或不能形成 available payload 时，所有 Assertions
entries 都是 `unmapped`。这只是导航数据状态，不会让 Assertions Attachment、Verdict 或 Score 变成
invalid。

两个 Attachment 都形成 available payload 后，结构可读但 semantic join 不成立的 row 或 site 只让
受影响位置 `unmapped`。这包括未知或重复 `entryId`、重复 `sourceOrder`、缺 source item、digest
mismatch、越界 coordinate 与无法走完的 trace。同一 entry 的其它有效 site 继续显示；其它 Assertions
entries 也继续映射。payload exact decode 或 own blob closure 的失败仍是 Attachment `invalid`，不按 row
修复。reader 不从当前文件补齐缺失内容。

Assertions criterion 的 unsupported 或 invalid 与 source mapping 独立。一个 entry 可以保留可读的
source site，同时 criterion 无法解释；也可以保留正常 criterion 与 sealed result，同时 source mapping
为 `unmapped`。mapping 不重复计算 check、points、unavailable、gate 或 Verdict；一个 `entryId` 的
权威结果始终只计一次。

`.key`、label 与 groupPath 仍只服务 display。它们不承诺跨 Attempt 配对，也不能替代 `entryId` 或
source item join。

## 中立公开读取

源码导航固定由三个中立 projection 组成：

```text
attemptSlotProjection(assertionsProjector)
attemptSlotProjection(assertionSourceSitesProjector)
attemptOriginRunProjection(sourcesProjector)
                    │
                    ▼
      assembleAttemptSourceTreeV1(...)
```

三个 projection 都保留 slot 的穷尽状态。公开纯组合函数
`assembleAttemptSourceTreeV1` 只组合已经形成的 `ProjectedSample` 值，并生成 mapped 或 unmapped
导航树。它不读取 Record、blob、path 或当前 worktree，也不重新执行 Assertion。

官方 Report 与第三方 Report 使用相同的三个 projection 和 `assembleAttemptSourceTreeV1`，或使用
Calculation 中语义等价的纯组合。不存在内建 Report 绕过 projection 的读取入口、owner lookup 或跨
Attachment capability。

## Source identity 的相邻 migration group

`SourceItemId` 的 identity 语义未来若改变，Sources 与 source-sites 必须一起发布相邻 schema
version，并注册一个唯一的 source-identity migration group。group 从完整旧 Sources value 建立一份
authoritative old-to-new item mapping，再把同一 mapping 用于该 origin Run 的每个匹配 source-sites
value。

两个独立 Attachment converter 不得各自从 path、digest、数组位置或当前 worktree 猜 item mapping。
无法给出无损 mapping 时，group 声明 `not-losslessly-migratable`，保留旧 bytes，并使需要 current
source navigation 的读取得到 `migration-unavailable`。group 的 preflight、原子写入与 sentinel 规则由
[Record migration](../../record/architecture.md#显式-migration) 拥有。

## 相关阅读

- [Assertions architecture](../architecture.md) —— entry、criterion、result 与 own material。
- [Sources manifest](../../record/architecture.md#sources-manifest) —— SourceItemId、path、digest 与 blob。
- [多个 Attempt 怎样共用源码快照](../../record/use-case/多个Attempt怎样共用源码快照.md) —— origin Run 读取。
- [Projection Library](../../projection/library.md) —— 三种中立 projection。
- [Reports architecture](../../reports/architecture.md) —— Report 读取边界。
