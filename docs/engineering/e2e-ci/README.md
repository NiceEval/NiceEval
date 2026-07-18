# E2E CI

E2E 是[测试体系](../testing/README.md)的真实层：真实模型、真实协议、真实沙箱、真实安装与进程，没有离线档、mock 模式或替身分支——模型调用成本不构成设计约束，费用与时长由每个仓库自己的 Experiment 档位（模型、runs、budget、timeout）控制。

niceeval 的 E2E 以**独立测试仓库**为执行与所有权边界。每个测试仓库都包含自己的被测应用、Agent adapter、Eval、Experiment、依赖锁文件、启动脚本和验收脚本；不同仓库之间不共享 Eval factory、profile、应用进程或结果读取代码。

根仓库只编排这些仓库：构建当前 niceeval 候选包、选择测试仓库、逐个隔离运行并汇总结果。它不理解某个仓库应该发现多少条 Eval、工具名是什么，也不递归猜测 `.niceeval/` 的内部布局。

这条边界让同一个测试仓库可以被三种执行器用同一条命令运行：开发者本机、GitHub Actions，以及同步该仓库后远程执行命令的 crabbox。

本篇定义所有仓库共用的执行与编排协议。每个仓库**测什么、断言什么**按验收域分篇：

- [适配器域](adapters/README.md)——每个官方适配器一个仓库、一篇 E2E 评估计划。
- [报告域](report.md)——`results-contract` 仓库：落盘格式与公开读取面。
- [CLI 域](cli.md)——`cli-contract` 仓库：选择、退出码折叠与缓存复用。

## 1. 设计目标

E2E CI 同时证明以下行为：

1. **真实仓库路径**：从安装 niceeval、启动被测应用、发现 `evals/` 与 `experiments/`、执行真实 Agent，到断言、评分、结果落盘和进程退出码，全部通过公开使用面完成。
2. **仓库自治**：一个测试仓库只依赖自己的签入内容、声明的外部服务与注入的 niceeval 候选包。删除其它测试仓库或把本仓库复制到独立 checkout，不改变它的行为。
3. **协议差异显式存在**：SDK 的工具命名、usage、HITL、会话和沙箱能力直接写在对应仓库的 Eval 中，不用共享 profile 把多个真实协议抽象成一套条件分支。
4. **正反路径可证**：支持某项能力的仓库同时验证正例和反例；退出码折叠的验证由 [CLI 域](cli.md)的 contract 仓库承担，其 deliberate-fail / deliberate-error 实验把预期非零退出转换为仓库级验收成功。
5. **可独立调度**：任意仓库都能以稳定 ID 被单独选择、设置超时、注入所需 secrets、上传自己的证据，并把原始退出状态交给本地、CI 或 crabbox。

## 2. 独立测试仓库

### 2.1 独立的含义

一个测试仓库满足以下约束：

- 有自己的 `package.json` 和 lockfile，不加入 niceeval 根 workspace；Python 等其它运行时同样在仓库内声明依赖。
- 有自己的 `niceeval.config.ts`、`agents/`、`evals/` 和 `experiments/`。
- 被测应用及其启动方式属于该仓库，不从中央 `apps/` 目录连接共享进程。
- 不 import 另一个测试仓库，也不 import niceeval 根仓中的 `e2e/shared`、`src/` 或测试辅助源码。
- 不使用指向父目录的 `file:` / `link:` 依赖。待测 niceeval 由执行器通过候选包注入。
- `.niceeval/`、服务日志和 JUnit 属于一次运行的临时证据，必须被 ignore，不得成为下一次运行的输入。
- 从父目录复制到一个临时目录后，仍能在只注入候选包和 secrets 的条件下执行。

“不共享”约束的是运行时代码和测试语义。仓库可以遵循同一份书面执行协议，也可以在创建时从模板复制初始骨架；复制后各仓库独立演进，不存在会同时改变整个矩阵行为的共享 factory。

### 2.2 仓库形状

每个仓库都是完整的用户项目，而不是只绑定共享定义的薄壳：

