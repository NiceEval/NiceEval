# 报告作者 API —— Architecture

本篇定义 Reports 怎样把固定 Sample 变成可导出的双面结果，而不让页面、组件或导出器绕过证据边界。
公开形状见 [Library](library.md)。

## 执行模型

```text
Sample-owned validateMaterializedSample
loadReportDefinition：冻结 module graph digest 与 provenance
  → exportReport：验证 Sample 与 frozen definition capability
  → 校验并 JCS 规范化报告参数
  → definition.plan({ sample, parameters })
  → ReportPlan（作者侧 ReportPageInput）
  → executor 规范化 PlannedPage、memoize Projector、执行 Calculation
  → immutable ReportData
  → page instance render(data) 一次
  → immutable ReportNode
  ├─ text renderer
  └─ web renderer
```

报告入口先由 `loadReportDefinition()` 冻结模块图及其 provenance，再把 branded
`FrozenReportDefinition` 交给 executor。
模块图、Sample identity、参数、target 和 NiceEval 版本共同决定计划身份；动态 import、网络模块或进程变量集合不是报告输入。

`plan()` 运行一次。
它枚举全部 page instance、Calculation 与 Projector request，并生成确定顺序的 `ReportPlan`。
plan 可读取 Sample 的 identity、membership、coverage 和 provenance，但不能读取 Projection value、网络、时钟、随机数、任意 Store 或 renderer context。

executor 完成计划后才会读取 Projector。
每个 page instance 的 `render(data)` 只接收该计划已经交付的 data，并只运行一次。
返回树冻结后由 text 与 web 共用；两个 renderer 都不能重新执行页面或 Calculation。

## Sample 是范围与正确性的输入

