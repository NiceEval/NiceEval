# 共享 Eval：原生题目怎样跨项目复用

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

一组已经能被 NiceEval 发现的 Eval，本身就是可复用题集。
发布方不应为了共享再写 `suite.ts`、manifest、适配器或导出入口。
这里承诺的是“零共享协议文件”，不是替一个不完整或依赖声明错误的 package 自动补齐内容。

这个设计比较三种交付形态：复制题目、建立 NiceEval registry、挂载另一个已安装 NiceEval 项目的 Eval 目录。
推荐 [PLAN-3](PLAN-3/README.md)：分发与版本由项目已有的 package manager 负责，NiceEval 只扩展多根发现和逐 Eval 来源记录。

## 推荐路径一眼看完

发布方继续维护原来的 NiceEval 项目，不增加任何共享专用文件：

```text
terminal-bench/
├── package.json
├── niceeval.config.ts
├── evals/terminal-bench/<task-id>/eval.ts
└── experiments/
```

消费方把该仓库作为精确版本的项目依赖安装，再声明从哪个目录取 Eval：

```ts
// niceeval.config.ts
import { defineConfig } from "niceeval";

export default defineConfig({
  evalRoots: {
    "terminal-bench": {
      package: "terminal-bench",
      root: "evals/terminal-bench",
    },
  },
});
```

挂载 key 是消费项目内前缀。
`root` 是发布项目 package root 内的 Eval 发现根；省略时默认为 `evals`。

项目随后照常使用 Eval id：

```sh
niceeval list terminal-bench/
niceeval exp codex terminal-bench/hello-world --dry
niceeval exp codex terminal-bench/
```

`terminal-bench/hello-world` 仍是一条普通 Eval。
它沿用原来的 Sandbox、Task、Assertion 与 Record 主线；共享来源增加 owner/provenance 事实，但不增加第二套运行模型。

## 谁需要做什么

| 角色 | 必需动作 |
|---|---|
| 发布方 | 不写共享专用内容；所选 Git/package 来源按普通规则包含 Eval、资产与运行期依赖 |
| 消费方 package manager | 安装仓库、tarball 或 package，并在项目 lockfile 固定精确解析 |
| 消费方 NiceEval 配置 | 声明 package、Eval root 与项目内挂载前缀 |
| NiceEval | 发现外部根、隔离来源、捕获逐 Eval 输入，并运行普通 Experiment |

“发布方零共享协议新增”不等于 NiceEval 能读取未交付的文件。
如果 npm tarball 的 `files` 或 `.npmignore` 排除了 `evals/`，消费方应改用包含它们的 Git 依赖，或由发布方修正常规 package 内容。

## 为什么不新增 `eval.lock`

共享 Eval 包含可执行 TypeScript、它静态 import 的项目内模块和题目资产。
这些内容已经属于项目依赖图，`pnpm-lock.yaml`、`package-lock.json` 或 `yarn.lock` 会固定 package、Git commit、tarball integrity 与传递依赖。

NiceEval 的指纹与 manifest 再按 Eval 保存 source、可达 dependency、runtime revision 与 transfer 输入。
package lock 回答“安装了哪些字节”，Eval 指纹回答“哪几条结果受这些字节影响”；另加 `eval.lock` 只会制造第二个可能分叉的依赖真相。

package lock 不能只躺在仓库里而不参与携带判断。
NiceEval 必须把 Git commit/integrity 和逐 Eval 可达依赖身份只读投影到 manifest 与 Record；这不是第二份 lock，也不能反向用于安装。

## 实现前置裁决

Sol Max 红队验证后，PLAN-3 方向保留，但禁止把它缩水成“扫描另一个目录”。
第一版包含五项前置能力：

- Node >=22.15 的 ESM/CJS runtime binding；
- owner-root capability；
- dependency/runtime fingerprint；
- 运行期 transfer manifest；
- definition/execution provenance。
Terminal-Bench 238 条都能零共享协议改造运行；其中 10 条随机 Compose 题第一版保守重跑，不虚构全套精确携带。

Harbor 的任务是语言中立归档，所以它需要自己的 registry 与任务 digest。
NiceEval Eval 是已处于 TypeScript 依赖图中的原生模块，不应照搬同一套分发层。

## 接着读哪一篇

- 目标与非目标见 [GOALS](GOALS.md)。
- 外部框架做法与 NiceEval 现有约束见 [LIMITS](LIMITS.md)。
- 固定场景与验收结果见 [CASES](CASES.md)。
- 推荐 API、CLI、内部边界与时序从 [PLAN-3](PLAN-3/README.md) 进入。
- Terminal-Bench 的完整零发布改造示例见 [用例](PLAN-3/use-case/terminal-bench.md)。