```text
<repo>/
  package.json
  pnpm-lock.yaml
  .gitignore
  .env.example
  e2e.json
  niceeval.config.ts

  src/                         # 被测应用；不需要服务的仓库可省略
  agents/                      # 本仓库的 adapter
  evals/                       # 本仓库拥有的 Eval
  experiments/                # 本仓库拥有的 Experiment

  scripts/
    e2e.ts                     # 唯一执行入口（tsx 执行）：准备、启动、运行、验收、清理
    verify.ts                  # 可选；只包含本仓库的可观察行为断言
```

例如 `claude-agent-sdk` 仓库直接在自己的天气 Eval 里断言 `mcp__demo-tools__get_weather`，`ai-sdk` 仓库直接断言 UI Message Stream 的裸工具名。两者即使覆盖相似场景，也各自拥有完整 Eval；重复是协议验收的证据，不是需要消除的代码坏味道。

### 2.3 仓库描述文件

`e2e.json` 只声明编排器运行本仓库所需的事实：

```json
{
  "id": "claude-agent-sdk",
  "group": "sdk",
  "command": ["pnpm", "e2e"],
  "timeoutMinutes": 20,
  "secrets": ["DEEPSEEK_API_KEY", "NICEEVAL_JUDGE_KEY"],
  "artifacts": [".niceeval/**", "junit.xml", "logs/**"],
  "requires": { "runtimes": ["node>=22"] }
}
```

字段契约如下：

| 字段 | 含义 |
|---|---|
| `id` | 全局稳定的仓库选择器，也是 CI / crabbox 任务名 |
| `group` | 调度分组：`sdk`、`sandbox`、`contract` |
| `command` | 在仓库根执行的唯一验收命令，不包含 secret 值 |
| `timeoutMinutes` | 仓库级硬超时；Experiment 自己仍声明 attempt timeout 与 budget |
| `secrets` | 所需环境变量名，用于 fail-fast 检查和最小授权 |
| `artifacts` | 成功或失败后可收集的仓库相对路径 |
| `requires` | 可选；执行环境需求：`runtimes`（如 `["node>=22", "python>=3.11"]`）、`docker`（布尔）、`arch`、`memoryGB`。执行器据此选择 GitHub Actions runner 与 crabbox provider/profile；缺省表示只需要 Node 运行时与出网 |

这里不声明 Eval 数、期望 verdict、端口或 `.niceeval` 文件名。前两者属于仓库自己的验收语义；端口属于仓库自己的进程生命周期；结果布局属于 niceeval 的 Results 契约。

## 3. 统一执行协议

### 3.1 唯一命令

每个仓库提供：

```sh
pnpm e2e
```

该命令独立完成：

1. 检查运行时、候选 niceeval 包和所需 secrets。
2. 安装依赖，并确保实际解析到的是注入的候选 niceeval，而不是 lockfile 中的基线版本。
3. 清理本仓库上一次运行的临时结果。
4. 启动本仓库拥有的服务并等待 readiness；无服务仓库跳过。
5. 以 `--force` 运行本仓库声明的 Experiment，并输出 JUnit。
6. 校验本仓库的预期退出码与可观察行为，并对新产出的结果执行 CLI 读回（见 4.3）。
7. 无论成功失败都终止服务；保留日志和 `.niceeval/` 供执行器收集。

调用方不需要知道先起哪个端口、运行几个 Experiment、哪一次 CLI 调用预期退出 1。`pnpm e2e` 的退出码就是该仓库的最终验收结论，并区分失败类别：

- `0`：契约符合预期。
- `75`（`EX_TEMPFAIL`）：基础设施故障——依赖安装失败、服务 readiness 超时、provider 返回 429/5xx 或网络错误导致 attempt errored、judge 服务不可达这类**能确证的外部故障**。
- 其它非零：回归，契约不符。

分类规则只有一条：能确证是外部故障才退 `75`，不能确证一律按回归退出——宁可误报回归，不可把回归漏报成环境问题。回归与基础设施故障都使该仓库判红，区别只在编排器的重试与汇总标注（见根仓库编排）。

这条命令同时就是**本机回路**：开发者注入真实 key 后单仓库直接跑，与 CI、crabbox 行为完全一致，不存在"本机用 mock、CI 用真的"的分叉。

### 3.2 候选 niceeval 注入

根仓库先把当前 checkout 构建成可安装的 npm tarball，并把 tarball 路径作为候选包交给每个测试仓库。候选包是测试仓库与 niceeval 源码之间唯一允许的代码连接。

注入机制满足以下规则：

