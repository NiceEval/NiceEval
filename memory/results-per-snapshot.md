# 设计裁决:落盘单位改为快照,判决落 attempt 级 result.json(schemaVersion 4)

**裁决**(2026-07-11,用户拍板):废除 run 级 `summary.json`;落盘布局改为实验目录在外层(`.niceeval/<experiment>/<timestamp>-<rand>/snapshot.json + <evalId>/aN/result.json`);判决/断言的权威落点是 attempt 级 `result.json`(完成即写、一次写成),`snapshot.json` 只装快照级元数据(开始时写,收尾补 `completedAt`);快照目录独占创建保证唯一性。跨实验聚合(总计数/总成本)不落盘,归消费方。`createRunWriter` 改名 `createResultsWriter`,`RunDir`/`runDirs`/synthetic 合成键/`AttemptRef {run, result}` 随之消亡。

**曾选方案与否决理由**:

- *run 级 summary.json 聚合*(schemaVersion ≤3 现状):读取器拿到后第一步就是按 experiment 切碎(`sliceSnapshots`),领域模型里没有 run 的位置;顶层 agent/model 对多实验 run 是错的(第一个配置的值);`snapshots` 元数据字段本身就是「快照级数据被压进 run 级文件」的补丁;并发进程竞争同一聚合文件酿成真实数据丢失(见 [[parallel-runs-same-ms-summary-clobber]])。
- *只修唯一性(目录加后缀/独占 mkdir),保留 run 级 summary*:治并发覆盖,不治 crash 丢判决与领域模型错位;写→合→拆的损耗仍在。
- *保留 run 目录、里面每实验一份 json*:目录唯一性仍要修,attempt 路径仍要 agent/model/experiment 三段消歧;实验目录在外层则目录树 1:1 映射 Experiment→Snapshot,不同实验的并行进程天然零共享。
- *「判决 journal 不做」*(2026-07-10 旧裁决,原文曾在 docs/results-lib.md「读」一节:恢复成立的前提是 writer 增量落一份判定 journal——那是 Results Format 级的新落盘物,代价大于收益)——**本次翻案**:并行覆盖事故证明「判决只活在收尾聚合里」是真实数据丢失的单点,不是理论洁癖;且落点不是额外 journal,而是把判决放进 attempt 自己的记录文件,与「attempt artifact 完成即写」同构,没有第二套写入路径。`skipped("incomplete")` 从数据黑洞收窄为「快照目录建好、元数据没写完的极小窗口」;进程中断的常态变成可正常读取的未收尾快照(缺 completedAt,`latest()` 出 `unfinished-snapshot` 警告)。

**代价与接受理由**:读侧扫描从每 run 一个文件变成每 attempt 一个文件,本地规模(几百 attempt)无感;旧落盘(≤3)按既有不兼容策略提示 npx 旧版查看,不迁移;旧版本 CLI 看新落盘会误报 incomplete(旧读取器找不到 summary.json),beta 阶段接受。

定稿契约:docs/results-format.md、docs/results-lib.md。

## 2026-07-23 领域模型收口:Invocation 不持久化

**裁决**:一次 `niceeval` CLI 调用正名为 **Invocation**,只是瞬时编排、反馈、退出码和 `InvocationCompletion` 的边界;不分配持久化 id,不落 Run Manifest,不保存多 Experiment 在某次调用中的成员关系。持久化领域实体只保留 Snapshot(一个 Experiment 的一次执行水位)与 Attempt;文档和公开运行时词汇不再用 Run 同时指两种边界。

**核心理由**:

- carry 让后一次 Invocation 携入前一次的终态 Attempt、只补缺口;一份完整水位本来就可由多个进程续成,不存在能忠实对应它的单一调用。
- 「和哪些 Experiment 同批」只影响调度竞争,不是改变数字含义的实验条件;按可比性边界应归瞬时编排。
- 需要审计当次调用时,`Json(path)` reporter 已是 opt-in 的 `InvocationSummary` 落点;在 `.niceeval/` 再写一份 Manifest 会制造两个权威来源。

**配套裁决**:无法归属单个 Attempt、但明确归属单个 Experiment 的诊断(如 `experiment-teardown-failed`、`budget-unenforceable`)落入 `snapshot.json.diagnostics`,由 Snapshot 在补 `completedAt` 的同一次封口写入。它们不再只存活于终端,也不借此引入 Invocation 实体。

**Scope 投影**:`latest()` / `current()` 返回的 Scope 是水位投影,不是合成 Snapshot。`current.snapshots` 保存贡献水位的真实 Snapshot,每条 Attempt 也保留来源 Snapshot 与证据引用。快照级 diagnostics 只随这些 Snapshot 透传;Scope 不聚合 diagnostics、不把它们提升成 warnings、也不复制到 Attempt。

**Reports 呈现裁决**:快照级 diagnostics 由独立 `SnapshotDiagnostics` 组件呈现,不并入闭集 kind 的 `ScopeWarnings`。组件按 experiment → Snapshot 来源分组,保留 startedAt 与时效,通用渲染开放 code 的 level/message/command/count;web 面默认折叠但带严重度的摘要恒可见,text 面不折叠,空集零输出。spec 形态同时支持 Scope 与裸 Snapshot[],React data 形态只收 `{ experimentId, startedAt, diagnostics }[]` 投影。内建三张 scope-input page 与 `ScopeWarnings` 相邻放置两者;能定位到 Eval/Attempt 行的事实不得进入该面板。
