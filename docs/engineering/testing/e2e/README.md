# E2E CI

E2E 是[测试体系](../README.md)的产品层：始终使用真实安装、进程、文件系统、CLI 与浏览器。外部集成 profile 使用真实模型、协议和沙箱；功能仓库还可以用确定性 Agent 经公开 CLI 生产有区分力的产品场景，但必须和外部 smoke 分名，不能用脚本化事件冒充 provider 协议已经通过。

niceeval 的 E2E 以**独立测试仓库**为执行与所有权边界。
每个测试仓库都包含自己的被测应用、直接实例化官方 Agent 工厂的 Experiment、Eval、依赖锁文件、启动脚本和验收脚本；不同仓库之间不共享 Eval factory、profile、应用进程或结果读取代码。

根仓库只编排这些仓库：构建当前 niceeval 候选包、选择测试仓库、逐个隔离运行并汇总结果。
它不理解某个仓库应该发现多少条 Eval、工具名是什么，也不递归猜测 `.niceeval/` 的内部布局。

这条边界让同一个测试仓库可以被三种执行器用同一条命令运行：开发者本机、GitHub Actions，以及同步该仓库后远程执行命令的 crabbox。

本篇定义所有仓库共用的执行与编排协议。
每个仓库**测什么、断言什么**按验收域分篇：

- [适配器域](adapter/README.md)——`e2e/adapter/` 的仓库：每个官方适配器一个仓库、一篇 E2E 验收说明，验收真实协议路径。
- [功能域 · 报告与读面](report.md)——`e2e/report/` 仓库：落盘格式、公开读取面、机器出口与 show/view 渲染面。
- [功能域 · CLI](cli.md)——`e2e/cli/` 仓库：选择、退出码折叠与缓存复用。

验收脚本怎么执行 `niceeval` 命令、怎么断言返回的就是需要的，参考写法与用例见[验收脚本写法](verification.md)。

## 1. 设计目标

E2E CI 同时证明以下行为：

1. **真实产品路径**：从安装 niceeval、启动被测应用、发现 `evals/` 与 `experiments/`、执行 Agent，到断言、评分、结果落盘和进程退出码，全部通过公开使用面完成；需要证明外部集成时，该 Agent 也必须是真实官方工厂。
2. **仓库自治**：一个测试仓库只依赖自己的签入内容、声明的外部服务与注入的 niceeval 候选包。
   删除其它测试仓库或把本仓库复制到独立 checkout，不改变它的行为。
3. **协议差异显式存在**：SDK 的工具命名、usage、HITL、会话和沙箱能力直接写在对应仓库的 Eval 中，不用共享 profile 把多个真实协议抽象成一套条件分支。
4. **正反路径可证**：支持某项能力的仓库同时验证正例和反例；退出码折叠的验证由[功能域 · CLI](cli.md)的 `cli` 仓库承担，其 deliberate-fail / deliberate-error 实验把预期非零退出转换为仓库级验收成功。
5. **可独立调度**：任意仓库都能以稳定 ID 被单独选择、设置超时、注入所需 secrets、上传自己的证据，并把原始退出状态交给本地、CI 或 crabbox。

## 2. 独立测试仓库

### 2.1 独立的含义

一个测试仓库满足以下约束：

- 有自己的 `package.json` 和 lockfile，不加入 niceeval 根 workspace；Python 等其它运行时同样在仓库内声明依赖。
  TS 系仓库带一份只含 `packages: []` 的 `pnpm-workspace.yaml`，让 pnpm 把仓库目录本身当 workspace root、不向上并入父级 workspace——这样候选 niceeval tarball 注入后解析到的是仓库自己的 `node_modules`，就地调试（`cd <repo> && pnpm install && pnpm e2e`）与拷贝到临时目录执行行为一致。
  仓库自己的原生构建开关（`allowBuilds`）也声明在这个文件里。
- 有自己的 `niceeval.config.ts`、`evals/` 和 `experiments/`；Experiment 直接从 `niceeval/adapter` 导入并实例化官方 Agent 工厂。
- 被测应用及其启动方式属于该仓库，不从中央 `apps/` 目录连接共享进程。
- 不 import 另一个测试仓库，也不 import niceeval 根仓中的 `e2e/shared`、`src/` 或测试辅助源码。
- 不使用指向父目录的 `file:` / `link:` 依赖。
  待测 niceeval 由执行器通过候选包注入。
