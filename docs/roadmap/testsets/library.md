# Testsets —— 库用法

出题人怎么把一批题打包成测试集，消费者怎么引用它、拼出自己的 benchmark、接到自己的 experiment 上。心智模型与三层分工见 [README](README.md)。

## `defineTestset` 的形状

测试集声明写在包根的 `niceeval.testset.ts`，默认导出：

```typescript
import { defineTestset } from "niceeval";

export default defineTestset({
  id: string;                       // 命名空间;单个路径片段,进它每道 eval 的 id 前缀
  description?: LocalizedText;      // 人读,出现在 niceeval testset 与报告里
  evals?: string;                   // 题目录,相对本文件;省略 = "./evals"
  homepage?: string;                // 出处链接,反馈里原样展示
  environmentHints?: EnvironmentHints;  // 环境 profile 的推荐映射(见下),消费者显式采用才生效
});
```

`id` 是这个测试集在全世界的名字，也是它每道题 id 的第一段：`evals/recall/multi-session.eval.ts` 在 `id: "swe-memory"` 的测试集里发现成 `swe-memory/recall/multi-session`。它必须是单个合法路径片段——不含 `/`、`\`，不是 `.` / `..`，不含控制字符。**测试集的 id 由出题人钉死，不从消费者的目录布局推导**，这是跨人可比的前提：同一道题在谁的项目里都叫同一个名字。

测试集里没有版本字段。人读的版本标签取包的 `package.json.version`；可比性的权威是内容指纹（见 [Architecture · 内容指纹](architecture.md#内容指纹可比性的权威)），它由题目源码算出，不依赖出题人记得 bump 版本号。

题本身照 [`defineEval`](../../feature/eval/README.md) / `defineScoreEval` 写，一个字不用改：`tags`、`environment`、`timeoutMs`、`judge`、数据集扇出、沙箱型题全都照常。测试集只是给它们一个稳定的命名空间和一个发布出口。

### 出题人的目录

```text
swe-memory/
├── package.json            # main / exports 指向 niceeval.testset.ts
├── niceeval.testset.ts     # defineTestset 默认导出
└── evals/
    ├── recall/multi-session.eval.ts
    └── recall/summarize.eval.ts
```

出题人自己的仓库里同时可以有 `experiments/` 和 `niceeval.config.ts`，用来在本地验证这批题——那些文件不进发布产物，也不被消费者装载。测试集只贡献题。

## 引用测试集：`config.testsets`

```typescript
// niceeval.config.ts
import { defineConfig } from "niceeval";
import sweMemory from "@someone/swe-memory";
import teamRegression from "../shared/regression/niceeval.testset.ts";

export default defineConfig({
  testsets: [sweMemory, teamRegression],
});
```

`testsets` 收 `defineTestset` 的产物，不收包名字符串——引用是普通 import，路径解析、类型检查、跳转都交给宿主的模块系统，niceeval 不实现第二套包解析。monorepo 里直接 import 相对路径的 `niceeval.testset.ts`，效果与装包一致。

引用之后，测试集的题和本地 `evals/` 的题进入同一份发现结果，被同一套机制选择：CLI 位置参数（`niceeval exp swe-memory` 命中整个测试集，`niceeval exp swe-memory/recall` 命中一个分区）、`--tag`、benchmark 与 experiment 的谓词。

## `defineBenchmark` 的形状

benchmark 放消费者的 `benchmarks/` 目录，默认导出，id 从路径推导：

```typescript
// benchmarks/memory-v1.ts → id: memory-v1
import { defineBenchmark } from "niceeval";

