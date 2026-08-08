# 框架工具自身的 E2E 对照

本组研究只回答一个具体问题：Vite、Vitest 与 Playwright 测试自己时，通用 runner 管到哪里，产品专属 harness 又从哪里开始。

项目事实分别见 [Vite](vite/README.md)、[Vitest](vitest/README.md) 与 [Playwright](playwright/README.md)。链接固定到调研时读取的官方仓库提交；“事实”来自这些一手源文件，“推断”是跨项目归纳或对 NiceEval 的建议。

## 统一对照

| 项目 | 通用 E2E runner | Fixture project | 候选入口 | 生命周期 owner | 主要断言分工 | CI lane |
|---|---|---|---|---|---|---|
| Vite | Vitest + Playwright library，不使用 Playwright Test | `playground/*` 复制到 `playground-temp` | workspace 构建后的 `packages/vite/bin/vite.js` | Vitest hooks 加 Vite 自写 setup/globalSetup | DOM、日志和生成文件做结构化断言；少量稳定输出做 snapshot | unit、serve、bundled serve、build，叠加 OS/Node |
| Vitest | CLI E2E 的外层仍是 Vitest；UI 使用 Playwright Test；Browser Mode 使用 Playwright provider | `test/e2e/fixtures/*` 或 `useTmpFS` 生成临时项目 | workspace build，经 API 或真实 `vitest` 进程 | 外层 Vitest hooks；进程与临时目录由自写 test-utils；UI 浏览器由 Playwright Test | 结构化 test tree、error、exit 与流优先；snapshot 拥有稳定文本/序列化结果 | unit/E2E/coverage、OS/Node、browser shards、兼容性 smoke |
| Playwright | 使用一份 stable Playwright Test 作为外层 runner | inline files 写入 `testInfo.outputPath` | 当前构建的 `packages/playwright-test/cli.js` 作为内层 candidate | Playwright fixture 管 browser/context；自写 fixture 管 CLI、process tree 与 server | JSON reporter/计数验证 runner 语义；golden/screenshot 验证格式与视觉 | browser engines、OS/Node、weighted shards、installation、Docker/secondary |

## 它们是否使用“通用 E2E 框架”

**事实。** 三个项目都复用成熟 runner，但没有一个把产品 E2E 完全交给通用框架：

- Vite 复用 Vitest 的收集、hooks、断言和 snapshot，也复用 Playwright 的 browser automation；fixture 复制、Vite serve/build、源码编辑、日志收集和 teardown 仍由项目代码实现。
- Vitest 复用自己的 runner；UI 才使用 Playwright Test。嵌套 candidate、临时文件系统、CLI stream、exit、watch process 和结构化结果都由 `test/test-utils` 实现。
- Playwright 复用 Playwright Test 的 fixture、并发、assertion、snapshot、browser context 和 reporting。
  Inline project、候选 CLI、JSON reporter、进程树和测试 server 仍由专属 fixture 实现。

**推断。** “使用通用框架”与“手写产品动作”不是二选一。成熟边界是：框架拥有调度和通用资源，薄 harness 拥有 candidate、真实 repo、产品进程与产品 oracle。

## Golden、snapshot 与结构化断言的共同分工

**事实。** 三个项目都保留 snapshot 或 golden，但关键行为还有独立的结构化证据。
Vite 检查 DOM、server log 和构建输出；Vitest 返回 test modules、errors、exit 和分离的 streams。
Playwright 强制生成并解码 JSON report，再计算 passed、failed、flaky、skipped 等结果。

**推断。** Snapshot 适合稳定的人类文本、序列化格式和视觉输出，不应拥有 exit、JSON schema、资源状态或协议 framing。NiceEval 应把 CLI JSON、record/report、adapter receipt 和 cleanup receipt 解码后断言，只让 golden 验证面向人的输出。

## 可读性与维护方式

**事实。** 三个项目都把“稳定项目样本”和“本次运行的可变现场”分开。Vite 把 `playground/*` 复制到临时目录后修改；
Vitest 让复杂 fixture 留在目录中，极小 case 才由 `useTmpFS` 就地生成；Playwright 把 inline project 写入每例独立的
`testInfo.outputPath`。共享状态是需要串行或 worker fixture 的例外，不是默认前提。

**事实。** 它们的产品专属代码主要返回可继续断言的结构化结果：argv、流、exit、test tree、JSON report、server log 或文件。
测试仍由原生 runner 按文件和标题选择，领域 expected 留在 spec 中；没有再维护一份场景语言来转述测试正文。

**推断。** 可维护性来自四个边界，而不是把 test 写得越短越好：

