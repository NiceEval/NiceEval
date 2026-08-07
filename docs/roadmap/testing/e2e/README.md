# E2E：真实场景 Repo

E2E 只负责必须穿过真实公开边界的行为：候选包、外部 cwd、子进程、文件、HTTP、浏览器、真实 SDK / CLI / provider、
signal、sandbox 或下一次消费者。E2E 按流程范围分为单边界与 Journey；Adapter、CLI、Report、Package 与 Lifecycle 是 owner 域。

## Repo 是载体，不是测试模型

每个叶子目录是一个能被复制到仓库外使用的 NiceEval 项目：

- 自己的 `package.json` 与签入 lockfile；
- NiceEval dependency，由根 runner 在副本中替换成候选 tarball；
- 精确版本的 `@niceeval/testkit` devDependency，由 lockfile 固定为稳定外层裁判；
- `niceeval.config.ts`、`evals/`、`experiments/`、需要时的 `reports/`、agent、服务或 Docker Compose；
- 原生 Vitest / Playwright 测试；
- 只描述运行条件的 `e2e.json`。

它不能从 workspace 相对路径 import NiceEval 源码，也不能用“生成过 evidence”代替断言。完整规则见
[真实场景 Repo](scenario-repos.md)。

## 框架分工：复用 runner，只写产品 harness

- CLI、Runner、Package、Adapter 与 Lifecycle Repo 使用 Vitest 的选择、超时、hook、断言和报告能力；
- Report 与包含浏览器的 Journey E2E 使用 Playwright Test 的 `page` fixture、web-first assertion、trace、截图与 browser cleanup；
- 根 `pnpm e2e` 只实现 NiceEval 特有的候选 tarball、Repo 隔离安装、lane / capability 选择、artifact 与资源收据；
- 独立 [Testkit](../testkit.md) 只补跨 Repo 稳定的进程收据、严格数据解码、等待与 cleanup；单 Repo fixture 仍留在本地；
- 完整 `niceeval` argv、readiness 条件与领域 expected 留在测试正文。

这与 [Vite / Vitest / Playwright 等框架工具的自测方式](../../../research/framework-e2e/README.md)相同：复用通用 test runner，
再为自身的真实项目、CLI、server 或候选构建写薄的产品 fixture。NiceEval 不另造 assertion DSL、browser runner
或第二套测试调度器。

## 单边界 E2E

单边界 E2E 只跨一条公开边界或一个紧密动作组。命令、观察和 expected 放在同一文件：

```ts
// regression: d8d5a84b
test("show --json 经 pipe 仍交付完整文档", async () => {
  const result = await runProcess([
    "pnpm", "--silent", "exec", "niceeval", "show", locator, "--json",
  ]);

  expect(result.exitCode, result.diagnostic()).toBe(0);
  expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(128 * 1024);

  const document = parseJson(result.stdout, result.diagnostic());
  expect(document.format).toBe("niceeval.show");
  expect(document.data).toContainEqual(expect.objectContaining({ id: "tail-sentinel" }));
});
```

命令执行器、parser 和 artifact 收集器可以复用；阈值、sentinel 和成功条件不能藏进通用函数。
多种 runner 的目标代码见 [Testkit Example](../example/testkit/README.md)。

## Journey E2E：长用户流程

Journey E2E 证明只有跨域组合才会出现的断裂，不复制每个域的完整矩阵。它连续执行真实用户命令，并在最近接缝立即检查：

```text
init → exp --dry → exp → show --history → show @locator --execution → view --out → 浏览器打开
```

只看最终导出站会把前面错误都折叠成“页面没开”；只检查每条短命令又无法证明 locator 和结果能跨域传递。
Journey E2E 同时保留过程检查点和最终目标，完整代码见 [Example](../example/README.md)。

Journey E2E 使用独立项目副本和结果根。失败后保留副本时，摘要必须给出从第一条失败命令开始的复现方式。

## Adapter

`e2e/adapter/` 是 collection；每个官方 adapter 自己拥有叶子 Repo，另有独立的本地协议 Repo。不能在一个
`adapter/test/` 目录里用不同 fixture 名字冒充多个消费项目：

```text
e2e/adapter/
├── ai-sdk/          # live SDK 与该 SDK 独有的 telemetry / session 证据
├── codex-cli/       # live CLI、隔离 HOME / config 与规范工具身份
├── local-protocol/  # 无密钥的 transport、故障分类与 cleanup
├── claude-code/
├── opencode/
└── bub/
```

两类叶子 Repo 提供互补测试：

| 测试 | 证明 | Lane |
|---|---|---|
| 本地协议 / Docker fixture | NiceEval 自有 transport、断流、超时、错误分类和 cleanup | PR |
| Live SDK / CLI / provider | 上游真实事件形状、鉴权、usage、session、工具身份和版本兼容 | main / nightly / release |

本地 fixture 不能替代 live 兼容性；live smoke 也不能替代可控错误注入。两者若断言同一纯转换矩阵，完整矩阵留 Unit，
Repo 各取有区分力的真实边界代表。

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

浏览器场景先断言目标 URL / HTTP，再按 role 与实体身份操作；不要读 `.niceeval-row-hidden`、固定 sleep 或探测任意节点。
默认直接使用 Playwright Test；只有经测量证明需要跨大量场景共享远端 browser 时，才允许引入专用 browser fixture。

## Package 与 CLI

Package Repo 使用真实 `package.json` 形态验证 CJS、ESM、无 `type`、optional peer 缺席、外部 Report 和公开 example。
CLI Repo 验证 argv、stdin / stdout / stderr、pipe、PTY、exit 与 JSON / NDJSON / JUnit。两者都执行安装后的 binary，
不能直接调用 `src/cli.ts` 或 mock commander / parseArgs 后宣称公开命令已通过。

## Lifecycle

Lifecycle Repo 串行运行，拥有自己的进程组、容器和 sandbox。它不仅检查第一条命令退出，还检查：

- signal 被送到正确进程；
- teardown 与 lease 结束；
- 没有 orphan 或残留容器；
- 下一次独立消费者可以正常启动；
- cleanup 失败不会遮蔽原始失败。

## 单项重跑

任何 E2E 必须能按 Repo、文件和标题重跑：

```sh
pnpm e2e --repo report
pnpm e2e --repo report -- --run test/exported-targets.test.ts
pnpm e2e --repo report -- --run test/exported-targets.test.ts -t "打开 case target"
```

线性 `scripts/e2e.ts` 可以继续作为临时迁移入口，但新增测试不得只追加到一个无法按标题选择的大脚本。

本地、Docker 与 GitHub Actions 见 [Execution](execution.md)。
