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

## 新 Record 的正式起点

`{ format: "niceeval.record", schemaVersion: 1 }` 是 Record root / Core 首次正式公开的格式身份。它没有已发布
predecessor：旧 `niceeval.results`、未合并 `polish-assert` 的 16–18，以及尚未正式发布的 main 或工作树格式，
都不是 Record root migration source。当前 root / Core 仍是 schemaVersion `1`，没有相邻 migration。

## Observability family 1 → 2

2026-08-19，`niceeval.observability` 独立从 schemaVersion `1` 升到 `2`，Record root / Core 版本保持 `1`。
不兼容点只在 Attempt `agent.send` timing label：v1 只接受不含斜杠的 SafeIdentifier；v2 还接受 canonical
`turnN` 与 `sessionK/turnN`，从而让多 session turn identity 不再被降格成 `agent.turn`。

- 新 reader 遇到 v1 envelope 返回 `migration-required`，不把 dot label 猜成 turn，也不自动改写。
- 旧 reader 遇到 v2 envelope 返回 unsupported / migration-required 读态，不会把 slash label 当成旧格式。
- `niceeval migrate --yes` 只在 Git 能提供干净 restore point 时把已封口 Run 的 Observability envelope 从 1 改为 2；payload、blob 与未知 family bytes 保持不变。
- migration 前后都验证完整 sealed Core；结束前再验证全部认识的 family closure 与跨 family join。无 `complete` 的 draft 不进入 inventory，仍由 `niceeval clean` 处理。
- 中断会留下 `migration.in-progress` sentinel；用户从计划回执所列 Git commit 恢复 portable root 后重试。迁移幂等，已完成的 Record 返回 `already-current`。

Record 用稳定 `format` 和数值 `schemaVersion` 表达各兼容边界的身份，不使用带斜杠的版本名称。只有 root / Core
变化才递增 root schemaVersion；fixed family 变化由该 family 自己的固定相邻 migration 链承接。

新的 Record 将 root / Core 与每个 fixed family 的兼容性分开：已知 root、Core 或 family 的旧 schemaVersion
只在存在固定相邻步骤时显式 migration；独立 future family 则保持 opaque，只有依赖它的 Analysis 请求得到
`unsupported`，不影响其它闭合结果。这样兼容成本留在实际变化的格式边界，而不再扩散成 1→18 式全局重写。

当前目标契约见 [`docs/feature/record/architecture.md`](../docs/feature/record/architecture.md)；durable/local/cache 与 immutable publication 的翻案原因见 [`record-durable-local-boundary.md`](record-durable-local-boundary.md)。
