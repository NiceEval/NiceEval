# 设计裁决:Reports 外部评审修订(2026-07-16,第三轮)

三层重设计定稿([reports-component-page-report-redesign](reports-component-page-report-redesign.md))当天收到一份外部设计评审,逐条核对后按「接受 / 部分接受 / 否决」裁决。定稿形态已重写进 `docs/feature/reports/`、`docs/feature/results/library.md` 与两份 cases.md;实现对照清单在 `plan/reports-redesign-implementation.md`「2026-07-16 外部评审修订」节。本条只记翻案与否决的来龙去脉。

## 接受(评审指出的真缺陷)

- **`current()` 跨配置拼接会算错**:改 model/flags 后局部补跑,一个 experiment 行混两套配置却显示单一配置。裁决:加「可比性前提」——以最新快照的可比性配置为基准,不一致的旧快照不贡献,缺口走既有 partial-coverage。**曾选方案**:字段标 mixed + 新 warning(保留混拼数据);**否决理由**:标记了 mixed,聚合数字本身仍是两套配置的混合值,依旧误导;砍掉旧配置贡献才让「一行=一套配置」永真,且复用现有 partial-coverage 机制零新概念。可比性字段与编排字段的二分(runs/earlyExit/maxConcurrency/selectedEvalIds/evalFilterFingerprint/description 不参与)是本裁决的实质内容。
- **`ReportNode` 全文档无定义**:children/compose 返回值/`groups.map` 都依赖它却没有穷尽形状。已在 layout.md 定义;裸字符串被拒(自由文本必须过 `Text`,text 面折行与 web 转义需要显式载体)。
- **`AttemptListItem` 塞完整 assertions/error/diagnostics**:列表两面只渲染主失败摘要,完整结构进序列化 JSON 是泄露面与体积负担。翻案为 `failureSummary + moreFailures`(原设计注释「完整结构供展示层做遮蔽与下钻」被推翻——下钻本来就走 locator 回读取面);`redact` 范围随之收窄到只有 failureSummary。
- **`DeltaData` 丢 pair label**、**Scoreboard `missing` 混淆没跑与测不了**(拆 notRun/unscorable,计分仍都按 0)、**`MetricLine` 点身份未定义**(定为 `(series,x)`,x 须在 experiment × eval 内恒定否则报错)、**静态导出漏快照级 `sources/<sha256>.json` 正文**(view.md 曾自称"前端会读的全部复制"却漏了引用正文,携带条目还要归拢)、**默认报告散点「越靠右上越好」写反**(x 是成本,应为左上)、**标题回退两套口径**(view 的"当前 locale 显示值唯一" vs shell 的"深相等";统一为深相等,locale 相关判断会让不同语言页得出不同标题)。
- **命名**:`RunOverview`→`ScopeOverview`、`GroupSummary`→`ScopeSummary`、两处 `verdicts` 拆 `attemptVerdicts`/`evalVerdicts`(同名不同义是序列化后的实坑)、实体列表 `score/cost/duration`→`examScore/costUSD/durationMs`、`config()`→`runConfig()`(与 niceeval.config.ts 撞名,键收 RunConfigKey union)、`--eval`→`--source`(位置参数已是 eval 选择器,flag 再叫 --eval 违反 CLI 模型;AttemptEvidence 能力位 eval→source 同步)。
- **`ReportLocale` 封死 en|zh-CN**:数据协议(LocalizedText 键)开放为 string;官方生成面(内置文案、MetricCell.display)仍只出 en/zh-CN,其它 locale 走回退。**曾选方案**:每个 `*Data` 加 `locales` 选项;**否决理由**:speculative knob(见下 groupBy 同因),回退语义已够。

## 部分接受

- **「计算端渲染端必须同版本」不可检查**:保留裸 data(不套 envelope——会破坏 data 形态 props 直接性),改为组件消费 data 时做结构校验,漂移以显式错误浮出。**曾选方案**:`{data, warnings, producer, schemaVersion}` envelope;**否决理由**:改变每个组件 data prop 的形状,而 warning 分离本就是有意设计(宿主统一渲染)。
- **深相等 spec 缓存对函数未定义**:补「函数与 Metric/Dimension/NumericAxis 实例按引用比较」;未命中只是各算一次不是错误。否决了评审建议的显式 computation key(引用比较已让同 import 实例天然命中)。
- **脚本与"内容不可变"不变量矛盾**:改为显式的作者义务措辞(宿主不校验也无法校验),否决受限 enhancement API。

## 否决(评审误判或产品立场)

- **`ExperimentComparison` 加 `groupBy`**:一度落了文档,用户当场推翻——路径即分组 API,第三方 writer 要分组就让 id 带路径;自定义分组走组合组件(现有逃生门);给零配置成品加旋钮会模糊「官方看法」与「通用工具」的边界。教训:评审说"更通用的设计应有显式 X"时,先查现有组合逃生门够不够,不要条件反射加配置。
- **`Powered by niceeval` / 证据页不可移除**:是写明的产品决策(三条不变量支撑),非缺陷。
- **`TableRow.locator` 过度领域化**:`niceeval/report` 就是 niceeval 结果的报告库,locator 是「每个数字可下钻」不变量在 Table 的落点;泛化成 href/actions 反而丢约束。
- **`ReportDefinition` 绑死默认导出**:误读——它是普通值可测试可复用,默认导出只是装载 convention;docs 补了一句澄清。
- **改名否决**:`redact`(与 copySnapshots({redact}) 同名是有意一致)、`Col`(Row/Col 成对惯例无伤害)、`relativeTo`、`DeltaTable.by`。`Reporter`→`RunObserver` 未裁决(涉已实现 API,超出 reports docs 范围)。
- **`ExperimentComparison` text 面拆惰性分组详情**:数据已在内存,拆分省的是内存内聚合,破坏「两面同源同 payload」不值。
