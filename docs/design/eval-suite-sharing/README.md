# 共享 Eval：原生题目怎样跨项目复用

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3（未采用）](PLAN-3/README.md) · [DECISION](DECISION.md)

一组已经能运行的 NiceEval Eval 可以由其它 NiceEval 项目消费。
发布方继续维护原有题目、模块和资产，消费方为自己要使用的每道题写一个远程 Eval 文件。

这个设计比较复制题目、建立 NiceEval registry、自动发现外部根目录和显式远程 Eval 文件四种形态。
推荐文件级方案：package manager 负责交付与锁定 package，消费项目用 `defineRemoteEval` 明确登记每一道外部题。
落地后的产品契约在 [Feature · 共享 Eval](../../feature/eval/sharing.md)；本目录保留候选比较和选型理由。

## 推荐路径一眼看完

发布方维持普通 NiceEval 项目，不增加共享专用文件：

```text
terminal-bench/
├── package.json
├── niceeval.config.ts
├── evals/terminal-bench/<task-id>/eval.ts
└── experiments/
```

消费方把该仓库作为直接依赖安装，然后为要纳入项目的一道题写一个普通 Eval 文件：

```ts
// evals/terminal-bench/hello-world.eval.ts
import { defineRemoteEval } from "niceeval";

export default defineRemoteEval({
  package: "terminal-bench",
  root: "evals/terminal-bench",
  eval: "hello-world",
});
```

这个文件由项目自己的 `evals/` 发现器读取。
它的路径形成项目内 Eval id：`evals/terminal-bench/hello-world.eval.ts` 形成 `terminal-bench/hello-world`。
安装 `terminal-bench` 本身不会加入任何 Eval，也不会扩张项目 catalog。

Experiment 继续按普通 `evals` selector 选择 `terminal-bench/hello-world` 或 `terminal-bench/`。
它不需要 package selector、远程 selector 或第二套 Experiment。

## 谁拥有什么

| 内容 | owner |
| --- | --- |
| 远程 Eval 文件的路径和项目内 Eval id | 消费项目 |
| 上游 Eval、Task、Sandbox、Fixture、Assertion 与项目内模块 | 上游 package |
| package 版本、Git commit 和传递依赖选择 | 消费项目 package manager 与 lockfile |
| Agent、model、attempts、flags、预算与运行选择 | 消费项目 Experiment |
| 已安装 package 身份、package provenance 和携带资格 | NiceEval 的只读 provenance facts |

远程 Eval 文件只引用上游题目，不能 patch 或 override 它的定义。
要改 Task、Sandbox、Fixture 或 Assertion，发布方应修改上游并让消费方升级依赖，或消费方 fork 出新的 package 上游。

## 为什么没有 `eval.lock`

共享 Eval 是会 import `niceeval` 与其它 TypeScript package 的可执行代码。
消费项目的 package lock 已经固定 package、Git commit、tarball integrity 与传递依赖，NiceEval 只验证并持久化这个选择。

NiceEval 的 provenance facts 回答「这次运行用了哪个已安装 package」；它不承担安装，也不能反向重建依赖树。
额外的 `eval.lock` 会让同一份依赖出现第二个 owner。

## 接着读哪一篇

- 目标与非目标见 [GOALS](GOALS.md)。
- 外部框架做法与 NiceEval 约束见 [LIMITS](LIMITS.md)。
- 固定场景与验收结果见 [CASES](CASES.md)。
- 推荐 API、CLI、内部边界与时序从 [DECISION](DECISION.md) 与 Feature 契约进入。
- 自动扫描 package 根目录的历史候选见 [PLAN-3（未采用）](PLAN-3/README.md)。