1. 签入的 Repo / playground 负责让现场可读，运行时只修改它的副本；
2. 复用设施负责机械资源，测试正文负责公开动作和领域 expected；
3. 结构化结果逐字段断言，snapshot 只拥有稳定的人类表示；
4. 一个风险只有一个完整 owner，跨 runner 复用进程与 Repo API，不复制同一断言矩阵。

NiceEval 的测试文件因此可以保留少量重复 argv。把它们藏进 `runScenario("report")` 虽然行数更少，却会让评审者无法从
一个文件判断用户做了什么、失败停在哪里，以及修改 expected 是否合理。

**推断。** 功能 fixture project 与外部集成 fixture project 应是两组 Repo。Vite / Vitest 的产品功能 playground 不会因为
都要启动进程，就与某个第三方兼容性项目共用 package graph。NiceEval 因此应让 `cli / runner / report / package / lifecycle`
使用确定性功能 Repo，让 `adapter/<id>` 使用真实 SDK / CLI Repo；两组只共享不含领域语义的机械 Testkit。

## 对 NiceEval 的具体决策

NiceEval 应采用 **Vitest + Playwright Test + 一个薄的、框架中立的 repo runner**，不应自建通用 E2E 框架。

### 直接复用

- Vitest 负责 library、CLI、HTTP 与 local protocol 测试的收集、并发、hooks、assertion、snapshot plumbing、报告和精确过滤。
- Playwright Test 负责 browser Journey 的 Browser、Context、Page、web-first assertions、trace、screenshot/video、browser projects 与失败附件。
- 两者各自保留原生配置和报告，不再包装一层 NiceEval scheduler、retry、sharding 或 assertion DSL。

### 薄 repo runner 只拥有产品边界

建议让 Vitest 与 Playwright Test 共用普通 TypeScript API，而不是场景语言：

| API | 唯一职责 |
|---|---|
| `materializeCandidate()` | 查找 tarball、digest、CLI 入口与版本，返回 `CandidateReceipt` |
| `createConsumerRepo()` | 从只读模板复制真实 repo，创建假 HOME、cache、record 与 adapter state |
| `installCandidate()` | 在 consumer repo 安装精确 tarball，并证明实际 executable 入口和 digest |
| `runProcess()` / `startProcess()` | 分离 stdout/stderr，保存 exit/signal/timeout，清洗 env，并终止整个 process tree |
| `startServer()` | readiness deadline、日志、PID、stop deadline，以及端口释放证明 |
| `ownResource()` | 注册 LIFO cleanup，等待 postcondition，并返回 `CleanupReceipt` |
| `preserveFailure()` | 保存最小 repo、receipt、seed 与重跑命令，同时遮盖 secret |

### 不自建的能力

不要自建测试发现、套件调度、并发池、browser/context 管理、通用 matcher、snapshot engine、retry、sharding、trace 或 HTML report。这些都是 Vitest/Playwright 已拥有且持续维护的基础设施。

### 与三个对照项目不同的严格要求

**事实。** 本组项目主要从 workspace build 查找 candidate；Playwright 用 stable 外层 runner 启动当前内层 CLI，Vite 和 Vitest也直接消费仓库构建结果。

**推断。** NiceEval 的 installed-CLI/release lane 不应照搬这一点。它必须继续在普通 consumer repo 安装精确 tarball，并以 digest receipt 证明 artifact 身份。薄 runner 的价值正是把这条更严格的产品边界同时提供给 Vitest 和 Playwright Test。

## 建议落入 NiceEval 契约的位置

本研究不修改这些文件，只向父 agent 提供可执行修改目标：

| 位置 | 建议修改 |
|---|---|
| `docs/roadmap/testing/architecture.md` | 定案“两 runner、一套 framework-neutral repo support”；禁止另造调度、断言和 snapshot 层 |
| `docs/roadmap/testing/e2e/execution.md` | 写清 Vitest 与 Playwright Test 的 lane ownership，以及共享 runner 的生命周期契约 |
| `docs/roadmap/testing/e2e/scenario-repos.md` | 为 `CandidateReceipt`、consumer repo copy/install 与 failure preservation 定义机器可读字段 |
| `docs/roadmap/testing/portfolio.md` | Browser Journey 归 Playwright；CLI/HTTP/local protocol 归 Vitest；同一风险不得跨 runner 复制 |
| 独立 `@niceeval/testkit` | 用 framework-neutral process handle 同时服务功能与 Adapter 两组 Repo；精确锁版本且不 import Vitest / Playwright matcher |
| 根 runner 的 server / resource support | readiness、日志、process-tree shutdown、端口释放与 `CleanupReceipt`，以普通 TypeScript API 同时服务两种 runner |
| browser Journey example | 使用 Playwright Test 原生 fixture/trace，只调用共享 repo runner 准备 candidate 与后端 |
| CLI scenario example | 使用 Vitest 原生 assertions，只调用同一 repo runner 安装候选并运行真实 CLI |
