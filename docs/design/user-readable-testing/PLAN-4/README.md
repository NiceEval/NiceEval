# 方案 4：真实场景 Repo 与原生结果断言（推荐）

**相关文档**：[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [DECISION](../DECISION.md)

## 解决的问题

测试要先让维护者看见用户做了什么、得到了什么，再提供定位证据。
当前候选把 Behavior、Recipe、World、Observed、Execution Registration 与 Portfolio 分散到多个文件，简单回归也要先理解一套新的测试平台。

本方案只保留两个执行层；E2E 再按流程范围选择两种体裁：

- 根仓库中的原生 Unit，证明纯逻辑、可控竞态与错误分类；
- 单边界 E2E，在真实场景 Repo 中用一组公开动作证明一个用户结果；
- Journey E2E，在同一个真实项目中连续执行多条用户命令，并断言关键过程节点和最终结果。

测试语义写在 Vitest 正文里。
仓库级 manifest 只负责选择、运行环境、密钥和 artifact，不登记产品 Behavior，也不解释断言。

真实场景 Repo 是承载手段，不是新的产品模型。
它就是一个用户会写出的项目：自己的 `package.json`、lockfile、NiceEval 依赖、config、Eval、Experiment、Report、服务代码和测试。
测试必须实际执行 `pnpm exec niceeval exp/show/view`；不能用场景 Repo 的存在代替结果断言。

## 一眼可见的测试形状

```ts
// regression: d8d5a84b
test("show --json 经 pipe 仍交付完整 JSON", async () => {
  const result = await runProcess([
    "pnpm", "--silent", "exec", "niceeval", "show", locator, "--json",
  ]);

  expect(result.exitCode, result.diagnostic()).toBe(0);
  expect(result.stdout.length).toBeGreaterThan(128 * 1024);

  const document = parseJson(result.stdout, result.diagnostic());
  expect(document.format).toBe("niceeval.show");
  expect(document.view).toBe("attempt");
  expect(JSON.stringify(document.data)).toContain("tail-sentinel");
});
```

读者不用先找声明文件就能回答：真实命令是什么、结果从哪里读、独立预期是什么、旧 bug 会在哪一步变红。
`runProcess()` 只负责启动 argv 并保留原始收据；`parseJson()` 只负责严格解码并附加诊断。
两者都不能计算期望。

## 分类使用两条轴

第一条轴是被测领域：

| 领域 | 代表场景 Repo | 主结果 |
|---|---|---|
| CLI | `e2e/cli/` | argv、stdout、stderr、exit、pipe、PTY、机器出口 |
| Runner | `e2e/runner/` | dry plan、调度、carry、history 与真实运行的一致性 |
| Report | `e2e/report/` | show/view、导出文件、HTTP、浏览器语义与交互 |
| Package | `e2e/package/` | 安装、exports、CJS/ESM、外部 cwd、optional peer |
| Adapter | `e2e/adapter/<id>/` | 真实协议、规范事件身份、usage、session、工具调用 |
| Lifecycle | `e2e/lifecycle/` | signal、teardown、orphan、下一次消费者 |

其中 CLI、Runner、Report、Package 与 Lifecycle 是功能场景 Repo；`e2e/adapter/<id>/` 是另一组兼容性 Repo。
前者不借用真实 Adapter Repo 作为功能 fixture，后者也不接管 CLI / Report 的通用行为矩阵。

第二条轴是边界：

| 边界 | 手段 | 默认运行档 |
|---|---|---|
| 纯逻辑 / 可控调度 | unit + fake 自有依赖 | 每次 PR |
| 安装后公开产品行为 | 无密钥场景 Repo | 本地、PR、release |
| 本地服务或 Linux 环境 | host process 或 pinned Docker | 本地、PR |
| 真实第三方协议 | live provider / SDK / CLI | main、nightly、release |
| 高成本资源生命周期 | Docker / remote sandbox | nightly、release |

目录不决定证明强度。
一条 Report 公式可由 unit 证明；一条 Report 导出链接必须由安装后浏览器 E2E 证明。

## 原生测试规则

- 短测试的一个 `test()` 声明一个用户可观察结果；标题不能比断言更强。
- Journey 的一个 `test()` 声明一个完整用户目标，按真实命令顺序保留多个具名检查点；不能只看终态。
- 完整命令或 argv 留在调用点，不能藏进 `runScenario("x")`。
- 期望来自签入 fixture、公开契约或测试内字面量，不能从候选包枚举结果后再当预期。
- JSON、XML 与 NDJSON 先 parse，再比较有业务身份的字段；短且逐字承诺的错误反馈才用 golden。
- 浏览器先断言 URL / HTTP / network，再断言目标实体与用户动作；“有一个 dialog”不等于打开了正确对象。
- 历史回归在文件头写 `regression: <commit 或 memory>`，正文仍按长期用户结果命名。
- `test.each` 只展开共享动作与共享断言的等价矩阵；步骤不同就拆开。
- 共享 helper 只能拥有临时目录、进程、HTTP server、解析与清理等机械能力。
  领域选择、期望和正确性算法留在测试文件。

## 失败定位

E2E 不能可靠指出生产源码的具体行，但必须把故障缩到公开流水线的一段：

1. `prepare`：场景 Repo、依赖、fixture 或服务没有就绪；
2. `invoke`：安装后的公开命令或浏览器动作无法执行；
3. `observe`：进程收据、JSON、HTML、HTTP 或协议事件不可读；
4. `outcome`：观察合法，但用户结果错误；
5. `cleanup`：资源没有释放。

失败报告必须带测试项目、候选包 digest、backend、完整 argv、cwd、exit / signal，以及对应 stdout、stderr、trace、screenshot 或服务日志路径。
需要源码级定位的风险，再配一条最小 Unit；不在 E2E 上堆内部探针。

## 本地与 GitHub Actions

本地和 CI 只使用根入口：

```sh
pnpm e2e --lane pr
pnpm e2e --repo report
pnpm e2e --repo report -- --run test/exported-targets.test.ts
pnpm e2e --lane main --repo adapter/codex-cli
```

根编排器构建一次候选 tarball，复制场景 Repo 到临时目录，注入候选并核验完整性，再按 manifest 选择 host 或 Docker executor。
GitHub workflow 只生成矩阵并调用同一条命令，不重写安装、选择、重试或失败分类。

PR lane 不接触 secrets，只跑 unit 与确定性场景 Repo。
真实适配器只在可信的 main、nightly、手动或 release lane 读取 GitHub Environment secrets；不使用 `pull_request_target` 执行 PR 代码。

## 范围

本方案包含测试分类、真实场景 Repo、单边界 E2E、Journey E2E、候选包注入、host / Docker executor、CI lane、失败 artifact 与历史 bug 回归规则。

本方案不包含：

- Behavior / Proof / World 的全仓 Registry；
- `Observed<T>` 或领域 matcher 作为测试作者必经入口；
- 从测试生成第二份产品契约；
- 用本地协议模拟器替代真实 adapter 兼容性验收；
- 跨提交复用模型结果的缓存平台。

同一文件内一次昂贵准备可以被多个只读测试复用。
跨提交 evidence cache 只有真实成本证明需要时再设计，不能成为第一版前提。

## 代价

- 没有一张机器生成的全仓 Behavior 图，覆盖审计依赖领域目录、历史缺陷表和 review。
- 各场景 Repo 通过精确锁定的独立 Testkit 复用机械进程与解析原语；领域 fixture 与 expected 仍保持独立。
- 同一公开结果若在多个媒介都有独有契约，需要分别写断言，不能由统一领域对象自动投影。
- 本地没有 Docker、浏览器或密钥时，只能运行满足能力的子集。

这些代价换来的是测试正文可直接阅读、失败可直接复现，并且不会先建设一套与产品规模相当的测试平台。
