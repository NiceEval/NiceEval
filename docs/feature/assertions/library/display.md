# Assertions —— display

`exp`、`show` 与 `view` 呈现同一份闭合 Assertion、Verdict、Score 与诊断值。终端反馈只服务当前进程；frozen reader 打开 `Sample` 后，Report 通过 [Analysis Library](../../analysis/library.md) 的 `query()` 取得需要的 `SemanticFrame` 或 `DomainView`，不把 Record 文件、路径或读取 capability 交给页面。

## Attempt 摘要

Pass Eval 的区块顺序是 Execution、Verdict、检查项。Score Eval 的区块顺序是 Execution、Verdict、Score、评分项。Score 的主读数是 earned score，并同时显示 `complete`、`partial` 或 `unavailable` 的完整度。

`partial` 显示已知 earned 下界与缺失原因；`unavailable` 显示原因而不显示 `0`。低分和合法零分正常显示为数值。只有相同 rubric 下的 complete 结果参与名次或数值选择；partial 的下界只用于诊断。Verdict 的四态含义与优先级始终以 [Verdict architecture](../../verdict/architecture.md) 为准。

## 单条 Assertion

每条 Assertion 显示其 display、sealed result、coverage、limitations 与有界的 subject／evidence preview。criterion 可解释时显示 criterion 说明；unknown 或 invalid criterion 只影响该 entry，并明确显示 `unsupported` 或 `invalid`。

未配置 points 且没有失败 gate 的 Assertion 以 `recorded passed`、`recorded failed` 或 `recorded unavailable` 显示，不补 `+0`。失败 gate 仍显示 `gate failed`。

配置 points 的 entry 不使用 `soft passed` 或 `soft failed`。标题先显示 sealed result，再分别显示 `weight <points> pts` 与 `earned <earned> pts`。measurement 同时显示实际测量值与 threshold。contribution unavailable 时显示具名原因，不补成 `earned 0 pts`。entry 的 points 是计分系数，不是 max、百分比或 Evaluation kind。

occurrence collection-filter 在 cardinality 为零且 matched 时，展开区显示期望零命中与 `0 definite matches`。

mismatched 时显示实际命中数、决定结果的 tool occurrence，以及命中输入内的位置。
诊断采样或截断不能删除 sealed result 与决定性见证。

`usedNoTools` 与显式 `matching(toolMatch({}), exactly(0))` 走同一展示。
`count` 与 `maxToolCalls` 走 numeric／cardinality 主视图：写出 count、threshold、result 与 completeness，不展开 Matcher Filter Debugger 或 tool ledger。

Web 详情把 matcher 自身作为可展开行：`matched`、`mismatched` 与 `unavailable` 分别使用成功、失败与警告色，并在每行视觉显示状态文字；颜色、图标或无障碍名称都不能成为状态的唯一表达。

点击 matcher 后按诊断语义展示，而不是固定摊开通用对象：command 显示命令、实际退出码与预期退出码；tool collection 显示计数约束、确定命中数、检查数与候选调用分支；比较与阈值显示有效的实际值和预期值。`kind`、布尔 `outcome` 与 `expected.kind` 等机器路由字段不进入主视图，source、criterion、observed、policy expected 与 explanation 的完整闭合值仍收进技术详情。
页面按 criterion 与 artifact 类型选择展示，不按包装方法名或私有 snapshot 形状分支。

数值 Assertion 的主视图直接写出事实、运算关系和判定，不让读者翻技术字段。例如 token 上限通过时显示 `已用 3,200 tokens ≤ 上限 4,000，所以通过`；失败时使用同一语序说明超限。lower-bound 无法决定结果时明确写“至少已用 X，但仍缺少 usage，无法判断是否 ≤ Y”，不能显示成通过或普通失败。
collection cardinality 使用同一语序，例如 `工具调用 3 ≤ 上限 4，所以通过`。集合不完整且下界尚不能决定结果时，写明已知次数与缺口，不能显示成通过或普通失败。

费用上限的主视图显示已封口 pricing receipt 的公式、总额、上限与判定，例如 `输入 1,000 × $2/M + 输出 500 × $8/M = $0.006 ≤ 上限 $0.010，所以通过`。model、price source kind 与实际 selector 随公式显示；缺 model、price source、charge 或 usage 时显示具名不可用原因。Report 只格式化 receipt，绝不按当前价格重算，也不改用 observed `usage.costUSD`。criterion、原始材料和完整 receipt 收进默认折叠的技术详情。

generic input 的 scalar 直接显示。array 默认只显示 `Array(n)`，展开后按原顺序编号，每个元素保留独立视觉边界；object 字段保持同一元素内的结构。`satisfies` 等 opaque predicate 只显示作者命名、sealed result 与 input 摘要，不编造 expected、reason 或 witness。完整闭合值继续收进默认折叠的技术详情。

组合 matcher 在 Query summary 中按原声明层级展开。每个 `and`、`or`、`not` 与叶子 matcher 都携带自己的 sealed 状态，因此父组合命中时仍能辨认没有命中的分支。完整候选集合进入 source-owned ledger，不复制成另一棵通用 candidate tree。

tool ledger 的人类编号按原始 canonical order 固定为 T1、T2；event ledger 使用 E1、E2。普通工具行显示实际工具名，可用的逻辑命令行显示已闭合 argv preview。编号只用于稳定定位，不能替代 `toolOccurrenceId` 或 `eventId`；过滤、排序和展开都不重新编号。

