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
    await fx.writer.complete("2026-07-13T00:00:02.000Z")

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

## Selection（快照粒度 latest 与警告）

契约来源：[Library](../../../feature/results/library.md)。`latest()` 的口径是**快照粒度**：每个 experiment 取最新一次快照，不跨快照拼 eval、不平铺 attempts；覆盖缺口用结构化警告表达，不用静默拼接掩盖。

| 契约 | 场景 |
|---|---|
| `latest()` 每 experiment 取最新快照，返回 `Selection{snapshots, warnings}` | 正例：两实验各取各的最新；区分力反例（见下） |
| `partial-coverage`：选中快照的 evalIds 覆盖 < 该实验已知 eval 并集时写入警告，带 experimentId/covered/total | 正例：历史 50 题、最新只跑 1 题 → covered:1, total:50；反例：覆盖齐全无警告；边界：命令行前缀缩小范围后分母随之缩小 |
| `exp.evalIds` 是并集语义：本地历史各快照 ∪ 各快照 `knownEvalIds` | 正例：历史 5 + knownEvalIds 3 → 并集；边界：只有 knownEvalIds 时用它当分母 |
| `selection.filter(predicate)` 返回新 Selection 且只做删减：不在幸存快照中的实验警告丢弃，非实验作用域警告保留；原 Selection 不变 | 正例：滤掉带警告实验后警告消失；边界：无 experimentId 的警告不丢 |
| `stale-snapshot`：选中快照早于 Selection 中最新落盘即触发（无阈值）；`unfinished-snapshot`：选中快照缺 completedAt 即触发 | 正例：两实验时间差触发 stale；反例：单实验不触发；正例：中断快照被选中时 unfinished 且 attempts 仍可读 |
| `latest({experiments})` 按 experiment id 前缀过滤（string 或 string[]），与 CLI 位置参数同一套前缀匹配 | 正例：`"compare/"` 只选中该前缀；边界：多前缀取并集；反例：无匹配时 snapshots 为空 |

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

  const selection = results.latest()
  const [selected] = selection.snapshots

  expect(selected.startedAt).toBe("2026-07-13")
  expect(selected.evals.map((item) => `${item.id}:${item.attempts.length}`))
    .toEqual(["a:1"])
  expect(selection.warnings).toEqual([
    expect.objectContaining({
      kind: "partial-coverage",
      experimentId: "exp/a",
      covered: 1,
      total: 2,
    }),
  ])
})
```

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
