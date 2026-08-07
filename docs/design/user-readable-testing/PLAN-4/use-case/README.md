# 方案 4：Use Cases

**相关文档**：[README](../README.md) · [Architecture](../architecture.md) · [Lifecycle](../lifecycle.md) · [共同 Cases](../../CASES.md)

## C1：只重跑受影响的 Attempt

用户结果由一个真实场景 Repo 或 unit 测试直接断言：

```ts
test("只重跑源码身份变化的 eval", async () => {
  const first = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "compare", "--rerun", "all", "--json",
  ]);
  expect(first.exitCode, first.diagnostic()).toBe(0);

  await replaceEval("rerun", evalV2);

  const second = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "compare", "--json",
  ]);
  expect(second.exitCode, second.diagnostic()).toBe(0);
  const events = parseNdjson(second.stdout);

  expect(startedEvalIds(events)).toEqual(["rerun"]);
  expect(reusedEvalIds(events)).toEqual(["kept"]);
});
```

fingerprint 输入矩阵仍由 unit 以最小 fixture 穷举。
E2E 只证明安装后公开命令的用户结果，不复制矩阵。

## C2、C3：Report 目标能打开并且身份正确

```ts
test("导出站沿实际 href 打开失败 Attempt", async ({ page }) => {
  const locator = failedAttemptFromPublicHistory.locator;
  await page.goto(siteUrl);

  const link = page.getByRole("link", { name: /onboarding\/fails/ }).first();
  const href = await link.getAttribute("href");
  if (href === null) throw new Error("onboarding/fails target 缺 href");
  expect(await httpStatus(new URL(href, siteUrl))).toBe(200);

  await link.click();
  expect(page.url()).toBe(new URL(href, siteUrl).href);
  await expect(page.getByText(locator, { exact: true })).toBeVisible();
});
```

locator 来自上一条公开 `show --history --json`；链接目标来自页面实际 `href`，测试不根据 locator 猜文件路径。
HTTP 失败指向导出 / hosting；HTTP 正常但 URL 或 locator 错误指向 browser routing / enhancement。

## C4：调度机制

```ts
test("同一实验的 retry backoff 不释放并发闸", async () => {
  const first = controlledAttempt("first");
  const second = controlledAttempt("second");

  await first.enterRetryBackoff();
  expect(second.started()).toBe(false);

  await first.finish();
  expect(second.started()).toBe(true);
});
```

这里使用实现维护者能读懂的 barrier 词汇，不伪装成用户故事，也不靠 sleep。

## C5：一次准备，多项只读验收

Report Repo 的 `prepare` 只运行一次确定性 Experiment 并导出一次站点，然后把冻结的证据交给多个原生测试文件。
若复用范围只在单个文件，也可以用 `beforeAll`。机器出口、show、HTML 与 browser 各有自己的测试标题和失败 artifact。

需要写结果根的测试获得自己的临时副本。
不靠测试文件顺序保护共享状态。

## C6：Adapter 协议

```ts
// regression: 060a6a05
test("Codex 工具调用读回为规范 shell 身份", async () => {
  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "tool-call", "--rerun", "all", "--json",
  ]);
  expect(run.exitCode, run.diagnostic()).toBe(0);

  const locator = latestLocator(parseNdjson(run.stdout), "tool-call/shell");
  const readback = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", locator, "--execution", "--json",
  ]);
  const document = parseJson(readback.stdout, readback.diagnostic());

  expect(toolNames(document.data)).toContain("shell");
  expect(toolNames(document.data)).not.toContain("unknown");
});
```

这条测试在对应 adapter 的真实场景 Repo 运行。
Docker 协议 fixture 可以复现确定性断流与错误分类，但不能替代这条 live SDK / CLI 兼容性证明。

## C7：真实包消费方