命令 preview 只消费已闭合、已按已知 sensitive value 脱敏的逻辑投影，并遵守统一显示上限；读取端不从自由文本猜测或清洗 secret。内部 identity 只作为技术 locator，不作为行标题。调用名称、input、output、status 与命令 token 等子 matcher 随 Report locale 使用界面用语，并内联显示有界的 expected、observed 或 unavailable reason。

ledger 行以内联展开显示详情。只有还存在子节点或技术事实的行才可展开；没有额外内容的叶子保持静态，不能出现空白展开区。未知或第三方 matcher 使用 generic fallback，不因没有专用展示而丢失输入和闭合诊断。

### Matcher Filter Debugger

`collection-filter` 与 `ordered-sequence` artifact 展开后的第二层固定采用同一个阅读顺序：

1. Query summary 显示 scope、quantifier 或有序 query steps，以及 sealed result。
2. 权威聚合区显示 examined、matched、mismatched、unavailable、known total 与 decisive／exhaustive 状态。
3. source-owned ledger 默认折叠，展开后显示 scope 中已持久化的中立工具 occurrence 或独立事件。
4. coverage-aware assertion overlay 把已保留的逐行求值证据叠在 ledger 上。
5. selected-row detail 显示当前 Tn／En 的 source facts、matcher 分支、差异、locator 与 relation status。

ledger 本身不染成成功或失败，也不写 `matched`、`mismatched`、`unavailable` 或 `not-evaluated`。这些状态只由当前 Assertion 的 overlay 提供。逐行结果没有保留时显示“逐行结果未保留”，不能根据 sealed result、聚合计数、颜色或 source 内容回填。

Debugger 分别显示 source collection、evaluation receipt、identity relation 与 overlay retention。四者各自说明 complete、partial 或 unavailable 的原因；identity relation 另行区分 exact 与 ambiguous。source partial、observability unavailable 和 retained old diagnostics 不能合并成一个笼统 warning。

overlay 完整时，过滤器提供 All Records、matched、mismatched 与 unavailable。只有 exact relation、canonical order 和 receipt／`failure frontier` 能证明某行没有被执行时，overlay 才显示 `not-evaluated`，并可提供同名过滤项。overlay 不完整时只提供 All Records 与 Retained Evidence，同时显示 `retained X / examined Y`；筛选后仍保留 T1、T2、E1 等原始编号。

collection filter 以人类规则和权威聚合计数为主。order 成功显示 query steps 与稳定的最早 witness path。order 失败显示 `failure frontier`，其中包含 longest matched prefix、first blocking step、suffix checked counts 和有界 representative differences。partial 或 unavailable 结果显示尚不能证明的 step 与缺口，不渲染失败 frontier。

Filter 视图的首屏先把 Query summary 翻成人类规则，并紧接权威汇总。order 再显示 witness path 或 `failure frontier`；source ledger 保持折叠，供需要逐条核查的人展开。机器 matcher tree、raw criterion 与 source locator 仍留在技术详情，不能挤掉规则、汇总和决定路径。

每个有 exact relation 的 ledger 行提供“定位到会话日志”。动作精确滚动到对应事件或 logical tool occurrence，并短暂高亮；不能跳到相邻 Turn 后让读者自行搜索。页面上方 trace 只为当前 Assertion 显示 transient overlay，切换 Assertion 或关闭详情就清除，不能把 overlay 写回 source facts。

历史 Record 未保存 current matcher query 或逐条 relation 时，Filter 主视图只显示一条提示：`此历史 Record 未记录 matcher 查询或断言与记录的逐条关联`。中立 source ledger 仍可在技术详情中折叠查看，旧 diagnostic 也只在该处按原样展示。legacy 不显示 partial 大卡、matched／mismatched 筛选、逐行 overlay、witness path、failure frontier 或任何推断命中；页面不重跑 matcher，也不把旧 diagnostic 与 ledger 合成 inferred overlay。

Assertions display 不携带 source path、origin source snapshot 或跨 family blob ref。需要源码导航时，Analysis 的 source-navigation DomainView 组合 Assertions payload 内的 `sourceSites` 与 origin Sources snapshot。
没有对应 row 或 Sources 无法形成可用值时，entry 位置显示 `unmapped`，不能猜测当前 worktree。`.orStop()` 已执行的位置可由 role 为 `stop` 的 source site 显示，不能由未保存的控制流推断。

## identity 与 route

每个 Assertion 详情实例、链接与 route 都使用持久 `entryId`。Attempt key 与 entryId 经 Report route adapter 构造 route；entryId 不直接拼 raw `AttemptId`。同名条目仍是不同详情项；name、groupPath 与 entries 位置只服务标题、分组和展示顺序。

## 相关 durable facts

Turn、conversation、diff、telemetry、timing 和 diagnostic 使用各自的固定 family。页面只呈现 Analysis 已关闭的值与 Calculation results，并包装为闭合的 report document；展开详情不能重新读取 Record、请求网络或执行 criterion。

颜色、图标或悬停提示不能是状态的唯一表达。展示前剥除 ANSI 与不可打印控制字节，按显示宽度截断预览，并明确标记省略。原始大文本只在相应 owner 的 own blob closure 中；详情只保留有界入口。

## 相关阅读

- [Assertions architecture](../architecture.md)
- [Assertion evidence](../architecture/evidence.md)
- [Source sites](../architecture/source-sites.md)
- [Record architecture](../../record/architecture.md)
- [Verdict architecture](../../verdict/architecture.md)
- [Analysis Library](../../analysis/library.md)
- [Reports 架构](../../reports/architecture.md)
- [Reports CLI](../../reports/cli.md)