- 测试仓库的 `package.json` 声明一个正常发布版本作为独立运行时的默认基线。
- 编排执行时，候选 tarball 覆盖该依赖，但不永久修改仓库 manifest 或 lockfile。
- 仓库在运行开头打印 `niceeval` 的解析路径与版本/producer 信息，供日志诊断；**核验义务在编排器**——注入方在仓库命令结束后核对实际解析到的包与候选 tarball 指纹，不一致的结果作废（见根仓库编排）。这项防线不靠每个仓库手写的脚本各自实现。独立 checkout 不注入候选时没有核验对象，测的就是 lockfile 锁定的发布版。
- tarball 必须包含与发布相同的入口、构建产物和 package metadata；E2E 不从 `src/` 相对导入来绕过打包边界。

因此，niceeval 根仓可以验证未发布的当前改动；一个独立 checkout 也可以不注入 tarball，直接验证它锁定的已发布版本。

### 3.3 secrets 与真实服务

测试仓库通过环境变量接收真实 provider 与 judge 凭据，`.env.example` 只列变量名和非秘密 base URL。执行器按 `e2e.json.secrets` 逐仓库最小化注入，不把整个矩阵的 secrets 暴露给每个仓库。

SDK 与沙箱适配仓库使用真实模型和真实协议，不新增只为 E2E 存在的 mock 分支。模型、runs、budget 和 timeout 由仓库自己的 Experiment 决定：PR 门禁使用便宜模型与小样本，nightly 仓库或 Experiment 承担更完整的模型与 provider 矩阵。

被测服务由仓库的 `scripts/e2e.ts` 启动和清理。中央 workflow 不维护全局端口表，也不并发共享长期服务；仓库可使用动态端口并通过自身环境传给 adapter。

## 4. 仓库内验收

### 4.1 验收责任

Eval 是被测输入，不等于仓库级测试结论。仓库自己的验收脚本负责：

- CLI 退出码是否符合该 Experiment 的预期；
- 应发现的 Eval 是否实际运行，避免少排用例仍全绿；
- 正常 Experiment 是否按 Eval 级折叠后通过；
- 本仓库专项关注的 session、tool、skill、MCP、sandbox 或 tracing 行为——各域的断言计划见对应域文档。

这些期望与本仓库的 Eval 同处一个所有权边界。新增或删除 Eval 时，只修改该仓库，不同步中央期望表。

### 4.2 Results 读取边界

仓库验收脚本不得递归扫描 `.niceeval/`、猜 `summary.json` / `snapshot.json` 名称或手工拼 attempt 路径。读取结果只使用 niceeval 的公开读取面：

- 需要稳定机器摘要时，使用 CLI 的 `--json` 输出；
- 需要遍历快照和 attempt 时，使用 `openResults()` 返回的句柄；
- 需要验证 JUnit 时，解析显式指定的 `--junit` 文件；
- 只有[报告域](report.md)的 `results-contract` 仓库可以断言公开落盘格式，其它仓库不复制格式知识。

### 4.3 CLI 读回

每个仓库的验收链在 Experiment 结束后接读面 CLI：同一份新产出的快照直接交给 `niceeval show`（及仓库关心的证据切面，如 `show --execution`）。一次真实运行因此同时验收两个域——协议路径本身，和 CLI 读面在真实数据上的表现；模型成本只花一次。

读回是仓库机制验收的**首选断言面**：「适配器是否正常接收到各种信息」以 CLI 展示输出为准——展示里出现，就证明归一、落盘、读取面、渲染整条链都通了；`openResults()` 只兜展示读不出的机制事实（如断言「attempt 不产生 trace」）。

读回断言有界，只断言三类事实：

- 进程退出码为 0——读面在真实结果上不崩；
- 本仓库拥有的事实出现在输出里（Eval id、verdict、断言过的调用节点），且与 `--json` / `openResults()` 口径一致；
- 证据面与该仓库的 tracing 期望一致——声明 tracing 的仓库，执行树节点带 span 时间注释；未声明的显示 timing unavailable。

读回不断言终端布局、列格式或文案——渲染语义归[单元测试 Reports](../unit-tests/reports/README.md)；也不断言完整落盘与出口格式——那是[报告域](report.md)`results-contract` 的责任。这条边界让读回的维护成本停留在「自有事实的子串级检查」，矩阵修复成本不随格式微调放大。