- 适配器仓库不包含 `agents/` 或等价的本地 Adapter 实现层，不调用 `defineDirectAgent`、`defineSandboxAgent`、`driveFrameStream` 或 `from*Events` 拼装 Agent；官方工厂不够用就是产品缺口，不在 E2E 中补胶水。
  `cli` / `report` 功能仓库可以拥有确定性 Agent，但它只能构造已声明的产品状态图，不能复刻某个 SDK 协议或承担对应适配器的验收。
- `.niceeval/`、服务日志和 JUnit 属于一次运行的临时证据，必须被 ignore，不得成为下一次运行的输入。
- 从父目录复制到一个临时目录后，仍能在只注入候选包和 secrets 的条件下执行。

“不共享”约束的是运行时代码和测试语义。
仓库可以遵循同一份书面执行协议，也可以在创建时从模板复制初始骨架；复制后各仓库独立演进，不存在会同时改变整个矩阵行为的共享 factory。

`e2e/` 的布局平铺，目录名就是验收域：`adapter/` 是唯一的多仓库 collection，装已有完整官方 Agent 工厂的适配器仓库（`group` 为 `sdk` / `sandbox`），负责官方适配器的协议验收；`cli/`、`report/` 是直挂在 `e2e/` 下、自带 `e2e.json` 的功能仓库（`group` 分别为 `cli`、`report`），对公开 CLI 生产的产物断言 CLI 行为、落盘格式与渲染面，不测适配器协议路径。
物理位置只表达归属，不是仓库身份的一部分——`id` 在全部仓库范围内全局唯一，编排器与 CI 从每个仓库自己的 `e2e.json` 读 `group`，不从目录位置反推分组。

只有事件转换器、尚无完整官方 Agent 工厂的 fixture 放在 `e2e/undo/`。
`undo/` 不是 collection，发现器与 CI 都不扫描它；对应官方工厂落地后，fixture 删除本地 Adapter 实现、Experiment 改为直接实例化工厂，再整体移回 `adapter/`。

### 2.2 仓库形状

每个仓库都是完整的用户项目，而不是只绑定共享定义的薄壳：

```text
<repo>/
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml          # 只含 packages: []，令仓库自成 workspace root；兼放 allowBuilds
  .gitignore
  .env.example
  e2e.json
  niceeval.config.ts

  src/                         # 被测应用；不需要服务的仓库可省略
  evals/                       # 本仓库拥有的 Eval
  experiments/                # 直接实例化 niceeval/adapter 官方工厂

  scripts/
    e2e.ts                     # 唯一执行入口；也可由一个 runner 编排原生测试器：准备、启动、运行、验收、清理
    verify.ts                  # 可选；只包含本仓库的可观察行为断言
```

例如 `claude-code` 仓库直接在自己的 MCP Eval 里断言真实 Claude Code 工具名，`ai-sdk` 仓库直接断言 UI Message Stream 的不带命名空间的工具名。
两者即使覆盖相似场景，也各自拥有完整 Eval；重复是协议验收的证据，不是需要消除的代码坏味道。

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

| 字段             | 含义                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | 全局稳定的仓库选择器，也是 CI / crabbox 任务名                                                                                                                                                                |
| `group`          | 调度分组：`sdk`、`sandbox`、`cli`、`report`                                                                                                                                                                   |
| `command`        | 在仓库根执行的唯一验收命令，不包含 secret 值                                                                                                                                                                  |
| `timeoutMinutes` | 仓库级硬超时；Experiment 自己仍声明 attempt timeout 与 budget                                                                                                                                                 |
| `secrets`        | 所需环境变量名，用于 fail-fast 检查和最小授权                                                                                                                                                                 |
| `artifacts`      | 成功或失败后可收集的仓库相对路径                                                                                                                                                                              |
| `requires`       | 可选；执行环境需求：`runtimes`（如 `["node>=22", "python>=3.11"]`）、`docker`（布尔）、`arch`、`memoryGB`。执行器据此选择 GitHub Actions runner 与 crabbox provider/profile；省略表示只需要 Node 运行时与出网 |

这里不声明 Eval 数、期望 verdict、端口或 `.niceeval` 文件名。
前两者属于仓库自己的验收语义；端口属于仓库自己的进程生命周期；结果布局属于 niceeval 的 Results 契约。

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
5. 以 `--rerun all` 运行本仓库声明的 Experiment，并输出 JUnit。
6. 校验本仓库的预期退出码与可观察行为，并对新产出的结果执行 CLI 读回（见 4.3）。
7. 无论成功失败都终止服务；保留日志和 `.niceeval/` 供执行器收集。

