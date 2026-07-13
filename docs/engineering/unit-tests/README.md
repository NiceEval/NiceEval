# 单元测试 —— 从功能契约到可执行证明

这篇定义 niceeval 仓库怎样设计单元测试。单元测试的输入是已经定稿的功能与架构契约，目标是在不依赖真实 Agent、真实 Sandbox 或完整 CLI 进程的前提下，证明这些契约中的行为、不变量和失败语义。

- [`docs/feature/`](../../feature/README.md) 定义产品是什么、用户怎样使用以及系统必须保持哪些不变量。
- [Source Map](../../source-map.md) 把契约定位到实现；源码目录和导出函数不是测试需求的来源。
- 本篇定义怎样把契约变成测试，以及怎样选择最小而稳定的测试边界。
- 真实安装、进程、网络和 Sandbox 的全链路验证属于 [E2E CI](../e2e-ci/README.md)。

运行时测试、类型契约测试和仓库守护分别由 `pnpm test`、`pnpm run typecheck` 和挂在 `pnpm test` 下的 `test/` 守护测试承担。

## 核心判据

一条测试应能回答两个问题：

1. 它证明了哪一条已声明的功能契约或仓库约束？
2. 删除它以后，哪一种错误可能无声进入发布？

答不出具体契约或错误模式的测试不应存在。覆盖率、函数数量和实现行数可以帮助发现盲区，但不能决定测试是否充分。

单元不是函数。**单元是能够独立证明一条契约的最小稳定行为边界。** 一条契约可以由一个纯函数证明，也可能必须经过 collector、状态机或一组协作对象才能被观察。反过来，一个函数有多个导出或被拆成多个 helper，并不产生新的测试义务。

## 从契约得到测试

设计测试时按下面顺序工作：

1. 从对应 Feature 的 Library、CLI 或 Architecture 页面选出一条行为或不变量。
2. 写清输入、可观察结果、失败反馈以及不能发生的静默错误。
3. 通过 [Source Map](../../source-map.md) 找到实现该契约的边界。
4. 选择能完整观察该契约的最低层级；只有下层不能证明时才升到组件或集成边界。
5. 覆盖会改变语义的等价类、边界值和状态组合，不按实现分支机械补 case。
6. 测试名描述契约和场景，不描述私有 helper 或实现步骤。

Feature 文档是语义的唯一来源。测试可以用表格或 fixture 展开 case，但不在测试里重新发明一份与文档不同的规则。

## 测试分层

层级表示证明契约所需的边界，不表示固定的目录，也不是所有功能都必须经过每一层。

| 层 | 证明什么 | 常用形态 |
|---|---|---|
| **领域规则** | 输入到输出的确定语义、优先级、阈值和不变量 | 表驱动测试、边界值、性质测试 |
| **组件协作** | collector、状态机、调度器和生命周期中多个对象共同形成的行为 | 内存 fake、受控时钟、受控信号、组件级入口 |
| **边界归一** | 外部 SDK、CLI、OTLP 或文件格式怎样进入 niceeval 的标准模型 | 脱敏真实 fixture、契约矩阵、畸形输入 |
| **公共组合** | 用户可见 API、类型能力和主要组合方式能够表达 Feature 契约 | 公共子路径 import、编译 fixture、窄集成测试 |
| **结果与呈现** | 选择、去重、聚合和渲染没有改变结果语义 | 数据级断言、宿主等价测试、少量稳定快照 |
| **仓库守护** | 索引、链接、生成区块和测试收集范围等仓库约束 | `test/` 下的 Vitest 守护 |

测试预算由静默错误的影响和发现难度决定，而不是按层平均分配。判定、证据归一、缓存、调度、结果选择和指标聚合都可能给出看似合理但错误的答案，应得到更强的组合与边界覆盖。排版细节通常可以薄测，但不能因此把整个 Reports 功能视为低风险展示层。

## 按 Feature 设计测试

每次功能设计变化，都从对应入口重新核对测试，而不是按 `src/` 目录扫导出函数。

| Feature | 首要证明 | 合适的测试边界 |
|---|---|---|
| [Eval](../../feature/eval/README.md) | `defineEval`、context、session 和 turn 的用户语义；能力不可用时的反馈 | 公共 API 组合、context 组件、类型契约 |
| [Experiments](../../feature/experiments/README.md) 与 [Runner](../../runner.md) | runs 展开、有界并发、early exit、budget、重试、缓存与 carry/resume | 受控 attempt 驱动器、fake Agent/Sandbox、虚拟时钟与信号 |
| [Adapters](../../feature/adapters/README.md) | 外部事件被无损映射为标准事件；session、usage 和证据完整性不被伪造 | 脱敏真实 payload、协议状态序列、畸形与缺失字段 |
| [Sandbox](../../feature/sandbox/README.md) | 生命周期、路径边界、命令结果、diff 和清理语义 | fake provider、临时目录、资源获取与释放测试 |
| [Scoring](../../feature/scoring/README.md) | matcher、scope、collector、evidence、severity 和 Verdict 形成一致判定 | 领域规则、组件协作、公共 API 组合 |
| [Results](../../feature/results/README.md) | artifact round-trip、身份、选择、去重和历史合成语义 | 内存/临时文件存储、表驱动选择矩阵 |
| [Reports](../../feature/reports/README.md) | 指标与聚合结果正确；text/web 宿主表达同一语义 | 计算结果断言、双宿主等价、窄快照 |

