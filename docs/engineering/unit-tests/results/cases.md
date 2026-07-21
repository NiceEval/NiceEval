# Results 的测试用例

本页是 Results 契约的场景登记表。fixture 形状见 [测试架构](README.md)。

## 落盘格式

契约来源：[Architecture](../../../feature/results/architecture.md)、[Library](../../../feature/results/library.md)。

| 契约 | 场景 |
|---|---|
| `snapshot.json` 快照开始时一次写入（format/schemaVersion/producer/experimentId/agent/startedAt）；`finish()` 唯一重写是补 `completedAt`，无收尾聚合 | 正例：writeAttempt 后内容不变；正例：finish 前后 diff 只多 completedAt；反例：不含 passed/failed 计数与总成本 |
| `result.json` attempt 完成时一次写成，只含 attempt 级事实，不重复快照级字段 | 正例：round-trip 读回；反例：`not.toHaveProperty("experimentId")` |
| 快照目录独占创建：撞名换 4 位随机后缀重试，并发/同毫秒各得各的目录 | 边界：预建撞名目录后仍成功且路径不同 |
| artifact 未提供则不生成文件；reader 对缺文件返回 `null`、盘上空数组如实返回 `[]` | 正例：events=undefined 时无文件且 events() 为 null；边界：盘上 `[]` 读回 `[]` |
| 截断唯一落点在 writeAttempt：events/trace 内字符串超 256 KiB 按 UTF-8 字符边界截断，追加 marker 并写结构化 `truncated`；sources/diff/o11y 原样落盘 | 正例：300 KiB 落盘后 ≤256 KiB 带 truncated；边界：截断点落在多字节字符中间；反例：diff 中同长字符串不截断；边界：256 KiB 整不截断 |
| 源码两层落盘：attempt 级 `sources.json` 只存 `{path, sha256}[]`，内容在快照级 `sources/<sha256>.json` 按内容哈希去重 | 正例：两 attempt 同源码只存一份；反例：sources.json 不含 content；边界：不同路径同内容共享 blob |
| `locator` 由 `{experimentId, 快照 startedAt, evalId, attempt}` 确定性派生（`@` + 1 位 scheme + 7 位 base36） | 正例：同元组恒同串；反例：attempt 序号不同则不同；边界：格式正则 |
| 携带条目（resume 合入）：startedAt 保留原值、artifactBase 指向原快照、locator 原样复制从不重算、has* 真值原样携带 | 正例：locator 与原条目逐字节相同；反例：用新快照 startedAt 重算会得到不同串 |
| 目录名只是身份的清洗投影，权威身份在 snapshot.json 字段；两个 experimentId 清洗后撞名时 reader 仍按字段归为两个实验 | 正例：`dev-e2b/codex-e2b` → `dev-e2b_codex-e2b`；边界：撞名目录按字段分组 |
| 快照目录名由 startedAt ISO 串清洗加 4 位随机后缀构成；reader 不依赖目录名解析 startedAt | 正例：目录名正则；正例：改名后仍按字段读 |
| 同一轮的[轮标签](../../../feature/scoring/library/display.md#turntsend的展示)在 `diff.json` 的 `window`、时间树 turn 节点的 `label`、send 标注的 `label` 三处逐字相等；消费方按字符串等值对照，不解析标签内部结构 | 正例：单会话一轮 fixture 三处均为 `turn1`；边界：`t.newSession()` 轮三处均为 `session2/turn1` |

示例——round-trip 断言字段归属：

```ts
it("writer 把快照元数据与 attempt 事实写到各自唯一位置", async () => {
  const fx = await resultsWriterFixture({
    experimentId: "compare/codex",
    agent: "codex",
    startedAt: "2026-07-13T00:00:00.000Z",
  })

  try {
    await fx.writer.writeAttempt({
      id: "weather/brooklyn",
      attempt: 0,
      verdict: "passed",
      durationMs: 1200,
      assertions: [],
    })
    await fx.writer.finish()

    const snapshot = await fx.readJson("snapshot.json")
    const result = await fx.readJson("weather/brooklyn/a0/result.json")

    expect(snapshot).toMatchObject({
      format: "niceeval.results",
      experimentId: "compare/codex",
      agent: "codex",
    })
    expect(result).toMatchObject({
      id: "weather/brooklyn",
      attempt: 0,
      verdict: "passed",
    })
    expect(result).not.toHaveProperty("experimentId")
  } finally {
    await fx.dispose()
  }
})
```

## 读取分类（版本兼容与坏数据）

契约来源：[Architecture](../../../feature/results/architecture.md)、[Library](../../../feature/results/library.md)。每个 case 只写形成分类所需的最小文件。

| 契约 | 场景 |
|---|---|
| `format` 匹配但 `schemaVersion` 不同（不论新旧）：整份进 `results.skipped`，reason `incompatible-version`，携带 dir、schemaVersion 与完整 producer | 正例：版本 +1 与 -1 都 skipped 且 producer.version 保留；反例：其 attempt 不出现在任何 experiment |
| 元数据坏 JSON → skipped reason `malformed`，不冒充空结果 | 正例：截断 JSON → malformed 条目 |
| 有 attempt 落盘、无 `snapshot.json` → skipped reason `incomplete`，已写事实仍可诊断 | 正例：只有 result.json → incomplete |
| 无 `format` 且不满足 legacy 启发式的 JSON 当作无关文件静默忽略 | 正例：混入第三方 JSON 后结果与无该文件时相同 |
| 历史 run 级 `summary.json`（legacy 启发式命中）识别为 incompatible 并给版本提示，不迁移也不说"不是 niceeval 结果" | 正例：旧版 summary.json 分类为 incompatible 且保留 producer.version |
| 同 schemaVersion 快照正常读取，接受并忽略未知可选字段与未知 artifact 文件 | 正例：加未知字段/未知 .json 后读取结果不变 |
| 未收尾快照（有 snapshot.json、缺 completedAt）不是 skipped：正常进 experiments，attempt 照常读出 | 正例：attempts 可遍历、completedAt 为 undefined；边界：与 incomplete 行为对照 |

## Scope（快照粒度 latest 与警告）

契约来源：[Library](../../../feature/results/library.md)。`latest()` 的口径是**快照粒度**：每个 experiment 取最新一次快照，不跨快照拼 eval、不平铺 attempts；覆盖缺口用结构化警告表达，不用静默拼接掩盖。

| 契约 | 场景 |
|---|---|
| `latest()` 每 experiment 取最新快照，返回 `Scope{snapshots, warnings}` | 正例：两实验各取各的最新；区分力反例（见下） |
| `partial-coverage`：选中快照的 evalIds 覆盖 < 该实验已知 eval 并集时写入警告，带 experimentId/covered/total | 正例：历史 50 题、最新只跑 1 题 → covered:1, total:50；反例：覆盖齐全无警告；边界：命令行前缀缩小范围后分母随之缩小 |
| `exp.evalIds` 是并集语义：本地历史各快照 ∪ 各快照 `knownEvalIds` | 正例：历史 5 + knownEvalIds 3 → 并集；边界：只有 knownEvalIds 时用它当分母 |
| `scope.filter(predicate)` 返回新 Scope 且只做删减：不在幸存快照中的实验警告丢弃，非实验作用域警告保留；原 Scope 不变 | 正例：滤掉带警告实验后警告消失；边界：无 experimentId 的警告不丢 |
| `stale-snapshot`：选中快照早于 Scope 中最新落盘即触发（无阈值）；`unfinished-snapshot`：选中快照缺 completedAt 即触发 | 正例：两实验时间差触发 stale；反例：单实验不触发；正例：中断快照被选中时 unfinished 且 attempts 仍可读 |
| `latest({experiments})` 按 experiment id 前缀过滤（string 或 string[]），与 CLI 位置参数同一套前缀匹配 | 正例：`"compare/"` 只选中该前缀；边界：多前缀取并集；反例：无匹配时 snapshots 为空 |
| 警告必带下一步：每 kind 的 `message` 以下一步收尾；可单命令推进的 kind（partial-coverage / stale-snapshot / unfinished-snapshot）带 `command` = `niceeval exp <experimentId>`（真实 id 已替换）；missing-startedAt 是定位动作，不带 `command` | 正例：partial-coverage 的 `command` 含真实 experimentId 且 message 内嵌同一命令；正例：stale-snapshot 的 message 同时含对齐命令与「没改东西可忽略」条件；反例：missing-startedAt 无 `command` 且 message 仍给出定位动作 |

区分力场景——局部补跑构造"最新快照只有 a，旧快照有 a+b"，三种候选算法必须产生不同结果（快照粒度只含新 a + 警告；逐 eval 拼接会混入旧 b；平铺 attempts 会混入旧 a），否则测试即使通过也没有区分力：

```ts
it("latest 取实验最新快照，覆盖缺口以 partial-coverage 警告表达", () => {
  const results = resultsFixture({
    experiments: [{
      id: "exp/a",
      snapshots: [
        snapshot("2026-07-13", [evalResult("a", "passed", [attempt0])]),
        snapshot("2026-07-12", [
          evalResult("a", "failed", [oldAttempt0, oldAttempt1]),
          evalResult("b", "passed", [attempt0]),
        ]),
      ],
    }],
  })

  const scope = results.latest()
  const [selected] = scope.snapshots

  expect(selected.startedAt).toBe("2026-07-13")
  expect(selected.evals.map((item) => `${item.id}:${item.attempts.length}`))
    .toEqual(["a:1"])
  expect(scope.warnings).toEqual([
    expect.objectContaining({
      kind: "partial-coverage",
      experimentId: "exp/a",
      covered: 1,
      total: 2,
    }),
  ])
})
```

## 现刻水位与宿主等价（results.current() / show · view）

契约来源：[Results Library · 官方现刻水位](../../../feature/results/library.md#官方现刻水位resultscurrent)、[Reports Architecture · Scope 是计算入口](../../../feature/reports/architecture.md#scope-是计算入口)。`current()`/`selectCurrentResults` 与 `latest()` 是不同口径：按 experiment × eval 取"包含该 eval 的最新快照"里的全部 attempt，跨历史拼出当前判定水位；`show` / `view` 默认首页与自定义报告的 `ctx.scope` 共用同一个入口，不各自选一遍。

| 契约 | 场景 |
|---|---|
| 每个 experiment × eval 取"包含该 eval 的最新快照"里的全部 attempt；同一 eval 的多个 attempt 整批来自同一快照，不跨快照拼装 | 正例：单 experiment 单快照单 attempt；正例：局部补跑时 q1 取最新快照、q2 从旧快照补齐补全；正例：同 eval 多 attempt 整批取自最新快照，旧快照的同 eval attempt 不掺入 |
| 跨快照拼接有可比性前提：以该 experiment 最新快照的可比性配置（agent、model、reasoningEffort、flags、budget、timeoutMs、sandbox）为基准，配置不一致的旧快照不贡献 attempt，其覆盖缺口按 partial-coverage 告警；编排与选题字段（runs、earlyExit、maxConcurrency、selectedEvalIds、evalFilterFingerprint、description）不参与比较 | 正例：改 model 后局部补跑，未补跑的题不从旧 model 快照拼入且触发 partial-coverage；正例：只改 runs / maxConcurrency 的旧快照照常参与拼接；边界：flags 深相等比较，键序不同不算改配置 |
| 历史已知 eval（跨快照并集 ∪ knownEvalIds）在现刻水位中缺失时产出 `partial-coverage` 警告，覆盖齐全不产出；eval id 前缀过滤与 `--exp` 分段前缀过滤都相应收窄分母 | 正例：knownEvalIds 声明但从未落盘 → partial-coverage；反例：覆盖齐全无警告；边界：位置前缀过滤后分母同步收窄，范围外缺口不触发 |
| 多 experiment 更新时间不同时较早者触发 `stale-snapshot`；未完成快照（缺 completedAt）触发 `unfinished-snapshot`；`--results` 只看该结果根，不跨根 | 正例：两 experiment 时间差触发 stale；正例：中断快照被选中时触发 unfinished 且 attempts 仍可读；正例：两个独立结果根互不可见 |
| 合成快照的 `experiment.selectedEvalIds` 重建为最终 picks 的有序 id 列表，不是照抄某一来源快照的局部选择；来源快照里不在其自身 `selectedEvalIds` 内的 attempt 不进入合成结果 | 正例：q1 取自新快照、q2 从旧快照补齐后，合成快照的 `selectedEvalIds` 恰为 `["q1", "q2"]`；反例：某来源快照声明 `selectedEvalIds: ["q1"]` 却夹带 q2 的历史 attempt，合成结果不含该 q2 |
| 来源快照缺 `experiment.selectedEvalIds`（第三方 harness 未实现该字段）时按其实际 `snapshot.evals` 退化，不把该来源整份排除 | 正例：无该字段的第三方快照仍贡献它实际写出的 eval；边界：与本方快照混合时各自按自己的口径退化/收窄 |
| resume 携带的复印件不重复计票：同一 eval 若"当前活着"的快照恰好是复印件所在快照，只计一次，证据 ref 仍可读 | 正例：复印件整批只出现一次且 `events()` 非 null |
| `show` 的 text 面与 `view` 的 web 面对同一结果根、同一 scope 传给 `selectCurrentResults` 同形参数，反映同一批事实（experiment / eval 集合、通过率、`partial-coverage` 警告在/不在）；`--report` 注入的 Scope 与不传 `--report` 时的默认报告一致 | 正例：局部补跑下两面都见补齐的 eval、通过率一致；正例：位置前缀收窄后两面一致排除范围外 eval；正例：`--report` 回显的 eval id 集合与裸默认报告相同；正例：真实 partial-coverage 时两面警告都在场且消息里的分子/分母一致 |

## 身份与去重

契约来源：[Library](../../../feature/results/library.md)、[Architecture](../../../feature/results/architecture.md)。

| 契约 | 场景 |
|---|---|
| 跨快照重复（resume 携带）时 reader 忠实保留重复；去重是消费方义务，身份键 `(experimentId, evalId, attempt, startedAt)` 在读取面可达 | 正例：携带后新旧快照各见一条；正例：四字段可从 handle 取全 |
| 去重规则：同身份键保留**最新快照**里的那份 | 正例：幸存条目的 snapshot 是较新者；反例：fixture 让"取旧"与"取新"的 ref 可区分 |
| `startedAt` 缺失时宁可不去重也不误删：重复如实保留并产出 `missing-startedAt` 警告 | 正例：缺锚重复全保留 + 警告；反例：有锚时正常去重无警告 |
| reader 拼合"缺才补"：快照级字段注入 result，条目自带 startedAt/locator 优先、缺失才回退/兜底 | 正例：携带条目 startedAt 不被快照值覆盖；正例：第三方无 locator 条目有兜底；反例：自带 locator 不被重算覆盖 |
| `attempt.ref = {snapshot, attempt}` 指条目所在落盘（携带入的新快照）；snapshot 恒为两段路径 | 正例：携带条目 ref 指新快照；边界：evalId 含 `/` 时 attempt 段多层 |

## artifact 懒加载

契约来源：[Library](../../../feature/results/library.md)、[Architecture](../../../feature/results/architecture.md)。

| 契约 | 场景 |
|---|---|
| 六个懒加载方法（events/trace/o11y/agentSetup/diff/sources）缺文件一律返回 `null` 不抛错 | 正例：六方法逐一验证；反例：不抛 ENOENT |
| 携带条目按候选顺序回退：先本目录，再 `artifactBase` 指向的原快照；原快照被清理后如实 `null` | 正例：只在原快照时经 artifactBase 读到；边界：删原快照后 null；边界：两处都有取本目录 |
| `sources()` 把引用 + 去重仓库拼回 `{path, content}[]`；携带条目去**原快照**的 sources/ 解引用 | 正例：拼回 content 完整；反例：当前快照 sources/ 为空时仍读到内容 |
| 截断是磁盘事实：reader 原样读出（含 marker 与 truncated 字段），不重新截断也不还原 | 正例：读回逐字节一致 |
| 同进程内按 handle 记忆化：同一 AttemptHandle 重复调用只读一次磁盘 | 正例：首读后删文件、二次调用返回同值 |

保留缺失与空的差别：

```ts
it.each([
  { file: undefined, expected: null },
  { file: [], expected: [] },
  {
    file: [{ type: "message", role: "assistant", text: "ok" }],
    expected: "events",
  },
])("events artifact 保留缺失与空数组的差别", async ({ file, expected }) => {
  const attempt = await attemptOnDiskFixture({ events: file })
  const events = await attempt.events()

  if (expected === "events") expect(events).toHaveLength(1)
  else expect(events).toEqual(expected)
})
```

## 标注 Eval 源码（AnnotatedEvalSource）

契约来源：[concepts · 标注 Eval 源码](../../../concepts.md)、[Show · --source](../../../feature/reports/show.md)。

| 契约 | 场景 |
|---|---|
| 断言按 `SourceLoc` 标回源码行；无 loc / 异文件 / 越界行进 unmapped 桶，never silently dropped | 正例：同一行多条断言；反例：三类不可映射断言都出现在 unmapped；边界：`summary` 的 totalAssertions/mappedAssertions/unmappedAssertions 与 passed/failed、gate/soft 双维计数按映射结果精确统计，空断言数组时全零但行数仍正确 |
| send 标注按同一映射规则落到 `t.send(...)` 调用行，一行多轮逐轮保留；定位不到行的轮直接丢（轮次全量面是 `--execution`，不设兜底桶） | 正例：同一行两轮都保留；反例：异文件与越界行的轮不落任何行 |
| `deriveSendAnnotations`：第 i 条用户消息配 `eval.run` 下第 i 个 turn 节点（与 `--execution` 分轮同一规则），头行事实取 turn 节点的 label / failed / durationMs；用户消息无 loc 的轮不产出且不使后续轮错位 | 正例：三轮中第二轮无 loc 时第三轮仍配对正确；边界：时间树缺 turn 节点回退 `turn<i>` 标签、无墙钟；边界：空事件流产出空数组 |
| `content` 按行切分不产生幻影尾空行（结尾单个换行符不多出一行，结尾双换行保留一行真实空行），空文件视为一行空字符串；`sourceSha256` 用 SHA-256 归一化后的源码计算，CRLF 与 LF 内容一致时哈希与行文本都相同 | 正例：单/双尾换行两态各自产出正确行数；边界：空文件为单个空行；正例：CRLF 与 LF 的 `sourceSha256` 相同且逐行文本一致 |

## Attempt 证据装配（AttemptEvidence）

契约来源：[概念 · Attempt 证据](../../../concepts.md)（"AttemptEvidence" 词条：`locator`、身份、`EvalResult`、`AnnotatedEvalSource`、`ExecutionTree`、diff、artifact 路径与能力位一次装配，`show` / `view` / 静态导出 / 报告列表共用同一份）。

| 契约 | 场景 |
|---|---|
| 四个能力位（source/execution/timing/diff）各自只在"数据真的存在且非空"时为真，不是"artifact 文件存在"；四位全具备、全缺失、部分具备（有 events 无 phases、有 diff 文件但两数组皆空）都要能分辨 | 正例：四位全真；正例：四位全假不崩溃；边界：无 phases 时 execution 真、timing 假；边界：diff 文件存在但两数组皆空时 `capabilities.diff` 为假 |
| execution 节点与 trace span 按 call id 精确关联，不按名字/文本猜；identity 与源 attempt 的 experimentId/snapshotStartedAt/evalId/attempt 完全一致，`locator` 恒有值且与源 attempt 的 `locator` 原样一致（不重算） | 正例：action 节点关联上对应 span；正例：identity 四字段与 `attempt.locator` 逐一核对相等 |
| `artifactPaths.dir` 是该 attempt 落盘目录的绝对路径 | 正例：等于 `join(snapshot.dir, ref.attempt)` |

## copySnapshots 与 resolveLocator

契约来源：[Library](../../../feature/results/library.md)。

| 契约 | 场景 |
|---|---|
| copySnapshots 目标目录非空即报错，不覆盖不合并；预检失败不留半成品 | 正例：非空报错且内容未动；正例：预检失败后目标不存在 |
| 发布前整文件预检：任一文件超 `PUBLISH_FILE_MAX_BYTES`（50 MiB）整体失败，错误列出路径、字节数与处理动作 | 正例：>50 MiB diff 整体失败；边界：恰好 50 MiB；反例：从 artifacts 排除后成功 |
| 产物自包含可直接 `openResults`：携带 artifact 经 artifactBase 解引用后复制、sources 按内容重新去重落盘、无回退指针；给每个 snapshot.json 补记 `knownEvalIds` | 正例：复制后 artifact 可读且无 artifactBase；正例：目标目录 latest() 不误报 partial-coverage；反例：artifact 字节与源一致 |
| `artifacts` 合法值全集六种；缺省不带 diff | 正例：缺省时无 diff.json 有 o11y.json；正例：显式带 diff 时复制且仍受预检 |
| `resolveLocator` 只查内存索引不碰磁盘；语法不合法抛 `MalformedLocatorError`，合法但不存在抛 `LocatorNotFoundError`，都不返回 null | 正例：落盘 locator 解析回同一 handle；反例：两类错误可分辨 |

## 不这样测

- 不让 builder 隐藏 startedAt、attempt、experimentId 等身份字段。
- 不只断言 writer 写出了某个文件；还要断言事实位于正确层级且 reader 能读回。
- 不用一份巨大黄金目录覆盖版本、选择、去重和 artifact。
- 不把 `null`、空数组、零和缺文件合并成同一种 fixture 默认值。
- 不在测试里复刻 locator 派生或去重算法再对答案；期望值写死在 case 里。
