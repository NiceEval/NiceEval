# Testkit 目标代码

这里展示 `@niceeval/testkit` 0.x 稳定后，多种场景 Repo 的测试正文会变成什么样。当前文件只用于 API 与可读性评审，
不会冒充已经发布或已经进入 release gate 的实现。

正式迁移时，场景 Repo 从精确锁定的 `@niceeval/testkit` 导入。这里暂时从 [`api.ts`](api.ts) 导入声明，避免使用不存在的
workspace link。Testkit 未完成独立 meta-test、packed-tarball 和 stable-outer 验收前，现有 `test/support` 继续作为裁判。

真实 Repo 的依赖形状是精确版本，不使用 range 或 `latest`：

```json
{
  "devDependencies": {
    "@niceeval/testkit": "0.1.3"
  }
}
```

根 runner 只把同一 Repo 的 `niceeval` 替换为 candidate tarball，并核对 Testkit 的 lockfile integrity 没有变化。

## 代码索引

- [`runner-carry.example.ts`](runner-carry.example.ts)：Testkit 只隐藏进程和 JSON framing；Repo-local project copy、三段 argv、
  schemaVersion、reused 关系与 `85cafd7d` 留在正文。
- [`cli-pipe.example.ts`](cli-pipe.example.ts)：完整收据直接提供严格 `json()`；128 KiB、sentinel 和历史 bug 仍可见。
- [`long-lived-process.example.ts`](long-lived-process.example.ts)：AI SDK 与 Lifecycle 共享 `withProcess()`，但 readiness 条件、
  signal 结果和 owned resource oracle 不共享。
- [`report-browser.example.ts`](report-browser.example.ts)：Testkit 只运行 CLI；浏览器仍用 Playwright Test 的 `page` fixture。

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
await testkit.runCarryScenario("smoke");
await testkit.expectAttemptPassed(locator);
await testkit.openReportAttempt(page, locator);
```

后者把用户动作、expected 和失败接缝藏进共享包。测试虽然短，却无法从正文判断它到底证明了什么。

## Runner carry 为什么不可能只剩三行

carry 的 `full → partial → full` 本来就包含三次公开动作、一次源文件变化和两个身份结果。Testkit 可以删除 spawn、buffer、
JSON error、timeout 和 cleanup 模板，但不能删除这些业务步骤。目标不是最短，而是让剩余每一行都属于 carry 契约。

当前 [`carry-reuse.test.ts`](../repos/runner-carry/test/carry-reuse.test.ts) 已先把副本 cleanup 收进 Repo-local
`withProjectCopy()`。进程 support 只有在稳定 Testkit artifact 成为外层裁判后才迁移，避免代码先引用一个不存在或与候选共命运的包。