一条跨 Feature 契约可以在拥有完整观察面的边界测试一次，再由各 Feature 的领域规则测试补足独立失败模式。不要为了让每个源码目录都有测试而重复完整流程。

## Feature 测试示例

下面各页把本篇的方法展开成代码。示例中的 `fixture`、`harness`、`make*` 和 `run*` 是测试侧构造器，不是新增的产品 API；实际测试通过 Source Map 选择当前实现入口。

| Feature | 示例页 |
|---|---|
| Eval 与 Context | [eval.md](eval.md) |
| Experiments 与 Runner | [experiments-runner.md](experiments-runner.md) |
| Adapters 与协议归一 | [adapters.md](adapters.md) |
| Sandbox 与资源生命周期 | [sandbox.md](sandbox.md) |
| Scoring 与断言 | [scoring.md](scoring.md) |
| Results 与落盘选择 | [results.md](results.md) |
| Reports 与双面呈现 | [reports.md](reports.md) |

各示例页负责该 Feature 的 fixture 形状和测试代码，README 不重复定义。跨 Feature 的公共 fixture 只共享机械构造能力；场景输入和期望仍留在使用它的测试旁边，让读者能看到一条契约如何被证明。

## 类型契约

niceeval 是 TypeScript 库，类型推断和非法组合也是公共契约。类型测试由 `pnpm run typecheck` 验证，可以使用编译 fixture 和 `@ts-expect-error` 表达：

- 公共子路径能够独立导入。
- capability 决定可用 API 的形状。
- 合法用户代码保持正确推断。
- 文档明确禁止的组合不能编译。

类型测试不冒充运行时行为测试；运行时序列化、额外字段、错误消息和数据归一仍需 Vitest 断言。

## 无意义或脆弱的 unit

以下测试没有证明产品契约，或者选择了错误的观察面，应删除或改写：

- **每个导出函数都直接测。** 导出数量是实现形状，不是契约数量；改为测试该导出参与实现的行为。
- **Mock 返回什么就断言什么。** `mockResolvedValue(x)` 后只验证结果等于 `x`，没有覆盖转换、状态或失败语义。
- **复刻生产算法。** 在 fixture 或 fake 里复制实现，再比较两份相同算法的输出，只能发现两边没有同步修改。
- **锁定私有调用步骤。** 在契约只要求最终结果时断言 helper 调用次数和顺序，会把重构当回归。
- **grep 局部源码文本。** 匹配函数名、变量名或某段实现文本属于脆弱的实现检查；架构边界应通过 import 图、类型或可观察行为守护。
- **替第三方库证明基本能力。** 不测试 `JSON.parse` 会解析、哈希库能返回字符串或 SDK 构造器能构造；只测试 niceeval 对它们的参数、错误和结果语义。
- **巨大且不透明的 snapshot。** 评审者无法指出变化对应哪条契约时，snapshot 只是变更税。
- **把类型检查当运行时证明。** TypeScript 不保证 JSON 没有额外字段，也不保证 parser、序列化和错误反馈正确。
- **只为覆盖率穿过分支。** 如果测试名无法写出 Feature 场景和错误模式，命中分支本身没有价值。

同一不变量可以在不同故障边界各验证一次，例如领域规则和公共组合。是否重复取决于它们能否发现不同类别的错误，不按文件数量机械删除。

## 套件边界与仓库守护

Vitest 只收本仓库自己的测试。`vitest.config.ts` 的 `exclude` 必须排除：

- `.repos/**`：vendored 外部仓库。
- `.claude/**`：Agent 临时 worktree 中的源码和测试副本。

临时 worktree 副本会使用过期源码产生与当前提交无关的结果，详见 [`vitest-collects-agent-worktree-copies`](../../../memory/vitest-collects-agent-worktree-copies.md)。`pnpm test` 收集到的文件数应等于 `src/` 和 `test/` 下测试文件的实际数量。

索引覆盖、链接真实性、生成区块漂移和其它仓库约束写成 `test/` 下的 Vitest 测试，复用 `pnpm test`，不新增命令或 hook。这些测试同样必须指出自己守护的具体约束，以及删除后会发生的静默腐坏。
