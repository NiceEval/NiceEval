# 复杂 CLI 测试体系对照

本研究为 NiceEval 测试体系提供外部基准。它不按测试数量评分，只比较证据链、隔离、协议真实性、lane 同构、cleanup 与矩阵所有权。

Vite、Vitest 与 Playwright 如何测试自身，以及 NiceEval 是否应自建框架，另见[框架工具自身的 E2E 对照](../framework-e2e/README.md)。

## 范围与证据纪律

研究对象是 [Git](git/README.md)、[Cargo](cargo/README.md)、[Deno](deno/README.md)、[pnpm](pnpm/README.md)、[OpenTofu](opentofu/README.md) 与 [kubectl](kubectl/README.md)。
链接固定到调研时读取的官方仓库提交。项目页将直接观察到的内容标为“事实”，跨项目归纳或对 NiceEval 的建议标为“推断”。

没有源码证据时，本文不会把“常见做法”补成项目事实。没有看到某个 lane，也只写“本次取证未查到”，不推导为项目绝对不存在。

## 跨项目研究判断

成熟项目的共同点不是拥有一套庞大的 E2E。它们复用同一候选 CLI 查找方式、隔离模型和断言协议，再把昂贵远端服务只分配给必须由它证明的风险。

六个项目分别提供了最强的局部样本：

| 问题 | 最值得借鉴的项目 | 原因 |
|---|---|---|
| 已构建 CLI 与真实项目 | Cargo、Deno | 共享测试层直接查找候选二进制，并为每例建立隔离上下文 |
| stdout、stderr、exit 与结构化输出 | Git、Cargo、Deno | 流与退出状态分开建模，并要求测试消费关键结果 |
| plugin 或外部进程协议 | Cargo、OpenTofu、kubectl | 使用真实辅助进程、provider 或 PATH plugin，而不是只 mock 调用点 |
| cleanup 与长流程 | Git、pnpm、kubectl | 等待进程退出，聚合 teardown 失败，并检查资源是否真的消失 |
| 本地、CI 与 live lane | Cargo、kubectl | 复用入口与 harness，差异由 capability 和 executor 选择表达 |
| 避免矩阵重复 | OpenTofu、kubectl | unit、local protocol、live integration 各自拥有不同风险 |

## 六项目简表

| 项目 | CLI 入口 | Fixture 隔离 | 断言 | 扩展协议 | lane | Journey 与 cleanup | 去重方式 |
|---|---|---|---|---|---|---|---|
| Git | build tree wrapper 或 `GIT_TEST_INSTALLED` | 每脚本 trash repo 与假 HOME | TAP、exit、流文件与比较函数 | PATH remote/credential 子进程 | 本地与 CI 调同一 shell suite | LIFO cleanup，daemon kill 加 wait | 公共 shell harness 与变量化变体 |
| Cargo | `cargo_bin!("cargo")` | 每测试 project、Cargo home、registry | status、stdout、stderr、JSON 与 UI fixture | 真 credential process 与 registry | OS、toolchain、network capability | RAII fixture 与完整 publish/install | 测试属性声明 capability 与层级 |
| Deno | `deno_exe_path` | TempDir、`DENO_DIR`、本地 server | 分流/合流输出、signal、golden、JSON | 真 `deno lsp` 与 JSON-RPC | 核心 CI 加定时 ecosystem lane | 子进程与 server guard | spec、integration、ecosystem 分责 |
| pnpm | Rust candidate 或 `bin/pnpm.mjs` | project、store、cache、registry | assert_cmd、NDJSON、snapshot、文件系统 | pnpmfile hook 与独立 server process | OS/Node/chunk 与 affected/full | tree kill、wait、teardown 错误聚合 | 共用 fixture；迁移期双栈仍有重复 |
| OpenTofu | TestMain 构建或预置 release binary | 复制 testdata 到 `t.TempDir` | 输出、状态、plan/state、规范化 JSON | 真 provider v5/v6 与 provisioner | PR、合并后跨平台、TF_ACC、cloud | init 到 destroy 与云资源 cleanup | unit、command E2E、cloud 分层 |
| kubectl | `make test-cmd` 或 `--kubectl-path` | `KUBE_TEMP`、假 HOME、唯一 namespace | exit、流文件、JSONPath/template | 真 `kubectl-*` PATH plugin | 本地/Prow/Kind/GCE/skew | trap、等待删除、leak scan | fake unit、local API、live/skew |

