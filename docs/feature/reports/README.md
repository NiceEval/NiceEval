# Reports —— 计划、数据与双面呈现

Reports 把一份已经生成的 [Sample](../sample/README.md) 变成可审计的报告交付物。
它保留组件、主题、`show`、`view`、参数化页面与作者组合能力，但把取数固定在 renderer 之前。

作者模型只有一条主线：

```text
冻结报告模块与参数
  → plan：枚举 page instance、Calculation、Projector request
  → executor：规范化、memoize 并求出 ReportData
  → render：每个 page instance 生成一次不可变组件树
  → text / web：消费同一棵树
```

ReportDefinition 的 `plan({ sample, parameters })` 只读取 Sample 的稳定 identity、规范化 sources、已定 membership、coverage 与 provenance。
它运行一次，不能读取 Projection 值、网络、时钟、任意 Store 或未计划的外部数据。

## 基本写法

```tsx
import {
  Col,
  Scatter,
  Table,
  aggregate,
  costUSD,
  defineReport,
  passRate,
} from "niceeval/report";

export default defineReport({
  plan({ sample }) {
    const performance = aggregate(sample, {
      id: "performance",
      by: ["agent"],
      measures: { passRate, costUSD },
      unavailable: "exclude",
    });

    return {
      pages: [
        {
          id: "overview",
          title: "Overview",
          data: { performance },
          render({ performance }) {
            return (
              <Col>
                <Scatter
                  points={performance}
                  x="costUSD"
                  y="passRate"
                  point="agent"
                />
                <Table rows={performance} />
              </Col>
            );
          },
        },
      ],
    };
  },
});
```

`aggregate()` 在 plan 中声明一个 sample-wide `AggregateRequest<Groups, Measures>`，不在作者代码里取值。
executor 统一执行 request，并把冻结的 `ReportData` 交给 `render()`。其中 `performance` 始终是
`EvidenceValue<AggregateResult>`；`Scatter` 与 `Table` 的 aggregate 输入会先显示外层 unavailable，
available 时才消费 `value.rows` 与 `value.coverage`。示例没有把它隐式 unwrap 成未包装数组。
同一 page instance 的 render 只运行一次，text 和 web 不会各自计算一遍。

## 作者应当理解的边界

- **Sample 是固定输入。** Reports 不重开 Record，不按 locator、时间或配置摘要重新挑选 Attempt。
- **Projector 是唯一取数入口。** 通过 Record 的 `defineAttemptProjector()` 声明身份、规范化 defaults、实际 Projector object dependencies 与读取。`projectNormalized()` 只返回 raw `T`；作者不能手写 available/unavailable 或 `basedOn`。
- **Calculation 是纯声明。** 它用带本地 request id 的 ProjectorRequest 列出 dependency，`evaluate()` 只经 `input.get(request)` 计算已交付输入。
- **renderer 只显示。** 它不能发起查询、执行 Calculation、读取 Store，或以 UI 字段反推 Record 事实。
- **缺失不是 null。** `EvidenceValue`、`MeasureCell` 和 `MetricValue` 保留 available / unavailable 判别；available 保留 verification 与全部 issues，unavailable 保留全部 causes 与 basedOn。
- **外部业务事实先进入 Record。** 先写成带 provenance 的 snapshot，再由 Projector 读取；报告模块不能在 plan 或 render 临时请求业务系统。

## 页面与参数

普通页面和参数化页面共用一种计划模型。
参数化页面在 plan 阶段按 Sample identity 枚举所有 instance；每个 instance 的 data dependency 在计划中完整可见。
数据相关分支只能决定怎样显示已交付的 data，不能在某个分支临时增加 Projector request。

`pages` 中只有一种作者输入 `ReportPageInput`。像上面的普通页可以同时省略 `instanceId` / `route`；
executor 确定性补成 instanceId 等于 id、pathname 为 `"/" + id`、空 route parameters，并把
navigation 补为 true。参数化页必须显式给出 instanceId 与 route；只给一个会在执行 request 前以
`report-plan-invalid` 失败。之后 renderer、target 与 artifact 只消费字段完整的 PlannedPage / ReportPlannedPage。

页面的 id、导航顺序、主题、head、`dimensionPins` 与双面 renderer 协议仍保持为 Reports 的宿主边界。
页脚、页头链接和作者组合仍是普通组件树；它们不成为另一个数据通道。

## 交付

公开 `loadReportDefinition(entryModule)` 先生成带完整 module graph identity 的
`FrozenReportDefinition`。`exportReport(frozenDefinition, { sample, sources, parameters, target })` 运行
完整计划，并返回 `ReportArtifactRef`。

