# show 范围 × 切片 × 形态 + Usage 诚实化 + facts 通道:实现 TODO

契约已定稿,**一律以 docs 为准,本 plan 只列落点不复述契约**:

- 三轴模型、缺省切片选择、范围/互斥规则:`docs/feature/reports/show.md`
- 对照矩阵组件与装配:`docs/feature/reports/library/metric-views.md#deltatable`、`docs/feature/reports/show/compare.md`
- 稳定性矩阵组件与装配:`docs/feature/reports/library/metric-views.md#stabilitymatrix`、`docs/feature/reports/show/stats.md`
- `--usage` 组件与装配:`docs/feature/reports/library/attempt-detail.md#usagetable-组装口径单源`、`docs/feature/reports/show/usage.md`
- `--json` 信封与逐视图组件指针:`docs/feature/reports/show/json.md`、`docs/feature/reports/architecture.md#show-的切片是组件选择`
- execution 卡片预算、`--expand` 句柄、范围化与 `--grep`:`docs/feature/reports/show/execution.md`;失败命令合流的 JSON 落点 `AttemptConversationData.failedCommands`:`docs/feature/reports/library/attempt-detail.md#公开组件集`
- 诊断首页 `usage:` / `facts:` 行:`docs/feature/reports/show/attempt.md`
- `Usage` 落盘形状、`facts` 字段(AttemptRecord / SnapshotMeta)与三通道语义:`docs/feature/results/architecture.md#usage`、`#facts运行事实`
- `ctx.fact` 三处上下文声明:`docs/feature/sandbox/library.md`、`docs/feature/experiments/architecture.md`、`docs/feature/adapters/architecture/agent-contract.md`
- 测试覆盖类别:`docs/engineering/testing/unit/reports.md`(show 范围×切片、usage 组装与 facts 投影、execution 预算/句柄/grep、--json 投影)、`docs/engineering/testing/unit/results.md`(Usage 与 facts 落盘)
- 设计背景与实测代价数据:`memory/show-scope-slice-json-ruling.md`

背景:这套设计来自一次真实的 benchmark 归因(MemoryBench 三条件对照)——93 次 show 调用 + 两段解析脚本才拼出一张对照表,证据覆盖已近乎完备,缺的是输出契约与调用正交性。验收标准同源:「search/保存到没到位」「A 条件哪里好」「为什么空库」三类问题各 ≤2 条命令终结。

## TODO

- [x] **A. Results 层**(无依赖,先行)
  - [x] A1. `Usage` 形状对齐 `src/types.ts`:字段按契约命名,`requests` 只在协议真实提供时写入——排查各 adapter 当前是否写死 `requests: 1`,是则删(bug,对应 usage 失真现象)。已落地(fa33b1ec):字段对齐契约、requests 凑数已修
  - [x] A2. `AttemptRecord.facts` / `SnapshotMeta.facts` 落盘与读取面(`src/results/`):writer 收集、快照封口补写 experiment 级、reader 原样读回;key 词法校验与非标量报错
  - [x] A3. `ctx.fact()` 贯通:sandbox hook ctx、experiment hook ctx、`AgentContext`(`src/context/`、`src/runner/`),runner 按当前作用域自动归属
  - [x] A4. 非零 Sandbox 命令证据(`commands.json`,`AttemptRecord.artifacts` 含 `commands`)按
    `plan/failed-command-evidence.md` 落盘并接入 Results reader/copy。已落地(fa33b1ec):真机 FAILED COMMAND 卡、--expand cmd1、--json failedCommands 全通。
- [x] **B. show 选择层:切片接受范围**(依赖 A 的读取面,不依赖 A3)
  - [x] B1. `src/cli.ts` + `src/report/` show 宿主:范围解析统一(locator = 单元素范围),`--source/--execution/--timing/--usage/--diff` 走同一条范围通路,多 attempt 分节输出。两条具体现状:`FLAG_OPTIONS` 里 `exp: { type: "string" }` 没有 `multiple: true`,`node:util` 的 `parseArgs` 对不带 `multiple` 的 `string` flag 重复传入时静默只保留最后一次出现的值(不报错),要改成 `multiple: true` 并把 `flags.experiment` 从单值改成数组消费;`src/show/index.ts:333-348` 的 legacy 单 eval 详情分支(`flags.report === undefined && flags.page === undefined && patterns.length > 0 && matchedEvalIds.length === 1` 时绕过报告槽直接 `evalDetailText` 渲染)要被三轴范围语义取代——落地范围解析后这条特判要么并入范围收窄后的裸报告路径,要么整支删除,不能继续和三轴模型并存
  - [x] B2. 重复 `--exp` 的条件解析与互斥校验(恰好一个 experiment、`@locator` 冲突、`--grep`/`--expand` 的组合校验),错误文案按 `docs/error-feedback.md` 三段式
