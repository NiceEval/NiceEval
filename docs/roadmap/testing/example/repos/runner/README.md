# Runner 场景 Repo（docs 示例）

本 Repo 是 Runner 功能自己的无密钥消费现场，不从 Adapter Repo 借 Agent 或结果。`experiments/carry.ts` 与 `experiments/history.ts`
共用本地确定性 agent，但每个测试文件拥有一个长期命题：

- `carry-reuse.test.ts`：dry plan、真实 dispatch、config 指纹与部分补跑；
- `history-dedup.test.ts`：强制重跑追加新 attempt，全携入不复制旧身份。

会修改 config 或 eval 的 carry case 使用 `@niceeval/testkit` 的 `withProjectCopy()`。
复制起始目录、排除项和 `node_modules` 链接仍在测试文件头可见。

## 怎么跑

```sh
# 在 NiceEval 根目录：按 Runner 子功能选择文件
pnpm e2e --repo runner -- --run test/carry-reuse.test.ts
pnpm e2e --repo runner -- --run test/history-dedup.test.ts

# 在已经安装候选包的 Runner 隔离 Repo 根目录
pnpm test --run test/carry-reuse.test.ts
pnpm test --run test/history-dedup.test.ts
```

测试分别执行 `niceeval exp carry ...` 与 `niceeval exp history ...`。固定 launcher 位于文件头，
每次调用保留子命令和 flags；观察只来自公开 plan、事件流与 `show --history --json`。

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
| `evals/simple/{alpha,beta}.eval.ts` | carry 的两条确定性 eval，partial case 只改 alpha |
| `evals/suite/stable.eval.ts` | history 的稳定通过 eval |
| `experiments/{carry,history}.ts` | 同一 Repo 内两个独立 Runner 实验 |
| `niceeval.config.ts` | 声明 `judge.model`（进 configHash，config 变化场景改它） |
| `test/carry-reuse.test.ts` | dry/run 携入一致、指纹门、full → partial → full（隔离副本） |
| `test/history-dedup.test.ts` | attempt 身份集合的追加与去重 |

本 Repo 没有 `test/support`。进程、严格 JSON / NDJSON、唯一项选择与项目副本生命周期都来自
精确版本的 `@niceeval/testkit`；Runner 的领域类型、命令和 expected 留在测试正文。

## 为什么是本地 fixture agent

这些 Runner 语义与 provider 身份无关。真实模型会引入与命题无关的协议和输出变量，无法区分 carry 接线错误；
本地确定性 agent 让输入、verdict 和历史身份由签入 fixture 独立给出。真实 provider 兼容性另由 Adapter Repo 证明。
