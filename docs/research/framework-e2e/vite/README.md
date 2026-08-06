# Vite

## 证据范围

本页固定到 Vite 官方仓库提交 [`fddf4ea41de5f7889037a2f957438857ac12a260`](https://github.com/vitejs/vite/tree/fddf4ea41de5f7889037a2f957438857ac12a260)。

主要源文件与目录：

- [`CONTRIBUTING.md`](https://github.com/vitejs/vite/blob/fddf4ea41de5f7889037a2f957438857ac12a260/CONTRIBUTING.md)：playground E2E 的入口、serve/build 模式与 `~utils`。
- [`vitest.config.e2e.ts`](https://github.com/vitejs/vite/blob/fddf4ea41de5f7889037a2f957438857ac12a260/vitest.config.e2e.ts)：Vitest 的 E2E 收集、setup 与模式选择。
- [`playground/vitestGlobalSetup.ts`](https://github.com/vitejs/vite/blob/fddf4ea41de5f7889037a2f957438857ac12a260/playground/vitestGlobalSetup.ts)：共享 Chromium server 与 playground 临时副本。
- [`playground/vitestSetup.ts`](https://github.com/vitejs/vite/blob/fddf4ea41de5f7889037a2f957438857ac12a260/playground/vitestSetup.ts)：Vite server、Page、日志与每套件 teardown。
- [`playground`](https://github.com/vitejs/vite/tree/fddf4ea41de5f7889037a2f957438857ac12a260/playground)：真实 fixture projects 与共置 specs。
- [`.github/workflows/ci.yml`](https://github.com/vitejs/vite/blob/fddf4ea41de5f7889037a2f957438857ac12a260/.github/workflows/ci.yml)：构建、浏览器安装、OS/Node 与 serve/build lane。

## Fixture project 如何组织

**事实。** `playground/*` 是提交在仓库中的真实小项目，每个 package 可带自己的 `__tests__`。Global setup 删除并重建 `playground-temp`，只复制被选中的 playground 和 variant，过滤 tests 与已有 dist；测试在副本中编辑源码和生成构建输出。

**推断。** Vite 把“可读模板”与“可变运行目录”分开，适合会修改源码、触发 HMR 或生成 dist 的场景。NiceEval scenario repo 也应复制模板后运行，不应直接污染 canonical fixture。

## 候选构建或 CLI 如何运行

**事实。** 官方贡献文档要求先构建 Vite。Setup 查找 workspace 中的 `packages/vite/bin/vite.js`，再按 suite 选择 dev server 或 build；`test-serve`、`test-build` 和 `test-serve-bundled` 复用同一批 playground specs。

**推断。** Vite 的重点是让同一产品行为验证 dev/build 变体，不是验证 package tarball 安装。NiceEval 可以借鉴 mode matrix，但 installed-CLI lane 仍应安装带 digest 的候选 tarball。

## 使用哪个 test runner

**事实。** 外层 runner 是 Vitest；浏览器自动化直接使用 Playwright library。仓库没有为这组 playground tests 使用 Playwright Test runner。

**推断。** Vite 选择这一组合，是因为 serve/build 两种产品模式共享一套 Vitest suite 和大量非浏览器测试函数。它不构成“所有浏览器 Journey 都应挂在 Vitest 下”的通用判断。

## Browser、server 与 process 生命周期由谁管理

**事实。** `vitestGlobalSetup.ts` 用 Playwright `launchServer` 启动共享 Chromium server，并在全局 teardown 关闭。`vitestSetup.ts` 在 suite 前连接 browser、创建 Page、启动默认或自定义 Vite server；teardown 关闭 Page、Vite server、watcher 与 browser connection。Vitest 负责 hooks 的触发，Vite 自写 setup 负责产品资源。

**推断。** Runner 只提供生命周期插槽，产品仍必须定义 readiness、日志、watcher 和 server shutdown。NiceEval 的共享 runner 也应保持这种薄边界。

## Golden、snapshot 与结构化断言怎样分工

**事实。** Playground specs 通常直接检查 DOM、URL、server log、错误与构建输出。Snapshot 用于 source-map 等稳定序列化输出或少量 UI 文本，并非所有页面行为的唯一 oracle。

**推断。** Browser assertion 应靠 DOM 和产品状态，snapshot 只验证需要整体比较的稳定表示。NiceEval Journey 还应联合验证 href、HTTP、record 与 report JSON。

## 本地与 GitHub CI 如何分 lane

**事实。** 本地脚本分别运行 serve、build 和 bundled-serve。GitHub Actions 先安装 Chromium、构建 workspace，再在 Ubuntu、macOS、Windows 与多个 Node 版本上分配 unit、serve、bundled serve 和 build jobs。

**推断。** 产品 mode 是第一层 owner，OS/Node 只叠加需要的平台风险。NiceEval 不应让每种宿主条件重复所有 Journey。

## 通用能力与手写产品动作

**事实。** Vitest 提供 test collection、hooks、assertions 与 snapshot；Playwright 提供 browser protocol 和 Page API。Vite 自己实现 playground copy、模式选择、Vite server 启停、源码编辑、日志收集与临时目录回收。

**研究判断。** Vite 使用通用测试基础设施，但没有使用通用的端到端产品 harness。可复用层与手写层的分界正好落在产品进程和 fixture lifecycle。
