# exp 写的 run.json 缺 configHash + selectedEvalIds 过滤,现刻水位塌成单题(已修)

## 现象

下游(MemoryBench)收窄重跑一题或 accept 单条后,`show` / `view` 的每个实验只剩 1 条结果:
最新快照物理含全部 36 条 `result.json`(携带合入),但 view 首页每实验计票是 `1 通过` 或
`1 失败`。计划面(`--dry`)明明打印几十条 `carried`。下游台账里「36 条全 accept 后快照只组进
6」「全沿用 run 跑完只剩 1」是同一根。

## 根因

三层叠加,盘上证据在 MemoryBench `.niceeval/compare_codex-gpt-5.6-luna/`(2026-08-04):

1. **exp 写入面从不写 run 级 `configHash`**。`src/record/writer.ts` 的 `writeAttemptForImpl`
   懒建快照时,`RunDeclaration` 只带 experimentId/agent/model/startedAt/experiment,没有
   configHash;只有 `accept`(`src/runner/accept.ts` 直调 `writer.run()`)显式传。盘上全部
   exp 产快照 `configHash` 缺失、全部 accept 产快照有——系统性,不是偶发。
2. **`currentSample` 的跨 Run 缝合因此从未在 exp 产物上生效**。`src/sample/index.ts` 的
   `baseline = exp.latestRun.configHash` 为 undefined 时旧快照全部跳过(「缺 configHash 只与
   自己可比」本是防第三方 harness 的分支,exp 自己的产物全落了进去)。平时没暴露,因为携带
   合入让最新快照物理完整,缝合形同虚设也看不出来。
3. **读取面按 `selectedEvalIds` 过滤来源快照的贡献**(sample/index.ts 「一个来源快照只贡献
   它自己选中的 eval」),而携带合入**不受**本次选择收窄(「让最新 Run 天然完整」,
   `experiment:complete` 的 carriedResults 全量补写)。写读两侧对「快照贡献范围」理解相反:
   收窄跑一题时 `selectedEvalIds=[那一题]`,其余 35 条物理在场的携带条目被静默拒收,又因
   第 2 条无法从旧快照补齐 → 全实验塌成 1 条。

## 修法(已落地)

- **A(主根因)**:exp 写入面把规划期已算好的 config hash(`run.ts` 的 `plannedConfigHashes`)
  经 `InvocationShape.configHashes` → `Artifacts` reporter → `WriterOptions.configHashes` →
  `writer.ts` 的 `buildSnapshot` 写进 `run.json`(`src/runner/run.ts`、
  `src/runner/reporters/artifacts.ts`、`src/record/writer.ts`、`src/runner/types.ts`)。
  `run.ts` 按 experimentId 汇总时校验同一 experiment 内各 eval 算出的 configHash 一致,
  不一致直接抛错,不硬写。存量快照无法重写,`src/record/open.ts` 的 `readSnapshotDir` 同时做
  回退推导——Run 级缺失时,若该快照全部 attempt 的 `result.configHash` 一致,取之为 Run 的
  configHash,让存量记录不重跑即痊愈。
- **B**:裁决 `selectedEvalIds` 的语义为「这份快照声明覆盖的题集」——写入面把携带条目的 eval id
  并进 `selectedEvalIds`。落点在 `src/record/writer.ts` 的 `RunWriter.finish({ carriedEvalIds })`
  (新增选项,`mergeCarriedEvalIds` 合入 `experiment.selectedEvalIds`),由
  `src/runner/reporters/artifacts.ts` 的 `experiment:complete` 与 `onInvocationComplete` 两处
  收集携带条目的 eval id 并传入。读取面 `currentSample` 的过滤规则未改。
- docs 同步重写:`docs/feature/record/library.md`(configHash 一节)、
  `docs/feature/sample/library.md`(缝合的前提)、`docs/feature/record/architecture.md`
  (selectedEvalIds 小节)。
- 测试:`src/record/results.test.ts`(exp 路径写出 configHash、回退推导一致/不一致两格)、
  `src/sample/sample.test.ts`(收窄跑一题 + 携带合入的真实盘面,经真实
  `createWriter`/`writeAttemptFor`/`finish` 走一遍,不手写 run.json)。三条测试均在临时禁用对应
  修法后复现过原始故障(塌成单题 / configHash 缺失),确认非重言式。

教训:`docs/feature/sample/library.md` 声明的「configHash 缝合」在 exp 产物上从来没成立过,
掩盖它的正是另一个机制(携带合入)的物理副本——两条冗余通道同时在场时,任何一条的失效都
不可见,直到只剩一条时一起塌。验收跨快照行为必须构造「最新快照残缺 + 旧快照补齐」的真实
盘面,不能只在携带合入让快照完整的常态下测。
