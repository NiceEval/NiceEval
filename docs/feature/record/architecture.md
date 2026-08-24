# Record 架构

Record 是可携带的已封口运行事实。Record Core 决定 owner、引用、content、Seal 与发布机制；Attachment
definition 决定持久业务语义。Experiment 调度、execution claim、Analysis 分母和 Report 页面都在 Record 之外。

外部消费者把 `<project>/.niceeval/record/` 当作 opaque directory（不透明目录）。目录、JSON 与 content object
是 Core 私有协议。第三方 package 可以定义 Attachment，却不能借 SPI 取得 root、path 或文件系统能力。

## 三层职责

| 层 | 拥有 | 不拥有 |
|---|---|---|
| Record Core | owner capability、exact codec、content source 读取、digest、预算、原子 envelope commit、Seal、发布、reader 与 migration executor | Assertions、conversation、file change 等业务字段与 capture 解释 |
| `record/family` | attachment 的 family、owner、current Schema、named validate；persistence 的 revision 与私有相邻 migration | root I/O、staging、路径、Git、capture 生命周期 |
| Runner / Sandbox / Adapter / producer | 在亲历边界通过领域 collector capture，并使用 owner-scoped `record.write` 提交一次完整有界 logical value | durable layout、digest 算法、物理 content 表示、跨 owner 写入或第二个 capture authority |

官方与第三方 definition 都遵守这条边界。Core 不按 family 名称分支；`record/family` 不打开 Record；capture
authority 不写 envelope 或 content object。

## 两个物理边界

| 边界 | 内容 | 是否可复制、纳入 Git |
|---|---|---|
| portable Record | `record.json`、已发布 Run、Core、Attachment、Seal manifest 与 content | 是 |
| local operation state | execution claim、lease、writer staging、临时文件与 verified-read cache | 否 |

execution claim、session 与 lease 位于 `.niceeval/coordination/`。每个 writer 的 staging 位于同一文件系统，
但不在 portable root 内。migration 不创建 sentinel、journal、backup、rollback metadata 或 Git sidecar。

local state 不进入 Report，也不随 Record 复制。复制或 Git 操作只在 writer 与 maintenance 停稳后进行。

## Durable layout 与 commit record

```text
record/
├─ record.json
└─ runs/
   └─ <RunId>/
      ├─ run.json
      ├─ members/<SlotId>.json
      ├─ attempts/<AttemptId>/
      │  ├─ attempt.json
      │  └─ attachments/<family>/
      │     ├─ attachment.json
      │     ├─ payload/sha256/<digest>
      │     └─ content/sha256/<digest>
      ├─ attachments/<family>/
      │  ├─ attachment.json
      │  ├─ payload/sha256/<digest>
      │  └─ content/sha256/<digest>
      ├─ seal-manifest.json
      └─ complete
```

`record.json` 写一次，保存 `{ format: "niceeval.record.attachments", recordId }`。根目录没有递增编号、
权威 `latest` 或共享 summary。

一个 Attachment instance 由实际 owner 与 `family` 定位。`attachment.json` 是它唯一的 commit record。
Core 先写完并同步 content object，再以同目录 atomic replace 提交 envelope。没有被 current envelope 引用的
content object 不是事实。

envelope 保存 definition identity，以及 payload、content 与 reference inventory。logical value 单独编码成
digest-addressed payload bytes，并在 envelope 提交前写完：

```ts
type AttachmentEnvelope = {
  readonly format: "niceeval.record-attachment";
  readonly ownerKind: "run" | "attempt";
  readonly family: string;
  readonly revision: PositiveSafeInteger;
  readonly payload: {
    readonly sha256: Sha256Digest;
    readonly byteLength: NonNegativeSafeInteger;
  };
  readonly contents: readonly {
    readonly key: RecordBlobKey;
    readonly sha256: Sha256Digest;
    readonly byteLength: NonNegativeSafeInteger;
  }[];
  readonly references: readonly {
    readonly owner: "run" | "attempt";
    readonly family: string;
  }[];
};
```

payload 与 content pointer 只在当前 Attachment 的私有 namespace 定位。即使两个 Attachment 的 digest 相同，
它们也各自拥有 bytes。Core 禁止跨 owner、跨 family、跨 Run 或 root 外引用。

