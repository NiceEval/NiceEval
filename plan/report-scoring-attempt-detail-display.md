# 计分制 attempt 详情与摘要面展示:实现 TODO 树

计分制 attempt 的给分证据在详情页与摘要面的展示契约已定稿(commit `c192b7d`),**一律以 docs 为准,本 plan 只列落点不复述契约**:

- 计分制展示单点(收纳豁免/顶部计数/源码面归属/丢分摘要规则 5、6/单行挣分尾缀):`docs/feature/scoring/library/display.md`
- 组件职责(AttemptSummary 总分位、AttemptSource 给分投影、FixPrompt 三态)与视觉规范:`docs/feature/reports/library/attempt-detail.md`
- show 首页计分制形态与示例:`docs/feature/reports/show/attempt.md`
- 列表字段语义(`failureSummary` 计分制口径、`moreFailures` 丢分计数、明细挣分列):`docs/feature/reports/library/entity-lists.md`
- 测试覆盖类别:`docs/engineering/testing/unit/reports.md`(本次声明:`failureSummary` 计分制口径、`AttemptAssertions` 收纳豁免与挣满计数、「计分制的 attempt 详情数据」)
- 设计背景与被否方案:`memory/score-display-source-face-carries-score-evidence.md`

实现判据(docs 按体裁不写实现推导,记在这里):**`⤓` 与未到达区从既有事实推导,不加落盘字段**——计分制 attempt `verdict === "failed"` 只有前置中止一个来源,中止点恒为记录顺序最后一条 `AssertionResult`(必为 failed gate);其 `loc` 之后的源码行即未到达区。`ScoreEntry` 已带 `loc`(`src/scoring/types.ts`),源码面标注 `t.score` 行不需要动采集侧。

⚠️ **撞车提示**:另一条并行线正在改 `src/report/components/entity-lists/`(commit `93da1b6`/`93d1dc1` 的 `scoring`/`totalScore` 接线,开工时 typecheck 可能未绿)。B、E 两节动同一区域,**开工前先 `git log --oneline -5` 与 `pnpm run typecheck` 确认那条线已收敛**;提交遵守 memory `parallel-agents-shared-git-index`:路径限定 add 后立即提交。

## TODO 树

依赖关系标在节点上;无依赖标注的兄弟节点可交给不同 worker 并行。

- [ ] **A. Attempt 详情 data 层**(无依赖;A1–A4 各自独立可并行,A5 依赖 A1–A4)
  - [ ] A1. `attemptSummaryData`:计分制 attempt 加本轮挣分字段(通过制省略,不摆 null 占位);题型判定读定义期 `scoring`,不从结果推断
  - [ ] A2. `attemptAssertionsData`:得分点(含 passed)豁免收纳——passed 得分点进平铺列表不折进 `passedGroups`;新增得分点挣满计数字段(挣满 = `n × 1.0`,判据见 display.md);`validate*Data` 同步
  - [ ] A3. `attemptSourceData` 给分投影:断言行标注携带挣分;`t.score` 行按 `ScoreEntry.loc` 投影为给分行;中止行标记与未到达行区间(按上面的推导判据);`loc` 不在展示源码内的得分点与给分记录进既有 unmapped 区,给分记录按 `groupPath` 分组(与 A2 同一套分组算法,不写第二份)
  - [ ] A4. `attemptFixPromptData` 三态:计分制丢分或中止 → 非 null(围绕丢分检查点组装),挣满且未中止 → null,通过制 passed 恒 null
  - [ ] A5. 单测:「计分制的 attempt 详情数据」与「`AttemptAssertions` 收纳豁免」两类别,全部 data 级断言(串行,依赖 A1–A4)
- [ ] **B. 摘要派生层**(无依赖,但见撞车提示;B2 依赖 B1)
  - [ ] B1. 主失败选取加计分制规则 5、6(中止前置自然选中;passed 丢分取首条丢分得分点,`+N more lost points` 计数);单行压缩形态加挣分尾缀(`… · +0 pts`,独立成尾不参与截断);`failureSummary`/`moreFailures` 按 entity-lists.md 字段注释取值
  - [ ] B2. 单测:「`failureSummary` 计分制口径」类别——fixture 要能区分「挣满 null」「丢分取首条」「中止取前置」三态(串行,依赖 B1)
- [ ] **C. 详情渲染面**(依赖 A;C1/C2 不同文件可并行)
  - [ ] C1. text 面(show 默认页与 `--source`):头行 verdict 后跟总分(`✗ failed · 1 pt · …`);框上边框右侧挣满计数在行数标注前;得分点逐条含 passed、挣分标注右对齐;给分记录成块;`⤓` 行——对照 `docs/feature/reports/show/attempt.md` 的示例逐字符核形
  - [ ] C2. web 面(view Attempt 详情):挣分 pill 进右缘 meta、给分行不着判定色、中止后源码降灰、unmapped 区收给分记录——DOM 结构事实单测可断,染色/降灰/sticky 观感归 E2E 报告域,不在单元层锁快照
  - [ ] C3. i18n:「得分点挣满」「前置未过, test() 就地结束」「给分记录」等文案走既有 LocalizedText 机制,中英都给(可与 C1/C2 并行)
- [ ] **D. FixPrompt 渲染**(依赖 A4;量小,可并入 C 的 worker)
  - [ ] D1. web 面复制按钮的 prompt 正文围绕丢分检查点/中止点组装;text 面维持零输出
- [ ] **E. 列表渲染面**(依赖 B 与并行线的 entity-lists 收敛)
  - [ ] E1. Result 单元格:通过制 passed `—`;计分制丢分显示 `failureSummary` + `+N more lost points`;中止显示前置摘要——渲染面只做宽度截断,不重算摘要
  - [ ] E2. text 明细表计分制插挣分列(结果列前),对照 entity-lists.md 的 `exam/claude` 示例核形
- [ ] **F. 集成与收尾**(依赖全部,单一 worker 串行)
  - [ ] F1. `pnpm run build:report`(改 `src/report/**` 必做——memory `linked-consumer-stale-dist-report`)→ `pnpm run typecheck` → `pnpm test`
  - [ ] F2. 公开面变了(`*Data` 类型新字段带 TSDoc):`pnpm docs:reference` 再生成参考页区块,漂移守护须绿
  - [ ] F3. 真机验收:在真实 eval repo(如 `/Users/ctrdh/Code/coding-agent-memory-evals`,或 `examples/zh` 的计分制示例)跑一条 `defineScoreEval`(要覆盖 t.score、丢分得分点、前置中止三种痕迹),`pnpm exec niceeval show @<locator>` 与裸 `show` 输出对照 docs 示例;行为与 docs 有出入时**改实现对齐 docs**,docs 有真问题回设计侧,不在 worker 侧就地改契约

## 验收

1. **单测覆盖**:`docs/engineering/testing/unit/reports.md` 本次声明的三条类别各有测试且绿;只为已声明类别写测,不越界。
2. **守护**:`pnpm run typecheck`、`pnpm test`(含 reference 漂移与 docs 一致性)全绿;`build:report` 后 dist 与 src 同步。
3. **真机**:F3 的三种给分痕迹在 show 默认页全部可见——总分在头行、得分点逐条、给分记录成块、`⤓` 后无输出;通过制 eval 的同一页零计分痕迹、不摆空区块。
