# docs 与代码 gap 收口：实现 TODO 树

本计划只负责拆解工作，不把 `docs/` 降格为当前实现说明。核验入口：

- Results 目标契约：`docs/feature/results/{architecture,library}.md`
- Reporter / Invocation 目标契约：`docs/{runner,observability}.md`
- Reports 目标契约：`docs/feature/reports/`
- 测试覆盖登记：`docs/engineering/testing/{README,unit/results,unit/reports,unit/experiments-runner,unit/sandbox,e2e/report}.md`
- 实现定位与差异台账：`docs/source-map.md`

## 核验结论与设计判断

- **Snapshot diagnostics 的分层方向合理**：诊断属于真实 Snapshot；`Scope` 不设聚合 diagnostics；报告 data 只投影可序列化的来源身份与记录，不把 `Snapshot` / `AttemptHandle` 拖进浏览器。这能保住来源、时效和 IO 边界。
- **`current()` 的目标方向合理，但 Reports 输入契约与 `filter()` 尚不够可实现**：`Scope.snapshots` 应是贡献水位的真实 Snapshot，`Scope.attempts` 是另行物化的选中 attempt。两者不能再靠 `snapshots.flatMap(s => s.attempts)` 绑定；删掉同一 experiment 的某一个来源 Snapshot 时，也不能只按 experimentId 保留全部 attempt / coverage。Reports 目前也只从 snapshots 展平，且拿合成 Snapshot 充当“最新水位时刻”；移除合成对象后必须显式区分 attempt 的真实来源与该 experiment 的水位基准。
- **Snapshot 封口的所有权应在单个 Snapshot writer**：docs 示例与“每个 Experiment 各自收尾”都要求 `snap.finish({ diagnostics })`；当前 `ResultsWriter.finish()` 一次封全部快照既与公开示例不符，也无法诚实表达不同 Experiment 的完成时点。
- **Invocation 正名不是机械替换**：docs 尚未穷尽声明 `InvocationSummary` / `InvocationShape` 的字段；现有 `RunSummary.agent/model` 是跨多 Experiment Invocation 上的单值，语义不成立。先定稿形状，再改名，避免把旧模型原样换皮。
- **实验域 diagnostics 缺少持久化传递协议**：当前 `RunFeedbackState.diagnostics` 是终端状态，字段只有 `key/severity/message/data`，而落盘需要 `code/level/message/phase/data/command/count` 和明确 experiment 归属；`Artifacts` 又在 CLI 读取 feedback state 之前封口。不得解析 key/message 猜落盘记录。
- **组深度 `MetricMatrix` 的现有 docs 形状不合理**：一个 attempt 可同时贡献多个 `groupPath`，而当前 `Dimension` 是“一 attempt → 一个 key”、`Metric.value()` 也拿不到当前组上下文。不能把它伪装成新增一个 BuiltInDimension；优先设计专用组深度组件/数据模型，不污染通用矩阵。
- **F 是环境相关测试，不应跳过**：`src/sandbox/orphans.test.ts` 在本次受限环境跑出 `20 passed`，但用例结果会随 `ps` 是否可用改变，仍违反确定性单测契约。应注入进程启动时刻判据，不用环境探测决定断言。
- **E 的实现已存在**：`scoringComposition`、`totalScore` 顶层导出、计分制实体字段和 mixed 拆组均有源码与测试；定向执行 `compute.test.ts + dual-render.test.tsx` 为 `121 passed`。旧 plan 仍需完成构建、类型、公开参考和消费方验收后再删除。
- **E2B memory 的“已修”状态仍需补一刀**：实际文件是 `memory/e2b-list-returns-paginator-not-array.md`，`memory/INDEX.md` 已标“已修”；provision reconcile 已完整翻页，但 `src/sandbox/keep.ts` 目前只调用一次 `nextItems()`，尚未按 memory 所写遍历全部页。API 形状已修，跨页查找仍可能漏实例。

## TODO 树

