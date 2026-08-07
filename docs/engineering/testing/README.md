# 测试体系

niceeval 的测试体系采用“真实场景 Repo + 原生结果断言”。
本目录是仓库测试机制的唯一正式入口，不再维护并行的 Roadmap、候选方案或代码原型。

## 目标

新体系同时优化四件事：

- **测结果**：从公开 Library、安装后的 CLI、HTTP、浏览器或真实 adapter 协议进入，断言用户拿到的结果；
- **能定位**：短测试只跨一条公开边界，Journey 在每个跨域接缝检查，失败报告标出阶段和原始收据；
- **易阅读**：命令、动作、独立预期和历史 bug 引用留在同一个原生测试文件；
- **少跟改**：内部 DTO、DOM class 或候选算法变化不能迫使无关结果测试同步改写。

真实场景 Repo 是表现和运行手段，不是新的测试语义。它就是一个普通用户项目，含自己的
`package.json`、lockfile、NiceEval 依赖、config、Eval、Experiment、Report、服务和测试。
测试仍然要明确执行 `pnpm exec niceeval exp/show/view` 并断言过程与结果，不能用“这个 repo 跑过了”代替测试命题。

功能测试与 Adapter 测试使用两组不同 Repo。CLI、Runner、Report、Package 与 Lifecycle 使用自己的确定性消费项目；
`adapter/` 是兼容性 collection。AI SDK、Codex CLI、Claude Code、OpenCode、Bub 与本地协议 fixture 都是独立叶子 Repo，
各自安装候选包并拥有结果根。两组只共用根 runner 与机械 Testkit，不互借 fixture、依赖或运行结果。

## 两层与两种 E2E 体裁

目录只使用业界已有的两个执行层名称，不再增加 `Mechanism` 或 `Result` 这种项目内分类：

| 层 | 证明什么 | 典型位置 |
|---|---|---|
| Unit | 纯计算、schema、错误分类、可控竞态和确定性状态变化 | 根仓库 unit |
| E2E | 安装后的候选包经过真实公开边界后交付的用户结果 | 独立场景 Repo |

E2E 再按流程范围选择两种写法：单边界 E2E 只承诺一个公开结果；Journey E2E 串起多个产品域，逐接缝检查并断言终态。
`Journey` 是测试体裁，不是第三层。`Result` 已是 NiceEval 产品里的领域名，不再同时拿来命名测试类型。

另一条轴只回答“哪个产品域负责”：CLI、Report、Package、Runner、Adapter、Sandbox / Lifecycle。
目录按执行层和产品域找 owner，文件名按可观察行为命名，测试标题写长期结果。

## 分层裁决

| 风险 | 最早且完整的证明边界 | 示例 |
|---|---|---|
| 公式、选择、聚合、schema | Unit | Report 聚合口径、fingerprint 输入矩阵 |
| lock、retry、clock、并发限制 | barrier / fake clock Unit | backoff 期间不释放并发槽 |
| 安装、exports、外部 cwd、CJS / ESM | Package 场景 Repo | `init → list` 在 CommonJS 项目可用 |
| argv、pipe、PTY、exit、机器输出 | CLI 场景 Repo | `show --json` 经 pipe 不截断 |
| show / view、导出、HTTP、浏览器动作 | Report 场景 Repo | 导出 target 可达且打开正确实体 |
| SDK / CLI / provider 兼容性 | 对应 Adapter 场景 Repo | 真实工具事件读回规范身份 |
| 跨域完整目标 | 最终结果 owner 的 Journey 测试文件 | Report Repo 中初始化、运行、定位失败、导出报告 |
| signal、teardown、orphan | Lifecycle 场景 Repo | 中断后无孤儿且下一次运行可用 |

一条风险只在一个位置展开完整矩阵。其它层只有在能排除不同错误实现时才留一个接线代表，不能把同一场景换成
human、JSON、DOM 和 snapshot 各测一遍。

## 测试正文约束

- 单边界 E2E 的一个 `test()` 只承诺一个用户可观察结果；Journey E2E 的一个 `test()` 只承诺一个完整用户目标。
- 完整 argv 留在调用点；允许 `runProcess()` 隐藏 spawn 细节，不允许 `runScenario("report")` 隐藏用户动作。
- 预期来自公开契约、签入 fixture 或测试中字面量，不能从候选包枚举、解码后再生成自己的 expected。
- 结构化输出先 parse，再按稳定身份比较；只有短且逐字承诺的反馈使用 golden。
- 浏览器沿页面真实 `href` 断言 URL、HTTP、产品已声明的可访问身份和可见结果，不拼 target 路径，也不臆造不存在的
  role / label；不稳定能力先记产品缺口。
