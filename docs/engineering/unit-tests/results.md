# Results 的单元测试

契约来源：[Results](../../feature/results/README.md)、[Architecture](../../feature/results/architecture.md) 和 [Library](../../feature/results/library.md)。Results 测试分为落盘格式、读取分类、身份与去重、Selection 四组；不要用一个巨大目录 snapshot 同时承担全部责任。

## 两类 fixture

### 内存结果图

用于选择、去重和聚合前身份测试。Builder 必须要求写出会影响身份与选择的字段：

```ts
interface AttemptSpec {
  readonly evalId: string
  readonly attempt: number
  readonly startedAt: string
  readonly verdict: "passed" | "failed" | "errored" | "skipped"
}

function attempt(spec: AttemptSpec): AttemptHandle {
  return attemptFixture({
    experimentId: "exp/a",
    assertions: [],
    durationMs: 1,
    ...spec,
  })
}
```

`startedAt` 不应由全局自增器偷偷生成，因为它是去重身份的一部分。测试读者必须能从 case 看出两条记录应该相同还是不同。

### 临时落盘树

用于 writer/reader、版本识别、crash 残留和 artifact 懒加载。每例创建独立目录：

```ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

async function resultsDirFixture() {
  const root = await mkdtemp(join(tmpdir(), "niceeval-results-"))
  return {
    root,
    async writeJson(path: string, value: unknown) {
      const target = join(root, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, JSON.stringify(value), "utf8")
    },
    async dispose() {
      await rm(root, { recursive: true, force: true })
    },
  }
}
```

## 示例：round-trip 断言字段归属

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

这里断言字段不存在是有效的：它证明运行时落盘格式的唯一归属，TypeScript 无法保证 JSON 没有冗余字段。

## 示例：选择 fixture 必须区分竞争算法

局部补跑场景构造“最新快照只有 a，旧快照有 a+b”。正确的现刻水位是新版 a 加旧版 b；只取最新快照会漏 b，平铺 attempts 又会混入旧 a：

```ts
it("现刻水位逐 eval 取包含它的最新快照", () => {
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

  const selection = selectCurrentResults(results)
  const [selected] = selection.snapshots

  expect(selected.evals.map((item) => `${item.id}:${item.attempts.length}`))
    .toEqual(["a:1", "b:1"])
})
```

Fixture 中三种候选算法必须产生不同结果，否则测试即使通过也没有区分力。

## 版本与坏数据矩阵

目录 fixture 至少覆盖：

- 相同 `format` 与 `schemaVersion`：正常读取。
- niceeval format、不同 schema：识别为 incompatible，并保留 producer version 供提示。
- 坏 JSON：malformed，不冒充空结果。
- 有已完成 attempt、缺少收尾元数据：incomplete，已写事实仍可诊断。
- 无 niceeval 标记的无关 JSON：忽略。
- 新增未知可选字段：同版本读取器按契约接受。

每个 case 只写形成分类所需的最小文件，不复制一份完整 `.niceeval` 树。

## Artifact fixture

懒加载测试把 artifact 分成缺失、空内容和有效内容：

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

## 不这样测

- 不让 builder 隐藏 startedAt、attempt、experimentId 等身份字段。
- 不只断言 writer 写出了某个文件；还要断言事实位于正确层级且 reader 能读回。
- 不用一份巨大黄金目录覆盖版本、选择、去重和 artifact。
- 不把 `null`、空数组、零和缺文件合并成同一种 fixture 默认值。
