# NiceEval Results schemaVersion 1–16 研究

本页整理 NiceEval 旧 Results Format 从 v1 到 v16 的格式演进，回答三个问题：每次为什么升版，哪些变化其实不需要升版，以及为什么一个全局整数最终无法支撑 Record → Report。

这是 NiceEval 内部历史研究，不是外部产品页面，也不是当前 Record 契约。
完整 commit 边界以 [`memory/results-schema-version-history.md`](../../../memory/results-schema-version-history.md) 为准；本页把分散在多份 memory 的设计动因、真实故障和后续约束合在一起。

> 复核日期：2026-08-14
>
> 范围：v1–v16。v17–v18 也只存在于未合并的 `polish-assert` 分支，详见 memory 历史存档。

## 怎样判断一个版本是否存在

- **main**：版本常量与对应 writer 变化一起进入 main 可达 commit，当时的 main 可以写出该格式。
- **未出现**：源码没有在 commit 中写入该 literal；设计过程里的编号不等于公开格式。
- **未合并分支**：存在 commit，但不在 main ancestry，没有成为 main writer 格式。
- **未提交工作树**：没有 commit identity，不计入版本历史。

旧 main 实际写到 v15。v7 与 v10 从未成为独立格式；v16 只存在于未合并分支。

## v1–v16 逐版原因

| 版本 | 状态与 commit | 主要变化 | 为什么当时升全局版本 |
|---:|---|---|---|
| 1 | main；`6b197dda`，2026-07-02 | `summary.json` 加入格式信封、版本识别和不匹配提示 | 整份 Results 第一次取得唯一格式身份 |
| 2 | main；`03b2d30b`，2026-07-10 | `ExperimentRunInfo.flags` 改名为 `params` | 核心对象字段名改变，旧 reader 无法按原字段读取 |
| 3 | main；`a5c32829`，2026-07-10 | `params` 又改回 `flags`，确认 A/B feature flag 语义 | 同一核心字段再次改名，v2 与 v3 无法互读 |
| 4 | main；`d0b67181`，2026-07-11 | 落盘单位从 Run 改为 Snapshot；实验目录外置，`snapshot.json` 与 Attempt `result.json` 取代 Run `summary.json` | owner、目录、权威判定落点和提交单位一起改变 |
| 5 | main；`b5b8ca92`，2026-07-12 | 加入 Attempt locator；source 改为 Attempt 引用与 Snapshot 级 `sources/<sha256>.json` | identity、引用和 source 文件布局一起改变 |
| 6 | main；`fef6adcd`，2026-07-14 | 自由字符串 `error` 改为结构化 `AttemptError`，并加入有界 diagnostics | Attempt 核心错误形状发生破坏性变化 |
| 7 | 未出现 | `operation`→`phase` 与 lifecycle 词表统一在开发中形成，最后随 v8 写入 | 没有 literal v7；过渡变化被下一批改动吸收 |
| 8 | main；`5e7549eb`，2026-07-15 | assertion outcome、`groupPath`/`loc`、lifecycle、coverage、逐 send diff、发布消毒与 Experiment projection 等一起写入 | 多个核心对象和 artifact 同批改变，只能整包拒绝旧 Results |
| 9 | main；`be3ebdb3`，2026-07-23 | 四个 `has*` 布尔收敛为 artifacts 列表；`o11y.json` 删除可派生的 usage、cost 与 duration 摘要 | artifact registry 与权威事实边界也由全局版本表达 |
| 10 | 未出现 | 多文件 source 的 callers、role 与 entry 约束在 9→11 期间形成，随 v11 写入 | 没有 literal v10；设计步骤没有对应 writer 格式 |
| 11 | main；`d79be370`，2026-07-28 | Snapshot→Run；加入 Record/Sample identity、Run/Member/Attempt 布局、source roles/callers；常量改名为 `RECORD_SCHEMA_VERSION` | 核心 owner、identity、目录和读取模型整体替换 |
| 12 | main；`3dd6419e`，2026-07-30 | `WindowChange.binary` 并入 `elided`，统一 binary 与 oversized-text | 旧 reader 会把新条目误读为文本变化 |
| 13 | main；`63877700`，2026-07-30 | `TimingNode` 改为开放的 `TimingActivity`；错误与诊断使用 `TimingOrigin`；Run 加入 timings 与 sandbox build provenance | timing owner、引用与 error origin 的判别形状一起改变 |
| 14 | main；`c9e7d21f`，2026-08-02 | `coverage` 改名为必填 `evidenceCoverage`，扩为六通道 | 字段改名且变为必填，旧 reader 与新 reader 都不能安全省略 |
| 15 | main；`88d07f99`，2026-08-03 | `commands.json` 的命令调用事实加入必填 `checked` | 单个业务 artifact 的字段变化再次让整份 Results 失效；这是 main 的最后一个旧格式版本 |
| 16 | 未合并 `polish-assert`；`841924d8`，2026-08-09 | 第一版 Fact/use assertion lifecycle 与对应 Record 形状 | assertion 存储模型整体替换，但没有成为 main 的公开格式 |