```ts
// regression: b44420d3
test("CommonJS 项目 init 后可以立即 list", async () => {
  // 这个叶子 Repo 本身就是已安装候选 tarball 的 CommonJS consumer；
  // 不在 test 内另造一个没有执行 pnpm install 的空目录。
  const project = await scenarioRepo("package-commonjs");

  const init = await runProcess(
    ["pnpm", "--silent", "exec", "niceeval", "init"],
    { cwd: project.root },
  );
  expect(init.exitCode, init.diagnostic()).toBe(0);

  const list = await runProcess(
    ["pnpm", "--silent", "exec", "niceeval", "list"],
    { cwd: project.root },
  );
  expect(list.exitCode, list.diagnostic()).toBe(0);
  expect(list.stdout).toMatch(/(?:Discovered 0 evals|发现 0 个 eval)/);
});
```

根 runner 已在这个 Repo 的隔离副本里注入、安装并核对候选身份；完整 binary argv 仍留在测试正文。
`list` 列的是 Eval，`exp list` 才列 Experiment，因此不能用 `No experiments found` 作为这里的 expected。

## C8：Bug 回归归属

- 公开结果逃逸：在对应场景 Repo 补或扩大一条长期 E2E，并在头部链接历史 bug。
- 纯内部错误：只补最小 Unit。
- 已有测试本该捕获却没捕获：先修 fixture 或断言，不并排增加一个 bug 专用框架。
- 新测试必须在 fix parent 或最小逆补丁上变红；否则不能宣称捕获了历史 bug。

## C9：本地与 CI 同构

Report 项目的 manifest 同时声明 `pr`、`main` 与 `release`，默认使用 host executor，并显式声明 Chromium capability。
开发者和 Actions 都运行：

```sh
pnpm e2e --repo report
```

Actions 只额外提供 matrix runner 条件和上传 artifact。
需要固定 Linux 系统包或验证容器边界时再增加 pinned Docker executor；若 host 与 Docker 都受支持，二者必须是 manifest 中
两条显式 scenario，CI 不自动切换，本地也不静默 fallback。

## 长流程 Journey：从初始化到定位失败并导出报告

Journey 不是把多个短测试机械串起来，而是证明一个跨功能用户目标真的走通。
正文保留每条真实命令，并在关键接缝立即检查：

```ts
test("新项目能运行评测、定位失败 Attempt 并交付静态报告", async () => {
  const project = await scenarioRepo("journey-first-eval-to-debug");

  const init = await runProcess(
    ["pnpm", "--silent", "exec", "niceeval", "init"],
    { cwd: project.root },
  );
  expect(init.exitCode, `[init]\n${init.diagnostic()}`).toBe(0);

  const plan = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "onboarding", "--dry", "--json",
  ], { cwd: project.root });
  expect(parseJson(plan.stdout).matrix.map((row) => row.evalId))
    .toEqual(["onboarding/passes", "onboarding/fails"]);

  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "onboarding", "--rerun", "all", "--json",
  ], { cwd: project.root });
  expect(run.exitCode, `[run]\n${run.diagnostic()}`).toBe(1);
  expect(resultEvents(parseNdjson(run.stdout))).toMatchObject([
    { evalId: "onboarding/passes", verdict: "passed" },
    { evalId: "onboarding/fails", verdict: "failed" },
  ]);

  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "onboarding/fails", "--history", "--json",
  ], { cwd: project.root });
  const locator = onlyAttempt(parseJson(history.stdout)).locator;

  const detail = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", locator, "--execution", "--json",
  ], { cwd: project.root });
  expect(parseJson(detail.stdout).data.locator).toBe(locator);

  const view = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "view", "--out", "site", "--no-open",
  ], { cwd: project.root });
  expect(view.exitCode, `[view]\n${view.diagnostic()}`).toBe(0);
  await expectExportedAttemptToOpen(project.path("site"), locator);
});
```

`init`、plan、run、history、detail、export 任一接缝出错都会在最近检查点停止，并保留该命令的收据。
Journey 不复制每个域的完整边界矩阵；它只验证跨域组合才会出现的断裂。