## NiceEval 已达到成熟项目水平的方向

以下是对现有目标契约的事实核对，不代表实现已经完成。

- [Testing Roadmap](../../roadmap/testing/README.md) 已按 Library、installed CLI、HTTP、browser 与真实 adapter 划分可观察边界。
- [Testing Architecture](../../roadmap/testing/architecture.md) 已要求 oracle 独立、结构化输出严格解码，并把进程结果作为一等证据。
- [Scenario Repos](../../roadmap/testing/e2e/scenario-repos.md) 已要求普通 consumer repo 安装候选 tarball，并用 digest 证明被测 artifact 身份。
- [E2E Execution](../../roadmap/testing/e2e/execution.md) 已规定本地和 CI 复用 runner，并区分 PR、main、nightly 与 release lane。
- [Portfolio](../../roadmap/testing/portfolio.md) 已用唯一 matrix owner、历史 bug 杀伤力与退役条件控制重复。
- 目标契约已经要求资源级 cleanup 与失败分类。这个方向与 Git、pnpm、OpenTofu、kubectl 的成熟做法一致。

因此，NiceEval 的主要问题不是缺少测试层级名称。它已经有比多数项目更严格的候选包身份链、真实 consumer repo 和矩阵所有权设计。

## NiceEval 明显较弱的部分

以下判断是基于研究时看到的 Roadmap 与 example 快照所得的推断。并行修改可能随后修复其中一部分，父 agent 验收时应重新核对。

1. Process 命令执行器的可执行契约不够完整。示例没有统一证明 timeout、进程树终止、子进程变量清洗、敏感信息遮盖，以及 stdout/stderr/exit 是否已被断言。
2. Cleanup 语义仍偏“调用过 stop”。成熟项目会继续等待进程退出、端口释放或远端资源消失，并把 cleanup 失败与主失败一起报告。
3. 候选 artifact 的 digest 已被设计，但示例还缺少统一的机器可读安装 receipt。测试需要直接证明路径、版本、digest 与入口来自同一候选包。
4. 同一 lifecycle 场景曾在根 example 与 scenario repo 出现不同强度的版本。复制式示例会使较弱版本继续被读者采用。
5. 外部 adapter 的三层 ownership 还应更显式。协议编码属于 unit，本地真进程属于 local E2E，secret 服务行为属于 live lane。
6. Journey 示例需要先验证真实 href 与持久化身份，再执行浏览器交互；测试 `view` server 时再增加 HTTP readiness 与响应断言。只看到页面可点击不足以证明 CLI 到报告的整条链。

## 直接采用的十个模式

1. 每例创建真实 consumer project，并分配假 HOME、cache、store 与 adapter 配置目录。
2. 候选 CLI 和所有协议辅助进程在 suite 启动前构建一次。测试只消费带 digest 的 artifact receipt。
3. ProcessResult 分别保存 stdout、stderr、exit code、signal、duration 与 timeout，不把流过早合并。
4. 为 ProcessResult 增加 assertion ledger。非空输出或非零退出未被断言时，测试在收尾阶段失败。
5. 外部协议测试启动真实辅助进程、provider 或 plugin，并把 argv、env、stdin/stdout framing 纳入断言。
6. 每个长生命周期资源返回 `OwnedResource`。cleanup 必须产出等待退出、端口释放和资源删除的 receipt。
7. 主失败与 cleanup 失败使用聚合错误。cleanup 不能遮蔽最初的产品失败。
8. lane 缺能力时先产生显式 preflight 结果。不能把 release candidate 无法运行协议进程测试悄悄记成通过。
9. 每个风险只有一个 matrix owner。unit、local protocol、live integration 只验证各自独有的错误类别。
10. 失败时保留最小工作目录、artifact receipt、随机种子与精确重跑命令，同时对 secret 做遮盖。