2026-08-06 另有一段未提交工作树曾把常量短暂推进到 16/17，原因是可选 `renamedFrom` 与删除运行期选题 projection。
复核发现 v15 reader 仍能读取后撤销；这次撤销说明“改动很大”或“新功能已经加入”都不能单独证明需要升版。

## 升版背后的四类动因

### Core、identity 与目录真的改变

v1、v4、v5 与 v11 触及格式身份、owner、持久实体、locator、引用或目录布局。
其中 v4 来自真实的数据丢失：同一命令并行启动的进程会在同一毫秒创建相同 Run 目录，多个 writer 最后互相抹掉 `summary.json`。
把判定移到 Attempt `result.json`、让 Snapshot 独占目录并原子封口，不是为了新页面方便，而是为了消除 last-writer-wins 与进程中断造成的不可恢复缺口。

v5 让 locator 成为持久 identity，并把 source 改成显式引用的两层布局。
v11 又同时引入稳定 `runId`、可逆目录编码和更长 locator，修正目录名不等于身份、有损清洗可能碰撞、旧 locator 位宽不足等问题。
这类变化确实需要新的 Core 格式；它们也说明 Core 应保持极小，否则每个业务变化都会搭上 Core 升版。

### 字段改名和判别形状改变

v2→v3 是最直接的反复：同一天把 `flags` 改成 `params`，又因领域语义判断翻案改回 `flags`。
旧策略不接受字段别名或 normalize loader，所以每次改名都让上一版不可读。

v6、v12、v13 与 v14 也属于 reader 会误读或读不到的变化：字符串错误变结构化错误、binary 改为 `elided` 判别、timing 模型与 error origin 改形、必填 coverage 改名并扩展。
这些变化有真实语义理由，但它们属于不同业务事实；把它们都绑到 root 版本，才造成全历史连带失效。

### 业务 artifact 改变

v9 与 v15 最能暴露兼容域过大的问题。
v9 为消除多处 `has*` 清单同步税，把 artifact presence 收敛为 registry；v15 只为 commands 调用事实加入必填 `checked`。
两次都只改变一个业务域，却要求所有不含该 artifact 的 Run 也接受新的全局版本。

v8 更极端：assertion、lifecycle、coverage、diff、发布消毒与 projection 多项变化被打成一个版本。
当版本只表示“这批代码是什么时候合并的”，而不表示变化属于哪个 owner、family 或事实类型时，reader 无法局部判断 supported、unsupported 或 invalid。

### 开发过程也污染版本序列

v7 与 v10 是从未成为 writer literal 的过渡编号，v16 则只存在于未合并分支。
同一个数字后来还曾被另一段未提交工作树短暂使用。
因此整数序列不能单独证明格式曾公开、能够读取或存在迁移路径；必须同时核对 commit ancestry、writer literal 与对应 shape。

## 哪些变化没有升版

旧 Results 已经有几次正确地没有升版，这些反例帮助收紧判据：

| 变化 | 为什么不升版 |
|---|---|
| events、trace 与 commands 的大字符串加入可选 `truncated` 描述 | 新字段可省略；旧 reader 可以忽略，既有字段语义不变 |
| Turn 标签从 `s1/t1` 改成 `turn1`、`session2/turn1` | 标签是同源不透明字符串，消费方只做等值比较，不 parse 内部语法 |
| `LifecyclePhase` 增加 `experiment.setup` / `experiment.teardown` | 消费方按标签呈现并保留 fallback，不以封闭枚举拒绝未知值 |
| `carriedAccepting`、`error.timeout`、`manifests.json` 等纯增量 | 可选字段或相邻文件没有改变旧字段含义，旧 reader 仍能正确读取原对象 |

判据不是“文件有没有变化”，而是旧 reader 是否会缺字段、落错判别分支或把同一 bytes 解释成不同语义。
新增页面、查询、聚合、renderer、可选字段或未知值 fallback 都不应自动变成格式升级。

## 全局升版造成的实际成本

### 旧运行整批不可读

旧 reader 只接受与自身完全相同的 `schemaVersion`，没有多版本 normalize loader，也没有迁移函数。
版本一变，`openRecord` 会把旧数据归入 unreadable，carry planner 取得不到 prior results；真实 benchmark 的历史运行会全部变成需要重跑的格子。
同版写、同版读的仓库 fixture 很难暴露这项成本。

### CLI 的恢复提示并不可靠

