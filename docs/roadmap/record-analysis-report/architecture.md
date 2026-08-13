# Architecture

本架构保留 Record 的不可变事实、frozen Sample、verified cache 与静态交付能力，同时把 RecordAttachment authoring 从公共 API
移回平台内部。

## 依赖方向

```text
普通 Eval
  └─ domain Plugin / registered Capture token
       └─ Capture host
            ├─ total obligation
            ├─ producer identity
            └─ fixed Metric / Score / Artifact command
                    ↓
              internal Record kernel
                    ↓ frozen Record view
              Analysis field executor
                    ↓ MetricValue / closed rows
              Report callback
                    ↓ closed semantic tree
              terminal / Web / static renderer
```

上层不能反向取得下层 capability：

- Report 不能取得 Analysis projection 或 Record reader。
- Analysis 不能取得 Capture capability 或 Record writer。
- Capture callback 不能取得 Record root、path、schema version 或 migration authority。
- Plugin mount 不能安装 converter 或扩大 Record 可读 family。

## 四种 identity

| identity | 回答的问题 | 何时固定 | 不能替代什么 |
|---|---|---|---|
| Fact definition identity | 事实是什么 | package definition load | producer behavior |
| Producer identity | 谁用哪一种行为产生 | Eval / Plugin mount | fact identity、领域 label |
| Attempt identity | 哪次实际执行拥有事实 | Invocation planning | logical slot |
| Analysis field identity | 按什么口径解释事实 | Analysis module load | Report column label |

Report row identity 由 nominal population identity 与完整 grouping coordinate 形成。显示顺序、format、limit 或 locale 不参与 row
identity。

## Fixed envelope model

Record 内部拥有固定 envelope schema：

```ts
interface FixedFactEnvelopeV1<Definition, Payload> {
  readonly kind: "metric" | "score" | "artifact" | OfficialFactKind;
  readonly definition: CanonicalDefinitionSnapshot<Definition>;
  readonly definitionFingerprint: string;
  readonly producer: ProducerIdentitySnapshot;
  readonly owner: AttemptId | RunId;
  readonly sealedAt: string;
  readonly payload: Payload;
  readonly evidence: readonly EvidenceRef[];
}
```

第三方 definition 决定 envelope 内受限 token 的名字和值，不决定 durable document shape。NiceEval 拥有：

- envelope schema version；
- canonical encoding 与 blob closure；
- 相邻 converter；
- current decoder 与 generic inspector；
- migration plan、publication 与 receipt。

领域 package 拥有：

- fact definition identity 与纯数据 snapshot；
- Producer identity；
- Capture 逻辑；
- Analysis fields、producer compatibility 与跨 ID bridge。

application 不拥有 executable schema、converter 或 installation。

## Capture state machine

每个 actual Attempt 打开时，host 从 Eval definition 与 mounted Plugins 收集 Capture tokens，并建立 pending obligations：

```text
declared
  → pending
      ├─ seal available / empty / unavailable / failed → accepted
      └─ duplicate / foreign / late / invalid          → violated

Attempt close:
  pending  → violated
  accepted → publish candidate
```

只有全部 required obligations accepted，且 optional obligations 没有 contract violation，Attempt 才能进入 publish candidate。
`required: false` 的 explicit failed 可以保存为事实；未封口从来不是 normal missing。

host 对一次 seal 执行以下原子步骤：

1. 验证 token 属于当前 Attempt。
2. 验证 obligation 仍是 pending。
3. 验证 definition fingerprint、producer identity、state 与 bounded payload。
4. 规范化 Evidence refs 与 Artifact blobs。
5. 形成 fixed envelope command。
6. 把 obligation 标为 accepted。

任何步骤失败都不留下 accepted obligation。Attempt publication barrier 同时等待 Plugin release 与所有 obligations 的最终状态。

## Metric coordinate completeness

Metric seal 是一个有限 coordinate set，不是 append stream。

```text
Metric definition labels
       ↓
complete coordinate tuple
       ↓ unique within bundle
available | empty | unavailable | failed
```

声明 expected coordinates 时，host 验证集合相等；未声明时，host 只验证实际 coordinate 唯一且符合 definition。后者不能产生
“缺少 gpu-1”之类推论，因为系统没有 nominal device set。

这种边界阻止 Metric 变成任意事件隧道。需要 span、command、conversation 或 file diff 时，应使用对应官方事实；复杂第三方材料
进入 Artifact。

## Score atomicity

Score 的一次 evaluator invocation 对整个 rubric bundle 原子提交。required rubric 不能靠 absent 表示 empty 或 failed。
Evidence refs 属于各 rubric result 或 bundle failure，复杂 explanation 自身保存在 Evidence / Artifact。