`sources` 是由固定 Record handle 构造的 `RecordSourceSet`；交付物通过 `openReportArtifact(store, ref)` 打开。
executor 在执行完成后生成并写入 finalized `ReportExportPlan`；作者不手写 export plan，也不能靠
渲染时的偶然读取补依赖。

创建、打开、导出与读取 artifact Store 的完整入口和可判别 `ReportArtifactError` 见 [Library](library.md#导出报告)。

export 在读取 target Store、Record sources 或 Sample 字段并运行 plan 之前，先调用 Sample-owned
`validateMaterializedSample()`。伪造、brand / canonical order / invariant / digest 损坏统一包装为
`report-sample-invalid`，并保留完整 `SampleValidationError`；它们不会变成空 Sample、零 coverage 或
Store failure。

`ReportNode` 与 renderer 函数只存在于 export 的内存执行阶段。artifact 持久化的是 canonical
`ReportExportPlan`、纯 JSON page payload 与已经生成的 text / HTML。
它还保存资产 bytes 与 proof index。
`openReportArtifact()` 离线验证并重开这些值，不装载报告模块，也不重新执行 renderer。

Report artifact 与 SampleBundle 分别使用独立 Store。
`ReportArtifactStore` 只有 create/open 能取得 runtime brand，并实现 `AsyncDisposable`；wrapper
close 幂等，已经取得的 child export/read retain 可独立完成。真实 closed 与伪造/其它 Store kind
的 invalid handle 使用互斥 typed failure。

bundled local create/open factory 只接受非空绝对本地 path，或没有 host / query / fragment 的
`file:` URL；合法输入先规范化成绝对本地 path。root issue 与非 `file:` scheme 各有 closed typed
failure，并保留实际 `create` / `open` operation；它们不会伪装成 missing、permission 或 IO。

目标 Store 用分页 `RecordEvidenceProofIndexV1` 交付报告实际消费的 event、object、Claim 与 authenticated absence proof。
归档 wrapper 包含源 `RecordGraphRef`、原始 bytes 与路径证明，但不会激活源节点。

复制、递归 basis 闭合或 proof 校验失败会使导出失败，不能伪装成 `not-recorded`。
Report 不直接传播 Record owner error。
source 读取与 proof closure 都包装为 `ReportArtifactError / report-evidence-closure-failed`。
wrapper 按 `phase` 完整保留 typed `RecordSourceFailure` 或 `RecordEvidenceProofFailure`，不降成
message 或 `unknown`。

## 保留的呈现能力

`Table`、`Scatter`、`Waterfall`、`Conversation`、`SourceView`、`DiffView`、Attempt 与 Experiment 详情、主题与自定义双面 renderer 都继续存在。
组件接收已经计算好的普通值；它们不理解原始事件 schema，也不拥有 Record 读取权限。

`show` 与 `view` 选择报告 target，消费同一份计划、ReportData 和结果树。
`show` 的内建诊断切片仍是稳定的终端路径；`view` 保留本地浏览、深链、主题和静态站交付。

## 契约场景

实施与验收至少包含这些用户路径：

1. 按 Agent 显示质量与成本，并由同一批 ReportData 渲染图和表。
2. 生成 `security/` Sample 后收窄成员，再列出失败或 unavailable 成员。
3. 参数化 Attempt 详情页在 plan 中按 Sample identity 枚举，深链不增加临时读取。
4. 用自定义 Projector 定义业务读数，并把完整 basedOn、available verification 或 unavailable causes 交给 MetricValue。
5. 用固定题集 rubric 生成成绩单，保留固定分母和各题证据。
6. 把预先 snapshot 进 Record 的外部预算与 NiceEval 读数放进同一份 ReportData。
7. 用同一份定义分别由 `show`、`view` 与静态导出消费。
8. 定义新的双面显示形状，但不让 renderer 执行查询或重新判断证据资格。

## 相关阅读

- [Library](library.md) —— ReportDefinition、Projector、Calculation、MetricValue 与导出 API。
- [Architecture](architecture.md) —— plan/data/render、identity、memo、Store 与证据闭包。
- [Calculations](calculations.md) —— 公共计算内核与报告旁算法的边界。
- [Show](show.md) —— 终端 target 与内建诊断切片。
- [View](view.md) —— 浏览器、主题、深链与静态站交付。
- [Sample](../sample/README.md) —— 报告的已定输入与跨 Store 交付。
