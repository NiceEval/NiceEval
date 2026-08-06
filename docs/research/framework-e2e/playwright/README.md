# Playwright

## 证据范围

本页固定到 Playwright 官方仓库提交 [`b4a646a624c0b1e8e352d320cbc6684581625ff6`](https://github.com/microsoft/playwright/tree/b4a646a624c0b1e8e352d320cbc6684581625ff6)。

主要源文件与目录：

- [`package.json`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/package.json)：build、stable outer runner 与各 suite 入口。
- [`tests/playwright-test/playwright-test-fixtures.ts`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/tests/playwright-test/playwright-test-fixtures.ts)：inline project、候选 CLI、JSON reporter、watch 与 teardown。
- [`tests/playwright-test/playwright.config.ts`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/tests/playwright-test/playwright.config.ts)：Playwright Test 自测配置。
- [`tests/config/commonFixtures.ts`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/tests/config/commonFixtures.ts)：child process、子进程变量清洗、process tree 与失败输出。
- [`tests/config/serverFixtures.ts`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/tests/config/serverFixtures.ts)：HTTP、HTTPS、proxy 与 SOCKS server lifecycle。
- [`tests/playwright-test/golden.spec.ts`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/tests/playwright-test/golden.spec.ts) 与 [`to-have-screenshot.spec.ts`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/tests/playwright-test/to-have-screenshot.spec.ts)：golden 和截图断言自测。
- [`.github/workflows/tests_primary.yml`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/.github/workflows/tests_primary.yml)：browser、OS/Node、runner shards 与 installation lanes。
- [`.github/workflows/tests_secondary.yml`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/.github/workflows/tests_secondary.yml) 与 [`tests_docker.yml`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/.github/workflows/tests_docker.yml)：专门能力与 Docker lane。
- [`docs/src/browser-contexts.md`](https://github.com/microsoft/playwright/blob/b4a646a624c0b1e8e352d320cbc6684581625ff6/docs/src/browser-contexts.md)：Playwright Test 的 BrowserContext 隔离契约。

## Fixture project 如何组织

**事实。** `writeFiles(testInfo, files, initial)` 把 inline project 写入 `testInfo.outputPath`，补充最小 `package.json` 和 `tsconfig`。Installation tests 另以目录 fixture 验证真实安装场景。每例 output directory 由 Playwright Test 隔离，额外 cache 使用 `mkdtemp` 创建。

**推断。** Inline fixture 适合精确表达 runner edge case，目录 fixture 适合安装和完整项目。NiceEval 的 canonical scenario repo 应使用目录模板，极小 parser/CLI case 才用 inline files。

## 候选构建或 CLI 如何运行

**事实。** Root script 先构建仓库，再用一份 `stable-test-runner` 中的 `@playwright/test` CLI 作为外层 runner。Fixture 把当前构建的 `packages/playwright-test/cli.js` 作为内层 candidate，以 `node <cli> test ...` 启动。

**推断。** Stable outer/current inner 避免“用正在被测的调度器裁决自己是否正确”的递归。NiceEval 不需要复制稳定 runner，但 release lane 必须让 runner 与候选 artifact 身份彼此独立。

## 使用哪个 test runner

**事实。** Playwright 的 runner 自测仍使用 Playwright Test，只是外层版本固定为 stable，内层才是当前 candidate。大部分 library/browser suites 也由 `playwright test` 运行。

**推断。** 自托管 runner 可以成立，前提是外层裁判稳定且内层结果有独立 oracle。NiceEval 使用 Vitest/Playwright 时无需自建第三个 runner。

## Browser、server 与 process 生命周期由谁管理

**事实。** Playwright Test 提供 test/worker fixtures，并默认为每例创建隔离 BrowserContext。`commonFixtures.ts` 自己追踪所有 child processes，捕获 stdout/stderr/exit，清洗子进程变量，在 POSIX 管理 detached process group，并于 teardown 对进程树发送信号、等待退出。`serverFixtures.ts` 的 HTTP、HTTPS、proxy 与 SOCKS servers 是 worker-scoped，逐例 reset，worker 结束时 stop/close。

**推断。** BrowserContext 是框架通用资源，candidate CLI 和产品 server 是项目专属资源。NiceEval 也应让 Playwright 管 browser，让共享 repo runner 管 CLI、backend 与 adapter。

## Golden、snapshot 与结构化断言怎样分工

**事实。** Runner fixture 强制内层 candidate 输出 `report.json`，解码为类型化 JSON report，并派生 passed、failed、flaky、skipped 等统计；同时保存 exit、stdout、stderr 与合流后的原始输出。Golden 与 screenshot suites 专门测试文本/文件匹配和视觉比较。

**推断。** Playwright 没有用截图证明 runner 结果。NiceEval 也应让 report/record JSON 和 HTTP 状态拥有语义，截图只证明视觉回归。

## 本地与 GitHub CI 如何分 lane

**事实。** Primary workflow 把 Chromium、Firefox、WebKit library tests 与 Playwright Test runner tests 分开；runner tests 跨 Linux、macOS、Windows、多个 Node 版本并采用 weighted shards。Installation、web components、secondary 能力与 Docker 另有专门 workflows。

**推断。** Browser engine、OS/Node、installation 与 Docker 是独立风险轴，不是一个笛卡尔积。NiceEval 应让 browser Journey 只验证支持矩阵中的必要代表，安装 identity 由 installed-CLI lane 独占。

## 通用能力与手写产品动作

**事实。** Playwright Test 提供 fixtures、parallelism、assertions、snapshots、browser contexts、reporting 和 test output。Playwright 仓库仍自写 inline project、候选 CLI invocation、JSON report parser、process-tree cleanup、test servers 和 watch-mode interaction。

**研究判断。** 即使产品本身就是 E2E 框架，其自测也保留薄的产品 harness。NiceEval 应复用 Playwright Test，而不是仿造它；只实现 NiceEval repo、artifact、process 和 cleanup 边界。
