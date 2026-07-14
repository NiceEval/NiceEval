# Results 的测试架构

契约来源：[Results](../../../feature/results/README.md)、[Architecture](../../../feature/results/architecture.md) 和 [Library](../../../feature/results/library.md)。Results 测试分为落盘格式、读取分类、身份与去重、Selection、artifact 懒加载、copySnapshots 几组；不用一个巨大目录 snapshot 同时承担全部责任。用例登记在 [cases.md](cases.md)。

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

`startedAt` 不由全局自增器偷偷生成，因为它是去重身份的一部分。测试读者必须能从 case 看出两条记录应该相同还是不同（规则见 [Harness](../harness.md)）。

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

每个 case 只写形成该分类所需的最小文件，不复制一份完整 `.niceeval` 树。

## 观察面

- **落盘面**：writer 写出的 JSON 文件内容与层级归属。断言字段**不存在**同样有效——TypeScript 保证不了 JSON 没有冗余字段。
- **读取面**：`openResults()` 句柄的分类（experiments / skipped）、Selection 与警告、artifact 方法返回值。
- **身份面**：locator、身份四元组、ref 归属。

写读两面在 round-trip 测试里互相对账：writer 写出的 reader 必须能读回，且事实位于契约声明的唯一位置。
