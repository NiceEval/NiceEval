# runner-history 场景 Repo（docs 示例）

历史去重语义的独立消费 Repo：`experiments/smoke.ts` 用仓库自有的本地确定性 agent
（`agents/fixture.ts`，`defineDirectAgent`，不连任何 provider），包含一条确定性通过 eval。
本 Repo 证明 `--history` 的跨快照去重按 attempt 身份键工作：强制重跑追加一条**新身份**
的 attempt、旧身份原样保留，全携入 run 不派发任何新 attempt、身份集合不变
（这是 history 身份风险，不冒充某个历史 commit 的因果回归）。

断言用身份集合（locator 是公开 attempt 身份）而不是行数猜测。

## 怎么跑

```sh
# NiceEval 根目录
pnpm e2e --repo runner-history -- --run test/history-dedup.test.ts

# 已安装候选包的隔离 Repo 根目录
pnpm test --run test/history-dedup.test.ts
```

测试自己跑 `pnpm exec niceeval exp smoke ...` 与 `pnpm exec niceeval show
suite/stable --history --json`，完整命令都在调用点，不读 `.niceeval/` 私有布局。

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
| `evals/suite/stable.eval.ts` | 一条确定性通过 eval |
| `experiments/smoke.ts` | `defineExperiment({ agent, evals: ["suite/"] })` |
| `test/history-dedup.test.ts` | 身份集合不变的去重断言：一次新身份、零重复行 |
| `test/support/` | 本 Repo 自有的进程收据与机械断言辅助 |