依赖写在节点上；标为“可并行”的兄弟节点可由不同 worker 同时做。发生同文件交叉时以路径所有权拆开，最终集成节点统一收口。

- [x] **0. 先修正契约与差异台账**（所有相关实现的串行前置）
  - [x] 0.1 `docs/source-map.md` 单列 `current()` 仍合成 Snapshot 的差异；在修复前撤掉“已保留真实 Snapshot”的错误现状断言
  - [x] 0.2 `docs/source-map.md` 单列 Invocation 正名尚未实现，列出旧公开类型、回调、事件名与多余 `agent` 参数；不要只把它埋在 agent/ci 聚合行 bullet 中
  - [x] 0.3 补全 `Scope.filter()` 的目标语义：按真实 Snapshot 身份 `(experimentId, startedAt)` 删除来源；`attempts` 仅保留 `attempt.snapshot` 属于幸存来源的当前水位条目；逐 experiment 以原 `knownEvalIds` 和幸存 attempt 重新计算 `missingEvalIds`；warning 按其真实 Snapshot 来源同步修剪
  - [x] 0.3a 补全 Reports 对 Scope 的解释：指标样本来自 `Scope.attempts`；配置/diagnostics/dir 来自真实 `Scope.snapshots`；每个 experiment 的“水位基准 Snapshot”是贡献来源中 startedAt 最新者；当前有效题集从 `Scope.coverage.knownEvalIds`（经范围收窄）读取，不再借合成 Snapshot 重写 `experiment.selectedEvalIds`
  - [x] 0.4 穷尽声明 `InvocationShape`、`InvocationSummary`、`InvocationCompletion` 和 `ReporterEvent` 联合；裁决并删除跨配置不诚实的 summary 顶层单值 `agent/model`，身份从逐条 `EvalResult` 读取
  - [x] 0.5 为内建 Artifacts 定稿 Experiment 收尾协议：推荐增加结构化 `experiment:complete` reporter 事件，携带 `experimentId/completedAt/carriedResults/diagnostics`；它发生在该 Experiment teardown 之后、`invocation:summary` 之前，供对应 Snapshot 原子封口，不把 diagnostics 偷塞进跨 Experiment 的 `InvocationSummary`
  - [x] 0.6 定稿“实验域 diagnostic → `DiagnosticRecord`”单点：产生处必须显式给出 experimentId、code、phase、level、message、可选 command/data/dedupeKey；feedback 的 `DiagnosticNotice` 是它的展示投影，不是反向解析来源
  - [x] 0.7 同步 `docs/engineering/testing/unit/{results,experiments-runner,reports}.md` 的覆盖类别；只补本计划新增的可区分场景，不列实现细节
  - [x] 0.8 运行 `pnpm test test/docs-consistency.test.ts`，确认入口、链接与差异台账一致

- [x] **A. Invocation 公共模型正名**（依赖 0.4；可与 B、F、G 并行）
  - [x] A.1 在 `src/runner/types.ts` 一次性改为 `InvocationSummary`、`InvocationShape`、`InvocationCompletion`；`totalRuns` 改为契约名 `totalAttempts`；不留 deprecated alias（beta 契约）
  - [x] A.2 `Reporter` 改为 `onInvocationStart(evals, shape)` / `onEvalComplete(result)` / `onInvocationComplete(summary)`；删除 start 回调的 `agent` 参数
  - [x] A.3 `ReporterEvent` 全量改为 `invocation:*`，同步 runner 发送、`scopeReporter` 过滤、内建 Artifacts/Json/JUnit/Braintrust 和用户导出
  - [x] A.4 Braintrust 不再从 Invocation start 接收一个虚假的单 agent；逐 attempt 身份写入行 metadata，需要 Invocation 级 agent 集时从结果去重派生
  - [x] A.5 同步 `src/{index,types}.ts`、`src/results/index.ts` 与全部测试/fixture；全仓 grep 旧名应只命中明确讨论第三方旧术语的历史文字
  - [x] A.6 从源码 TSDoc 生成公开参考：`pnpm docs:reference`；确认 `docs-site/zh/reference/cli.mdx` 的 `--json` 已显示 `InvocationSummary`
  - [x] A.7 类型与运行时测试同时证明：用户 reporter 按两个参数实现 `onInvocationStart` 能编译，tsx 直接执行时 start/complete 回调各真实触发一次，不能只靠类型重命名

