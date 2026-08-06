# Vitest

## 证据范围

本页固定到 Vitest 官方仓库提交 [`8e2108ddaec3c58501621fdd2d78929d87c383c8`](https://github.com/vitest-dev/vitest/tree/8e2108ddaec3c58501621fdd2d78929d87c383c8)。

主要源文件与目录：

- [`test/README.md`](https://github.com/vitest-dev/vitest/blob/8e2108ddaec3c58501621fdd2d78929d87c383c8/test/README.md)：core、config、CLI、browser、UI 与 watch suites 的职责。
- [`CONTRIBUTING.md`](https://github.com/vitest-dev/vitest/blob/8e2108ddaec3c58501621fdd2d78929d87c383c8/CONTRIBUTING.md)：构建和本地测试入口。
- [`test/e2e/vitest.config.ts`](https://github.com/vitest-dev/vitest/blob/8e2108ddaec3c58501621fdd2d78929d87c383c8/test/e2e/vitest.config.ts)：外层 Vitest projects、snapshot 与 serial tests。
- [`test/e2e/fixtures`](https://github.com/vitest-dev/vitest/tree/8e2108ddaec3c58501621fdd2d78929d87c383c8/test/e2e/fixtures)：提交在仓库中的真实 fixture projects。
- [`test/test-utils/index.ts`](https://github.com/vitest-dev/vitest/blob/8e2108ddaec3c58501621fdd2d78929d87c383c8/test/test-utils/index.ts)：嵌套 Vitest、CLI process、临时文件系统、stream 与 teardown。
- [`test/ui/playwright.config.ts`](https://github.com/vitest-dev/vitest/blob/8e2108ddaec3c58501621fdd2d78929d87c383c8/test/ui/playwright.config.ts)：UI E2E 的 Playwright Test 配置。
- [`test/browser/vitest.config.mts`](https://github.com/vitest-dev/vitest/blob/8e2108ddaec3c58501621fdd2d78929d87c383c8/test/browser/vitest.config.mts)：Vitest Browser Mode 与 Playwright provider。
- [`.github/workflows/ci.yml`](https://github.com/vitest-dev/vitest/blob/8e2108ddaec3c58501621fdd2d78929d87c383c8/.github/workflows/ci.yml)：OS/Node、browser shards 与兼容性 lane。

## Fixture project 如何组织

**事实。** 复杂、可复用的项目放在 `test/e2e/fixtures/*`。需要就地生成的 case 使用 `useTmpFS`，在随机 UUID 目录写真实 package、config 和源码，并由 test lifecycle 删除。会修改共享 Git fixture 的少量 tests 被配置为 serial project。

**推断。** 固定 fixture 与 inline repo 是互补机制；串行只能用于确有共享状态的例外。NiceEval 默认应每例复制或生成 consumer repo，并把共享变体收敛为显式 template。

## 候选构建或 CLI 如何运行

**事实。** 贡献流程要求先 build。`runVitest` 经 `startVitest` 在进程内启动 workspace candidate；`runVitestCli` 则启动真实 `vitest` CLI process。两者都由外层 test suite 捕获结果，并在测试结束时关闭 context 或杀死进程。

**推断。** 进程内入口适合 runner 内部语义，真实 CLI 入口拥有 shell、stream、signal 与 watch wiring。NiceEval 的 library 和 installed CLI 也应按这条边界分层。

## 使用哪个 test runner

**事实。** Core/config/CLI E2E 的外层 runner 仍是 Vitest。UI suite 的 package script 使用 `playwright test`；Browser Mode suite 使用 Vitest 和 Playwright provider。因此 Vitest 自身不是只用一个通用 runner，也没有为 CLI E2E 引入另一套框架。

**推断。** Runner 应按被测交互选择。NiceEval 的 browser Journey 适合 Playwright Test，其余本地产品边界适合 Vitest。

## Browser、server 与 process 生命周期由谁管理

**事实。** 外层 Vitest 的 `onTestFinished`/`afterEach` 触发 cleanup。`test/test-utils` 自己关闭嵌套 Vitest context、杀死并等待 CLI/watch process、删除临时目录。UI 的 browser/context/page 生命周期由 Playwright Test fixture 管理；Browser Mode 的浏览器连接由 Vitest provider 管理。

**推断。** 即使 runner 有 hooks，candidate process 仍需要产品专属 handle。NiceEval 应共享 framework-neutral process API，而不是分别在 Vitest 和 Playwright fixture 中复制 kill/wait 逻辑。

## Golden、snapshot 与结构化断言怎样分工

**事实。** `runVitest` 返回 stdout、stderr、exit code、test modules、errors 与状态统计，测试可以直接检查结构化结果。Snapshot suites 独立配置，用于稳定的序列化输出、diagnostic 或报告形态，而不是代替所有状态判断。

**推断。** NiceEval 应借鉴“结构化 result 先行”。Snapshot 只拥有人类文本；JSON、record tree、exit、signal 与 timeout 都用类型化断言。

## 本地与 GitHub CI 如何分 lane

**事实。** 本地可按 suite 运行 core、E2E、browser 或 UI。CI 先构建，再把 unit/E2E/coverage 分配到 Linux 多个 Node 版本、最低 Node、macOS 与 Windows；browser tests 另在 Ubuntu/Windows 分片，并有 Vite 兼容性 smoke。

**推断。** OS、Node、browser 与依赖兼容性各自拥有不同风险。NiceEval 应先指定唯一 matrix owner，再决定哪些组合进入 PR、main 或 nightly。

## 通用能力与手写产品动作

**事实。** Vitest 外层 runner提供 collection、hooks、assertions、snapshot 和 project scheduling；Playwright Test 或 Playwright provider 提供浏览器能力。项目自写 `runVitest`、`runVitestCli`、`useTmpFS`、inline file、stream capture、readiness 与 process teardown。

**研究判断。** Vitest 复用了通用 runner，也为自己的嵌套 runner/CLI 边界保留了薄 harness。它没有另造一套通用 E2E DSL。