- [x] **C. 新切片与视图**(组件 `*Data` 计算函数只消费 `ReportInput`,不依赖 CLI 范围解析,可与 B 并行实现;零配置装配——按 `--exp` 顺序派生 `conditions`、按范围收窄 `by`/`evals`——依赖 B 的范围解析产出,单个节点内实现顺序是组件计算先于 show 装配)
  - [x] C1. 对照矩阵(缺省切片 × 重复 `--exp`):`DeltaTable` 组件 + `deltaTableData` 计算函数——聚合口径、`DeltaData` 形状单源在 `docs/feature/reports/library/metric-views.md#deltatable`;show 侧是该组件的零配置装配(`--exp` 出现顺序即 `conditions`、首个为基准,eval id 前缀即 `evals`),落点见 `docs/feature/reports/show.md#缺省切片的选择规则`、`docs/feature/reports/show/compare.md`
  - [x] C1b. `--stats` 稳定性矩阵:`StabilityMatrix` 组件 + `stabilityMatrixData` 计算函数——聚合口径、`StabilityMatrixData` 形状单源在 `docs/feature/reports/library/metric-views.md#stabilitymatrix`;show 侧是该组件的零配置装配(范围内 experiment 即 `by="experiment"` 取值、eval 前缀即 `evals`),落点见 `docs/feature/reports/show/stats.md`
  - [x] C2. `--usage` 表 + attempt 首页 `usage:` 行:`UsageTable` 组件 + `usageTableData` 计算函数——组装口径单源在 `docs/feature/reports/library/attempt-detail.md#usagetable-组装口径单源`(行为计数来自事件流、token/请求来自落盘 `Usage`、`uncachedInputTokens` 派生条件、缺失整段省略);show 侧是范围内逐 attempt 映射的宿主装配(分节、排序、合计行、`—`/`*` 占位),落点见 `docs/feature/reports/show/usage.md`;`facts:` 行不属于 `UsageTable`,按 A2/A3 落点单独接线。对照范围的逐 eval pivot 矩阵已落地(fa33b1ec,`renderUsageCompareSlice`);`--json` 按契约保持扁平行数组(pivot 是 text 渲染面)。
  - [x] C3. execution:卡片 8 KiB 预览预算、`t<N>.c<M>` / `cmd<N>` 句柄派生、失败 Sandbox 命令按 timing node 合流、`--expand`、`--grep` 与命中汇总;失败命令合流的 JSON 落点是 `AttemptConversationData.failedCommands`(`docs/feature/reports/library/attempt-detail.md#公开组件集`)。失败命令合流已随 A4 落地并真机验证。
- [x] **D. `--json` 形态**(依赖 B/C 已把各 view 接到对应组件)
  - [x] D1. envelope + 各视图输出对应组件 resolve 产物:信封字段与跨视图不变量、逐 view 组件指针见 `docs/feature/reports/show/json.md`;每个 view 对应哪个组件见 `docs/feature/reports/architecture.md#show-的切片是组件选择`——text 面与 `data` 字段同值由同一次组件 resolve 构造保证,不是两套手写投影之间需要人工维持的纪律;compare 同时投影各条件 totals 与共同题 pairedDelta(`DeltaData`);timing JSON 恒全树;stdout 单文档、警告走 stderr。落点:`src/show/json.ts`(信封类型 `ShowJson`/`AttemptJson`、`buildShowScope`、`renderShowJson`)、`src/show/index.ts`(逐 view 接线)、`src/show/compose.ts`(`attemptHistoryHandles`,`history` view 的 `AttemptJson` 投影与 text 面的 `attemptHistory` 共用同一条去重/排序口径)。
- [x] **E. 单测**:全节点类别已覆盖(A1 累计诚实/A4 commands 往返/pivot/json 投影各有测试,fa33b1ec)。
- [x] **F. 同步义务**
  - [x] F1. `src/cli.ts` `FLAG_OPTIONS` 新 flag(`--usage`/`--json`/`--grep`/`--expand`/`--stats`)JSDoc → `pnpm docs:reference`;核对 `src/i18n/` 两份 `--help` 速查
  - [x] F2. docs-site:`docs-site/zh/tutorials/viewing-results.mdx` 与 `agent-feedback-loop.mdx` 增补对照矩阵 / `--json` / `--grep` 任务路径(中文先定稿,英文入口核对后同步);`docs:validate` + `docs:links`(Node 22)。已落地并经真实 CLI 输出取样(fa33b1ec + 9607515e)
  - [x] F3. 改 `src/report/**` 后 `pnpm run build:report`(linked 消费项目才能看到,见 memory 台账)。D1 本身未改 `src/report/**`(只消费既有组件 `*Data`),`pnpm run build:report` 已在验证阶段确认可用。
- [x] **G. 验证**
  - [x] G1. `pnpm run typecheck` → `pnpm test` 全绿
  - [x] G2. 真机:在 `/Users/ctrdh/Code/MemoryBench` 用 `pnpm exec niceeval show` 复演三个验收问题,输出与 docs 各分篇示例形态一致。已在自造双条件结果根上完整复演(X1 走查,三问各 ≤声明命令数);MemoryBench 真实结果根的复演待其 v9 重生成后由仓主执行(v8 快照新 reader 拒读,见版本策略)。

## 验收

1. [x] MemoryBench 真机上:「search/保存到没到位」= 1 次 `--execution --grep`;「两条件哪里差」= 1 次多 `--exp` 矩阵;「起步库状态」= 榜单/矩阵 facts 行直读(需 A3 后 harness 侧补 `ctx.fact`)。三问已在等价自造根上达标(--grep 1 条/多 --exp 矩阵+--json 2 条/facts 直读 1 条);MemoryBench 真实根复演待 v9 重生成。
2. [x] 任意视图 `--json | jq` 可直接消费:与 text 面选择同一批实体、共有派生字段同值,并保留机器归因所需的数据超集;无脚本解析人类排版的残留必要。D1 已实现全部 10 个 view 并在 `src/show/json.test.ts` 覆盖 envelope 形状、text/JSON 同值、数据超集、字段名复用、timing 全树、互斥用法错误与 stdout 单文档;真机样例见本次任务的实现报告。
3. [x] `usage` 行不再出现凑数 `requests: 1`;缺字段显示为省略,不显示 0。已核:accumulateUsage 凑数 bug 已修(memory 台账 usage-requests-accumulation-padded-with-1),X1 走查 usage 行缺字段整段省略。
