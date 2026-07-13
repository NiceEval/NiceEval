# Sandbox 的单元测试

契约来源：[Sandbox](../../feature/sandbox/README.md)、[Architecture](../../feature/sandbox/architecture.md)、[操作](../../feature/sandbox/library/operations.md) 和 [结果断言](../../feature/sandbox/library/asserting-results.md)。单测证明 provider 共同契约、路径规则和生命周期；真实容器与云 provider 连通性留给 E2E。

## Recording Sandbox fixture

大多数上层测试只需要记录交互，不需要模拟 shell：

```ts
import type { CommandOptions, CommandResult, Sandbox } from "../../sandbox/types.ts"

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly options?: CommandOptions
}

function recordingSandbox(results: readonly CommandResult[]): SandboxFixture {
  const commands: CommandCall[] = []
  let cursor = 0

  return {
    sandbox: {
      workdir: "/workspace",
      sandboxId: "fixture",
      otlpHost: null,
      async runCommand(command, args, options) {
        commands.push({ command, args, options })
        const result = results[cursor]
        cursor += 1
        if (result === undefined) throw new Error("missing command result fixture")
        return result
      },
      // 其余方法由公共 test factory 提供明确的 unsupported 默认实现。
      ...sandboxMethodStubs(),
    },
    commands,
  }
}
```

默认 stub 应抛出 `unexpected sandbox call`，不能静默返回空值。这样生产代码意外增加一次文件读取时，测试会失败而不是用假数据继续通过。

## 示例：命令参数透传而不是执行 shell

```ts
it("runCommand 保留参数边界、cwd、env 和 root 语义", async () => {
  const fx = recordingSandbox([
    { stdout: "ok", stderr: "", exitCode: 0 },
  ])
  const t = sandboxContextFixture(fx.sandbox)

  const result = await t.sandbox.runCommand(
    "pnpm",
    ["test", "--", "path with spaces"],
    { cwd: "packages/app", env: { CI: "1" }, root: false },
  )

  expect(result.exitCode).toBe(0)
  expect(fx.commands).toEqual([
    {
      command: "pnpm",
      args: ["test", "--", "path with spaces"],
      options: { cwd: "packages/app", env: { CI: "1" }, root: false },
    },
  ])
})
```

这个测试能发现错误的 shell 拼接；断言 mock 被调用一次不能。

## 路径 fixture

路径规则适合表驱动，每个 case 指向一条允许或拒绝语义：

```ts
it.each([
  { input: "src/a.ts", expected: "/workspace/src/a.ts" },
  { input: "./src/../src/a.ts", expected: "/workspace/src/a.ts" },
  { input: "../../etc/passwd", error: /workspace|outside/ },
])("解析 sandbox 路径 $input", ({ input, expected, error }) => {
  if (error) {
    expect(() => resolveWorkspacePath("/workspace", input)).toThrow(error)
  } else {
    expect(resolveWorkspacePath("/workspace", input)).toBe(expected)
  }
})
```

临时文件测试用每例独立的 `mkdtemp` 目录，并在 `afterEach` 或 Scope finalizer 删除；不要共享固定 `/tmp/niceeval-test`。

## 生命周期与 LIFO cleanup

资源测试覆盖成功、setup 失败、test 失败和中断。Effect 入口持有 Scope，fixture 只记录事件：

```ts
import { assert, it } from "@effect/vitest"
import { Effect } from "effect"

it.effect("setup 失败仍清理已获取资源，并按 LIFO teardown", () =>
  Effect.gen(function* () {
    const log: string[] = []
    const fx = sandboxLifecycleFixture({
      setup: [
        () => { log.push("setup:a"); return () => log.push("cleanup:a") },
        () => { log.push("setup:b"); throw new Error("boom") },
      ],
      teardown: [
        () => log.push("teardown:x"),
        () => log.push("teardown:y"),
      ],
      stop: () => log.push("stop"),
    })

    yield* Effect.exit(fx.run)

    assert.deepStrictEqual(log, [
      "setup:a",
      "setup:b",
      "cleanup:a",
      "teardown:y",
      "teardown:x",
      "stop",
    ])
  }),
)
```

如果 Feature 契约规定了不同的 cleanup/teardown 相对顺序，期望值以该契约为准；fixture 不应自行排序。

## Provider 契约测试

每个 provider 用同一组 contract cases 验证：

```ts
function sandboxContract(make: () => Promise<Sandbox>) {
  it("命令失败返回非零 exitCode，而不是把它当基础设施异常", async () => {
    const sandbox = await make()
    const result = await sandbox.runCommand("sh", ["-c", "exit 7"])
    expect(result.exitCode).toBe(7)
  })
}
```

内存 provider 可以在 unit 套件跑；Docker、Vercel、E2B 的真实创建和网络行为由分层 E2E 调用同一 contract suite。

## 不这样测

- 不在 Context 测试里重新实现一个会执行真实 shell 的 fake Sandbox。
- 不断言 Docker SDK、Vercel SDK 或 E2B SDK 的构造器本身工作。
- 不只测 happy path；资源泄漏通常出现在失败和中断。
- 不允许未实现的 fake 方法静默返回空字符串、空数组或成功结果。
