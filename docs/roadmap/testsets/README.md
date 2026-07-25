# Testsets —— 分享测试集，构建自己的 benchmark

一批题（eval）应该能像一个包一样被发布、被别人装进自己的项目，别人再从若干测试集里挑出自己关心的那些题、拼成一张卷子，对着自己的 agent 跑分。

现在的 eval 只有一个来源：本仓库的 `evals/` 目录，id 从本仓库的文件路径推导。想用别人的题只能把文件拷进来——拷进来的那一刻，题的 id 变成了拷贝者目录布局的产物，两个人的分数不再指向同一道题；出题人后来修了题面或加了 case，拷贝者也拿不到。这一层缺失把「跨团队比同一批题」压成了口头约定。

这篇提案引入两个概念，把「题从哪来」「比哪张卷」「对着谁跑」拆成三件独立的事。

## 三层分工

| 层 | 概念 | 回答的问题 | 作者是谁 | 身份从哪来 |
|---|---|---|---|---|
| 题库 | **Testset（测试集）** | 有哪些题、每题怎么算对、需要什么环境 | 出题人 | 测试集自己声明的 `id`，跨项目不变 |
| 卷子 | **Benchmark（跑分卷）** | 这次跑分比哪些题、用哪张榜单读 | 组织跑分的人 | 消费者 `benchmarks/` 下的路径 |
| 跑法 | **Experiment（实验）** | 对着哪个 agent、哪个 model、跑几次 | 跑分的人 | 消费者 `experiments/` 下的路径 |

三层沿用 niceeval 已有的那条分界线：**eval 不知道被测的是谁**。Benchmark 同样不知道——它只说比哪些题、读什么分；对着谁跑仍然只有 experiment 一处说了算。所以同一张卷子可以被任意多个 experiment 引用，跨 agent 对比不需要把选题抄第二遍。

## 心智模型

一个**测试集就是一个 niceeval 项目**：它有自己的 `evals/` 目录，题按本来的写法写，多一个包根的 `niceeval.testset.ts` 声明身份。出题人不需要学第二套写法，本地怎么写题，发出去就是什么。

消费者装了它之后，这些题以 `<测试集 id>/<测试集内的 id>` 的形式出现在发现结果里，和本地 `evals/` 下的题并排，被同一套 `--tag`、id 前缀、experiment 谓词选择。

```text
@someone/swe-memory        本地 evals/
  evals/recall/a.eval.ts     evals/billing/refund.eval.ts
  evals/recall/b.eval.ts
        │                              │
        └──────────┬───────────────────┘
                   ▼  统一的发现结果
     swe-memory/recall/a   swe-memory/recall/b   billing/refund
                   │
                   ▼  benchmarks/memory-v1.ts 挑题
          一张卷子（题集 + 榜单 + 内容指纹）
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
 experiments/codex.ts   experiments/claude.ts     ← 各自的 agent
```

## 最短路径：用别人的测试集

```sh
pnpm add @someone/swe-memory
```

```typescript
// niceeval.config.ts
import { defineConfig } from "niceeval";
import sweMemory from "@someone/swe-memory";

export default defineConfig({
  testsets: [sweMemory],
});
```

```typescript
// benchmarks/memory-v1.ts → benchmark id: memory-v1
import { defineBenchmark } from "niceeval";

export default defineBenchmark({
  description: "记忆机制跑分：swe-memory 的 recall 分区 + 我们自己的两道回归题",
  evals: (e) =>
    (e.testset === "swe-memory" && e.tags.includes("recall")) ||
    e.id.startsWith("billing/"),
});
```

```typescript
// experiments/codex.ts
import { defineExperiment } from "niceeval";
import memoryV1 from "../benchmarks/memory-v1.ts";
import { codexAgent } from "./agents.ts";

export default defineExperiment({
  benchmark: memoryV1,
  agent: codexAgent(),
  model: "gpt-5.4",
  runs: 3,
});
```

```sh
niceeval exp
```