## 5. 根仓库编排

niceeval 根仓库保留一个薄编排层：

```text
e2e/
  README.md
  repos/                       # 独立测试仓库 checkout 或可拆出的仓库目录
    ai-sdk/
    openai-compat/
    claude-agent-sdk/
    codex-sdk/
    pi-agent-core/
    langgraph/
    claude-code/
    codex-cli/
    bub/
    openclaw/
    results-contract/
    cli-contract/
  scripts/
    list.ts                    # 发现并校验 e2e.json（tsx 执行）
    run.ts                     # 构建候选包、选择仓库、隔离 spawn、汇总退出码（tsx 执行）
```

编排器只负责：

1. 构建一次候选 niceeval tarball。
2. 从每个仓库自己的 `e2e.json` 发现 ID、组、命令、超时、secret 名、artifact 路径和环境需求。
3. 为选中的仓库创建隔离工作目录，注入候选包和最小环境，执行其唯一命令。
4. **注入核验**：仓库命令结束后、采信退出码之前，核对仓库内实际解析到的 `niceeval` 包指纹与候选 tarball 一致；不一致则作废该仓库结果，按基础设施故障处理——绿灯必须来自候选包，不能来自 lockfile 里的发布基线。
5. **基础设施重试**：退出码 `75` 的仓库整仓库重跑一次；重跑后仍 `75` 按失败汇总并标注 infra 类别。回归（其它非零）不重试。
6. 原样汇总仓库退出码与失败类别，收集声明的证据。

编排器不得：

- 内置 SDK、端口或 Experiment 列表；
- 维护每个仓库的 Eval 数与 verdict 期望；
- 启动被测应用；
- 读取或解释 `.niceeval/`；
- 把一个仓库失败降级为警告后继续返回成功。

本地选择命令保持稳定：

```sh
pnpm e2e --repo claude-agent-sdk
pnpm e2e --group sdk
pnpm e2e --group sandbox
pnpm e2e --group contract
```

矩阵默认串行或按仓库隔离后有限并发。一个仓库内的并发由 niceeval Experiment 控制；编排器不让两个仓库共享服务、`.niceeval/` 或安装目录。

## 6. CI 与 crabbox

### 6.1 GitHub Actions

GitHub Actions 从仓库描述文件生成 matrix，每个 matrix cell 只运行一个测试仓库，runner 规格由该仓库 `e2e.json.requires` 映射（Docker、架构、内存），不在中央 workflow 里内置每仓库知识。这样超时、日志、secrets、重试和 artifact 都以仓库为边界，某个慢沙箱不会遮住其它 SDK 的结论。

触发层级：

| 层级 | 内容 | 触发 |
|---|---|---|
| PR | SDK 仓库与 contract 仓库的便宜档 | pull request、main push |
| 路径门禁 | 受影响的真实沙箱仓库 | sandbox / agent / 对应 repo 改动 |
| Nightly | 完整模型、judge 与 sandbox provider 仓库 | schedule、手动 dispatch |

每个 cell 总是上传该仓库声明的 JUnit、`.niceeval/` 和服务日志。`.niceeval/` 被 ignore 只表示不进入版本控制，不表示失败证据不应上传。

上传前，执行器用本次注入的 secret 值对全部 artifact 做扫描替换（占位符 `<redacted:VAR_NAME>`），命中记入运行汇总——真实 Agent 与服务日志可能回显环境变量，脱敏由收集面兜底，不指望每个仓库的日志纪律。

### 6.2 crabbox

crabbox 同步仓库 checkout 并在远端执行仓库命令；它不应知道 niceeval E2E 的内部编排。单仓库运行使用同一个入口：

```sh
crabbox run --shell 'pnpm e2e --repo claude-agent-sdk'
```

当某个测试仓库被放在独立 checkout 中时，命令进一步收窄为：

```sh
crabbox run --shell 'pnpm install --frozen-lockfile && pnpm e2e'
```

两种方式的仓库脚本、Eval 和验收语义相同。crabbox 只负责远端容量、同步、环境转发、日志/JUnit 收集和退出码传播；niceeval 根编排器或测试仓库负责候选包注入与 E2E 语义。