- [x] **B. `current()` 保留真实 Snapshot**（依赖 0.3；可与 A、F、G 并行）
  - [x] B.1 重构 `makeScope`，让 `attempts` 成为显式入参；`latest()` 可从真实快照平铺，`current()` 必须传逐题选择后的独立 attempt 集
  - [x] B.2 `selectCurrentResults` 删除第 209 行附近的合成 Snapshot；收集所有真正贡献至少一道题的来源 Snapshot，按稳定顺序去重，原对象身份、diagnostics、dir、配置与反向引用全部保留
  - [x] B.3 `fresh` 只过滤显式 attempt 集，不克隆/改写 Snapshot 的 `evals`；被排除的题进入 coverage
  - [x] B.4 `Scope.filter()` 按 0.3 重算 attempts / coverage / warnings；同一 experiment 有两个贡献 Snapshot 时，删除其中一个必须只删除该来源的水位，不得整实验全留或全删
  - [x] B.5 重构 Reports 的 `resolveInput/collectItems`：Scope 分支消费显式 attempts，裸 Snapshot[] 分支才 flatten；`Item` 同时保留真实 source Snapshot 与 experiment 水位基准，`historicalOf` 比较两者，snapshot 维度/refs/locator 始终读真实来源
  - [x] B.6 `scoringComposition`、指标、实体列表、摘要、site data 等全部计算入口审计为走 B.5；experiment 行的有效题集读 coverage，配置/labels 读水位基准 Snapshot，不得再次从真实 snapshots 全量 flatten 或任取旧配置
  - [x] B.7 Results 单测覆盖：两个来源快照分别贡献不同 eval、旧快照含 diagnostics、同 eval 的旧历史不得混入、对象引用与 `attempt.snapshot` 原样、fresh/filter 后 coverage 精确
  - [x] B.8 Reports 单测覆盖：同一旧来源 Snapshot 还含已被更新 eval 的历史 attempt，所有指标只算 `Scope.attempts`；历史标记以水位基准比较；snapshot 维度仍显示真实 startedAt；experiment 有效题集不因最新快照局部选择而缩小

- [x] **C. Snapshot diagnostics 持久化链**（子树按各自依赖启动，不把整条链错误串行化）
  - [x] C.1 **Results 写读面**（依赖 0.6；可与 A、B 并行）
    - [x] `SnapshotMeta` / `Snapshot` 增 `diagnostics?: DiagnosticRecord[]`，补齐代码里缺失的 `DiagnosticRecord.command?: string`
    - [x] 把封口 API 放到 `SnapshotWriter.finish({ diagnostics?, completedAt?, name? })`；每个 Snapshot 只能封一次，空 diagnostics 省略字段，开始写的 meta 不提前带封口字段
    - [x] reader 从 `snapshot.json` 原样读回 diagnostics；`copySnapshots` 与其它格式感知复制保留该字段
    - [x] 单测证明开始态、封口态、重复封口、两个 Experiment 不同完成时点/诊断、result.json 不出现快照字段
  - [x] C.2 **Runner 归属与交付**（依赖 A、C.1、0.5、0.6）
    - [x] 建 per-experiment 的有界 diagnostic accumulator；只接无法归属单 Attempt 的实验事实
    - [x] Experiment hook `ctx.diagnostic`、teardown failed/timeout/late、`budget-unenforceable` 等在产生处直接构造结构化记录；interrupted、provider 全局并发提示、reporter error 等 Invocation 事实不得误落任一 Snapshot
    - [x] 相同 dedupeKey 只在同一 Snapshot 内折叠 count；不同 Experiment、不同 Snapshot 不跨来源合并
    - [x] 通过 0.5 的事件把 carriedResults 与 diagnostics 交给 Artifacts，并在对应 Experiment 收尾后调用该 Snapshot 的 `finish`
  - [x] C.3 **Reports 数据与两面组件**（依赖 B、C.1；可与 C.2 并行）
    - [x] 新增 `snapshotDiagnosticsData`，输入 `Scope | readonly Snapshot[]`，仅投影非空真实 Snapshot；experiment 字典序、同实验 startedAt 新到旧、不跨来源合并、开放 code 原样保留
    - [x] 新增 `SnapshotDiagnostics` web/text 面、data validate、locale 与样式；web 原生 `<details>` 默认折叠且 summary 恒可见，text 全展开，空集零输出
    - [x] 单快照单记录不造空壳层级；汇总计数按 count，最高严重度有文字区别；command 逐记录呈现
    - [x] 从 `niceeval/report`、`niceeval/report/react` 与相关类型入口公开导出，`pnpm run build:report` 后验证真实 dist 导出
  - [x] C.4 **内建报告接线**（依赖 C.3）
    - [x] `standard.tsx` 的 report / attempts / traces 三张 scope-input page 均按 `ScopeWarnings` → `SnapshotDiagnostics` 相邻放置；attempt-input page 不放
    - [x] 单元层只断言 data 与展开树；折叠、HTML/text 结构、相邻顺序和真实命令归 `e2e/report` 验收