Attempt 发布后不会追加 Score。历史重分析只运行新的 Analysis fields；未来 post-hoc 持久判分必须引入新的 immutable Assessment
Run owner，并显式引用旧 Attempt 与 frozen Evidence。

## Frozen read path

一个 host operation 对一个 canonical root 打开一个 `RecordAccessRuntime`：

```text
RecordAccessRuntime
  ├─ invocation facet   → frozen reuse view + scoped write session
  ├─ snapshot facet     → fresh frozen view for Analysis / Report
  └─ maintenance facet  → inspect + plan + authorize + migrate
```

Capture write session 关闭后，Analysis / Report host 必须取得 fresh frozen view。它不能沿用写前 reader，也不能在 Report execution
中自动刷新。

verified cache 只缓存 exact content identity 对应的已验证 Core、fixed envelope 与 blob。它不缓存 live reader、Capture token、
Report callback 或 migration authority。

## Analysis execution

Analysis field graph 由 nominal descriptors 构成：

```text
frozen Sample
  → fixed envelope readers
  → local typed facts
  → package-owned relations
  → Dimension / Measure
  → MetricValue
```

每个 field 必须绑定一个 nominal population。跨 population 需要具名 relation；没有 relation 时拒绝组合，不做 heuristic join。

Metric Measure 的 reduction 顺序固定为：

```text
coordinate cells within Attempt
  → Attempt value
  → attempts within logical slot
  → value across logical slots
```

每一段都保留状态、observed、denominator、issues 与 refs。一个 scalar 不能在丢失这些信息后重新包装成 `MetricValue`。

## Report execution

Report 选择 data-dependent callback 与 requested-page isolation，因此不在 callback 前编译整份 Report。

```text
request Page
  → create restricted ReportSample
  → run Page callback once
       → aggregate A: compile A field DAG, execute, cache, return closed rows
       → branch on closed rows
       → aggregate B: compile B field DAG, execute, cache, return closed rows
  → close semantic tree
  → render terminal / Web / static
```

同一次 `ReportExecution` 的 cache key 包含：

- frozen Sample identity；
- nominal population identity；
- exact field descriptor 与 dependency identity；
- producer policy；
- Analysis executor version。

它不使用公开字符串 ID 单独作为 cache key。不同 execution 不共享这项保证。

Page callback 与 component callback 都只运行一次，不存在 discovery dry-run。未请求 Page 的 dependency error 不影响当前 Page；
static export 通过同一次 execution 枚举目标 Pages，因此仍可跨 Page 复用 field results。

## Closed semantic tree

Report callback 结束时，以下对象都不能进入 `ReportExecution`：

- `ReportSample`；
- Record reader 或 root path；
- Promise、Effect、Stream 或 callback；
- Analysis field executor；
- Capture token 或 Producer config secret。

闭合树只含 serializable semantic nodes、closed rows、MetricValue、refs、routes 与 problems。terminal、Web 和 static renderer 不能
重新查询数据或重算指标。

## Migration boundary

平台 converter 只升级 Record Core 与固定 envelopes。unknown future envelope 必须把 exact bytes 与完整 blob closure 无损带到
新 snapshot；做不到时整个 migration fail closed，source snapshot 保持不变。

第三方 package 消失后，generic definition snapshot、Metric / Score values 与 Artifact 仍可由平台检查、显示和迁移。package
特有 Analysis field 只有恢复 package，或 import exact-compatible pure definition 后才可执行。

历史数据修复使用追加的具名 correction 或新 fact identity，不原地改已发布事实，也不伪装成 schema migration。

## Invariants

1. 普通作者 API 不出现 Record writer、schema version、converter、installation 或 projection。
2. 一个 Capture token 只属于一个 Eval / Plugin declaration graph。
3. 每个 actual Attempt 的 obligation 恰好 accepted once，或 Attempt 失败。
4. Fact definition identity 与 Producer identity 分离。
5. Metric coordinate 与 Score rubric 都有硬上限，不能承载任意事件。
6. Artifact 内容不自动进入 Analysis schema。
7. Analysis 决定 population、denominator、missing 与 rollup；Report 只呈现结果。
8. ReportSample 不能枚举 raw facts 或改变 population。
9. 每个 Page / component instance 在一次 execution 中最多执行一次。
10. renderer 只消费闭合 semantic tree。
11. migration 不能部分发布，也不能执行第三方 converter。
12. official facts 与 third-party facts 共用内部 kernel；官方特权止于固定 namespace 与 envelope ownership。