再写一个 `experiments/claude.ts` 换掉 `agent`，两条线就在同一张卷子上可比——`benchmark` 字段保证两个实验的选题与题目内容完全一致，不靠人肉核对两份 `evals` 谓词有没有写歪。

## 最短路径：把自己的题发出去

出题人的仓库里加一个包根声明：

```typescript
// niceeval.testset.ts
import { defineTestset } from "niceeval";

export default defineTestset({
  id: "swe-memory",
  description: "跨会话记忆能力的 40 道题",
  evals: "./evals",
});
```

`package.json` 把它设成入口，`npm publish`。消费者装包、在 config 里引用，题就出现在他们的发现结果里。

## 跨人可比靠什么

分数能不能横着比，取决于两个人跑的是不是同一批题的同一个版本。这件事不靠版本号约定，靠**内容指纹**：每个测试集按其全部 eval 源码算一个 `contentHash`，每张 benchmark 按「解析后的选题集合 + 各来源测试集的 contentHash」算一个 benchmark 指纹，两者都随快照落盘。

- 指纹一致的两份结果是同一张卷，可以直接并到一张榜单上。
- 指纹不一致的，报告如实标成不同版本的卷子，不做静默合并。
- CI 想把题库悄悄升级当红灯拦下来的，在 benchmark 上写 `pin`，指纹不匹配即启动期报错。

测试集内容进可比性配置，和 `model`、`flags`、`sandbox` 同类——它改变的是单题被测行为与判定，不是编排选择。

## 待裁决分歧

这些问题定稿前必须有答案，正文的候选契约按当前倾向写，不代表已经裁决。

1. **`as` 别名要不要允许。** 消费者本地 `evals/` 有个同名顶层目录时会与测试集 id 撞车。允许 `as` 重命名前缀能解冲突，也能同时装同一测试集的两个版本做题目改版对比；代价是被重命名的 eval id 不再是跨人共享的那个坐标。候选：(a) 允许，快照同时记原始 id 与别名，报告按原始 id 对齐；(b) 禁止，碰撞时要求消费者改本地目录名。
2. **Benchmark 这一层是不是必须。** 只做 Testset、让 experiment 的 `evals` 谓词直接选题也能跑起来，代价是每个 experiment 重复一份选题、跨人对比缺一个共享身份。反方论点是三层比两层重，而 `evals` 谓词已经存在。
3. **`benchmark` 与 `experiment.evals` 的关系。** 当前候选是互斥（写了 `benchmark` 就不能再写 `evals`）。另一候选是允许 benchmark 之上再收窄，代价是「同一张卷」的承诺失效。
4. **测试集能不能带自己的运行缺省。** 出题人知道自己的题需要什么裁判模型、多长超时。让 `defineTestset` 带一份缺省要回答它在[四层解析链](../../feature/experiments/architecture.md#resolved-config一次求值处处同源)里插在哪；不带则出题人只能写进每道 eval。
5. **`Benchmark` 这个词的归属。** 仓库里 `docs/engineering/benchmark/` 现在指阶段耗时与安装的性能基准。同一个词两个意思要裁一次：给用户概念留 `Benchmark`、工程那篇改称性能基准，还是给用户概念换词。
6. **分发形态先支持哪些。** npm 包是主路径；git URL 与本地相对路径（monorepo 内共享题库）是不是同批支持。
7. **结果要不要能分享。** 跨团队榜单需要把别人的快照拿进来；这可能只是 [Results 的搬运能力](../../feature/results/README.md)加一个来源，也可能需要独立设计。

## 相关阅读

- [Library](library.md) —— `defineTestset` / `defineBenchmark` 的候选形状、引用与环境映射。
- [Architecture](architecture.md) —— id 命名空间、内容指纹、发现流程与数据形状。
- [CLI](cli.md) —— `niceeval testset` 与 `list` / `exp` 的期望反馈。
- [影响面](impact.md) —— 这份提案定稿时，既有契约各要改成什么。
- [Eval](../../feature/eval/README.md) —— 题本身怎么写；测试集不改变这套写法。
- [Experiments](../../feature/experiments/README.md) —— 跑法这一层的现有契约。
</content>
</invoke>
