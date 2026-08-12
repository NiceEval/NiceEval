# Assertions —— source sites

本页拥有源码导航的 semantic schema。它定义 Attempt-owned
`niceeval.assertion-source-sites/v1`，并规定它怎样只读地组合 origin Run 的
`niceeval.sources/v1`。两份 Attachment 都保存已经发生的审计事实，不保存可执行的作者调用图。

`niceeval.assertions/v1` 继续拥有 criterion、material 与 sealed result。source-sites 只把这份
Assertions Attachment 内的 `entryId` 映射到实际执行的源码位置，并保存实际执行的 `send` 标注。
它不能改写 Assertion、Verdict、Score 或 reuse behavior identity。

## Owner、snapshot 与 semantic join

| Attachment | owner | 精确事实 |
|---|---|---|
| `niceeval.sources/v1` | origin Run | 此次 Run 的 package、file、canonical UTF-8/LF text snapshot 与每个 file bytes 的 SHA-256。 |
| `niceeval.assertion-source-sites/v1` | Attempt | Assertions entry 到 role-tagged site 的 mapping，以及实际执行的 send site／occurrence。 |
| `niceeval.assertions/v1` | Attempt | `entryId`、criterion、material 与 sealed result。 |

source-sites 的 `entryId` 只 join 同一 Attempt 的 Assertions entry。每个 trace frame 的 package／file
item ref 只 join 该 Attempt 的 exact origin Run Sources manifest。这些字段是 schema-declared
immutable semantic join；它们不是 blob ref、Attachment address、Record path、owner handle 或读取
capability。

payload 不保存 absolute host path、`originRunId`、Sources manifest 的数组位置，或另一个 Attachment
的 `RecordBlobRef`。公开 reader 也不会因 payload 内有 join 获得跨 owner 的 storage access。

### package／file item 引用

Sources family 拥有 `SourcePackageItemId`、`SourceFileItemId` 与 `Sha256Digest` 的 exact decoder。
source-sites 只使用这些 opaque identity，不能由 package name、file path、digest、数组位置或当前
worktree 重新生成它们。

```ts
type SourcePackageItemRefV1 = {
  readonly kind: "package";
  readonly packageItemId: SourcePackageItemId;
};

type SourceFileItemRefV1 = {
  readonly kind: "file";
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly sha256: Sha256Digest;
};
```

`packageItemId` 只在一个 Sources manifest 内标识一个 package item。`fileItemId` 只在它所属的
package item 内标识一个 file item；`{ packageItemId, fileItemId }` 才是 file item ref。`sha256`
必须等于该 exact file snapshot 的 canonical UTF-8 bytes digest。package name 与 package-relative
path 只可由 Sources projection 作为 display text 提供，不能承担 join identity。

Sources family 必须把每个可定位 file snapshot 作为 strict UTF-8 text 保存，并在 seal 前把所有
line ending canonicalize 为 LF (`\n`)。`sha256` 是 canonical text UTF-8 bytes 的 SHA-256 digest。无效 UTF-8、
未 canonicalize 的 CRLF／CR，或 digest 不匹配都会使 Sources Attachment 不能成为 available payload。
source-sites 不接受 host locale、UTF-16 buffer 或当前文件的替代解释。

一个 Run 只 join 自己 sealed 的 Sources snapshot。新 Run 即使看到相同 package name、path、item
ID 或 digest，也拥有新的 snapshot instance，不能据此配对旧 Run。reference Member 展示历史
Attempt 时沿该 Attempt 的 exact origin Run 读取 Sources；它不把被选的新 Run 当成可替换的 snapshot。
跨 Run 比较属于显式 consumer 逻辑，不是 source-sites join 或 assembler 的能力。

### 坐标与 trace

```ts
type SourceCoordinateV1 = {
  readonly line: number;
  readonly column: number;
};

type AssertionSourcePackageFrameV1 = {
  readonly target: SourcePackageItemRefV1;
};

type AssertionSourceFileFrameV1 = {
  readonly target: SourceFileItemRefV1;
  readonly coordinate: SourceCoordinateV1;
};

type AssertionSourceFrameV1 =
  | AssertionSourcePackageFrameV1
  | AssertionSourceFileFrameV1;

type AssertionSourceTraceV1 = {
  readonly frames:
    | readonly [AssertionSourceFileFrameV1]
    | readonly [
        AssertionSourceFileFrameV1,
        ...AssertionSourceFrameV1[],
        AssertionSourceFileFrameV1,
      ];
};
```

