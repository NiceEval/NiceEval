# E2E：真实用户结果的默认 owner

产品行为默认从 E2E 开始裁决。E2E 穿过真实公开边界：candidate、外部 cwd、子进程、文件、HTTP、浏览器、真实 SDK / CLI / provider、
signal、Sandbox 或下一次消费者。E2E 按流程范围分为 Journey 与单边界。Eval、CLI、Runner、Record、Report、Package 与 Lifecycle 使用
功能场景 Repo；Adapter 使用另一组 `adapter/<id>` 协议 Repo，包括确定性产品 owner 与 live 兼容性检查。

E2E 是 Bug 修复的开工门：先按[测试总纲的 E2E TDD](../README.md#bug-修复的-e2e-tdd)让安装后的旧候选从公开入口变红，再修改生产代码。优先加强既有 owner；没有合格 owner 时新增一个最小 owner。只有文档列明的外部阻塞才改做本次 AI 真实验收。

跨多个公开接缝的完整用户目标由 Journey 拥有；原子公开结果由单边界 E2E 拥有。
只有两者无法稳定制造、穷举或区分具名错误算法时，才进入 [Unit 例外](../unit/README.md)。

## Repo 是载体，不是测试模型

每个叶子目录是一个能被复制到仓库外使用的 NiceEval 项目：

- 自己的 `package.json` 与签入 lockfile；
- NiceEval dependency，由根 runner 在副本中替换成候选 tarball；
- `e2e.json` 的 `harness.testkit: true`；根 runner 把当前 checkout 的 Testkit
  直接编译到 invocation-local scratch snapshot，并只在副本中注入该目录依赖；
- `niceeval.config.ts`、`evals/`、`experiments/`、需要时的 `reports/`、agent、服务或 Docker Compose；
- 原生 Vitest / Playwright 测试；
- 只描述运行条件的 `e2e.json`。

它不能从 workspace 相对路径 import NiceEval 源码，也不能用“生成过 evidence”代替断言。完整规则见
[真实场景 Repo](scenario-repos.md)。

## 框架分工：复用 runner，只写产品 harness

- CLI、Runner、Package、Adapter 与 Lifecycle Repo 使用 Vitest 的选择、超时、hook、断言和报告能力；
- Report 与包含浏览器的 Journey E2E 使用 Playwright Test 的 `page` fixture、web-first assertion、trace、截图与 browser cleanup；
- 根 `pnpm e2e` 只实现 NiceEval 特有的候选 tarball、checkout-local Testkit 注入、Repo 隔离安装、lane / capability 选择、artifact 与资源收据；
- 独立 [Testkit](../testkit.md) 只补跨 Repo 稳定的进程收据、严格数据解码、等待与 cleanup；Repo 策略仍留在调用点；
- 完整 `niceeval` argv、readiness 条件与领域 expected 留在测试正文。

这与 [Vite / Vitest / Playwright 等框架工具的自测方式](../../../research/framework-e2e/README.md)相同：复用通用 test runner，
再为自身的真实项目、CLI、server 或候选构建写薄的产品 fixture。NiceEval 不另造 assertion DSL、browser runner
或第二套测试调度器。

## 单边界 E2E

单边界 E2E 只跨一条公开边界或一个紧密动作组。命令、观察和 expected 放在同一文件：

```ts
// owner: docs/engineering/testing/e2e/report.md#show-json-pipe
// regression: memory/show-json-pipe-truncated-at-128k.md
test("show --json 经 pipe 仍交付完整文档", async () => {
  const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
  const result = await niceeval.run(["show", locator, "--json"]);

  expect(result.exitCode, result.diagnostic()).toBe(0);
  expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(128 * 1024);

  const document = result.json<AttemptDocument>();
  expect(document.schema).toBe("niceeval.show/v1");
  expect(document.data).toContainEqual(expect.objectContaining({ id: "tail-sentinel" }));
});
```

命令执行器、parser 和 artifact 收集器可以复用；阈值、sentinel 和成功条件不能藏进通用函数。
命令收据与资源生命周期的共用规则见 [Testkit](../testkit.md)。

## Journey E2E：长用户流程

Journey E2E 证明只有跨域组合才会出现的断裂，不复制每个域的完整矩阵。它连续执行真实用户命令，并在最近接缝立即检查：

```text
init → exp --dry → exp → show --run <runId> --json → show --page <route> → view --out → 浏览器打开
```

只看最终导出站会把前面错误都折叠成“页面没开”；只检查每条短命令又无法证明 locator 和结果能跨域传递。
Journey E2E 同时保留过程检查点和最终目标。

Journey 的每个检查点只证明终态需要的身份、接线或前置事实。
一个命题拥有独立输入、独立 expected、独立修复动作，或可以与终态独立失败时，必须拆成单边界 E2E 或另一 Journey。
不能把选择、退出码、缓存、机器输出与导出等多个结果放进一个 `test()`，再用“长流程”掩盖多 owner。

Journey E2E 使用独立项目副本和结果根。失败后保留副本时，摘要必须给出从第一条失败命令开始的复现方式。

## 功能 Repo 自己生产证据

功能 Repo 签入为本域设计的 Eval 与 Experiment，每次 Repo invocation 都先通过安装后的 `niceeval exp` 完整运行，现场生成
`.niceeval`，再执行 `show`、`view`、`--dry`、`accept` 或公开 Record API 等本域动作。不得签入、下载或从其它 Repo 复制一份
预生成 `.niceeval` 来跳过产品运行路径；artifact 中保留 `.niceeval` 只用于本次失败诊断，不是下一次运行的输入。

Eval 数量服从 case，而不是统一矩阵。一个现有 Eval 无法稳定制造某条公开分支时，Repo 可以增加更有区分力的 Eval；它只服务
本域的 observable expected，不抽成跨 Repo 共享的产品 Eval。普通消息、Context 与纯输出证据优先用确定性 Direct Agent；只有
文件、diff、shell、资源生命周期等结果需要 Sandbox 时才使用 Sandbox。选择 Direct 或 Sandbox 不改变“完整运行后再读回”的要求。

同一次完整运行生成的冻结 evidence 可以由本 Repo 的多个只读 case 共用。会修改 Eval、config、当前结果或执行 `accept` 的 case
必须拥有私有项目副本，并在该副本中先完成自己的初始运行；不靠文件顺序，也不修改供其它 case 读取的共享 evidence。

## 功能 Repo 与 Adapter Repo 不混用

功能 Repo 使用签入的确定性 Agent / backend fixture，证明对应功能域的行为。
确定性 Adapter Repo 使用公开协议的本地故障端，证明 NiceEval 官方 Adapter 自己拥有的 transport 与错误处理。
Live Adapter Repo 使用真实 SDK、CLI 或 provider，只证明该上游入口的兼容性。
三者可以共用 Testkit，但不共享 package graph、fixture、secret、结果根或运行 evidence。
功能 Journey 不放进 `adapter/ai-sdk`；Adapter Repo 调用 `exp` / `show` 也不获得 CLI 或 Report 的矩阵所有权。

live Adapter 不承担产品可靠性。确定性 UI Message Stream counterpart 负责产品语义并通过重复运行接管门；live 断言协议身份与关系。
公开 Assertion、Context、Report 或 Runner 契约各自由功能 Repo 完整验收；Adapter 只使用足以判定其协议事实的断言，
不承载跨 Adapter 的 Assertion 契约或共享 Eval 注入。
结构化外部故障不算 pass，也不倒推确定性产品 owner 失败；同一 candidate 的 AI 真实兼容性验收可以替代本次有效 live 结果。

## 公开读回

每个 Repo 通过产品公开入口读回自己制造的结果，但只断言本 Repo 拥有的事实。功能 Repo 用 `show`、导出文件或浏览器证明
NiceEval 自有行为；Adapter Repo 用 `exp` / `show` 确认协议身份、usage、session 与失败阶段。通用 CLI 格式、Report 渲染和
Adapter 协议矩阵分别只在各自 owner 中验收，不因一次读回而复制到所有 Repo。

## Eval 与 Assertions

`e2e/eval/` 使用自己的真实项目、Direct Agent / Sandbox、Eval 与 Experiment，完整验收公开 Eval authoring、Context 和 Assertion
契约。值 matcher、scope、句柄修饰、计分与 unavailable 等价类只在这里展开一次；需要不同事件、session 或 Sandbox 证据时，
在该 Repo 增加对应 Eval。Adapter Repo 不因同样调用了 `t.calledTool()` 或 `t.session()` 而获得这张矩阵的所有权。

具体 owner 见 [Eval 域](eval.md)；首次结果、live retry 与终局验收的 typed expected 见 [Verdict Policy](verdict-policy.md)。

## Adapter

`e2e/adapter/` 是 collection；每个官方 Adapter 自己拥有 live 叶子 Repo，另有独立的确定性协议 Repo。不能在一个
`adapter/test/` 目录里用不同 fixture 名字冒充多个消费项目：

```text
e2e/adapter/
├── ai-sdk/          # live SDK 与该 SDK 独有的 telemetry / session 证据
├── codex-cli/       # live CLI、隔离 HOME / config 与规范工具身份
├── local-protocol/  # uiMessageStreamAgent 的确定性成功对照与故障路径
├── claude-code/
├── opencode/
└── bub/
```

两类叶子 Repo 提供互补测试：

| 测试 | 证明 | Lane |
|---|---|---|
| UI Message Stream 本地 fixture | NiceEval 自有 transport、断流、超时、错误分类和 cleanup | PR |
| Live SDK / CLI / provider | 上游真实事件形状、鉴权、usage、session、工具身份和版本兼容 | 可信同仓 PR / main / nightly / release |

本地 fixture 不能替代 live 兼容性；live 检查也不能替代可控错误注入。NiceEval 自有的协议语义矩阵默认留在
确定性 UI Message Stream E2E；只有它无法稳定穷举或区分的纯归一算法，才登记最小 Unit 例外。Live Repo 只取有区分力的真实兼容性代表。

Adapter E2E 至少检查：实际执行了期望 Eval、最终 verdict、公开 readback 中的协议身份、usage / session 等本 adapter 独有事实，
以及失败时的阶段和可行动诊断。不能只断言命令 exit 0。

Adapter 的分页或事件 fixture 必须属于被测公开协议。E2B `Sandbox.list()` 的 SDK paginator 形状归直接使用真实 SDK 类型的
最小 Unit；把它改写成自造 HTTP cursor 后，即使有两页数据也不能引用 E2B 的历史回归。

## Report

Report Repo 用真实 Experiment 产生结果，再通过公开入口读取：

- `show`：text / JSON 的身份、范围、切片和大输出；
- `view --out`：导出文件、链接闭合、base path 与无 server 读取；
- `view`：HTTP、持续重建与浏览器动作；
- 自定义 Report：外部 cwd 的 TSX 编译、公开组件和页面目标。

Record 目录是可复制、可进入 Git 的 opaque 产品资产，不是公开磁盘 schema。Report Repo 只从安装后 CLI 产生它，
再用 `show`、`view` 与自定义 Report 验收公开结果；测试不得 import reader / writer，也不得扫描物理文件来反推成功。
损坏、不完整、迁移与删除未完成 Run，只有在 CLI 能稳定制造并返回公开诊断时才由对应 CLI Journey 接管。

Source Page 的生产—读取闭环也归 Report Repo：Eval 从入口文件和嵌套断言模块声明断言，完整运行后再修改工作区源码；旧 locator
的已生成 Source Page 仍必须显示运行时捕获的入口、callers、路径与内容，而不是当前磁盘内容。需要另一种 verdict、conversation、tool、timing 或源码树时，
在 Report Repo 增加专用 Eval，不借用 Adapter 结果。

浏览器场景先断言目标 URL / HTTP，再按 role 与实体身份操作；不要读 `.niceeval-row-hidden`、固定 sleep 或探测任意节点。
默认直接使用 Playwright Test；只有经测量证明需要跨大量场景共享远端 browser 时，才允许引入专用 browser fixture。

## Runner

Runner Repo 使用确定性本地 Agent 产生可区分的 plan、dispatch、carry 与 history 证据。`carry-reuse.test.ts`、
`history-dedup.test.ts` 等子功能是同一 Repo 内的测试文件；修改 config、Eval 或当前结果的 case 使用私有项目副本。
这些命题不依赖真实 provider 身份，因此不能借用 `adapter/ai-sdk` 或 `adapter/codex-cli` 的运行结果。

`--dry` 与 `accept` 同样归 Runner Repo。相关 Journey 先完整运行自己的初始 Experiment，再修改 Eval 或被导入源码模块。
随后检查 human / JSON dry plan，执行 `accept @<locator>`。再用 accept 收据中的 Run ID 明确读取，证明新 Run 通过 reference Member 指向同一
immutable Attempt；公开读回还要确认 verdict / evidence 未被复制或改写，采用原因由目标 Member action 表达。

accepted action 只属于目标 Member Core，不是另一份 durable family，也不是未来复用许可；后续 dry
仍独立执行当前 reuse policy。不得用手写 manifest 或预置 `.niceeval`
直接从流程中段起跑。

## Package 与 CLI

Package Repo 按 [Package 外部消费契约](README.md#package-与-cli)用默认 CommonJS 项目的 `init → list` Journey 验证安装后的 CLI、tsx CJS hook
与 `require` exports 接线，并检查私有 Testkit 没有进入产品包。ESM 与功能子路径由各功能 Repo 的真实 Journey 自然消费，
不在 Package Repo 复制入口清单。
CLI Repo 验证 argv、stdin / stdout / stderr、pipe、PTY、exit 与 JSON / NDJSON / JUnit。两者都执行安装后的 binary，
不能直接调用 `src/cli.ts` 或 mock commander / parseArgs 后宣称公开命令已通过。

## Lifecycle

Lifecycle Repo 保留原生测试 runner 的默认并行。每条 case 按场景独占自己的进程组、容器或 Sandbox，不靠兄弟文件的执行顺序隔离。
只有无法分配独立身份的外部资源才在局部关闭并行，并在 Repo README 说明限制。Lifecycle 不仅检查第一条命令退出，还检查：

- signal 被送到正确进程；
- teardown 与 lease 结束；
- 没有 orphan 或残留容器；
- 下一次独立消费者可以正常启动；
- cleanup 失败不会遮蔽原始失败。

### Eval Group shared Sandbox

`e2e/lifecycle/test/eval-group-shared-sandbox.test.ts` 是 Eval Group 物理生命周期的单边界 owner。
它用两个同时进入调度的 Group 证明：不同 Group 可以并行；同一 Group 的成员按规范化 Eval ID 串行；成员之间复用同一台
Docker Sandbox，`$HOME` 中的 Group 状态得以保留而工作目录会重置；运行结束后两台 owned Sandbox 都已释放。
测试只通过安装后 CLI 的 result 事件与 `show --history --json` 读回公开结果，不读取 `.niceeval/` 私有布局。

## 单项重跑

任何 E2E 必须能按 Repo、文件和标题重跑：

```sh
pnpm e2e --repo report
pnpm e2e --repo report -- --run test/exported-targets.test.ts
pnpm e2e --repo report -- --run test/exported-targets.test.ts -t "打开 case target"
```

E2E 必须由原生测试 runner 按文件与标题发现；无法按标题选择的线性脚本不拥有长期测试命题。

新增、接管或实质修改确定性 owner 时，还必须通过[可靠性：重复运行](../README.md#可靠性重复运行)的隔离副本、同副本连续运行、
默认并行与单项重跑组合。任一次意外失败都不合格；测试级 retry 不得把失败改写成通过。
真实 provider live owner 随常规全量 E2E 完成真实运行与公开读回。provider 随机性不能证明确定性，
因此 live Repo 不用重复 takeover 承担确定性可靠性门。

本地、Docker 与 GitHub Actions 见 [Execution](execution.md)。

## 各域验收入口

- [Adapter](adapter/README.md)：官方 Adapter 的确定性协议 owner 与 live 兼容性检查；
- [Eval](eval.md)：Eval、Context 与公开 Assertion 契约 owner；
- [CLI](cli.md)：选择、进程出口、机器输出与缓存行为；
- [Record](README.md)：公开 Record API 与已声明磁盘格式；
- [Persisted Record handoff](migrate.md)：可替换 producer 与 candidate 的持久化读回边界；
- [Report](report.md)：公开读面、HTTP、导出与浏览器行为。

这些页面只登记稳定结果与 owner，不复制本篇的 Repo、执行和隔离规则。