- [x] **D. agent/ci 的 Eval 级结论行**（依赖 A；可与 B、C、F、G 并行）
  - [x] D.1 从同一份结构化终局数据派生逐 `(experiment, eval)` 聚合，不让 agent/ci renderer 各算第二份口径
  - [x] D.2 early exit 输出 `attempts/planned/unstarted/reason=early_exit`；跑满输出 attempts 与 rate；顺序稳定且不与 Invocation handoff 重复冒充同一层
  - [x] D.3 补 runner feedback 单测：纯跑满、首过即停、并发时已有在飞 attempt、fail-fast 与 budget 未派发不得误标 early_exit
  - [x] D.4 `pnpm e2e --repo cli` 验收 agent 与 ci 两种 profile 的真实 stdout 单一事件流

- [x] **E. 组深度读取面重新设计并实现**（设计部分无依赖，可与 A–D/F/G 并行；实现依赖 E.1 裁决）
  - [x] E.1 在 `docs/roadmap/report-chart-composition/` 或独立 ADR 比较两种形状：扩展通用 Matrix 为“一 attempt 多成员 + cell context”，或新增专用组深度组件；**推荐专用组件**，因为组是 assertion/score-entry 子实体，不是 Attempt 身份维度
  - [x] E.2 用穷尽类型定稿：输入、行键（eval + `groupPath` 的无损结构）、计分制组内挣分、通过制组质量分、失败/中止定位、稀疏/null、refs 与 text/web 呈现；不要只写一句“MetricMatrix 支持 group”
  - [x] E.3 裁决后重写 `docs/feature/experiments/score-points.md` 与 Reports 组件目录；若采用专用组件，撤掉把该行为强塞给 `MetricMatrix` 的字面契约并更新 source-map
  - [x] E.4 先在 `docs/engineering/testing/unit/reports.md` 登记覆盖类别，再实现 data、validate、两面组件、公开导出和内建/配方接线
  - [x] E.5 fixture 至少含嵌套 groupPath、同一 attempt 多组、跨 eval 同名字面组、缺组、计分制中止与通过制 gate；精确断言组内数值和 refs，渲染归 E2E

- [x] **F. 让 orphan 单测与 `ps` 能力无关**（无依赖，可与 A–E/G 并行）
  - [x] F.1 给候选分类路径注入窄判据（如 `classifyRunIdentity` 或 `readPidStartedAt`），生产默认仍用真实系统探测
  - [x] F.2 `listOrphanCandidates` fixture 显式控制 alive / orphan / unverified；不依赖当前进程真实启动时刻，不按环境 skip
  - [x] F.3 保留现有 `classifyRunIdentity` 注入式语义测试，删除与实际断言相矛盾的“禁 ps”注释
  - [x] F.4 在可执行 `ps` 与禁止 `ps` 的环境各跑同一测试文件，测试数与结果完全相同且全绿；再跑 `pnpm test`

