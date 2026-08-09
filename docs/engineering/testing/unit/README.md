# 单元测试 —— 从功能契约到可执行证明

这篇定义 niceeval 仓库怎样设计单元测试。
单元测试的输入是已经定稿的功能与架构契约，目标是在不依赖真实 Agent、真实 Sandbox 或完整 CLI 进程的前提下，证明这些契约中的行为、不变量和失败语义。

- 体系分层、运行契约（速度与依赖预算）、变更预算和操作卡在 [测试体系总览](../README.md)。
- [`docs/feature/`](../../../feature/README.md) 定义产品是什么、用户怎样使用以及系统必须保持哪些不变量。
- [Source Map](../../../source-map.md) 把契约定位到实现；源码目录和导出函数不是测试需求的出处。
- 本篇定义怎样把契约变成测试，以及怎样选择最小而稳定的测试边界。
- 真实安装、进程、网络、模型和 Sandbox 的全链路验证属于 [E2E CI](../e2e/README.md)。

运行时测试可直接运行 Vitest 的 `unit` project，类型契约测试由 `pnpm run typecheck` 承担；文档守护位于 `lint/`，分别由 `pnpm lint:docs` 与 `pnpm lint:docs-site` 执行（见[套件边界与仓库守护](#套件边界与仓库守护)）。

单元层的观察面是**数据**：输入数据到输出数据的确定性语义。
渲染输出（终端排版、DOM 结构、Run、样式）、CLI 进程行为与真实协议路径不属于本层，一律归 E2E 功能仓库——边界全文见[测试体系总纲](../README.md#单元层的边界)。

## 核心判据

测试的默认答案是**不写**。
每条测试都是负债：契约一动它要跟着动（变更预算税）、评审要读它、套件每次都要跑它；只有一种收益能抵掉这笔税——删掉它会放走一类具体错误。
一条测试的存在权靠回答两个问题赢得：

1. 它证明了哪一条已声明的功能契约或仓库约束？
   ——并且能指认对应 Feature 测试文档「证明范围规范」里的哪条类别（见[证明范围登记](registry.md)）。
2. 删除它以后，哪一种错误可能无声进入发布？

答案含糊时默认删，不默认保留。
涉及范围、函数数量和实现行数可以帮助发现盲区，但不能决定测试是否充分。

单元不是函数。**
单元是能够独立证明一条契约的最小稳定行为边界。**
 一条契约可以由一个纯函数证明，也可能必须经过 collector、状态机或一组协作对象才能被观察。
反过来，一个函数有多个导出或被拆成多个公共函数，并不产生新的测试义务。

测试的稳定性遵循[变更预算](../README.md)：实现重构不改契约时任何测试都不应变红，变红的测试锁定了实现细节，按缺陷改写。

## 从契约得到测试

设计测试时按下面顺序工作：

1. 从对应 Feature 的 Library、CLI 或 Architecture 页面选出一条行为或不变量。
2. 确认它属于对应 Feature 测试文档「证明范围规范」已声明的类别——正常流程里证明类别在设计阶段已随契约同批定稿；没有的先补条目、按契约影响面评审，再动手（流程与预算见[证明范围登记](registry.md)）。
3. 写清输入、可观察结果、失败反馈以及不能发生的静默错误。
4. 通过 [Source Map](../../../source-map.md) 找到实现该契约的边界。
5. 选择能完整观察该契约的最低层级；只有下层不能证明时才升到组件或集成边界。
6. 证明会改变语义的等价类、边界值和状态组合，不按实现分支机械补 case；数量以区分力为界（见[证明范围登记](registry.md)）。
7. 测试名描述契约和场景，不描述私有辅助函数或实现步骤。

Feature 文档是语义的唯一出处。
测试可以用表格或 fixture 展开 case，但不在测试里重新发明一份与文档不同的规则。

## 测试分层

层级表示证明契约所需的边界，不表示固定的目录，也不是所有功能都必须经过每一层。

| 层                 | 证明什么                                                    | 常用形态                                    |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------- |
| **领域规则**       | 输入到输出的确定语义、优先级、阈值和不变量                  | 表驱动测试、边界值、性质测试                |
| **组件协作**       | collector、状态机、调度器和生命周期中多个对象共同形成的行为 | 内存 fake、受控时钟、受控信号、组件级入口   |
| **边界归一**       | 落盘格式与第三方文件怎样进入 niceeval 的标准模型            | 脱敏真实 fixture、畸形输入                  |
| **公共组合**       | 用户可见 API、类型能力和主要组合方式能够表达 Feature 契约   | 公共子路径 import、编译 fixture、窄集成测试 |
| **结果与计算口径** | 选择、去重、聚合、格式化与装载校验的数据语义                | 数据级断言、宿主装载等价测试                |
| **仓库守护**       | 索引、链接、生成区块和测试收集范围等仓库约束                | `test/` 下的 Vitest 守护                    |

测试预算由静默错误的影响和发现难度决定，而不是按层平均分配。
判定、证据归一、缓存、调度、结果选择和读数聚合都可能给出看似合理但错误的答案，应得到更强的组合与边界证明。
渲染输出不在本层断言（归 [E2E 功能域](../e2e/report.md)），但 Reports 的计算口径与装载语义仍是高风险面，不因"展示层"标签薄测。

## Fake 边界：mock 什么，测哪一层

每个 Feature 的单元测试都站在一条**缝**上：缝上面的逻辑是被测对象，缝下面用两种手段之一替代——**构造输入数据**（证据图、Record 图、落盘树：没有替身，只有受控输入），或 **fake 自有稳定接口**（Agent、Sandbox、Reporter、judge 传输、时钟）。
这条缝的选择有一条硬规则：

- **fake 只发生在 niceeval 自己声明的契约接口上。**
   自有接口要漂移只能是我们自己改契约，fake 不会静默失真。
- **外部协议接口从不 fake。**
   别人的协议是会漂移的外部事实，fake 它只能证明"与自己采的样本一致"——协议归 [E2E 适配器域](../e2e/adapter/README.md)的真实运行。
- **外部基础设施不 fake，用隔离的真实实例。**
   文件系统用每例独立的临时目录，不 mock fs。

每条缝的真实侧由对应 E2E 域验收；unit 证明缝上面的逻辑在整个输入空间上正确，E2E 证明缝接进真实世界是通的，两层合起来才是完整证明：

| 测试文档                                       | 被测逻辑（缝上面）                                                        | fake / 构造（缝下面）                                                | 缝的真实侧验收                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [eval.md](eval.md)                             | Context、session、HITL、能力边界                                          | scripted Agent 与 recording Sandbox（自有 `Agent` / `Sandbox` 接口） | [e2e/adapter](../e2e/adapter/README.md)：真实 Agent 走同一条 Context 链      |
| [experiments-runner.md](experiments-runner.md) | 调度、缓存、Sandbox 生命周期、budget、退出码折叠                          | fake Agent / Sandbox / Reporter、受控时钟与 barrier                  | [e2e/cli](../e2e/cli.md)：真实进程与真实 attempt 下同一批行为                |
| [assertions.md](assertions.md) | matcher、collector、scope、judge、verdict | 构造的证据图（`AssertionEvaluationContext`）；judge 只 fake 传输层（截获 fetch） | [e2e/adapter](../e2e/adapter/README.md)：真实证据上判定一致、真实裁判模型 |
| [sandbox.md](sandbox.md)                       | provider 之上的共同逻辑：路径、IO/provision 重试、生命周期编排、diff 归因、主 Sandbox 实例及伴随资源 | 内存 provider 实现自有 `Sandbox` 接口                                | [e2e --group sandbox](../e2e/README.md)：真实 provider 跑同一 contract suite |
| [adapters.md](adapters.md)                     | Agent ensure 循环、身份 / staged payload digest、断网义务、复用与 environment 隔离 | 脚本化安装层 + recording Sandbox（自有接口）                   | [e2e/adapter](../e2e/adapter/README.md)：真实 Agent CLI 安装与探测           |
| [record.md](record.md)                         | 提交 / 读取、身份与 locator、闭包与完整性、receipt、mirror / export、开放 timing activity | 不 fake：构造数据 + 每例独立的真实临时目录                           | [e2e/report](../e2e/report.md)：真实运行的提交与读回                         |

| [reports.md](reports.md)                       | 数据源 `compute()`、装载、树解码                                          | 构造的 Sample / evidence fixture                                      | [e2e/report](../e2e/report.md)：真实输出上的出口与渲染                       |

## Feature 测试文档

每个 Feature 一篇文档，写的是**体系与规范，不是场景列举**，固定四段：

- **观察面与边界**：从哪里观察、为什么选这个边界。
- **Fixture 规范**：用什么形状的输入、构造纪律与区分力要求；示例代码演示怎么做。
- **证明范围规范**：登记 Feature 契约的测试影响面。
  按契约域声明必须证明的行为，以及不能静默放走的错误。
  它也是新增测试的准入条件，规则见[证明范围登记](registry.md)。
  契约变化时，用它核对哪些测试应该修改；评审测试时，用它检查影响面是否越界。
  具体场景由测试代码和测试名枚举，文档不复述。
- **不这样测**：该 Feature 特有的反模式。

| Feature                                                                               | 首要证明                                                              | 测试文档                                       |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| [Eval](../../../feature/eval/README.md)                                               | `defineEval`、context、session 和 turn 的用户语义；能力不可用时的反馈 | [eval.md](eval.md)                             |
| [Experiments](../../../feature/experiments/README.md)、[Sandbox 生命周期](../../../feature/sandbox/lifecycle.md) 与 [Runner](../../../runner.md) | runs 展开、有界并发、生命周期连续性、early exit、budget、缓存与退出码折叠 | [experiments-runner.md](experiments-runner.md) |
| [Sandbox](../../../feature/sandbox/README.md)                                         | 生命周期、路径边界、命令结果、diff、cleanup 与 Sandbox 实例语义          | [sandbox.md](sandbox.md)                       |
| [Adapters](../../../feature/adapters/README.md)（Agent Ensure）                        | Ensure 状态机、Agent / artifact 身份、断网义务、复用与 environment 隔离        | [adapters.md](adapters.md)                     |
| [Assertions](../../../feature/assertions/README.md) | matcher、scope、collector、evidence、Coverage 和 Verdict 形成一致判定 | [assertions.md](assertions.md) |
| [Record](../../../feature/record/README.md)                                          | artifact round-trip、身份、开放 timing、`configHash` 与发布自包含     | [record.md](record.md)                         |

| [Reports](../../../feature/reports/README.md)                                         | 读数与聚合口径正确；装载、树解码与校验反馈完整                      | [reports.md](reports.md)                       |

SDK 事件转换与协议归一没有单元层测试维度——协议的真身只有真实调用，wire fixture 是协议的二手复制、会随上游版本漂移，协议正确性的唯一验收面是 [E2E 适配器域](../e2e/adapter/README.md)的真实运行。
Adapter 侧确定性逻辑（Agent Ensure）登记在 [adapters.md](adapters.md)；归一之后与协议无关的派生（成本估算、执行树投影）登记在 [reports.md](reports.md) / [record.md](record.md)。

一条跨 Feature 契约可以在拥有完整观察面的边界测试一次，再由各 Feature 的领域规则测试补足独立失败模式。
不要为了让每个源码目录都有测试而重复完整流程。

测试文档与 Feature 契约同批维护：契约变了先重写 `docs/feature/` 受影响小节，同批更新对应测试文档的证明范围规范，再改测试代码——顺序与"先文档后代码"一致。
证明范围规范声明"必须证明哪些类别的行为"，不登记`实现进度`。

示例中的 `fixture`、`harness`、`make*` 和 `run*` 是测试侧构造器，不是新增的产品 API；它们的所有权与稳定性契约见 [Harness](harness.md)。
实际测试通过 Source Map 选择当前实现入口。

## 类型契约

niceeval 是 TypeScript 库，类型推断和非法组合也是公共契约。
类型测试由 `pnpm run typecheck` 验证，可以使用编译 fixture 和 `@ts-expect-error` 表达：

- 公共子路径能够独立导入。
- capability 决定可用 API 的形状。
- 合法用户代码保持正确推断。
- 文档明确禁止的组合不能编译。

类型测试不冒充运行时行为测试；运行时序列化、额外字段、错误消息和数据归一仍需 Vitest 断言。

## 无意义或脆弱的 unit

以下测试没有证明产品契约，或者选择了错误的观察面，应删除或改写：

- **每个导出函数都直接测。**
   导出数量是实现形状，不是契约数量；改为测试该导出参与实现的行为。
- **Mock 返回什么就断言什么。**
   `mockResolvedValue(x)` 后只验证结果等于 `x`，没有证明转换、状态或失败语义。
- **复刻生产算法。**
   在 fixture 或 fake 里复制实现，再比较两份相同算法的输出，只能发现两边没有同步修改。
- **锁定私有调用步骤。**
   在契约只要求最终结果时断言辅助函数调用次数和顺序，会把重构当回归。
- **grep 局部源码文本。**
   匹配函数名、变量名或某段实现文本属于脆弱的实现检查；架构边界应通过 import 图、类型或可观察行为守护。
- **替第三方库证明基本能力。**
   不测试 `JSON.parse` 会解码、哈希库能返回字符串或 SDK 构造器能构造；只测试 niceeval 对它们的参数、错误和结果语义。
- **断言渲染输出。**
   终端排版、DOM 结构与 Run 锁定的是呈现而不是语义，实现每次调整都让它们变红；渲染面归 [E2E 功能域](../e2e/report.md)对真实输出验收。
- **把类型检查当运行时证明。**
   TypeScript 不保证 JSON 没有额外字段，也不保证 parser、序列化和错误反馈正确。
- **只为命中率穿过分支。**
   如果测试名无法写出 Feature 场景和错误模式，命中分支本身没有价值。

同一不变量可以在不同故障边界各验证一次，例如领域规则和公共组合——前提是两处各自写明自己放走的错误类别不同（预算规则见[证明范围登记](registry.md)）；写不出不同的错误类别，就只保留一处。

## 套件边界与仓库守护

套件按**验证对象**分成三个 Vitest project，每个 project 一个入口命令，成员资格由目录决定：

| project          | 验证对象           | 入口                                  | 收哪些文件                                      |
| ---------------- | ------------------ | ------------------------------------- | ----------------------------------------------- |
| `unit`           | 代码               | `pnpm exec vitest run --project unit` | `src/**/*.test.ts(x)` 与 `test/unit/**`         |
| `lint-docs`      | `docs/`、`memory/` | `pnpm lint:docs`                      | `lint/docs/**`                                  |
| `lint-docs-site` | `docs-site/`       | `pnpm lint:docs-site`                 | `lint/docs-site/**`，命令里再串 Mint 两步校验   |

三个 include 互不重叠且按仓库根锚定，新增守护文件放进哪个目录就归哪个入口——不存在「三个 project 谁都没收它、于是永远不跑」的静默失效。
`docs-site` 入口把 `docs:validate`、`docs:links` 串在 Vitest 之后：mint CLI 要 LTS Node 且每次拉 `mint@latest`，放进代码侧入口会给全部单测强加网络依赖。

Vitest 只收本仓库自己的测试。
`vitest.config.ts` 的 `exclude` 作为第二层排除规则，包含：

- `.repos/**`：vendored 外部仓库。
- `.claude/**`：Agent 临时 worktree 中的源码和测试副本。
- `e2e/adapter/**`、`e2e/cli/**`、`e2e/report/**`：拥有独立执行入口的 E2E 仓库。
- `e2e/undo/**`：尚无完整官方 Agent 工厂、暂停执行的 E2E fixture。

临时 worktree 副本会使用过期源码产生与当前提交无关的结果，详见 [`vitest-collects-agent-worktree-copies`](../../../../memory/vitest-collects-agent-worktree-copies.md)。
每个入口收集到的文件数应等于它那几个 include 目录下测试文件的实际数量。

索引涵盖、链接真实性、生成区块漂移和其它仓库约束写成 `test/` 下的 Vitest 测试，复用上面三个入口，不新增脚本或 hook。
这些测试同样必须指出自己守护的具体约束，以及删除后会发生的静默腐坏。

判对错与写输出按这条线切开：**说红绿的一律是 Vitest，写文件的才是脚本**。
一个脚本同时干这两件事时（`sync-tiers.mjs` 的 sync/check、`docs-writing-lint.ts` 的检查/更新存量上限），检查那一半导出成不打印、不退出的纯函数，由对应 project 的测试调用；生成那一半保留命令行。
带**待清除存量上限**的守护用两条断言表达：先判回归，数字变大即失败；再把实测结果与磁盘文件做快照比对，收紧交给 `vitest -u`。
顺序不能反：回归断言在前，更新模式才写不进一个被放宽的数字。

一条约束只能有一个入口说它红。
同一个检查既能由脚本判、又能由测试判时，两边迟早给出不同判定，而人只会记得跑其中一条。

测试文档归属也在守护范围内：`src/` 下每个测试文件头部用一行注释声明所属文档（`// cases: docs/engineering/testing/unit/<feature>.md`）。`test/` 下的守护测试校验两个方向：每条声明指向真实存在的测试文档；每篇 Feature 测试文档至少被一个测试文件声明。
`test/` 下的仓库守护测试没有 Feature 文档可指，不做此声明，它们的登记面就是自己守护的那条仓库约束（写明在文件头注释里）。
机器守护只保证测试文档与套件不整册脱钩；类别级的影响面核对仍是评审对照证明范围规范的义务。