trace 保留实际 runtime stack 从最外层 captured file 到叶调用点的顺序。第一帧和最后一帧都必须是
file frame；中间可以穿过任意 package 或 file frame。producer 不从 AST、import graph、恢复的
producer／use graph 或当前 worktree 补写 frame。

`line` 与 `column` 都是 positive safe integer。`line` 从 1 开始，按 canonical LF 分行；空 text
只有第 1 行，末尾 LF 产生最后一条空行。`column` 从 1 开始，按该行 canonical UTF-8 bytes 计数，
不按 UTF-16 code unit、Unicode scalar value、grapheme cluster 或 display cell 计数。它可以指向一个
scalar 的首 byte，或指向 line-end 的 `byteLength + 1`；不能落在 UTF-8 continuation byte。runtime
capture 必须在 seal 前转换到这个坐标系；reader 只按 saved snapshot 验证和显示。

## 精确 source-sites payload

`AssertionsDocumentV1` 由 [Assertions architecture](../architecture.md) 拥有。Sources manifest 的
family、attachment definition 与 source identity migration group 由 Record 侧 Sources owner 拥有。
本页只定义这些 owner 之间的 navigation facts 与其不变量。

```ts
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

type AssertionSourceSendStatusV1 =
  | "completed"
  | "failed"
  | "interrupted";

type AssertionSourceSendOccurrenceV1 = {
  readonly sourceOrder: number;
  readonly label: string;
  readonly status: AssertionSourceSendStatusV1;
  readonly durationMs: number;
};

type AssertionSourceSendSiteV1 = {
  readonly trace: AssertionSourceTraceV1;
  readonly occurrences: readonly [
    AssertionSourceSendOccurrenceV1,
    ...AssertionSourceSendOccurrenceV1[],
  ];
};

type AssertionSourceSitesDocumentV1 = {
  readonly entries: readonly AssertionSourceSitesEntryV1[];
  readonly sendSites: readonly AssertionSourceSendSiteV1[];
};
```

`entries` 按 `entryId` canonical 排序，且一个 `entryId` 至多一行。每个 `sites` 与 `sendSites`
按其第一条 occurrence 的 `sourceOrder` 升序排列。一个 site 内的 occurrence 也按 `sourceOrder`
升序排列。相同 entry 的两个 site 不得有完全相同的 trace。

每个 `sourceOrder` 都是 positive safe integer，并在一个 Attempt 的所有 assertion occurrence 和
send occurrence 中唯一。数值缺口没有语义：它既不代表 send，也不包含 send 的 location、status 或
duration。reader 只能读取 `sendSites` 的 exact occurrence，不能从缺口、Conversation、Timing、
Fact storage 或其他 Attachment 推断一个 send annotation。

这些是 producer seal invariants。structurally readable input 若有 duplicate `entryId` row 或 duplicate
`sourceOrder`，assembler 只把受影响 row／occurrence 标为 locally unmapped；它不使整个 source-sites
Attachment `invalid`。

`label` 是最多 256 Unicode scalar value、无控制字符的 sealed display text。`durationMs` 是 finite
non-negative milliseconds。每个 recorded send 都有 terminal `status` 与 duration；`interrupted`
仍表示已经开始、随后被 Attempt interruption 截断的实际 send。source-sites 不保存 prompt、reply、
provider payload、turn transcript 或 Fact graph；这些都不是源码页 send annotation 所需的事实。

`declaration` 标明 entry 的登记。`threshold`、`score`、`gate` 与 `optional` 分别标明对应 modifier
实际执行的位置。`stop` 标明 `.orStop()` 实际执行的位置：`continued` 表示 continuation 继续，
`stopped` 表示设置 authoring stop latch，`interrupted` 表示 stop 等待被中断。不存在为未执行源码
补写的 declaration、modifier、stop 或 send occurrence。

## Runtime capture、seal 与 Sources dependency

每个 Attempt 有一个单调 source-order allocator。registration、modifier、stop 与 `send` 都从同一
allocator 取得 runtime token。producer 在执行时保存 token、trace，以及 send 的 label、terminal
status 和 duration；seal 后才把 assertion token 关联到 durable `entryId`。它不能从 Assertions
entries 数组、`.key`、当前 worktree、静态 AST 或恢复的 producer／use graph 猜测这种关联。

在 whole Run `complete` 之前，Evaluation producer 必须联合验证下列事实：