- [x] **G. 已落地事项清账**（无依赖，可与 A–F 并行）
  - [x] G.1 对 `plan/report-primary-reading-by-scoring-type.md` 的 A–E 节逐项对源码、测试和公开导出；补跑 `pnpm run build:report`、`pnpm run typecheck`、相关 report 单测与计划中声明的真实消费方验收
  - [x] G.2 全部通过后删除 `plan/report-primary-reading-by-scoring-type.md`；若有未通过项，把剩余项迁入单独 plan，不能因“基本落地”直接丢台账
  - [x] G.3 把 `src/sandbox/keep.ts` 的 detached inspect 改为 `while (paginator.hasNext)` 完整翻页查找，补“目标只在第二页”测试；provision reconcile 与 detached inspect 都满足 memory 后，保留 `memory/INDEX.md` 的“已修”状态

- [ ] **H. 全树集成收口**（依赖 A–G 的实现节点；单一 worker 串行）
  - [ ] H.1 全仓 grep：旧 Invocation 名、合成 Snapshot 注释/构造、缺失 SnapshotDiagnostics 导出、错误 source-map 断言均归零；有意历史引用逐条人工确认
  - [ ] H.2 按影响面运行 `pnpm run build:report` → `pnpm run view:build` → `pnpm run typecheck` → `pnpm test`
  - [ ] H.3 运行 `pnpm docs:reference`、`pnpm docs:validate`、`pnpm docs:links`，确认生成区块无漂移
  - [ ] H.4 Results / Reports 改动跑 `pnpm e2e --repo report`；runner / 公开 Reporter 破坏性变更跑 `pnpm e2e --repo cli`，再按测试矩阵修复全部受影响官方适配器仓库
  - [ ] H.5 最后更新 `docs/source-map.md`：删除已闭合差异，只保留 E 若尚停在设计裁决；不得把尚未验收的节点提前写成已实现

## 验收

全部相关节点满足才算收口：

1. **真实来源不变量**：`current().snapshots` 的每个成员都是 `openResults()` 读出的真实 Snapshot；`current().attempts` 只含逐题选中的水位；任一 attempt 的 `snapshot/ref/locator` 未被重写；filter/fresh 后 coverage 精确。
2. **诊断落盘不变量**：实验域 diagnostic 在所属 Snapshot 封口时一次写入；来源、phase、code、level、message、command、data、count 读回不变；不跨 Snapshot 合并，不进入 Attempt 或 Invocation summary。
3. **报告边界不变量**：`snapshotDiagnosticsData` 不携带 Snapshot、Eval、AttemptHandle 或 IO 方法；Scope 与裸 Snapshot[] 得到同值投影；三张内建 scope-input page 相邻放置两类范围反馈。
4. **Invocation 公共面**：公开导出、回调、事件和生成参考只出现 Invocation 术语；`onInvocationStart` 恰为两个参数；tsx 运行时回调真实触发；跨多 agent Invocation 不再声称一个顶层 agent/model。
5. **机器反馈**：agent/ci 对跑满与 early exit 都有逐 Eval 结论行，数字与最终 `(experiment, eval)` 折叠一致。
6. **组深度口径**：类型能表达一个 attempt 的多个 groupPath，组内指标拿到明确上下文；嵌套路径无损、数值与 refs 可由单测精确证明。未完成这条设计前，不得宣称 MetricMatrix gap 已修。
7. **测试确定性**：`orphans.test.ts` 不因 `ps` 权限变化改变结果；全量 unit 无“已知恒红”豁免。
8. **守护全绿**：build、typecheck、unit、docs 生成/链接、report E2E、CLI E2E 及公开 API 影响到的适配器矩阵全部通过；工作树只包含本计划授权的路径。
