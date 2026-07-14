# Sandbox 的测试架构

契约来源：[Sandbox](../../../feature/sandbox/README.md)、[Architecture](../../../feature/sandbox/architecture.md)、[Library](../../../feature/sandbox/library.md)、[操作](../../../feature/sandbox/library/operations.md) 和 [结果断言](../../../feature/sandbox/library/asserting-results.md)。单测证明 provider 共同契约、路径规则、重试分类和生命周期；真实容器与云 provider 连通性由 [E2E](../../e2e-ci/README.md) 用真实沙箱验证。用例登记在 [cases.md](cases.md)。

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
      workdir: "/home/sandbox/workspace",
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

默认 stub 抛出 `unexpected sandbox call`，不静默返回空值。这样生产代码意外增加一次文件读取时，测试会失败而不是用假数据继续通过（规则见 [Harness](../harness.md)）。

## 生命周期 fixture

资源测试覆盖成功、setup 失败、test 失败和中断四条路径。Effect 入口持有 Scope，fixture 只记录事件序列，期望顺序以 [Architecture](../../../feature/sandbox/architecture.md) 的调用链为准，fixture 不自行排序。

## 临时目录纪律

临时文件测试用每例独立的 `mkdtemp` 目录，并在 `afterEach` 或 Scope finalizer 删除；不共享固定 `/tmp/niceeval-test`。

## Provider 契约测试

每个 provider 用同一组 contract cases 验证共同语义：

```ts
function sandboxContract(make: () => Promise<Sandbox>) {
  it("命令失败返回非零 exitCode，而不是把它当基础设施异常", async () => {
    const sandbox = await make()
    const result = await sandbox.runCommand("sh", ["-c", "exit 7"])
    expect(result.exitCode).toBe(7)
  })
}
```

内存 provider 在 unit 套件跑这组 contract；Docker、Vercel、E2B 的真实创建和网络行为由 E2E 沙箱仓库对真实实例调用同一 contract suite。