Reports 接收的是已生成的 [MaterializedSample](../sample/library.md#materializedsample-与构造入口)，不是会追随 head 的 Record handle。
它的完整 `sources` 集合、成员、denominator、included、excluded、unavailable 与 Record-owned membership proof 都是本次计划的输入。

任一 Reports executor 在读取这些字段前先调用 Sample-owned `validateMaterializedSample()`。
`exportReport()` 尤其在 target Store / RecordSourceSet、frozen definition 检查与 plan 之前完成这一步；失败包装为
`report-sample-invalid` 并保留完整 `SampleValidationError`。Reports 不修复 brand、canonical order、
invariant 或 digest，也不把非法值解释成空范围。

一次 Attempt 的完整引用直接使用 [Record Library 的 `AttemptRef`](../record/library.md#runcontribution-与-attempt-handle)。
它的 `AttemptId`、`AttemptLocator`、完整 `RecordGraphRef` 与 adopted `NodeRefV1` 都由 Record owner 定义；Reports 不重新声明字段，也不把它们改写为普通字符串。

Attempt 永远属于 origin Run。
当前 Run 对它的 `executed`、`carried`、`accepted` 或 `renamed` membership 只作为 Sample provenance 出现，不会被 Reports 重新解释为另一种 Attempt 或另一套统计口径。

## Projector 与 Projection identity

Projector 必须严格使用 [Record Library 的 `defineAttemptProjector`](../record/library.md#追踪式-projector) 创建。它有 `Input`、`Params`、`T` 三个泛型参数；id 是对象，读取入口只能是 `projectNormalized(ctx, parameters)`：

```ts
import { defineAttemptProjector } from "niceeval/record";

const utf8 = new TextEncoder();

function compareUtf8(left: string, right: string): number {
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

type ChangedLinesInput = { includeGenerated?: boolean };
type ChangedLinesParameters = { includeGenerated: boolean };

const changedLinesDefaults: ChangedLinesParameters = {
  includeGenerated: false,
};

const changedLines = defineAttemptProjector<
  ChangedLinesInput,
  ChangedLinesParameters,
  number
>({
  id: {
    namespace: "acme.checkout",
    name: "changed-lines",
    version: "1",
  },
  parameters: {
    schema: "acme.checkout.changed-lines/1",
    defaults: changedLinesDefaults,
    normalize(input = {}) {
      const unknownFields = Object.keys(input)
        .filter((field) => field !== "includeGenerated")
        .sort(compareUtf8);
      const firstUnknown = unknownFields[0];

      if (firstUnknown !== undefined) {
        return {
          state: "invalid",
          issues: [
            {
              code: "unknown-field",
              path: [firstUnknown],
              expected: { kind: "known-field" },
            },
            ...unknownFields.slice(1).map((field) => ({
              code: "unknown-field" as const,
              path: [field],
              expected: { kind: "known-field" as const },
            })),
          ] as const,
        };
      }

      if (
        input.includeGenerated !== undefined &&
        typeof input.includeGenerated !== "boolean"
      ) {
        return {
          state: "invalid",
          issues: [
            {
              code: "invalid-field",
              path: ["includeGenerated"],
              expected: {
                kind: "schema-rule",
                id: "include-generated-boolean",
              },
            },
          ],
        };
      }

      return {
        state: "success",
        parameters: {
          includeGenerated:
            input.includeGenerated ?? changedLinesDefaults.includeGenerated,
        },
      };
    },
  },
  dependencies: [],
  async projectNormalized(ctx, parameters) {
    const diffEvents = await ctx.events(diffBinding, diffQuery);
    return countChangedLines(diffEvents.value, parameters);
  },
});
```

`ChangedLinesInput` 与 `ChangedLinesParameters` 是本段 Projector 示例的局部参数类型。
`defineAttemptProjector`、`ProjectionReadContext` 与其余 Projector 协议只由 [Record Library](../record/library.md#追踪式-projector) owner。

示例的 normalizer 始终返回 `ProjectorParameterNormalization`：未知字段先按 UTF-8 bytes 顺序
选择字段并返回稳定、非空的 typed issue，合法输入则返回带完整 defaults 的 `success.parameters`。
它不通过 throw 表示 unknown field，也不返回未包装的 `ChangedLinesParameters`。

`ProjectionReadContext` 跟踪 identity、provenance、Claim、event、object 与嵌套 Projector 的全部读取。
它构造 `basedOn`；作者不得伪造、替换或漏写该字段。
`projectNormalized` 不接收 raw Attempt、AttemptHandle、Store 或任意对象查找器；所需 Attempt identity 由 `ctx.identity()` 取得，所有其它读取都走 `ctx`。

`projectNormalized()` 只返回 raw `T`。作者不能构造 available/unavailable wrapper、causes、
verification 或 basedOn；runtime 根据 tracked read 的完整结果
形成 `EvidenceValue<T>`。必要读取无法满足时由 context/runtime 形成 unavailable，不能由示例代码
猜一个主因。

Projector 的 `parameters.defaults` 本身就是完整规范化 `Params`。可选 request input 省略时以空对象
进入同一个 normalizer；normalizer 拒绝未知字段、补入 defaults 并按 JCS 规范化。runtime 对
defaults、规范化 Params、Projector result 与 dependency 数组执行 canonical copy / deep-freeze，
作者不能靠后续 mutation 改写 identity 或 memo value。

`dependencies` 只包含实际 `AttemptProjector` object，不是 `ProjectorId` 的近似副本；省略时
runtime 规范化为空数组。嵌套 `ctx.project()` 只能调用这里声明的 object dependency。定义期检查
无效 dependency object 与完整依赖图 cycle；registration 只检查同一完整 ID 的不同 object；
执行期传入未声明 object 时保留 `ProjectorExecutionError / projector-undeclared-dependency`。

一条 Projection identity 必须包含：

- Projector namespace、name 与 version；
- 参数 schema 与规范化后的参数值；
- 完整 `RecordGraphRef`；
- `attemptId`；
- 完整 adopted NodeRef。

因此相同 locator 但不同 Graph 或 adopted revision 绝不共享 memo。
同一 executor 内才允许按这份完整 identity memoize；Projection 不进入 Record graph，也不成为下次运行的事实输入。

## Calculation 与 ReportData

Calculation 用带本地 request id 的 `ProjectorRequest` 静态声明所有 Projector dependency，并只在 executor 交付依赖后运行纯 `evaluate(input)`。
它不能打开 Record、调用网络、读取任意 Store，或把 unavailable 自动压成 `null`。

每个 request 同时保存 Record-owned Projector 与其 input。executor 先调用 Record normalizer，再以完整 `ProjectionIdentityV1` memoize。Calculation 只能用 `CalculationInput.get(request)` 取得对应 `EvidenceValue`；它不能以对象形 Projector id 当作 JavaScript key。

ProjectorRequest 不是 page data leaf。单成员 page 使用显式带 `SampleMembership` 的
`CalculationRequest`；sample-wide 汇总使用 `AggregateRequest`。前者只展开指定 member，后者只展开
自身固定 Sample 的完整有序 membership。

Calculation 的 canonical `configuration` 也是 plan identity 的一部分。普通 `defineCalculation()`
使用空对象。`rollup()` 与 `aggregate()` 把 reducer、group、每个具名 measure 的 Calculation identity
与完整 configuration，以及 unavailable policy 写入该对象。

executor 将 configuration 与 SampleRef、CalculationIdentity、稳定 request address 和规范化 Projector
requests 一起写入 `CalculationExecutionIdentity`。函数引用与 request 创建顺序不参与 identity。

每个 root request address 固定 selected page target、data key、page-local request id 与 member/Sample
scope。

每个 Projector instance 另固定 owner calculation 与 membership。calculation dependency 还固定
member-root 或具名 aggregate-measure invocation，以及 Calculation-local request id；group dependency
固定 aggregate group address。

声明期 local-id 冲突在 membership 展开前拒绝。不同 address 即使共享同一 Projection memo，也作为
不同 consumer 留在 plan。

[`MeasureCell`、`CalculationInput`、`ReportDataRequest` 与 `ReportData`](library.md#reportdefinitionrequest-与-reportdata) 的唯一公开形状在 Reports Library。executor 汇集 MeasureCell、coverage、依据和验证质量，产生冻结的 ReportData。
Calculation 的输出、页面选择的 data 和 renderer 之间没有 Promise、lazy query 或组件级 data binding。

需要业务数据时，先把数据 snapshot 成 Record 中带 provenance 的事实，再通过 Projector 声明读取。
报告模块可引用其冻结的 module graph，但不能把 import、进程变量或请求响应当成未写入的业务事实。

## 结果值

`EvidenceValue<T>` 的精确形状直接采用 [Record Library](../record/library.md#evidencevaluevalue-与-verification-两轴)。
available 分支携带 value、basedOn 与 verification；unavailable 分支携带非空 causes 与 basedOn，
不含 verification。Reports 不再声明相近副本，也不为 unavailable 合成 verification。

所有 causes 与 issues 必须保留。
renderer 只显示既有的证据资格判断，不能选择「主因」或把 limited 当作 full。

MetricValue 在 available 与 unavailable 两种状态下都保留 `coverage`、`basedOn` 与 `refs`。
rollup 明确声明 unavailable policy；零 included 成员一定得到 unavailable MetricValue。
available 纳入值的 verification 取最差等级并合并全部 issues；unavailable 只有非空 causes，不含
verification。

`aggregate()` 的 raw Calculation output 是 `AggregateResult { rows, coverage }`，而 page data 是
`EvidenceValue<AggregateResult>`。顶层 coverage 说明 Sample membership 能否取得 group 值；行内
MetricValue coverage 说明该组内的 measure reducer。renderer 与 artifact 都保留这两层以及最外层
EvidenceValue，不把任一层 unwrap 成未包装的 rows、`null` 或空数组。

`eval` 与 `mode` group 直接使用 Sample 已认证的 Contribution shape。`agent` 与 `experiment` group
由内建 Record Projector 读取对应 provenance / Run evidence。它们的 object dependency 与规范化
Contribution input 全部进入 Calculation requests；`ProjectionIdentityV1` 进入 ReportExportPlan。
group Projector unavailable 的成员进入 AggregateResult 顶层 coverage.unavailable，不产生猜测值。

## 组件不执行计算

显示原语和组合组件只消费 `ReportData` 派生的值树。
它们不读取 Record、Sample Store、raw event schema 或 Claim，也不能通过字段名反向推测 Record 结构。

`Table`、图表、摘要格和详情组件继续按 `rows`、`points`、`value`、`items` 与 `attempt` 等具体角色属性接收数据。
自定义 renderer 仍必须同时实现 text 与 web，但两面只接同一份已冻结的值。

## 多页、目标与参数化页面

页面 id、标题、导航、主题、head 和 `dimensionPins` 在 module 冻结后可见。
参数化页面没有逐请求的数据阶段。
plan 根据 Sample identity 与规范化参数枚举每个 instance，并为每个 instance 列明 data dependency。

作者只有一种 `ReportPageInput`。普通页面可同时省略 instanceId / route；executor 确定性补为
`instanceId = id`、pathname `"/" + id`、空 route parameters 与 `navigation = true`。只提供二者之一
无效。参数化页面必须显式提供完整 instanceId 与 route；校验、duplicate target / route 检查和
canonical copy 都发生在任何 data request 执行前。后续阶段只看字段完整的 PlannedPage，artifact
再机械写成字段完整的 ReportPlannedPage。

`ReportTarget` 只定位已经计划的 page instance。
view 可以把 target 编码为深链，show 可以把它格式化为终端路径；没有计划到的 target 必须明确报错，不得借机查询新证据。

数据相关条件只能选择怎样渲染已交付 data。
不能以「若图表展开」「若某格 unavailable」等条件请求新的 Projector、Calculation 或 Store 读取。

## show、view 与本地重建

show 的内建诊断切片和显式 Report target 共用 executor 的输出规则。
view 保留页面导航、深链、主题与本地重建，但重建的单位是新的冻结 module graph、Sample identity 和 ReportPlan。

任何 Record 更新都要求重新打开对应 `RecordGraphRef` 并形成带新 source 的 Sample；既有页面不会在同一次 render 中漂移。
浏览器切换页面、locale 或 text/web 面只消费已生成结果，不能制造计划外数据请求。

## 导出、Store 与证据闭包

`exportReport()` 先把作者 `ReportPlan` 规范化成不带 evidence 与 ref 的内存
`ReportPreparedPlan`，再使用显式 `RecordSourceSet` 创建隔离的跨 source Projection session。
它执行所选 target 的全部请求，在内存中把每页 `ReportNode` 分别消费成最终 text 与 HTML。
只有执行 trace 与页面输出都完成后，executor 才形成 finalized `ReportExportPlan` 并写出 artifact。

SourceSet 只提供固定 reader；registry 与 memo 属于这次 export，不能污染另一份报告。
Projector dependency cycle 已由 branded object graph 在 definition 阶段拒绝。

在上述任何步骤之前，export 已用 Sample owner validator 验证 caller-supplied Sample。非法 Sample
不会触碰 target/source，也不会开始 plan，因此不能因后续 phase 的失败竞争成 Store 或 Record error。
finalized ReportExportPlan 由 executor 生成，至少写入：

- 冻结的报告模块图、定义 identity 与规范化参数；
- Sample identity、完整 `sources` 集合与 selected page instance；
- selected request graph 中每个 root address 的 Calculation 与每个 consumer address 的规范化 Projector
  request；两组按完整 JCS bytes 升序但不按共享 memo 去重，未选页面和未执行分支不进入；
- 每个所选 target 实际消费的 direct evidence 集合、全局 direct evidence union 与 proof closure identity。

pageEvidence 与 selected targets 等长同序。每页 direct set 和全局 union 都按完整 EvidenceRef 的 JCS
bytes 升序去重；未选择页面与未执行分支不进入。artifact proof index 则恰好等于这个 union 加上递归
Claim basedOn 的 Record-owned closure，不能缺项或带额外 proof。ReportPlanRef 因而只在执行 trace
闭合后计算，不可能由执行前计划预报 evidence。

`ReportPlanRef` 只摘要 versioned plan body，不摘要自己的 `ref`、Store root 或 runtime state。
`ReportArtifactRef` 只摘要 versioned artifact payload，不摘要自己的 `ref`、函数或 `ReportNode`。
两者都使用 Library 定义的 RFC 8785 JCS UTF-8 bytes 与 SHA-256；相同 ref 的不同 canonical bytes
是 collision，不能替换已保存的 bytes。

artifact page 是纯 JSON IR：canonical data snapshot、最终 text 与最终 HTML。asset descriptor 摘要
对应的原始 bytes，proof index ref 传递绑定归档证据。`openReportArtifact()` 只依赖 Artifact Store
验证这些 bytes 并返回 immutable value；它不装载 module graph，也不重跑 plan、Projector、
Calculation 或 renderer。

Report artifact Store 与 SampleBundle Store 都独立于源 Record Store，也彼此独立。
ReportArtifactStore 是 create/open 才能取得的 runtime-branded `AsyncDisposable` capability。
close 只幂等释放 wrapper retain；close 后不接收新 operation，但已经取得的 export/read child retain
可以独立完成。brand 校验先于 lifecycle，因此真实 closed capability 与伪造/其它 Store kind 的
invalid handle 互斥。

bundled local factory 与 Record / Sample 的 local-root 规则一致：只接受非空绝对本地 path，或没有
host、query、fragment 的 `file:` URL，并在任何文件系统访问前规范化为绝对本地 path。closed root
issue 与 unsupported URL scheme failure 都保留原输入及 create/open operation；规范化成功后的
create/open failure 报告 normalized root。任意远端 URL 不能借 local factory 构造 capability。

目标 Store 中的分页 `RecordEvidenceProofIndexV1` 统一引用 event、object、Claim 与 authenticated absence proof。
inert archive 保存源 `RecordGraphRef`、原始 bytes 和路径证明。
源 Claim、stream GraphNode 或其它源对象不能作为目标 Store 的活动节点。

源 Record 中已有的证据在导出时无法读取、复制或验证，会让导出失败。
只有源 Record 本来没有该事实时，Projector runtime 才能根据 tracked read 形成 unavailable
`EvidenceValue`；Projector author 仍只返回 raw `T`，导出器也不能把自己的故障改写成
`not-recorded`。

Report 统一把 source reader 与 proof closure 的 owner failure 包装为
`report-evidence-closure-failed`。`phase: "source"` 保存完整 `RecordSourceFailure` 与 source Graph；
`phase: "proof"` 保存完整 `RecordEvidenceProofFailure`。包装层不重写 owner code、operation、issues、
retryable 或底层 cause，也不另设第二种 source wrapper。

SourceSet 的三种输入失败继续使用 Record owner 的判别项：

- 伪造或其它 kind：`read-source / record-source-invalid-handle`；
- 真实 closed：`record-source-closed`；
- 缺少必需 GraphRef：`record-source-missing`。

Reports 对这三者应用同一个 source phase wrapper。

## 自定义显示形状与资产

`defineRenderer()` 继续定义新的双面显示形状，并可声明 scripts、styles 与静态资产。
资产只随已生成页面树收集；初始 HTML 无 JavaScript 时仍完整可读。
脚本只能增强浏览体验，不能取数、改写 MetricValue 或重新判断 evidence。

## 错误反馈

所有公开入口以 [Library 的 `ReportArtifactError`](library.md#导出报告) 交付可判别失败，
而不是把作者或 Store 问题降成一段未分类的文字。失败 code 与所属阶段一一对应：

- 参数未知、缺失或不能规范化是 `report-parameters-invalid`，保留字段与 schema；
- caller-supplied MaterializedSample 的 brand、canonical structure/order、不变量或 digest 无效是 `report-sample-invalid`，保留完整 `SampleValidationError` typed cause；
- plan 读取 Projection、网络或 Store，或生成非法页面集合，是 `report-plan-invalid`，保留违规页面；
- Calculation 漏列 dependency 或 request id 冲突是 `report-request-invalid`；
- Projector definition error 保持 Record-owned `ProjectorDefinitionError`；
- input normalization、registration、Record capability read、backend read 与 execution failure 是 `report-projection-failed`。`phase` 分别为 `input`、`registration`、`record-read`、`read` 与 `execution`。typed cause 对齐对应 Record error family。`record-read` 完整保存 `RecordReadError.failure.operation` / retryable / cause；`read` 的 `ProjectorReadError` 只负责 backend unavailable / IO；
- Calculation 或 renderer 的实际执行失败分别是 `report-calculation-failed` 或 `report-render-failed`；
- source reader 或 proof closure 失败是 `report-evidence-closure-failed`，按 `phase` 保留完整 typed `RecordSourceFailure` 或 `RecordEvidenceProofFailure`；
- artifact Store 的 root、URL scheme、已存在、缺失、格式、ref、损坏、权限、不可用与 IO 状态使用 `ReportArtifactStoreFailure`。local factory 的 root failure 保留 create/open operation；合法 root 先规范化为绝对本地 path。

缺失证据不是渲染异常。
它以原样保留的 `EvidenceValue` 和 `MetricValue` 进入结果树。

## 相关阅读

- [Library](library.md) —— 公开 API 和组件输入形状。
- [Calculations](calculations.md) —— Calculation、rollup 与领域算法。
- [View](view.md) —— 浏览器 target、主题和静态交付。
- [Sample](../sample/library.md) —— 固定 source 集合、membership 与 Sample Bundle。
