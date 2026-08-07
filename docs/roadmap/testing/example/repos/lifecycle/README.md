# Lifecycle 场景 Repo（docs 示例）

中断与资源终结功能的独立消费 Repo，不借用 Adapter backend。`experiments/slow.ts` 的实验级
`setup` / `teardown` Hook 对**拥有一个 backend 进程**。该进程由 `fixtures/backend.mjs` 提供本地 HTTP 服务。
它把 pid 与动态端口写入每条测试独有的系统临时目录；`experiments/post-interrupt-consumer.ts` 是中断后的下一消费者。

## 功能归属

这条测试长期归属 [Experiment 级共享服务](../../../../../feature/experiments/use-case/生命周期/启动共享服务.md)；
因此测试仍放在 Lifecycle 功能 Repo，并按中断后的用户结果命名，不另建 Bug Repo 或用 issue 编号命名。

[强清退出曾跳过 Experiment teardown](../../../../../../memory/force-exit-skips-experiment-teardown.md) 是相关历史风险，
但当前 case 只发送一次 SIGINT，没有确定性进入二次 Ctrl+C 或 watchdog 强清路径，所以不写 `regression:`。
将来若增加强清 case，必须先证明它能让 fix parent 在 teardown 或 owned backend 断言处失败，才可引用该 memory。

## 运行拓扑

`e2e.json` 声明 `host` executor。根 runner 只创建独立项目副本；Vitest、NiceEval CLI 与
`backend.mjs` 都作为本机或 GitHub Actions runner 上的进程运行。本场景不启动 Docker，项目副本隔离也不等于容器隔离。

```text
host / Actions runner
└─ Vitest
   └─ pnpm exec niceeval exp slow
      └─ node fixtures/backend.mjs <unique-temp-path>
```

本 Repo 保留 Vitest 默认的文件级并行，不设全 Repo 串行闸。当前只有一个测试文件，因此没有可并行的兄弟文件。
以后新增文件时，每条 case 必须拥有控制文件、进程组和资源身份；会改当前结果的 case 再使用独立结果根或项目副本。

本 Repo 等 owned backend **真启动**（`/health` 返回 200）后再发 SIGINT。
进程退出码为 130，`result` 折叠成 `interrupted`，实验级 teardown 照常执行
（`experiment_teardown` 事件）。随后 owned 资源消失：backend 自己的 pid
（不是父进程 pid）与端口都不可达；下一消费者仍可正常启动。
无 orphan 的判断以 owned 资源本身为准，只查父 PID 不算数。

## 怎么跑

```sh
# NiceEval 根目录
pnpm e2e --repo lifecycle -- --run test/interrupt-cleanup.test.ts

# 已安装候选包的隔离 Repo 根目录
pnpm test --run test/interrupt-cleanup.test.ts
```

测试运行 `pnpm exec niceeval exp slow --json`，等待私有 `backend.json` 与 `/health`，再发送 SIGINT。
它核对收据与资源消失后运行 `exp post-interrupt-consumer --rerun all --json`。
完整命令都在调用点，不读 `.niceeval/` 私有布局。`backend.json` 是本 Repo 的短命 fixture 收据，不是要收集的产品 artifact。

## lockfile 规则（正式）

- 本目录是 docs 示例，**不签入、不手写** `pnpm-lock.yaml`：文档里手写的 lockfile 必然
  过期，只制造"看起来可复现"。真实实现时 `pnpm install` 生成 lockfile 并随代码签入。
- 根 runner 在**临时副本**里把 `niceeval` 依赖替换成候选 tarball，安装后核对实际 executable
  到的包与 tarball 指纹一致；独立 checkout 不注入候选时，测的就是 lockfile 锁定的
  已发布的对照版本（本示例依赖声明 `niceeval ^0.4.6`）。
- 本目录不是 pnpm workspace 成员；真实 e2e Repo 需要自带只含 `packages: []` 的
  `pnpm-workspace.yaml`，让自己成为 workspace root、不向上并入父级。

## 内容

| 路径 | 角色 |
|---|---|
| `agents/fixture.ts` | 本地确定性 agent 与慢速 agent（一轮睡 60s，留出发送 SIGINT 的时间段） |
| `evals/suite/{slow,post-interrupt-consumer}.eval.ts` | 慢速 Eval 与下一消费者的快速通过 Eval |
| `experiments/slow.ts` | `setup` 起 owned backend（写私有 `backend.json`）、`teardown` 收掉（SIGTERM → SIGKILL 升级） |
| `experiments/post-interrupt-consumer.ts` | 中断后的下一消费者 Experiment |
| `fixtures/backend.mjs` | owned backend：本地 HTTP 服务，`/health` 200 |
| `test/interrupt-cleanup.test.ts` | 130 / teardown / 资源消失 / 下一消费者 |

本 Repo 没有 `test/support`。`withTempDir()`、`withProcess()`、`pollUntil()`、严格 NDJSON 与唯一项选择来自 Testkit。
`backend.json`、`/health`、事件身份和 PID / 端口 oracle 仍属于 Lifecycle 测试。