`view` 曾能按 producer version 建议使用旧 npm 版本，`show` 却只打印大量 `incompatible-version`，没有可执行的下一步。
即使补齐提示，本地 link 的开发树长期写入 package 占位版本，`npx niceeval@<version>` 也无法找到产生该数据的 commit。
这说明“拒绝旧数据，再让用户安装旧 CLI”不能成为稳定的产品恢复路径。

### 格式知识扩散后会一起漂移

v4 删除 `summary.json` 后，E2E 的 `verify.mjs` 仍手写扫描旧文件名，导致每次 CI 都报“找不到 summary.json”。
根因不是新格式错误，而是生产 reader 之外又存在一套平行布局知识。
同样的风险会出现在 Report、迁移器或下游脚本直接读取 `.niceeval/` 时，因此用户入口必须保持在 `niceeval show`、`niceeval view` 与静态导出。

## 为什么“严格一点再升版”仍然不够

旧格式后来已经形成较严格的判据：只有删除或改名字段、改变类型或判别方式、重新定义同一字段语义时才升版；新增可选字段和相邻文件不升版。
这个判据能避免无谓升版，却不能解决一个业务 family 的破坏性变化仍让整份 Record 失效。

根因是兼容域，而不只是工程纪律：

1. root、Run、Attempt、assertion、commands、diff、timing、source 与 coverage 共用一个整数。
2. reader 用 exact equality 处理整个 root，没有 family-local decoder。
3. carry、CLI、诊断和 Report 依赖同一次全局读取，局部不兼容无法降级成单项 `unsupported`。
4. migration 若仍以整个 root 为单位，会把局部 converter 的风险和成本扩散到全部 bytes。

## 对当前 Record → Report 的约束

当前方向需要把过去的兼容域拆开，而不是从 v16 后继续增加整数：

- Record major 只守住 root、Run、Member、Attempt、owner、identity、引用和完整发布判断。
- Metric、Score、Artifact、assertion、commands、timing、source 等事实由各自 Attachment family 拥有精确 schema 与 decoder。
- 单个 family 的新 shape 只让该事实进入 `migration-required`、`migration-unavailable`、`unsupported` 或 `invalid`，不能让无关 Run 整体消失。
- Analysis、Query、Table、Chart、Page、终端和静态站只消费已读取的事实；呈现变化不修改 durable schema。
- `niceeval migrate` 只执行平台拥有、相邻且无损的转换链；普通 `show` 与 `view` 不静默改盘。
- 用户不进入 `.niceeval/` 判断版本或手工修 JSON。CLI 无法解释时，应把它当作产品读取缺口。

目标契约见 [Record Architecture](../../feature/record/architecture.md)；本方向的门槛摘要见 [方向入口](README.md#怎样防止功能演进牵动-schema)。

## 关联 memory

- [Results schemaVersion 1–18 历史存档](../../../memory/results-schema-version-history.md)：版本、commit 与分支边界的唯一历史依据。
- [升 schemaVersion 会把存量语料整批打成不可携带](../../../memory/schema-bump-invalidates-all-history.md)：exact-version reader 对 carry 与重跑成本的影响。
- [落盘单位改为 Snapshot](../../../memory/results-per-snapshot.md) 与 [并行 Run 抹掉 summary](../../../memory/parallel-runs-same-ms-summary-clobber.md)：v4 的真实数据丢失动因。
- [Attempt locator 与 source 去重](../../../memory/attempt-locator-and-source-dedup.md)：v5 的 identity 与引用布局。
- [flags → params → flags](../../../memory/experiment-flags-naming-reversal.md)：v2–v3 的字段命名翻案。
- [LifecyclePhase 统一](../../../memory/lifecycle-phase-vocabulary-unification.md)：开发中的 v7 变化为何最后并入 v8。
- [Evidence registry](../../../memory/results-evidence-registry-ruling.md)：v9 如何由业务 artifact 清单扩散成全局升版。
- [Record identity 变更集](../../../memory/record-identity-change-set.md)：v11 的 runId、目录编码与 locator 选择。
- [Diff 导出预算](../../../memory/diff-export-budget-counts-transferred-bytes.md)：v12 的 `elided` 判别变化。
- [旧版本提示缺口](../../../memory/show-skipped-version-hint-missing.md)、[开发树 producer 版本占位](../../../memory/linked-dev-tree-producer-version-placeholder.md) 与 [E2E 格式漂移](../../../memory/e2e-verify-results-format-drift.md)：全局不兼容在用户入口与测试边界造成的后果。
- [大值截断](../../../memory/oversized-tool-output-blows-up-artifacts.md)、[Turn 标签](../../../memory/turn-label-plain-words.md) 与 [Experiment lifecycle hooks](../../../memory/experiment-level-lifecycle-hooks.md)：正确不升版的反例。
- [durable、local 与 cache 分离](../../../memory/record-durable-local-boundary.md)：当前稳定 Core 与局部 Attachment 边界的最终裁决。
