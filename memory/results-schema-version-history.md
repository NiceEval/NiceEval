# Results Format schemaVersion 1–18 历史台账

核对日期：2026-08-11

这是旧 `niceeval.results` 全局 `schemaVersion` 的唯一历史存档。目标 Record 契约不靠本页决定怎样读取；本页只保存“当时为什么整包升版、哪些数字从未成为正式 main 版本、16–18 为什么只存在于未合并分支”的证据，避免每次设计 Record 都重新考古。

## 状态口径

- **main**：版本常量与对应格式变化一起进入 main 可达 commit；这是当时真正可由 main writer 产出的版本。
- **未出现**：源码没有把该数字作为独立 literal 版本落入 commit；相关变化被下一次升版一起发布。
- **未合并分支**：commit 存在，但不在 main ancestry，也没有成为 main 的公开格式。
- **未提交工作树**：只在本地改动中短暂出现，没有 commit identity，不能当作格式历史。

commit、日期与主题由 `git show -s --format='%h %cs %s' <commit>` 复核；分支边界由 `git merge-base --is-ancestor <commit> main` 与 `git branch --contains <commit>` 复核。

## 逐版台账

| schemaVersion | 状态与证据 | 主要变化 | 为什么当时需要全局升版 |
|---:|---|---|---|
| 1 | main；`6b197dda`，2026-07-02 | 给 `summary.json` 增加格式信封与版本识别，拒绝不匹配结果并提示对应 npm 版本。 | 整份 Results 第一次获得唯一全局格式身份。 |
| 2 | main；`03b2d30b`，2026-07-10 | `ExperimentRunInfo.flags` 改名为 `params`。 | reader 读取同一核心对象时字段名已不同。 |
| 3 | main；`a5c32829`，2026-07-10 | `params` 又改回 `flags`，确认其 A/B feature flag 语义。 | 再次改变同一全局对象字段，v2 writer 与 v3 reader 不能互读。 |
| 4 | main；`d0b67181`，2026-07-11 | 落盘单位从 run 改为 snapshot；实验目录外置，`snapshot.json`、attempt `result.json` 取代 run `summary.json`。 | owner、目录与提交单位同时变化，不能局部兼容。 |
| 5 | main；`b5b8ca92`，2026-07-12 | 新增 Attempt locator；源码从逐 Attempt 内联改为 Attempt 引用加 snapshot 级 `sources/<sha256>.json` 去重。 | identity 与源码文件布局都变化。 |
| 6 | main；`fef6adcd`，2026-07-14 | `error` 从自由字符串变成结构化 `AttemptError`，并新增有界 diagnostics。 | Attempt 核心错误形状发生破坏性变化。 |
| 7 | **未出现** | `operation`→`phase`、统一 lifecycle vocabulary，以及同期 phase/step 收尾变化，最终与下一批 assertion/outcome 变化一起进入 v8。 | 仓库没有 literal v7；旧台账把过渡中的变化误记成独立版本。 |
| 8 | main；`5e7549eb`，2026-07-15 | 打包 assertion outcome、`groupPath`/`loc`、lifecycle phases、coverage、逐 send diff、publish 消毒与 Experiment resolved projection 等变化。 | 多个核心和 artifact 形状同时改变，只能整包拒绝旧 Results。 |
| 9 | main；`be3ebdb3`，2026-07-23 | 四个 `has*` 布尔收敛为统一 artifacts 列表；`o11y.json` 删除可派生 usage/cost/duration 摘要。 | artifact registry 与派生/权威事实边界都由全局版本表达。 |
| 10 | **未出现** | 多文件 source 的 callers/role/entry 约束在 9→11 的工作中形成，随 v11 一起提交。 | 仓库没有 literal v10；不能把设计步骤误当成 writer 曾产出的版本。 |
| 11 | main；`d79be370`，2026-07-28 | Snapshot→Run；引入 Record/Sample identity、Run/Member/Attempt 布局与 source roles/callers；常量改名为 `RECORD_SCHEMA_VERSION`。 | 核心 owner、identity、目录和读取模型整体替换。 |
| 12 | main；`3dd6419e`，2026-07-30 | `WindowChange.binary` 并入 `elided`，统一 binary 与 oversized-text 的省略形状。 | 旧 reader 会把新条目解释成错误的文本变化。 |
| 13 | main；`63877700`，2026-07-30 | 封闭 `TimingNode` 改为开放 `TimingActivity`；错误/诊断从 `phase` 改为 `TimingOrigin`；Run 增加 timings 与 sandbox build provenance。 | timing owner、引用和错误来源的判别形状同时变化。 |
| 14 | main；`c9e7d21f`，2026-08-02 | `coverage` 改名为必填 `evidenceCoverage`，并扩成完整六通道覆盖。 | 字段改名且必填，双向都无法安全缺省。 |
| 15 | main；`88d07f99`，2026-08-03 | `commands.json` 的命令调用事实新增必填 `checked`，区分 checked 与 unchecked 调用。 | 又一次业务 artifact 字段变化迫使整个 Results 失效；这是 main 最后的旧格式版本。 |
| 16 | 未合并 `polish-assert`；`841924d8`，2026-08-09 | 第一版 Fact/use assertion lifecycle 与对应 Record 形状。 | assertion 存储模型整体替换；该 commit 不在 main。 |
| 17 | 未合并 `polish-assert`；`165b2202`，2026-08-10 | 删除 legacy Assertion/Judge sidecar，固定 `evaluationAlgorithm: "fact-use/v2"`、`factResults` 与 `factUses`。 | v16 与新原子判定图不兼容；该 commit 不在 main。 |
| 18 | 未合并 `polish-assert`；`a31bc478`，2026-08-10 | 统一 assertion consumption，算法标识改为 `fact-use/v3`。 | verdict method/consumer 语义再变；该 commit 不在 main。 |