## 不应照搬的模式

- 不照搬 Git 的大型有序 shell 脚本。它的兼容性价值很高，但隐式共享状态不适合作为 NiceEval 的新测试设施。
- 不把 Cargo 或 pnpm 的广泛 snapshot 当默认 oracle。结构化契约优先做字段级断言，golden 只拥有稳定的人类文本。
- 不采用 Deno 式通用 flaky retry 作为产品失败补丁。只允许基础设施错误的有界重试，并保留每次 attempt。
- 不长期保留 pnpm 的 Rust/TypeScript 双测试栈。迁移期重复是成本，不是测试架构目标。
- 不采用 OpenTofu 在 release binary 模式运行时再编译协议进程的做法。候选及辅助进程应在 lane 开始前成为完整 artifact set。
- 不把 kubectl 的 privileged Docker、云集群和版本偏斜矩阵复制到每个 PR。只有真实服务独有的风险才进入 live lane。
- 不以 Docker 启动成功、网络请求成功或 exit 0 代替 adapter 语义证明。

## 建议父 agent 后续修改的位置

本研究不直接修改下列契约或示例。父 agent 可按所有权逐项裁决，再在独立任务中落地。

| 位置 | 建议 |
|---|---|
| `docs/roadmap/testing/architecture.md` | 补全 ProcessResult、ControlledProcess、timeout、进程树、子进程变量清洗、redaction、assertion ledger 与错误聚合 |
| `docs/roadmap/testing/e2e/scenario-repos.md` | 定义机器可读 `CandidateReceipt`，包含包路径、digest、安装位置、入口与报告版本 |
| `docs/roadmap/testing/e2e/execution.md` | 定义 `OwnedResource` 与 `CleanupReceipt`，并规定 lane preflight 和禁止静默 skip |
| `docs/roadmap/testing/portfolio.md` | 为每条风险补唯一 owner、wiring、排除 lane、删除条件和历史 bug 证据 |
| `docs/roadmap/testing/example/README.md` | 每个场景只保留一个 canonical repo，索引只链接而不复制测试正文 |
| 各 scenario Repo 的 `test/support/process.ts` | 先让每个例子明确返回可控子进程、分离流、强制 timeout、终止进程树并等待退出；契约稳定后再抽到根 runner，不预建大而全的共享命令执行器 |
| 根 runner 的 server / resource support | readiness 与 shutdown 都要有 deadline；stop 后验证 PID 消失和端口可重新绑定，并以普通 TypeScript API 供 Vitest 与 Playwright Test 复用 |
| CommonJS package example | 改成真实叶子 consumer repo，安装候选 tarball 并验证 receipt，禁止 workspace/source import |
| lifecycle example | 保存 ChildProcess handle 与 run ID，等待 backend 退出，并在后续 smoke 重获同一端口或资源名 |
| Journey example | 先读取并验证 href 与持久化事实，再点击页面；测试 `view` server 时另验证 HTTP readiness，cleanup 失败与 journey 失败一并报告 |

## 给父 agent 的交接

这次研究最重要的学习是：高质量 E2E 的核心不是“更真实”三个字，而是可审计的候选身份、真实协议、独立 oracle 和可证明的资源回收。

父 agent 接下来应先验收上述事实链接，再决定哪些推断进入 Roadmap。优先级应是 Process contract、cleanup receipt、candidate receipt 与唯一 canonical example。

这四项会同时降低 false green、泄漏和示例漂移。矩阵扩容、Docker 或更多 live provider 应放在这些共享能力之后。