Seal manifest 穷尽本 Run 的 Core、envelope 与 materialized content。`complete` 与 Seal 在 sealed staging
中一起形成，再经 no-replace directory rename 发布。ordinary publication 不替换已存在的 Run directory。

## Definition identity 与 owner brand

definition identity 是唯一三元组：

```text
(ownerKind, family, current Schema, named validate)
```

`family` 是稳定、无版本后缀的字符串。`ownerKind` 是 `run` 或 `attempt`；同一 family
可以各有一个 Run definition 与 Attempt definition，因为两个三元组不同。

`defineAttemptRecord` / `defineRunRecord` 返回 callable nominal definition。brand 同时携带 owner kind、family、
current Schema 与 logical value 类型；definition 本身也是 reader selector、reference target 和 Host
`RecordContribution`。字符串、对象复制、类型断言或手写 envelope 都不能构造同等 capability。完整作者调用形状由
[Record Library](library.md#high-level-record-definition) 统一定义。

```ts
const attemptEnergy = defineAttemptRecord({
  family: "acme.energy",
  schema: EnergySchema,
  validate: validateEnergy,
});
```

Run owner 的 `record.write()` 只接受 Run command；Attempt owner 只接受 Attempt command。TypeScript 在作者面拒绝 owner mismatch，dynamic JavaScript 边界再次返回
`record-owner-definition-mismatch`。

## Host-local explicit contribution composition

高层 definition 直接通过 Host 或 Plugin composition 显式贡献；已有 persistence 经 adapter 进入同一输入：

```ts
const host = makeRecordHost({
  records: [
    attemptEnergy,
    recordContributionFromAttachmentPersistence(legacyEnergyPersistence),
  ],
});
const reader = yield* host.current.openRead({ root });
```

`makeRecordHost()` 的规范输入只有 `{ records }`。它冻结 contribution，并按 exact nominal brand 与 `(owner, family)`
检查唯一性；低层 persistence 在创建时已经验证 revision 与 migration 单链。composition 不注册模块、
不修改进程状态，也不按 import 顺序选择 winner。

Host 把 immutable composition 绑定到 `openRead()`、`createRun()` 与 maintenance。一个 Host 形成后不会看见后续
composition。第三方 Plugin 可以贡献高层 definition 或适配后的 matching persistence；是否放进某个 Host 由应用决定。

composition 只授予解释 bytes 的能力。root I/O 仍由 `RecordFileSystem` 与 owner-scoped session 持有。任意 package
仅定义 Record 不会取得 reader、writer、path、lease 或 migration executor。

## 底层 Attachment persistence SPI

`defineRecordAttachment()`、`defineRecordAttachmentPersistence()` 与 `defineRecordMigration()` 保留为已有 family
演进的底层 SPI。persistence 拥有 durable revision 与严格相邻 migration。
`recordContributionFromAttachmentPersistence(...)` 把它适配成 Host `RecordContribution`。

底层 owner session 的 `attach(definition, callback)` 仍保留 exact owner、Schema、closure 与 content builder 契约；
它只服务 persistence SPI，不是高层业务 writer。

高层 definition 只自动创建 revision `1`，不提供 revise API。这个作者面与 composition 变化不改变 envelope、
目录、Seal、migration 或任何 portable physical bytes 的格式契约。

## Definition 的业务模块

每个 `record/family/<id>/definition.ts` 是小型 composition edge：

```text
definition.ts
├─ schema.ts                 current logical / encoded schema
├─ invariant.ts              owner-local business invariants
├─ budget.ts                 value、reference 与 content budget
├─ content.ts                sealed content Schema declarations
├─ references.ts             semantic dependency descriptors
└─ migrate/<n>-to-<n+1>.ts   strict adjacent transforms
```

`definition.ts` 只组装这些模块。复杂 schema、capture adapter 或 migration 实现不复制进总 catalog。
总 catalog 只是 definition 数组，不包含 family-name switch。

官方 definitions 为：

| ownerKind | family | capture authority |
|---|---|---|
| Attempt | `niceeval.assertions` | Assertion producer |
| Attempt | `niceeval.agent-turns` | Adapter |
| Attempt | `niceeval.turn-contexts` | SessionManager |
| Attempt | `niceeval.sandbox-commands` | Sandbox wrapper |
| Attempt、Run 各一份 definition | `niceeval.runner-activities` | Runner owner-monotonic clock |
| Attempt、Run 各一份 definition | `niceeval.runner-diagnostics` | Runner diagnostic sink |
| Attempt | `niceeval.file-changes` | Sandbox attribution collector |
| Run | `niceeval.sources` | Runner source collector |
| Attempt、Run 各一份 definition | `niceeval.artifacts` | 对应 owner 的 artifact collector |

conversation、usage、commands、timing 与 diagnostics 是 reader-side view。source navigation 是
Turn Contexts、Runner Activities 与 Sources 的 typed relation。它们都不占 durable family identity。

## Logical value、session callback 与 content consumption

一个 callable definition 有两个 command 输入面，另有 sealed declaration 面：

- `a(value)` 接受已经形成的完整 logical value；`a(builderCallback)` 延迟到 owner session 执行，其 content input 可以来自 text、bytes 或 Scope-bound Stream。
- sealed Schema 以 `RecordTextContentSchema`、`RecordBytesContentSchema` 与 `RecordAttachmentReference.to(ExactDefinition)` 声明位置。

```ts
type CurrentLogicalValue = unknown;
```

session callback 的 `content` 与 `reference` builder mint 本次 owner-local token。Core compiler 从 sealed declaration
生成 traversal 与 closure plan；它消费 source、计算 digest、执行 byte budget，并写 content object。

logical schema 禁止物理 path、content object key 与跨 Attachment ref。Reader content 是 Scope-owned consumption，
必须读尽或显式关闭；Scope finalizer 关闭遗留 stream、handle 与 lease。

reference descriptor 与 content descriptor 是不同数组。reference descriptor 声明目标 owner kind、family、
version relation、cardinality 与业务 anchor。它不指向 content，也不授予目标 writer 或 reader capability。

## Exact codec、预算与信任边界

durable bytes、JSON、Plugin contribution 与 dynamic import 都从 `unknown` 进入。catalog 先验证 definition shape，
reader 再按 envelope identity 选择 exact Schema。成功解码后的内部值不再接收 `unknown`。

definition 的 Schema 必须是 `R = never`。invariant、content descriptor、reference descriptor 与 migration
transform 都是确定性纯计算。它们不接收 filesystem、clock、random、network、root 或 path capability。

显式组合第三方 JavaScript 表示 Host 信任它作为同进程代码执行；SPI 本身不是恶意代码 Sandbox。
即便如此，Core 不把 Record root 或文件系统交给 callback，并独立验证 callback 输出与预算。

每个 definition 声明：

- value JSON byte、depth、node、object key、array item 与 string byte 上限；
- reference 数量上限；
- content 数量、单项 byte 与总 byte 上限。

Host 另有不可放宽的 reader hard ceiling。write、read、`requireComplete()`、Seal 与 migration 执行同一组
family budget；migration 不能借历史 decoder 绕过上限。

Core canonicalize encoded object key，但不擅自排序 identity array。family invariant 必须验证声明的 canonical order、
重复 identity 与 owner-local relation。Core 单独验证跨 Core document、reference closure 与 content closure。

## Current root 与 Core

current root 的 exact value 是：

```ts
type RecordDocument = {
  readonly format: "niceeval.record.attachments";
  readonly recordId: RecordId;
};
```

Run、Member 与 Attempt 的 current Core 形状为：

```ts
type RunDocument = {
  readonly runId: RunId;
  readonly experimentId: ExperimentId;
  readonly context: RunContext;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotIdentity[];
};

type RunContext = {
  readonly experimentId: ExperimentId;
  readonly execution: {
    readonly agentId: string;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
    readonly flags: RecordJsonObject;
  };
  readonly labels: Readonly<Record<string, string>>;
};

type SlotIdentity = {
  readonly slotId: SlotId;
  readonly evalId: EvalId;
  readonly attemptOrdinal: number;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
};

type MemberDocument = {
  readonly slotId: SlotId;
  readonly action:
    | "executed"
    | "carried"
    | "accepted"
    | "not-dispatched"
    | "interrupted";
  readonly attempt:
    | { readonly originRunId: RunId; readonly attemptId: AttemptId }
    | null;
};

type AttemptDocument = {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
  readonly slotId: SlotId;
  readonly evalId: EvalId;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
  readonly outcome: "completed" | "errored" | "cancelled" | "interrupted";
};
```

Core 强制以下不变量：

- `expectedSlots` 以 `slotId` canonical 排列且不重复；同一 `(evalId, attemptOrdinal)` 也只能有一个 Slot。
- `RunDocument.context` 必填、只写一次，且 `context.experimentId` 等于 Run 的 `experimentId`。
- `executed`、`carried` 与 `accepted` 必须引用 Attempt；终态空 Member 必须显式写 `null`。
- Attempt 只存放在 origin Run；origin Member 唯一，后续 Run 只写精确 reference。
- writer 只引用其 read selection 中已经发布的 Attempt，不形成 future reference 或环。

matcher、当前输入、cache hit、通行率、排名与页面模型不进入 Core。

## 局部读取算法

`openRead()` 先验证 root 与 Core structural boundary，并冻结已观察到的 published RunId。它读取 envelope header
与 Seal entry，却不要求 catalog 认识 inventory 中每个 family。

调用 `read(owner, definition)` 时按以下顺序执行：

1. 验证 definition brand 与 owner kind，并定位 owner 下的 exact family。
2. family 不存在时返回 `not-recorded`。
3. envelope revision 不等于 persistence current 时返回 `migration-required`，不调用历史 parser。
4. 解码 logical value，验证 content inventory、预算与本 definition 的 invariant。
5. 按独立 reference descriptors 展开 dependency closure。
6. closure 缺少 definition 时返回 `family-definition-required`；已知 dependency 再重复同一算法。
7. 全部通过后返回 deep-frozen value 与 owner-local blob closure。

inventory 中的未知 family 不参与第 1 至 7 步，所以无关 family 仍可局部读取。未知 bytes 不会被报告为
`invalid`；当前 session 没有解释它们的 authority。

`requireComplete(selection)` 会遍历选择及其引用到的每个 envelope。它要求每个三元组都有 definition、每个
version 都 current、每条 closure 都完整、每项预算都通过，并验证完整 Seal。缺一项就 fail closed。

Run publisher 与 migration 最终 Seal rebuild 使用同一 complete validator。它们不能发布或宣称完整 Seal，
却把未知 family 当作 opaque success。

## Writer 与发布状态机

Run writer 在 portable root 外建立 owner-private staging。owner-scoped writer 只有一个通用写入口：

```ts
owner.record.write(definition(valueOrBuilderCallback))
```

它是 create-once staging mutation；返回 `void` 不代表 durable publication。每个 family 的唯一领域 collector 在内存中
append、排序、去重并表达 complete/partial，再提交一次完整有界 value。重复或并发同 family 在 callback、Stream
与 I/O 前以 `record-already-written` 失败，并使未发布 Run fail closed。其余 write/append cases 见
[Record Library](library.md#write--append-case-matrix)。

逐 family Host method、通用 append、raw JSON writer、blob writer 与 family-name switch 都不属于目标形态。

Run session 状态为：

```text
open → sealing → ready-to-publish → published
               ↘ failed
```

1. `createRun()` 验证 request、context 与 Slot identity，再排他创建 staging。
2. `createAttempt()` 签发 Attempt owner writer；Run session 自身也是 Run owner writer。
3. producer 把惰性 command 交给 matching owner；`record.write()` 先排他占有 family，再执行 callback、消费 source，
   并在 staging 中形成 committed envelope。
4. `referenceAttempt()` 只写 Member reference，不复制历史 Attachment 或 content。
5. `seal()` 拒绝新 mutation，等待所有 owner writer 和 capture authority 停稳。
6. complete validator 检查 Core、全部 definition、reference closure、content、预算与 canonical inventory。
7. publisher 最后形成 Seal manifest 与零字节 `complete`，同步文件和目录。
8. no-replace directory rename 原子发布整个 Run，并重读 destination 后返回 receipt。

第 8 步前的 typed failure、defect、interruption 或进程退出都不暴露部分 Run。第 8 步后 Run 已发布；即使调用方
没有收到 receipt，也不撤销事实。finalizer 只释放 lease 与 handle，不删除已发布目录。

## 显式、相邻、单链 migration

ordinary reader 永远不执行 maintenance。direct read 遇到非 current revision 返回 `migration-required`。
`show`、`view`、`exp` 与 Library open 都不会自动调用 maintenance migration。

一个底层 persistence 可以携带历史 decoder 与相邻步骤，但必须形成从每个受支持 predecessor 到 current 的严格单链：

```text
1 → 2 → 3
```

跳步 `1 → 3`、分叉、合并、环、重复 revision 或缺口都使 catalog
`record-migration-chain-invalid`。不同 owner kind 的同名 family 各自拥有链。

`host.maintenance.planMigrate({ root })` 生成 nominal plan。`applyMigrate({ root, plan })` 取得 exclusive
maintenance lease，再按 RunId、owner kind、owner id、family、source version 的 canonical 顺序扫描：

1. 用该 step 的历史 schema 解码 current envelope，并验证 source content / reference closure 与预算。
2. Core 把已保存 content 作为 bounded immutable input 交给纯 transform。
3. transform 返回 target logical draft；Core 重新生成 content、计算 digest 并验证 target definition。
4. Core 先同步新 content，再 atomic replace `attachment.json`。这个 envelope commit 结束一个相邻步骤。
5. 继续下一相邻步骤；已是 target version 的 envelope 不重复执行。

全部目标 current 后，Core 从 current envelopes 与 Core bytes 重建 Seal manifest，完整验证，再 atomic replace Seal。
Seal 是最后一步。成功 receipt 只来自 full current Seal；丢失 receipt 后重跑会得到同一 current 结果。

migration 不读取当前项目文件、网络、provider、时钟或随机源，也不执行 capture。它不调用 Git，不要求 Record
已跟踪或 clean，不写 sentinel、journal、backup、rollback metadata 或恢复脚本。

## 崩溃状态、续跑与 orphan 删除

恢复只依赖 durable envelope、content address 与 Seal，不依赖隐藏 journal：

| 崩溃点 | durable truth | 下一次显式 migration | orphan 处理 |
|---|---|---|---|
| target content 写入前 | 旧 envelope | 重跑同一步 | 无 |
| 写入部分临时 content | 旧 envelope | 丢弃临时文件后重跑 | 临时文件不进入 namespace |
| content 已同步，envelope 未替换 | 旧 envelope | 可复用同 digest object，再重跑 transform | 未引用 object 记为 orphan candidate |
| envelope 已替换，receipt 未返回 | 新 version envelope | 跳过已提交步骤，继续下一步 | 旧 content 暂时保留 |
| 若干 Attachment current，Seal 尚旧 | 各 envelope 分别是唯一 truth | 继续未完成步骤，最后重建 Seal | ordinary `requireComplete()` 失败 |
| 新 Seal 临时文件已写，尚未替换 | 旧 Seal | 丢弃临时文件并重新确定性构建 | 不删除 committed content |
| Seal 已替换，receipt 未返回 | full current Seal | 返回 `already-current` 或等价 current receipt | maintenance 可开始 orphan sweep |

ordinary local read 可以读取已是 current 且 closure 完整的无关 family。它在 direct dependency 仍旧时返回
`migration-required`，在 Seal 尚未重建时不能通过 `requireComplete()`。

orphan sweep 只在 exclusive maintenance 下运行。Core 必须先证明所有 envelope current、完整 Seal 已重建，
再按 Attachment 私有 namespace 删除不被 current envelope 引用的 object。它不得跨 Attachment 以 digest 合并，
也不得在 mixed-version 或 Seal 与 envelope inventory 不一致时猜测垃圾。

## Legacy root cutover

`niceeval.record.attachments` 是 beta 阶段的一次 current format cutover。旧 `niceeval.record` 与
`niceeval.record.source-receipts` 不进入 ordinary catalog，也不由 `openRead()` 动态加载 decoder。

legacy decoder 只由显式 migration 选择。迁移先验证 legacy root 和完整写集，再按 current definitions 重写
Attachment 与 Seal，最后替换 `record.json`。ordinary read 不加载 legacy decoder，也不会产生写入。

无法证明 capture authority、owner、reference 或 content provenance 的 legacy 字段不得猜测转换。converter
必须返回具名 dropped facts，或在首个 destination byte 前拒绝。current writer 不双写 legacy format。

## Git 边界

Git 只负责用户拥有的历史、diff、restore 与 rollback。NiceEval 可以在错误提示中建议用户先提交或复制 Record，
但不会执行 `git status`、`git restore`、index 检查或 HEAD 绑定，也不会把 commit 写进 portable 或 local state。

迁移失败时，用户可以用自己的 Git 流程比较或回退。Record 只报告 committed envelopes、pending versions、
Seal 是否匹配 current inventory 与 orphan candidates；它不判断某次 Git restore 是否安全。

## Typed failure 与 Cause

| code | 触发条件 |
|---|---|
| `duplicate-family` / `invalid-family-definition` | identity 重复或 definition 不是 branded value |
| `owner-mismatch` | owner writer 与 definition brand 不匹配 |
| `family-definition-required` | direct read、reference closure、`requireComplete()` 或 publish 缺 definition |
| `record-migration-required` | root 是受支持 predecessor；ordinary reader 要求显式迁移 |
| `migration-required` | 已知 Attachment 的 revision 是可达 predecessor |
| `migration-chain-invalid` | 相邻链有缺口、分叉、跳步、环或重复版本 |
| `record-migration-invalid` | 历史 bytes、closure 或 migration 输出不能安全推进 |
| `resource-budget-exceeded` | value、reference 或 content 超过 family budget |
| `record-seal-incomplete` | 完整 Seal 缺 persistence、closure、committed envelope 或 current revision |
| `record-maintenance-busy` | exclusive migration / clean 与活动 session 冲突 |
| `record-format-unsupported` | root 或 Attachment 使用当前 composition 无法解释的 future / foreign identity |

已知 current Attachment 的业务损坏仍作为该读取的 `invalid` data state。I/O、permission、closed Scope 与
content open failure 是 typed Effect failure，不伪装成 `invalid` 或 `not-recorded`。

每个 error 只带稳定 code 与有界安全上下文。raw filesystem error、Schema tree、stack、secret 与第三方 message
不进入 portable bytes 或默认 CLI JSON。interruption 与 defect 不写入 typed union；finalizer 释放资源后保留 Cause。

## 变化归属

| 变化 | owner | Record 动作 |
|---|---|---|
| matcher、计划、reuse 条件或 Report component 改变 | behavior / Analysis / Report | 不改 Record，必要时更新 behavior identity |
| 从已保存事实计算新统计或 view | Analysis / Report | 不改 Record |
| 新的不可恢复事实 | 定义该事实的 package / Plugin | 新增 versionless family definition，并显式贡献 catalog |
| family 字段、单位、cardinality、content 或 reference 语义改变 | persistence owner | 提高 durable interpretation revision，并提供严格相邻 migration |
| Core identity、owner、目录、envelope commit 或发布边界改变 | Record Core | 发布新的 root format identity，并提供显式 root import |

新增 Analysis、Query、Measure、Page、renderer 或 Adapter mapper 不会自动推动 Record migration。

## 公开入口验收门

实现只有同时通过以下公开入口验收，才满足本契约：

1. 安装后候选实验以 `defineAttemptRecord` / `defineRunRecord` 定义 family，经显式 `{ records }` composition、write、seal、read；同一 definition 也可声明和创建 reference，未组合时没有全局残留。这是 API 可用性实验，不保留逐机制断言的专用 E2E Repo。
2. Record 含未知 family 时，已知无关 family 可读；direct / reference closure 返回
   `family-definition-required`，`requireComplete()` 与 publish fail closed。
3. content source 由 Core 计算 digest 并验证 budget；两个 Attachment 的相同 digest 仍产生 owner-private content。
4. v1 → v2 → v3 fixture 在 ordinary read 只返回 `migration-required`。显式 migrate 在每个崩溃点重启后可续跑，
   不重复 committed step，并且最后才替换 Seal。
5. migration 过程中没有 Git 调用，也不产生 sentinel、journal、backup 或 rollback metadata；orphan 只在 full
   current Seal 后删除。
6. legacy root 只经显式 migration 成为新 format；ordinary `show`、`view` 与 `exp` 不加载 legacy decoder。
7. 官方 family 使用同一 callable definition 与 `record.write(a(...))` 路径；类型检查与结构守护证明 Host 没有逐 family 写 API，Core 没有 family-name switch。

耐久、迁移与恢复结果的 E2E 必须从安装后的 Library / CLI / Plugin 入口运行。第三方 composition 与真实中断恢复不能直接写私有
envelope、复刻 Core content reader，或用 Git sentinel fixture 代替真实崩溃与续跑观察。literal migration
fixture 可以固定历史 bytes，但结果必须从公开维护与读取入口验收。
