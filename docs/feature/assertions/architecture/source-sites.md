# Assertions —— source sites

本页拥有 Assertions 的源码导航字段与 Sources join 规则。Assertion 的位置事实只在 Attempt-owned `niceeval.assertions` 的 `sourceSites` 中，源码内容只在 origin Run-owned `niceeval.sources` 中。Assertions 当前 envelope 是 `schemaVersion: 2`，Sources 是 `schemaVersion: 1`；两者都保存已经发生的审计事实，不保存可执行的作者调用图。

Record catalog 固定为六个 family。Attempt-owned `niceeval.source-navigation` 只拥有物理 send 到 source/timing 的 join，不拥有 Assertion source site。第三方不能增加 family。完整 owner、closure 与 Sources manifest 规则见 [Record architecture](../../record/architecture.md)。

## owner 与 semantic join

| family | owner | 精确事实 |
|---|---|---|
| `niceeval.assertions` | Attempt | `entryId`、criterion、materials、evaluation、decision、policy、contribution，以及 `sourceSites` row。 |
| `niceeval.source-navigation` | Attempt | `turnId`、source frame 与 `agent.send` timing join；不含 `entryId`。 |
| `niceeval.sources` | origin Run | 当时源码闭包的 item manifest 与本 family own blobs。 |

`sourceSites` 的 `entryId` 只能 join 同一 Attempt 的 Assertions entry。`sourceItemId` 与 `sha256` 只能 join 该 Attempt exact origin Run 的 Sources manifest。这些字段是 immutable semantic join，不是 blob ref、Attachment address、Record path、owner handle 或读取 capability。

一个 Run 只使用自己 sealed 的 Sources snapshot。后续 Run 展示历史 Attempt 时，沿该 Attempt 的 `originRunId` 读取 Sources；不能以相同 path、digest 或 item identity 假装配对另一个 Run。跨 Run 比较属于显式 Analysis 定义，不是 source-sites 的能力。

## Assertions payload 中的 source sites

`sourceSites` 与 `entries` 同属一个 exact Assertions payload：

```ts
type AssertionSourceRole =
  | "declaration"
  | "threshold"
  | "score"
  | "gate"
  | "optional"
  | "stop";

type AssertionSourcePosition = {
  readonly line: number;
  readonly column: number;
};

type AssertionSourceSite = {
  readonly entryId: AssertionEntryId;
  readonly sourceOrder: number;
  readonly role: AssertionSourceRole;
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: AssertionSourcePosition;
  readonly end: AssertionSourcePosition;
};

type AssertionsAttachment = {
  readonly entries: readonly AssertionEntry[];
  readonly sourceSites: readonly AssertionSourceSite[];
};
```

`line` 与 `column` 都是 positive safe integer，由 runtime capture 按已封口 Sources snapshot 的坐标系产生。payload 不保存 absolute host path、Sources manifest 数组位置、Source blob ref、prompt、reply、provider payload、Turn transcript、当前 worktree 或未执行的调用位置。

每个 `sourceSites` row 必须满足以下 producer seal invariants：

- `entryId` 是同一 payload 已封口 entry；
- `sourceOrder`、`line` 与 `column` 都是 positive safe integer，且 `sourceOrder` 在该 Attempt 的所有 source sites 内唯一；
- rows 先按 `entryId`、再按 `sourceOrder` canonical 排序；
- `sourceItemId` 存在于 exact origin Sources manifest，`sha256` 等于该 item 已封口 bytes 的 digest；
- `start` 与 `end` 是该 snapshot 中可显示的有序位置；
- `role` 只标记实际执行过的 declaration 或 modifier；未执行源码不补写 row。

`declaration` 标明 entry 的登记，`threshold`、`score`、`gate` 与 `optional` 标明对应 modifier，`stop` 标明实际执行 `.orStop()` 的位置。它们只服务审计和导航；不会改变 criterion、evaluation、decision、policy、contribution、gate、points、earned score 或 Verdict。

一个 entry 可以有多个 row。它们可以产生多个 location annotation，但 Assertion detail、summary 与 score contribution 都按 `entryId` 只计算一次。source order 的数字不能用来推测未保存的 send、控制流或其它事件。

## Sources 内容与跨 family 边界

Sources family 拥有 `sourceItemId`、path、byteLength、sha256 与 content blob；`sourceItemId` 不是 path、digest、数组下标或 blob key 的函数。Assertions row 只能引用 item identity 与 digest，不能取得或借用 Sources blob capability。

因此 Assertion source site 需要两种已验证 family value：Assertions 提供 entry 与位置 join，Sources 提供用于展示的 origin snapshot。物理 send navigation 另由 `niceeval.source-navigation` 使用同一 exact Sources manifest；两个 family 不复制对方的 result、turn、duration 或 blob capability。

## Analysis DomainView 与局部 unmapped

consumer 通过 [Analysis Library](../../analysis/library.md) 的 `query()` 请求已发布的 source-navigation `DomainView`。它从当前 `Sample` 的 sealed source facts 形成闭合输出，不直接打开 Record、blob path 或当前 worktree，也不重新执行 Assertion。

family Host 仍只有 `available`、`not-recorded`、`unsupported` 与 `invalid`。`unmapped` 不是第五个 Host state，而是 DomainView 对某个可读 entry 或位置的局部导航结果：

- Assertions 没有该 entry 的 `sourceSites` row；
- Sources 是 `not-recorded`、`unsupported` 或 `invalid`；
- `sourceItemId` 找不到、digest 不匹配，或保存的坐标无法在 snapshot 中显示。

上述情况只影响相应 location。Assertion 的 criterion 与 sealed result 仍按自己的规则读取；source mapping 不重复计算 check、points、missing／partial、gate 或 Verdict。若 Assertions family 本身不是 `available`，Analysis 仅保留相应问题，绝不补成成功、零分或空 Assertion。

## 相关阅读

- [Assertions architecture](../architecture.md) —— entry、criterion、result 与内嵌 sourceSites。
- [Evidence](evidence.md) —— 受限 material 与 own closure。
- [Record architecture](../../record/architecture.md) —— Sources manifest、六个 fixed family 与四态 Host。
- [Verdict architecture](../../verdict/architecture.md) —— Core 与 Assertions 的读侧 fold。
- [Analysis Library](../../analysis/library.md) —— `Sample`、`query()` 与 `DomainView`。
