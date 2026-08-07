# Testkit API 与已迁移代码

这里展示 `@niceeval/testkit` 的目标 API，以及 Example 场景 Repo 直接消费它之后的测试正文。
[`api.ts`](api.ts) 是完整类型草案，不是已经发布的实现。

本目录是设计 Example，所以所有 Repo 已经直接 import 尚未发布的 package，用于评审 API 是否好读。
真实 `e2e/` 只有在 Testkit 通过 meta-test、packed-tarball 和 stable-outer 验收后才能照此迁移。

真实 Repo 的依赖形状是精确版本，不使用 range 或 `latest`：

```json
{
  "devDependencies": {
    "@niceeval/testkit": "0.1.0"
  }
}
```

根 runner 只把同一 Repo 的 `niceeval` 替换为 candidate tarball，并核对 Testkit 的 lockfile integrity 没有变化。

## 功能 Repo 的调用点

- [CLI pipe](../repos/cli/test/show-json-pipe.test.ts)：`command()` 与收据的 `json()`；128 KiB、sentinel 和 bug 引用仍可见。
- [Runner carry](../repos/runner/test/carry-reuse.test.ts)：`withProjectCopy()` 拥有副本生命周期；排除项、链接策略、
  schemaVersion、reused 关系与对应 memory 留在正文。
- [Lifecycle](../repos/lifecycle/test/interrupt-cleanup.test.ts)：`withTempDir()` 为每条 case 分配控制文件，`withProcess()` 拥有进程；
  signal、teardown、PID、端口和下一消费者仍由测试断言。
- [Report](../repos/report/test/exported-navigation.spec.ts)：Testkit 只运行 CLI；浏览器仍使用 Playwright Test 的 `page` fixture。
- [Journey](../repos/report/test/first-eval-to-debug.spec.ts)：与 Report 共用消费现场，`withProjectCopy()` 隔离新项目；
  Playwright 负责 browser、context、trace 与 screenshot。

## Adapter Repo 的调用点

- [AI SDK](../repos/adapter/ai-sdk/test/tool-identity.test.ts)：跨 hook 共享进程时使用 caller-owned `startProcess()`，
  原生 `afterAll` 调用 `dispose()`。
- [Codex CLI](../repos/adapter/codex-cli/test/tool-identity.test.ts)：复用命令收据与唯一项选择；真实 CLI、Docker 与工具身份
  都留在这个 Adapter Repo。
- [Local protocol](../repos/adapter/local-protocol/test/local-backend-failure.test.ts)：`withHttpServer()` 只拥有 server 生命周期；
  502 body、错误阶段和 verdict 留在 Adapter 测试。

两组调用点只共享 API 实现，不共享场景 Repo。功能测试不会从 `adapter/ai-sdk` 借 backend 或运行结果；Adapter 测试也不会
通过 Testkit 获得 CLI、Report 或 Runner 的领域动作函数。

`ProcessHandle.signal()` 只刺激根进程；`processGroup: true` 只让 `dispose()` 与 timeout 的兜底终止整组。
Lifecycle 因此能证明 backend 是被产品 teardown 释放的，不会由 Testkit 提前杀掉被测资源。

核心 Unit 不在这里套一层统一 DSL。[`example/unit/`](../unit/) 继续使用 Vitest、最小领域 fixture、fake clock 或 barrier；
Testkit 不会仅为了让 Unit 与 E2E import 同一个包而接管这些能力。

## 这不是产品 DSL

可以抽取：

```ts
const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const receipt = await niceeval.run(["show", locator, "--json"]);
const document = receipt.json<AttemptDocument>();
```

不能抽取：

```ts
await testkit.runCarryScenario("carry");
await testkit.expectAttemptPassed(locator);
await testkit.openReportAttempt(page, locator);
```

后者把用户动作、expected 和失败接缝藏进共享包。测试虽然短，却无法从正文判断它到底证明了什么。

## Runner carry 为什么不可能只剩三行

carry 的 `full → partial → full` 本来就包含三次公开动作、一次源文件变化和两个身份结果。Testkit 可以删除 spawn、buffer、
JSON error、timeout 和 cleanup 模板，但不能删除这些业务步骤。目标不是最短，而是让剩余每一行都属于 carry 契约。

[`carry-reuse.test.ts`](../repos/runner/test/carry-reuse.test.ts) 把复制起始目录、顶层排除项和 `node_modules` 链接写在文件头。
`withProjectCopy()` 只执行这些策略并保证删除副本，因此它可以服务不同 Repo 的 mutation 场景，
却不知道 configHash、Eval 或 carry 是什么。当前两个实际消费者都是功能 Repo：Runner mutation 与 Report Journey；
这不表示二者共用同一个 Repo，只表示它们复用同一项文件系统生命周期。