- 每条测试先归属稳定 Feature；历史回归再写 `regression: memory/<条目>.md`，标题仍描述长期结果。新 case 必须能杀死旧实现。
- 复用设施只拥有临时目录、进程、server、parser、artifact 和 cleanup 等机械能力；浏览器生命周期默认交给 Playwright Test。

## 失败怎样定位

E2E 不承诺指出生产源码行，但要把问题收窄到最近的公开接缝：

1. `prepare`：项目、依赖、fixture、Docker service 或 secret 未就绪；
2. `invoke`：安装后的命令、HTTP 请求或浏览器动作没执行成功；
3. `observe`：stdout、JSON、HTML、协议事件或 artifact 不可读；
4. `outcome`：观察合法，但用户结果错误；
5. `cleanup`：进程、容器、sandbox 或临时目录未释放。

单边界 E2E 用于指出坏在哪条公开边界，Journey E2E 用最近检查点指出坏在哪个域间接缝；需要源码级区分力时，
再配一条最小 Unit。禁止为了定位在产品里加入测试专用探针。

## 本地与 GitHub CI

本地与 CI 共用根入口和同一个候选 tarball 注入链：

```sh
pnpm e2e --lane pr
pnpm e2e --repo report
pnpm e2e --repo report -- --run test/exported-targets.test.ts
pnpm e2e --lane main --repo adapter/codex-cli
```

- PR lane 无密钥，运行 unit、CLI、Runner、Report、Package 与确定性 host / Docker Repo；
- main 跑 PR 全集和低成本真实 Adapter 兼容性检查；nightly 跑完整 Adapter、Sandbox 与 Lifecycle；
- release 先生成最终 tarball，验收通过后发布同一字节与 digest；
- workflow 只负责 checkout、运行时、矩阵、cache 和 artifact，选择、注入、executor、重试和失败分类都在根 runner；
- 不使用 `pull_request_target` 执行 PR 代码并读取 secret。

完整执行契约见 [本地与 CI](e2e/execution.md)。

## 文档地图

- [Architecture](architecture.md) —— 数据流、分类、oracle、失败与复用设施边界；
- [官方 Testkit](testkit.md) —— 跨 Repo 的进程、严格数据解码、等待与资源终结原语；
- [测试组合与退役](portfolio.md) —— owner、矩阵去重、历史 bug 与迁移规则；
- [Unit](unit/README.md) —— 确定性语义测试的存在资格和写法；
- [E2E](e2e/README.md) —— 单边界测试、Journey、Adapter 与 Lifecycle；
- [E2E 测试正文](e2e/authoring.md) —— 原生测试文件、命令收据、阶段、失败分类与浏览器写法；
- [真实场景 Repo](e2e/scenario-repos.md) —— 项目形状、候选注入、隔离和 adapter backend；
- [本地与 CI](e2e/execution.md) —— host / Docker、lane、Actions、release 与 artifact；
- [测试跟改率](churn.md) —— 用历史读数识别绑定实现细节的测试；
- [`unit/<feature>.md`](unit/README.md#feature-测试文档) —— Unit 覆盖类别、Fixture 与矩阵 owner；
- [`e2e/adapter/`](e2e/adapter/README.md)、[CLI](e2e/cli.md)、[Record](e2e/record.md)、[Report](e2e/report.md) —— 各域的长期结果 owner。

历史缺陷的现象、根因与反直觉修法只留在 [`memory/`](../../../memory/INDEX.md)。
正式测试义务只由本目录的 owner 文档与对应产品契约定义。

## 目标闭包

- 根 runner 生成并核对唯一待测 tarball；每个场景 Repo 在隔离副本安装同一 artifact，并保留原始进程收据和单文件重跑入口。
- 场景 Repo 精确锁定稳定 Testkit；产品 gate 只注入 NiceEval candidate，不让外层裁判与被测对象一起变化。
- JSON pipe、CommonJS package 与 Adapter 工具身份各有能杀死对应旧错误的 owner。
- Report 单边界 E2E 只读消费证据；会修改配置、结果或服务的流程拥有私有项目副本与结果根。
- Journey E2E 跨 CLI、Report 等产品域，并在每个公开接缝立即检查身份与结果。
- PR、main、nightly 与 release lane 共用同一发现、注入、执行、分类和 artifact 协议。
- 新 owner 通过公开契约、历史错误 kill 与单项重跑后接管，同批删除被替代 owner，不长期保留双份体系。