调用方不需要知道先起哪个端口、运行几个 Experiment、哪一次 CLI 调用预期退出 1。
`pnpm e2e` 的退出码就是该仓库的最终验收结论，并区分失败类别：

- `0`：契约符合预期。
- `75`（`EX_TEMPFAIL`）：基础设施故障——依赖安装失败、服务 readiness 超时、provider 返回 429/5xx 或网络错误导致 attempt errored、judge 服务不可达这类**能确证的外部故障**。
- 其它非零：回归，契约不符。

分类规则只有一条：能确证是外部故障才退 `75`，不能确证一律按回归退出——宁可误报回归，不可把回归漏报成环境问题。
回归与基础设施故障都使该仓库判红，区别只在编排器的重试与汇总标注（见根仓库编排）。

这条命令同时就是**本机回路**：开发者注入真实 key 后单仓库直接跑，与 CI、crabbox 行为完全一致，不存在"本机用 mock、CI 用真的"的分叉。

### 3.2 候选 niceeval 注入

根仓库先把当前 checkout 构建成可安装的 npm tarball，并把 tarball 路径作为候选包交给每个测试仓库。
候选包是测试仓库与 niceeval 源码之间唯一允许的代码连接。

注入机制满足以下规则：

- 测试仓库的 `package.json` 声明一个正常发布版本作为独立运行时的默认基线。
- 编排执行时，候选 tarball 覆盖该依赖，但不永久修改仓库 manifest 或 lockfile。
- 仓库在运行开头打印 `niceeval` 的解析路径与版本/producer 信息，供日志诊断；**核验义务在编排器**——注入方在仓库命令结束后核对实际解析到的包与候选 tarball 指纹，不一致的结果作废（见根仓库编排）。
  这项防线不靠每个仓库手写的脚本各自实现。
  独立 checkout 不注入候选时没有核验对象，测的就是 lockfile 锁定的发布版。
- tarball 必须包含与发布相同的入口、构建产物和 package metadata；E2E 不从 `src/` 相对导入来绕过打包边界。

因此，niceeval 根仓可以验证未发布的当前改动；一个独立 checkout 也可以不注入 tarball，直接验证它锁定的已发布版本。

### 3.3 secrets 与真实服务

测试仓库通过环境变量接收真实 provider 与 judge 凭据，`.env.example` 只列变量名和非秘密 base URL。
执行器按 `e2e.json.secrets` 逐仓库最小化注入，不把整个矩阵的 secrets 暴露给每个仓库。

SDK 与沙箱适配仓库使用真实模型和真实协议，不新增只为 E2E 存在的 mock 分支。
模型、runs、budget 和 timeout 由仓库自己的 Experiment 决定：PR 门禁使用便宜模型与小样本，nightly 仓库或 Experiment 承担更完整的模型与 provider 矩阵。

被测服务由仓库的 `scripts/e2e.ts` 启动和清理。
中央 workflow 不维护全局端口表，也不并发共享长期服务；仓库可使用动态端口并通过自身环境传给 adapter。

## 4. 仓库内验收

### 4.1 验收责任

Eval 是被测输入，不等于仓库级测试结论。
仓库自己的验收脚本负责：

- CLI 退出码是否符合该 Experiment 的预期；
- 应发现的 Eval 是否实际运行，避免少排用例仍全绿；
- 正常 Experiment 是否按 Eval 级折叠后通过；
- 本仓库专项关注的 session、tool、skill、MCP、sandbox 或 tracing 行为——各域的断言计划见对应域文档。

这些期望与本仓库的 Eval 同处一个所有权边界。
新增或删除 Eval 时，只修改该仓库，不同步中央期望表。

公开使用面按**用户边界**判断，不按媒介判断：CLI 的退出码与输出、公开导出文件、HTTP 响应、package 的公开 API，以及浏览器中用户能感知的内容、语义、可访问性与交互都可以是 E2E 观察面。
测试必须经候选包公开入口驱动；内部组件名、内部树形、未公开 class/tag 与具体布局算法不是预期。
DOM selector 可以是定位手段，但不自动成为契约；能用 role、可见文本或公开稳定属性定位时优先用它们。