- source-sites 的每个 `entryId` 都是同一 Attempt 已封口 Assertions entry；
- 每个 package／file ref 都存在于 exact origin Sources manifest，file digest 与 canonical UTF-8/LF
  snapshot bytes 相等；
- 每个 coordinate、trace、role、stop outcome、send status、duration 与 source-order token 都符合本页形状；
- runtime token 到 durable entryId 的关联只包含已执行 assertion occurrence，send 不伪装成 Assertion；
- Sources、Assertions 与 source-sites 都在同一 Run 的 `complete` 标识之前通过验证。

generic Record writer 只验证 Core、owner、typed Attachment 与各自 closure。它不恢复 Assertion
运行时图，也不把 source-sites semantic join 当成新的 Core ref。

Sources family 必须提供本页所需的 package／file ref、canonical text 和 exact origin snapshot lookup。
Source identity migration group 的注册、complete mapping ref、family API 及原子 migration 由该 owner
定义；本页不替代这些 Record 侧契约。identity 语义变化时，Sources 和 source-sites 必须使用同一
相邻 group；group 不能无损给出 mapping 时，公开读取保留旧 bytes 并得到
`migration-unavailable`，不猜测新 item 或跨 Run 配对。

source-sites converter 只接受该 group 给出的 complete frozen mapping ref。它不能从自己的 Attempt
payload、path、digest、array position 或其它 Run 补齐一对 package／file item。

## 局部 unmapped 与 Assertion 隔离

source navigation 在每个可读取 Assertions entry 上独立保留 mapped site 与 locally unmapped reason。
Sources 或 source-sites Attachment 不能形成 available payload 时，只影响导航。
Assertions、Verdict 与 Score 仍按各自 owner 读取。

三个 Attachment 都 available 后，semantic join failure 也只影响对应 entry、site 或 send occurrence。
公开 assembler 必须保留下列具名 local reason：

- missing source-sites entry、orphan 或 duplicate entry row；
- duplicate source order；
- unknown package item、unknown file item 或 digest mismatch；
- coordinate out of range 或 malformed trace。

一个 entry 的其它 valid site、其它 entry 与其它 send 继续显示。payload exact decode 或 own blob
closure 失败仍是 Attachment `invalid`，不按 row 修复。

Assertions criterion 的 unsupported 或 invalid 与 source mapping 独立。一个 entry 可以保留可读 source
site，同时 criterion 无法解释；也可以保留正常 criterion 与 sealed result，同时 source mapping 为
unmapped。mapping 不重复计算 check、points、unavailable、gate 或 Verdict；一个 `entryId` 的权威
结果始终只计一次。

`.key`、label 与 groupPath 只服务 display。它们不承诺跨 Attempt 配对，也不能替代 `entryId`、
package／file item ref 或 origin snapshot join。

## 中立公开读取与 assembler

源码导航固定由三个中立 projection 组成：

```text
attemptSlotProjection(assertionsProjector)
attemptSlotProjection(assertionSourceSitesProjector)
attemptOriginRunProjection(sourcesProjector)
                    │
                    ▼
      assembleAttemptSourceTreeV1(...)
```

`assertionsProjector`、`assertionSourceSitesProjector`、`sourcesProjector` 与
`assembleAttemptSourceTreeV1` 是公开 source navigation primitive。
它们的 TypeScript signature、input／output ADT、slot 穷尽性和 Attachment 六态由
[Projection Library](../../projection/library.md#source-navigation-primitives) 拥有。
assembler 是 pure：它只组合已经形成的 `ProjectedSample`，不读取 Record、blob、path 或当前 worktree，
也不重新执行 Assertion。

assembler 在每个 slot 保留 `excluded`、`not-recorded`、`core-invalid` 或 `attachment-result`。后者保留
三份 Attachment 各自的 six-state result，并把所有已知 mapping failure 放进局部 unmapped ADT。一个
entry 的多 site 可以产生多个 location annotation，但 output 只保留一份 entry detail，summary 与 sealed
score contribution 都按 `entryId` 去重后计算一次。send occurrence 不参与 Assertion summary 或 score。

官方 Report 与第三方 consumer 使用相同的三个 exported projector 与 pure assembler，或使用语义等价的
pure combination。没有内建 Report 的额外 reader、owner lookup、跨 Attachment capability 或
专用查询入口。

## 相关阅读

- [Assertions architecture](../architecture.md) —— entry、criterion、result 与 own material。
- [Projection Library](../../projection/library.md#source-navigation-primitives) —— 三种中立 projection 与 public assembler ADT。
