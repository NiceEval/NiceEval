# runner-carry 场景 Repo（docs 示例）

携带（carry）语义的独立消费 Repo：`experiments/smoke.ts` 用仓库自有的本地确定性 agent
（`agents/fixture.ts`，`defineDirectAgent`，不连任何 provider），包含两条确定性通过 eval。
本 Repo 证明三件事：dry plan 预测的携入数与真实 run 一致；config 内容变化触发指纹门；
部分补跑不抹掉更早 run 的携入结果（`85cafd7d`）。

会修改 config 或 eval 的场景全部在**隔离副本**（`test/support/project.ts` 的
`copyProject`）里完成，不碰共享现场，也不「改完再写回」。

## 怎么跑

```sh
# 在 NiceEval 根目录：runner 复制本 Repo、注入候选 tarball 后执行指定文件
pnpm e2e --repo runner-carry -- --run test/carry-reuse.test.ts

# 在已经安装候选包的 runner-carry 隔离 Repo 根目录
pnpm test --run test/carry-reuse.test.ts
```

所以它不是“从任意 cwd 跑一份散落的 test”。测试文件属于 `runner-carry` Repo；测试自己跑
`pnpm exec niceeval exp smoke ...`，从 `--dry --json` 计划文档与
`--json` 事件流读回 reused 计数——完整命令都在调用点，不读 `.niceeval/` 私有布局。

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
| `agents/fixture.ts` | 本地确定性 direct agent，每轮回复同一段文字 |
| `evals/simple/{alpha,beta}.eval.ts` | 两条确定性通过 eval，partial 场景只改 alpha 的源码闭包 |
| `experiments/smoke.ts` | `defineExperiment({ agent, evals: ["simple/"] })` |
| `niceeval.config.ts` | 声明 `judge.model`（进 configHash，config 变化场景改它） |
| `test/carry-reuse.test.ts` | dry/run 携入一致、指纹门、full → partial → full（隔离副本） |
| `test/support/` | 本 Repo 自有的进程收据、隔离副本与机械断言辅助 |

## 为什么是本地 fixture agent

携带语义是 runner 纯逻辑，与 provider 身份无关。用真实模型会让每条 E2E case 花钱且抖动；
本地 deterministic agent 让 Repo 无 secret、进 PR lane，verdict 由 eval 字面量决定。