预期必须独立于候选实现：固定值来自本仓库签入的 Eval/fixture 与公开文档，升级时随契约 diff 显式修改。
禁止从候选包导入 schema 常量、renderer、组件或计算函数来生成“正确答案”；这种写法只证明候选实现与自己一致，无法抓住实现和预期同错。

### 4.2 Results 读取边界

仓库验收脚本只从 **CLI 公开使用面**进入：它起 `niceeval` 子进程并断言退出码与输出。
它不 import niceeval 库代码，也不得递归扫描 `.niceeval/`、猜 `run.json` 名称或手工拼 Attempt 路径。
读取结果只用 CLI 出口：

- 稳定机器摘要：`--json` 输出文件；
- 默认报告与逐 attempt 时间线（verdict、耗时、成本、locator）：`niceeval show` / `show --history`；
- 证据切面：`show @<locator> --execution` / `--timing` / `--source` / `--diff`；
- CI 出口：显式指定的 `--junit` 文件。

`openRecord()` 读取库是公开使用面的一部分，它的 E2E 验收归[功能域 · 报告与读面](report.md)的 `report` 仓库——只有那里可以断言落盘格式与读取库，其它仓库不复制格式知识、不经库面读结果。

### 4.3 CLI 读回

每个仓库的验收链在 Experiment 结束后接读面 CLI：同一份新产出的 Run 直接交给 `niceeval show`（及仓库关心的证据切面，如 `show --execution`）。
一次真实运行因此同时验收两个域——协议路径本身，和 CLI 读面在真实数据上的表现；模型成本只花一次。

读回是仓库机制验收的**断言面**：「适配器是否正常接收到各种信息」以 CLI 展示输出为准——展示里出现，就证明归一、落盘、读取面、渲染整条链都通了。
机制事实同样以展示形态断言——「没记录 trace」的可见形态就是 timing unavailable 与不挂 OTel 子树的 `--timing`。

读回断言有界，只断言三类事实：

- 进程退出码为 0——读面在真实结果上不崩；
- 本仓库拥有的事实出现在输出里（Eval id、verdict、断言过的调用节点），且与 `--json` 口径一致；
- 证据面与该仓库的 tracing 期望一致——声明 tracing 的仓库，执行树节点带 span 时间注释；未声明的显示 timing unavailable。

读回不断言终端布局、列格式或文案——渲染契约集中在[功能域 · 报告与读面](report.md)的 `report` 仓库验收；也不断言完整落盘与出口格式——同样是 `report` 的责任。
这条边界让读回的维护成本停留在「自有事实的子串级检查」，矩阵修复成本不随格式微调放大。

## 5. 根仓库编排

niceeval 根仓库保留一个薄编排层：

```text
e2e/
  README.md
  adapter/                     # 每个官方适配器一个仓库（group：sdk / sandbox）
    ai-sdk/
    claude-code/
    codex-cli/
    bub/
  cli/                         # CLI 功能仓库（group：cli）
  report/                      # 报告与读面功能仓库（group：report）
  undo/                        # 缺少完整官方工厂的停用 fixture；不参与发现与 CI
  scripts/
    discovery.ts               # 发现 adapter/<id>/ 与 e2e/ 直挂仓库并校验 e2e.json
    injection.ts               # 构建候选 tarball、算内容指纹、装后核验实际解析到的就是候选包
    secrets.ts                 # 按 e2e.json.secrets 为每个仓库构造最小注入的子进程环境
    list.ts                    # discovery.ts 的 CLI 包装（tsx 执行）
    run.ts                     # 构建候选包、选择仓库、隔离 spawn、汇总退出码（tsx 执行）
```

布局是 §2.1 定义的平铺形态：`adapter/` 是唯一的多仓库 collection，其余直挂仓库靠自带 `e2e.json` 被发现——新增功能域就是在 `e2e/` 下新增一个直挂仓库，不改变发现协议本身。

编排器只负责：

1. 构建一次候选 niceeval tarball。
2. 从每个仓库自己的 `e2e.json` 发现 ID、组、命令、超时、secret 名、artifact 路径和环境需求。
3. 为选中的仓库创建隔离工作目录，注入候选包和最小环境，执行其唯一命令。
4. **注入核验**：仓库命令结束后、采信退出码之前，核对仓库内实际解析到的 `niceeval` 包指纹与候选 tarball 一致；不一致则作废该仓库结果，按基础设施故障处理——绿灯必须来自候选包，不能来自 lockfile 里的发布基线。
5. **基础设施重试**：退出码 `75` 的仓库整仓库重跑一次；重跑后仍 `75` 按失败汇总并标注 infra 类别。
   回归（其它非零）不重试。