export default defineBenchmark({
  description?: LocalizedText;
  evals: "*" | readonly string[] | ((e: EvalDescriptor) => boolean);  // 比哪些题
  report?: ReportDefinition;      // 这张卷的默认榜单;show / view 不带 --report 时装载
  pin?: string;                   // 期望的 benchmark 指纹;不匹配即启动期报错
});
```

`evals` 与 experiment 的同名字段完全同形——同一个只读 `EvalDescriptor` 谓词，只是多了 `e.testset` 这个来源字段。选题表达式从 experiment 搬到 benchmark 之后，experiment 只剩「对着谁跑」。

```typescript
export default defineBenchmark({
  description: "swe-memory 的 recall 分区 + 本地 billing 回归",
  evals: (e) =>
    (e.testset === "swe-memory" && e.tags.includes("recall")) ||
    e.id.startsWith("billing/"),
});
```

显式 id 列表是可比性最强的写法——题库新增题目不会悄悄改变卷面：

```typescript
export default defineBenchmark({
  evals: ["swe-memory/recall/multi-session", "swe-memory/recall/summarize"],
});
```

选中的题必须同一题型（`EvalDescriptor.scoring`），与 experiment 现有的[同型约束](../../feature/experiments/README.md#defineexperiment-的形状)同源：通过率和总分不能相加，一张卷只回答一种读数。

### `pin`：把题库漂移当红灯

```typescript
export default defineBenchmark({
  evals: (e) => e.testset === "swe-memory",
  pin: "bm:sha256-3f9c1a…",
});
```

省略 `pin` 时指纹照常算、照常落盘，只是不校验——本地探索不该被一个哈希卡住。写了 `pin` 而实际指纹不同，即启动期配置错误，反馈见 [CLI](cli.md#指纹与-pin-不匹配)。CI 里的跑分卷应该写 `pin`：题库升级时红灯一次，人确认后更新哈希，比事后发现榜单换了卷面便宜得多。

### 分享一张卷

benchmark 是普通模块，可以从测试集包里 re-export，让消费者用出题人推荐的那张卷：

```typescript
// benchmarks/official.ts
export { default } from "@someone/swe-memory/benchmark";
```

benchmark 的 **id 永远由消费者的路径推导**，即使内容来自别人。理由：id 是「我这次要比的那张卷」的本地引用名，跨人对齐靠指纹不靠名字。这与 eval id 由出题人钉死是两件事——eval id 是要写进榜单横轴的共享坐标，benchmark id 不是。

## experiment 引用 benchmark

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

`benchmark` 与 `evals` 在一个 experiment 里互斥：卷面只能有一个来源，两个都写是启动期配置错误。没写 `benchmark` 的 experiment 行为不变——`evals` 默认 `"*"`，跑发现到的全部题（含测试集贡献的题）。

跨 agent 对比就是换 `agent` 再写一个文件，`benchmark` 那行照抄：

```typescript
// experiments/claude.ts
export default defineExperiment({
  benchmark: memoryV1,          // 同一张卷
  agent: claudeCodeAgent(),
  model: "opus",
  runs: 3,
});
```

两份快照记下同一个 benchmark 指纹，报告可以断言它们比的是同一批题，而不是靠人核对两份谓词。

## 环境 profile：出题人声明需求，消费者给产物

测试集里的沙箱题用 [`environment`](../../feature/eval/README.md#defineeval-的形状) 声明它需要的环境 profile id。这个 id 是 provider-neutral 的需求声明，翻译成具体产物的表在消费者的 sandbox spec 上——测试集不绑 provider，因为出题人不知道消费者用 Docker、E2B 还是 Vercel。

消费者照常写 [`environments` 表](../../feature/sandbox/library/prebuilt-environments.md#按-environment-选预制产物)：

```typescript
// niceeval.config.ts
export default defineConfig({
  testsets: [sweMemory],
  sandbox: dockerSandbox({
    image: "node:22",
    environments: {
      "python-3.9-astropy": { image: "ghcr.io/me/astropy-3.9:1" },
    },
  }),
});
```

选中的题声明了 profile 而表里没有这一项，是启动期配置错误——这条规则不因题来自测试集而放宽，只是反馈要多说一句「这个 profile 是 `swe-memory` 要的」，见 [CLI](cli.md#缺环境映射)。

### `environmentHints`：出题人给的推荐映射

出题人通常知道自己的题在哪个镜像上跑得起来。测试集可以带一张推荐表：

```typescript
// niceeval.testset.ts
export default defineTestset({
  id: "swe-memory",
  environmentHints: {
    docker: { "python-3.9-astropy": { image: "ghcr.io/swe-memory/astropy-3.9:1" } },
    e2b: { "python-3.9-astropy": { template: "swe-memory-astropy-39" } },
  },
});
```

它**永不隐式生效**。消费者要用就显式摊开：

```typescript
sandbox: dockerSandbox({
  image: "node:22",
  environments: { ...sweMemory.environmentHints.docker },
}),
```

不隐式生效是[「不猜 Provider」纪律](../../concepts.md#被测对象与适配器)的延伸：跑别人的题会拉别人的镜像，这必须是消费者按下的一个动作，不能是装个包就发生的副作用。

## 相关阅读

- [README](README.md) —— 三层分工、跨人可比与待裁决分歧。
- [Architecture](architecture.md) —— id 命名空间、指纹算法、发现流程与穷尽数据形状。
- [CLI](cli.md) —— `niceeval testset` 与各类错误反馈。
- [Eval Library](../../feature/eval/library.md) —— 题怎么写、数据集怎么扇出。
- [Experiments Library](../../feature/experiments/library.md) —— `evals` 谓词、labels 与 flags 的现有契约。
- [预制环境](../../feature/sandbox/library/prebuilt-environments.md) —— `environments` 表的完整语义。
</content>