传递 secrets 时使用 crabbox 的环境 allowlist / profile 能力，不把值写进命令行、`e2e.json` 或仓库配置。仓库的执行环境需求（Docker、CPU 架构、内存）声明在 `e2e.json.requires`，由 crabbox provider/profile 映射满足，不在 Eval 中探测并偷偷降级。

## 7. 验收域

矩阵按**测什么**分三个验收域，每个域一篇文档定义自己的仓库与断言计划：

| 域 | 文档 | 仓库 | group |
|---|---|---|---|
| 适配器 | [adapters/](adapters/README.md) | 每个官方适配器一个仓库：`ai-sdk`、`openai-compat`、`claude-agent-sdk`、`codex-sdk`、`pi-agent-core`、`langgraph`、`claude-code`、`codex-cli`、`bub`、`openclaw` | `sdk` / `sandbox` |
| 报告 | [report.md](report.md) | `results-contract` | `contract` |
| CLI | [cli.md](cli.md) | `cli-contract` | `contract` |

一个能力只在真实支持它的仓库中出现。中央矩阵不依据 profile 自动删减 Eval；缺少覆盖应表现为域文档覆盖表中的空白，由评审决定补进哪个仓库。

contract 仓库（`results-contract`、`cli-contract`）同样使用真实 Agent 与真实模型——真实优先没有例外，E2E 矩阵里不存在脚本化 agent。它们的稳定性来自断言对象：只断言机制事实（attempt 集合、复用显示、落盘格式、退出码折叠），不断言模型输出质量，因此真实模型下结论仍然确定。全部 E2E 仓库都需要真实凭据；无凭据环境的验证边界就是 `pnpm test`。

### 7.1 破坏性变更的矩阵修复

niceeval 是 beta 软件，公开 API / CLI 的破坏性重设计是常态。仓库自治意味着一次破坏性变更要逐仓库修复——这是自治换来的预期成本，不因此回退到共享 factory。修复按固定顺序推进，属于该变更的影响面，与变更同批完成：

1. **contract 仓库先行**（`results-contract`、`cli-contract`）：它们最薄、断言只依赖机制事实，先绿说明新契约本身自洽。
2. **按 group 逐组修适配器仓库**（`--group sdk` → `--group sandbox`）：每组内的修复是同构的机械改动，改完一组跑一组。
3. 修复期间某仓库暴露出的额外问题按该仓库的所有权处理，不顺手扩大变更范围。

## 8. 守护规则

根仓库的离线测试守住结构边界：

- 每个 `e2e/repos/*` 都有合法且 ID 唯一的 `e2e.json`；
- 每个仓库都有自己的 Eval 和 Experiment，且不存在指向其它测试仓库或父级 shared 源码的 import；
- 每个仓库有 lockfile、`.env.example` 与 `.gitignore`，其中 `.niceeval/` 被忽略；
- package manifest 不含指向 niceeval 父目录的 `file:` / `link:`；
- 把仓库复制到临时目录后可以完成依赖解析和 list/discovery 冒烟；
- 根编排器不含 Eval ID、expected count、artifact 文件名或协议工具名。

新增仓库级机器守护写进 `test/` 下的 Vitest，并由 `pnpm test` 执行；不增加独立 lint hook。

## 9. 不做的事

- 不建立 `e2e/shared`，不共享 Eval / Experiment factory，也不通过 profile 生成各仓库的能力子集。
- 不把被测应用与 Eval 拆成中央 `apps/` + 薄 `projects/`，避免单独运行时还要恢复隐含拓扑。
- 不让根编排脚本理解所有仓库的领域期望或 Results 私有布局。
- 不用 symlink、跨仓库相对 import、根 workspace hoist 或父目录 `file:` 依赖制造“看起来独立”的仓库。
- 不让某个真实模型仓库承担全部框架 contract；确定性机制放进专门 contract 仓库，适配器仓库专注协议路径。
- 不要求不同仓库拥有相同 Eval 文件名、数量、prompt、runs 或 assertion；覆盖矩阵对齐责任，不对齐源码。
- 不把 crabbox 变成 E2E 语义层。它是可替换执行器，仓库命令在本地、CI 和 crabbox 上保持一致。
- 不断言 show / view 的终端布局与报告 DOM——CLI 读回（见 4.3）只断言自有事实的出现与口径一致；报告域验收的边界见 [report.md](report.md)。