6. 原样汇总仓库退出码与失败类别，收集声明的证据。

编排器不得：

- 内置 SDK、端口或 Experiment 列表；
- 维护每个仓库的 Eval 数与 verdict 期望；
- 启动被测应用；
- 读取或解释 `.niceeval/`；
- 把一个仓库失败降级为警告后继续返回成功。

本地选择命令保持稳定：

```sh
pnpm e2e --repo ai-sdk
pnpm e2e --repo cli
pnpm e2e --repo report
pnpm e2e --group sdk
pnpm e2e --group sandbox
```

矩阵默认串行或按仓库隔离后有限并发。
一个仓库内的并发由 niceeval Experiment 控制；编排器不让两个仓库共享服务、`.niceeval/` 或安装目录。

## 6. CI 与 crabbox

### 6.1 GitHub Actions

GitHub Actions 从仓库描述文件生成 matrix，每个 matrix cell 只运行一个测试仓库，runner 规格由该仓库 `e2e.json.requires` 映射（Docker、架构、内存），不在中央 workflow 里内置每仓库知识。
这样超时、日志、secrets、重试和 artifact 都以仓库为边界，某个慢沙箱不会遮住其它 SDK 的结论。

触发层级：

| 层级     | 内容                                        | 触发                             |
| -------- | ------------------------------------------- | -------------------------------- |
| PR       | 改动所属的 E2E 仓库；`report` 同时拥有 `show` 读面 | pull request、main push          |
| 失败回退 | 无法安全归属的共享编排或产品改动运行完整矩阵      | shared / product 改动            |
| Nightly  | 完整模型、judge 与 sandbox provider 仓库    | schedule、手动 dispatch          |

每个 cell 总是上传该仓库声明的 JUnit、`.niceeval/` 和服务日志。
`.niceeval/` 被 ignore 只表示不进入版本控制，不表示失败证据不应上传。

上传前，执行器用本次注入的 secret 值对全部 artifact 做扫描替换（占位符 `<redacted:VAR_NAME>`），命中记入运行汇总——真实 Agent 与服务日志可能回显环境变量，收集面负责最终脱敏，不指望每个仓库的日志纪律。

### 6.2 crabbox

crabbox 同步仓库 checkout 并在远端执行仓库命令；它不应知道 niceeval E2E 的内部编排。
单仓库运行使用同一个入口：

```sh
crabbox run --shell 'pnpm e2e --repo ai-sdk'
```

当某个测试仓库被放在独立 checkout 中时，命令进一步收窄为：

```sh
crabbox run --shell 'pnpm install --frozen-lockfile && pnpm e2e'
```

两种方式的仓库脚本、Eval 和验收语义相同。
crabbox 只负责远端容量、同步、环境转发、日志/JUnit 收集和退出码传播；niceeval 根编排器或测试仓库负责候选包注入与 E2E 语义。

传递 secrets 时使用 crabbox 的环境 allowlist / profile 能力，不把值写进命令行、`e2e.json` 或仓库配置。
仓库的执行环境需求（Docker、CPU 架构、内存）声明在 `e2e.json.requires`，由 crabbox provider/profile 映射满足，不在 Eval 中探测并偷偷降级。

## 7. 验收域

矩阵按**测什么**分三个验收域，每个域一篇文档定义自己的仓库与断言计划：

| 域                | 文档                           | 仓库                                                                | group             |
| ----------------- | ------------------------------ | ------------------------------------------------------------------- | ----------------- |
| 适配器            | [adapters/](adapter/README.md) | 已有完整官方工厂的仓库：`ai-sdk`、`claude-code`、`codex-cli`、`bub` | `sdk` / `sandbox` |
| 功能 · 报告与读面 | [report.md](report.md)         | `report`                                                            | `report`          |
| 功能 · CLI        | [cli.md](cli.md)               | `cli`                                                               | `cli`             |

一个能力只在真实支持它的仓库中出现。
中央矩阵不依据 profile 自动删减 Eval；缺少覆盖应表现为域文档覆盖表中的空白，由评审决定补进哪个仓库。