另有一段不能与上表 16–18 混同的工作树历史：2026-08-06 曾因可选 `renamedFrom` 与删除运行期选题投影，把 main checkout 的常量临时推进到 16/17；复核发现现有 v15 reader 仍可读取后即撤销。它没有 commit，也没有成为正式版本。几天后 `polish-assert` 分支重新使用 16–18，是另一条未合并历史。

## 根因：一个整数承担了过多变化

旧 Results 把 root、Run、Attempt、assertion、commands、diff、timing、source 与 coverage 放在一个兼容域里。任一业务 API 或 artifact 字段变化都只能递增全局整数；reader 又只接受与自己完全相同的版本，因此“一处领域变化”会让所有页面、carry 和诊断同时失去整份历史。7/10 的跳号和 main/branch 16–18 的重叠，也说明整数本身没有表达变化属于哪个领域。

## 新 Record 怎样切断连锁

目标设计把兼容性拆成四个独立机制：

1. `niceeval.record/v1` 只冻结 root、Run、Member、Attempt、identity、origin、descriptor 与 whole-Run 原子发布；只有这些边界变化才需要完整 `record/v2`。发布 `record/v2` 不授权删除 v1 reader，也不把 v2 对象混写进 v1 root。
2. 业务事实用稳定 `ChannelName` 表示语义，用完整 `ChannelSchemaId` 表示精确 bytes shape。Assertions、usage、commands 或 source payload 改变只新增自己的 `/vN` decoder；未知 schema 只让该 fact `unsupported`，不会让整个 Record 无法打开。
3. 每个正式 `FactRequirement<A>` identity 不可变且自带版本。normalized 输出类型升级时发布新 identity；旧 identity 与输出类型永久保留，调用方按 identity 得到对应代的 normalized 值。
4. carry 不靠“reader 能展示旧值”推断安全。execution-required eligibility 带 mandatory `reuseContract` equality token；新增或改变 gate 必须切换 domain，旧 policy/旧 schema 形成 gap，不会误 carry。

built-in registry 在 core v1 生命周期内永久保留已发布 decoder 与 normalized FactRequirement。这样 API 可以重构、normalized model 可以演进、旧 channel 仍可被具名读取；兼容成本留在发生变化的领域，而不再扩散成 1→18 式全局重写。

当前目标契约见 [`docs/feature/record/architecture.md`](../docs/feature/record/architecture.md)；durable/local/cache 与 immutable publication 的翻案原因见 [`record-durable-local-boundary.md`](record-durable-local-boundary.md)。
