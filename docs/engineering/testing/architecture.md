# 测试架构

本篇是[测试体系](README.md)的技术方案：用什么工具、测试放在哪里、何时运行。要守护哪些性质由各 Feature 文档的「性质」一节拥有，本篇不列。

## 表面与工具

| 表面 | 层与工具 | 示例性质 |
|---|---|---|
| `exp` 的实时进度、中断、resize、`init` 引导 | E2E · Bombadil 终端驱动 | 任何时刻按下中断，最终都退出且不留孤儿进程；进度行不超过终端宽度 |
| `view` | E2E · Bombadil 浏览器驱动 | 任何页面都不显示凭据；任意导航序列后链接都有效 |
| CLI 参数、机器输出、退出码与人读呈现 | 集成 · 进程内 CLI，fast-check 生成参数与项目 | 任意 `--json` 输出都能解析并符合协议；失败时退出码非零且附诊断 |
| 发现、身份、缓存、沿用 | 集成 · fast-check 模型 | 普通注释与排版变化保持身份；任何实际输入变化都不沿用旧结果 |
| 运行、取消、收尾、并发 | 集成 · `fc.commands` 模型，资源终态用 E2E 复核 | 任意取消时机下收尾都按逆序执行一次；Record 保持可读 |
| 断言、Judge、报告 | 集成 | 判定只依赖公开证据；同一 Record 的 `show` 与 `view` 结论一致 |
| Adapter 协议 | 集成 · 确定性协议流；真实 Provider 只在 live 环境 | 任意合法事件序列都归一为同一种 Turn 结构 |
| 安装、exports、bin、CJS/ESM | E2E · CI 打一次 tarball 装进临时项目 | 冒烟命令成功；类型声明能被消费者编译 |

被测项目在每个测试里用 Vitest fixture 生成到临时目录，测试结束自动回收；不维护整套复制的场景 Repo。非 live 测试使用确定性 Agent，不调用付费模型。

## 运行

| 场合 | 跑什么 |
|---|---|
| 本地 | 改动对应的 Vitest 文件（`vitest --changed` 或点名文件）；改了界面时，对相关 Bombadil spec 跑一次短时 `test` |
| pre-push | 在待推送的提交快照中运行 `pnpm lint` 与 `pnpm test`（Vitest 的快速 project） |
| PR | 全部集成测试；每个 Bombadil spec 跑固定时长的 `test`；CLI 机器输出 E2E |
| nightly | Bombadil `fuzz` 长时探索；fast-check 提高运行次数；live Provider |
| release | tarball 冒烟 |

运行条件（需要 Docker、Linux 内核语义、外部网络与密钥）用 Vitest `projects` 与 CI 矩阵表达，不写自研的计划器或预检。本地默认只跑不需要这些条件的 project。

违反时 Bombadil 以退出码 2 结束，trace 作为 CI artifact 上传；fast-check 的失败信息里带 seed 与 path，可本地精确复现。

宿主侧代码只用 Node 标准库与上表中的社区工具，不按平台分支调用 `/proc`、`ps`、`script` 或 shell 脚本。被测对象本身是平台专属行为时，该测试只放在声明了对应平台的 project 里。

## 布局

- 集成测试与 CLI 机器输出 E2E 放在根 Vitest 配置的 `projects` 中，按运行条件划分（默认、docker、linux、live）；文件名按 Feature 命名。
- Bombadil spec 是 TypeScript 模块，按表面放置：终端 spec 驱动 `niceeval` 进程，浏览器 spec 驱动 `niceeval view`。每个 spec 旁的 `regressions/` 存放缩减后的 trace。
- Bombadil 二进制按发布版本固定，CI 与本地使用同一版本；spec 的类型来自 npm 包 `@antithesishq/bombadil` 的同一版本。
- Bombadil 0.8 使用二进制 trace。`--output-path` 指定文件路径，`fuzz` 在同目录生成带编号的文件。用 `bombadil trace --json <file>` 读取观察与性质违反。
- CI 的浏览器 test 和 fuzz 都通过 `--chrome-variant=headless-shell` 使用 Chrome for Testing。短时本地验证时，将 `chrome-headless-shell` 放入 `PATH` 并传入同一参数。
- 被测项目由 Vitest fixture 在临时目录生成，测试结束自动回收；确定性 Agent 与协议流 fixture 与使用它的测试放在一起。

## 分层与目录

| 层 | 目录 | 边界 | 单个测试 p50 上限 |
|---|---|---|---:|
| 集成 · Library | `test/integration/` | 进程内调用公开 Library API，真实临时项目 | 1s |
| 集成 · CLI | `test/cli/` | 进程内 CLI：同一命令程序在测试进程运行，注入 argv、cwd、环境与标准流 | 300ms |
| E2E · 进程 | `test/process/` | 真实多进程、信号、外部程序与 Sandbox Provider | 10s |
| E2E · 界面 | `test/bombadil/` | Bombadil 终端与浏览器 spec | 按 spec 设定探索时长 |

门禁按目录归层。CLI 或进程层的测试若只在验证领域情形，就下沉到 Library 集成层。

### 跨进程保证

`test/process/` 的每个文件在开头注释声明它依赖的边界类别与具体保证，例如 `// 跨进程保证：进程终止与信号——中断后整个进程组退出且 Sandbox 被回收`。架构守护检查声明存在且类别取自下表；保证是否必要由审阅核对。

| 类别 | 例子 |
|---|---|
| 进程终止与信号 | 中断回收整个进程组、teardown 在退出前完成 |
| 外部程序与 Provider | Docker、Incus 等真实 Sandbox 的创建、准备与回收 |
| 文件与锁 | 多个 `exp` 并发写同一项目的结果存储 |
| 运行环境 | 最小 `PATH`、真实入口的退出码、包安装后的 bin |
| 网络 | 真实 HTTP 套接字的响应与连接回收 |

## 成本上限

单个测试按上表的 p50 上限；超过上限的文件按 Use Case 拆分或下沉，见 `use-case/` 中的拆分指南。全量测试在 CI 分片运行，本地与 pre-push 按上表执行。

## 检查入口

测试、性能测量与静态检查分别调用，不设聚合入口：`vitest`（可带 `--changed`、`--project`、文件名）、`bombadil terminal|browser test <spec>`、typecheck、lint 与 `concord check`。具体命令以根 `package.json` 为准。