功能仓库（`cli`、`report`）可同时有确定性产品验收和真实 provider smoke。确定性 profile 的 Agent、Run 图与 expected 都由仓库拥有；外部 profile 仍使用真实官方 Agent 与真实模型。

稳定性来自有区分力的证据图和独立 oracle：确定性 profile 锁定 Attempt / Run / Sample 集合、退出码、落盘格式、渲染结构与排版；外部 profile 只锁定协议事实，不判断模型输出质量。每个 profile 一次生产可以支持任意多条断言，覆盖广度不随 Experiment 次数增长。

只有声明外部 profile 的运行需要真实凭据。仓库可提供不依赖凭据的定向命令，但 `pnpm e2e` 仍必须执行仓库契约声明的全部 profile；不能因本机无 key 静默跳过 smoke。

缺少完整官方工厂的 SDK 不进入矩阵：fixture 留在 `e2e/undo/`，覆盖缺口记录在[适配器域](adapter/README.md)。
协议归一的验收只在真实运行里发生，E2E 不用本地 `defineDirectAgent` 把转换器包装成貌似完整的官方适配器；工厂落地前，该 SDK 的协议路径就是显式空白。

### 7.1 破坏性变更的矩阵修复

niceeval 是 beta 软件，公开 API / CLI 的破坏性重设计是常态。
仓库自治意味着一次破坏性变更要逐仓库修复——这是自治换来的预期成本，不因此回退到共享 factory。
修复按固定顺序推进，属于该变更的影响面，与变更同批完成：

1. **功能仓库先行**（`cli`、`report`）：它们最薄、断言只依赖确定性事实，先绿说明新契约本身自洽。
2. **按 group 逐组修适配器仓库**（`--group sdk` → `--group sandbox`）：每组内的修复是同构的机械改动，改完一组跑一组。
3. 修复期间某仓库暴露出的额外问题按该仓库的所有权处理，不顺手扩大变更范围。

## 8. 结构边界怎么被守住

§2 的仓库结构约束不设离线元测试——不为 E2E 仓库的目录形状、`e2e.json` schema 或 import 边界写"对测试的测试"。
约束由两条真实路径证明：

- **编排器每次隔离运行**（§5）：仓库被复制到隔离工作目录、注入候选包、真实安装并执行。
  不独立的仓库——越界 import、指向父目录的 `file:` / `link:` 依赖、缺 lockfile、workspace 并入父级——在这一步直接失败；注入核验拦住解析到基线版本的假绿灯。
- **发现器 fail-fast**：`discovery.ts` 读取 `e2e.json` 时校验字段契约与跨 collection 的 ID 唯一性，非法描述文件在选择仓库阶段即报错，不进入执行。

其余约束（启用仓库不含 `agents/`、不导入自定义 Agent 拼装入口、根编排器不内置仓库专属知识）由评审对照本篇核对。
`test/` 下不为 E2E 仓库保留任何结构测试；那里的守护只服务仓库文档与登记表约束（见[测试体系总纲](../README.md#分层谁负责证明什么)）。

## 9. 不做的事

- 不建立 `e2e/shared`，不共享 Eval / Experiment factory，也不通过 profile 生成各仓库的能力子集。
- 不在 E2E 中实现或补全 Adapter；没有完整官方工厂的仓库进入 `e2e/undo/`，直到产品侧补齐。
- 不把被测应用与 Eval 拆成中央 `apps/` + 薄 `projects/`，避免单独运行时还要恢复隐含拓扑。
- 不让根编排脚本理解所有仓库的领域期望或 Results 私有布局。
- 不用 symlink、跨仓库相对 import、根 workspace hoist 或父目录 `file:` 依赖制造“看起来独立”的仓库。
- 不让某个真实模型仓库承担全部框架契约；确定性机制放进 `cli` / `report` 功能仓库，适配器仓库专注协议路径。
- 不要求不同仓库拥有相同 Eval 文件名、数量、prompt、runs 或 assertion；覆盖矩阵对齐责任，不对齐源码。
- 不把 crabbox 变成 E2E 语义层。
  它是可替换执行器，仓库命令在本地、CI 和 crabbox 上保持一致。
- 不在适配器仓库的 CLI 读回（见 4.3）里断言 show / view 的终端布局与报告 DOM——读回只断言自有事实的出现与口径一致。
  渲染与视觉交互的验收集中在功能域 `results` 仓库的渲染面条目，不散布到各适配器仓库；边界见 [results.md](report.md)。
