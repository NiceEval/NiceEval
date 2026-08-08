# 原生 LLM Judge Runtime —— 库用法

公开作者面只有一个 LLM 注册入口：`t.judge.llm(check)`。
`turn.judge.llm` 与 `session.judge.llm` 使用同一份 Check，只改变 `material.current()` 的默认 scope。

## 单条 rubric

最短写法把当前 scope 作为 candidate，并使用 `default` profile：

```ts
t.judge.llm({
  name: "回答有依据",
  rubric: "回答中的事实都能由工具结果支持，且没有补写未经支持的数字。",
}).atLeast(0.8);
```

`name` 是报告标题，`rubric` 是评分标准。
阈值、Severity、`.optional()` 与 `.points(n)` 继续由 Assertion handle 表达，不进入 rubric。

## Judge Check

`t.judge.llm` 接收穷尽联合。
直接 rubric 与配方调用不能在一个 Check 中混用：

```ts
type LlmJudgeCheck =
  | {
      name: string;
      rubric: string;
      on?: JudgeMaterial | readonly JudgeMaterial[];
      profile?: string;
      scoreMode?: JudgeScoreMode;
      recipe?: never;
      input?: never;
    }
  | {
      name: string;
      recipe: JudgeRecipe;
      input: Record<string, JudgeRecipeInput>;
      profile?: string;
      scoreMode?: never;
      rubric?: never;
      on?: never;
    };

type JudgeScoreMode = "continuous" | "binary";

type JudgeRecipeInput =
  | JudgeMaterial
  | readonly JudgeMaterial[]
  | string
  | number
  | boolean;
```

省略 `profile` 等价于 `default`。
省略 `scoreMode` 等价于 `continuous`。
直接 rubric 被规范化为版本化的内置 `niceeval/rubric` 配方，因此也走静态单节点图。
配方自身固定 score mode，调用配方时不能改写。

`continuous` 接受任意有限 `0..1` 分数。
`binary` 的 Provider response schema 只接受 `0 | 1`，适合原本使用 Y/N 端点的检查；`.gate()` 只判断通过线，不负责把连续分数量化成二元分数。

## 材料

材料工具从 `niceeval/judge` 导出：

```ts
import { material } from "niceeval/judge";

t.judge.llm({
  name: "变更聚焦",
  rubric: "补丁只修改目标逻辑，没有无关格式化。",
  on: [
    material.current({ id: "conversation", role: "context" }),
    material.text(t.sandbox.diff.get("src/weather.ts") ?? "", {
      id: "candidate-diff",
      role: "candidate",
    }),
  ],
});
```

每份材料都有稳定 `id` 和显式 `role`。
`role` 只允许 `candidate`、`reference`、`context` 与 `instruction`；它不改变内容类型。

```ts
type JudgeMaterial =
  | ScopeMaterial
  | TextMaterial
  | JsonMaterial
  | FileMaterial
  | InlineFileMaterial;

interface MaterialBase {
  id: string;
  role: "candidate" | "reference" | "context" | "instruction";
  label?: string;
  retention?: "full" | "digest";
}

type ScopeMaterial =
  | (MaterialBase & {
      kind: "scope";
      scope: "current" | "attempt";
      ref?: never;
    })
  | (MaterialBase & { kind: "scope"; scope: "turn"; ref: Turn })
  | (MaterialBase & { kind: "scope"; scope: "session"; ref: Session });

interface TextMaterial extends MaterialBase {
  kind: "text";
  text: string;
  mediaType: "text/plain" | "text/markdown" | "application/json";
}

interface JsonMaterial extends MaterialBase {
  readonly kind: "json";
  readonly mediaType: "application/json";
  readonly canonicalText: string;
  readonly algorithm: "json-jcs/rfc8785-v1";
}

interface FileMaterial extends MaterialBase {
  kind: "file";
  from: "project" | "sandbox";
  path: string;
  mediaType?: string;
}

interface InlineFileMaterial extends MaterialBase {
  kind: "inline-file";
  filename?: string;
  mediaType: string;
  dataBase64: string;
}
```

`material.current()` 读取调用点的 scope。
`material.turn(turn)`、`material.session(session)` 与 `material.attempt()` 产生显式 scope 材料。
Turn 材料包含该轮用户输入、附件、assistant message 与可用行为事件，不把整个对象做 JSON stringify。

`material.json(value, options)` 在调用点取得 eager、不可变 snapshot。
descriptor-safe walker 接受：

- `null`、boolean、string 与有限 number；
- dense array；
- prototype 为 `Object.prototype | null`，且只含 own enumerable string-keyed data property 的 plain object。

共享但无环的引用按出现位置展开。

类型入口的核心形状是：

```ts
type JsonSnapshotInput<T> =
  T extends null | boolean | string | number ? T
    : T extends (...args: never[]) => unknown ? never
      : T extends readonly unknown[]
        ? { readonly [K in keyof T]: JsonSnapshotInput<T[K]> }
        : T extends object
          ? { readonly [K in keyof T]: JsonSnapshotInput<T[K]> }
          : never;

function json<const T>(
  value: T & JsonSnapshotInput<T>,
  options: MaterialBase,
): JsonMaterial;
```

它拒绝 `undefined`、array hole、`NaN`、Infinity、bigint、symbol key/value、function、accessor、cycle 与 class instance；`Date`、`Map`、`Set` 和 typed array 也不被接受。
walker 不调用 getter 或 `toJSON`，也不沿 prototype 读取。

snapshot 按 RFC 8785 JCS 生成 canonical UTF-8 文本，算法身份是 `json-jcs/rfc8785-v1`。
调用后的对象 mutation 不改变材料、hash 或 Judge 输入。
构造器返回被冻结的 wrapper；canonical bytes 由 Runtime 私有持有，JavaScript 强改公开字段也不能替换该 snapshot。

类型入口使用递归 mapped type 接受 readonly framework facts，而不是要求对象声明 string index signature；runtime 校验仍是最终边界。
JSON 材料形成一个 `application/json` text part，因此 Eval 的静态声明只需要 `media: ["text"]`。

`material.file(path, { from, ... })` 在 Judge 求值时读取文件。
文件扩展名只用于给出 MIME 候选；内容与声明冲突时报作者错误。
HTTP URL 不是材料出处，调用方应先取得字节，再使用项目文件或内联文件。

`retention` 省略时是 `full`，材料内容随 Judge provenance 保存。
`digest` 只保存 hash、大小、MIME 与有界脱敏预览；Provider 仍读取原内容，报告会明确标出内容未保留。

Provider 接收读取后的规范内容 part：

```ts
type JudgeContentPart =
  | { type: "text"; text: string; mediaType: string }
  | { type: "image"; bytes: Uint8Array; mediaType: string }
  | { type: "audio"; bytes: Uint8Array; mediaType: string }
  | { type: "file"; bytes: Uint8Array; mediaType: string; filename?: string };
```

图片不会先转成文本。
Provider 不支持某种 part 时，该请求在模型调用前以 `judge-capability-unavailable` 结束。

## 内置配方

内置配方同样从 `niceeval/judge` 导出，不拥有单独的调用协议：

```ts
import { judges, material } from "niceeval/judge";

t.judge.llm({
  name: "事实与参考一致",
  recipe: judges.factuality,
  input: {
    candidate: material.current({ id: "answer", role: "candidate" }),
    reference: material.text("布鲁克林今天是晴天", {
      id: "weather-reference",
      role: "reference",
    }),
  },
}).atLeast(0.8);

t.judge.llm({
  name: "摘要忠于原文",
  recipe: judges.summary,
  input: {
    candidate: material.current({ id: "summary", role: "candidate" }),
    source: material.text(article, { id: "source", role: "reference" }),
  },
});
```

内置集合包含 `rubric`、`factuality` 与 `summary`。
三者都输出同一个 `JudgeDecision`，且输入槽名表达语义。
新增内置配方不能新增另一种结果 envelope 或 Provider 调用方式。

## 自定义单节点配方

`defineJudge` 声明可复用 rubric 配方：

```ts
import { defineJudge } from "niceeval/judge";

export const safeForAge = defineJudge({
  id: "acme/safe-for-age",
  version: 1,
  scoreMode: "binary",
  inputs: {
    candidate: { kind: "material", required: true },
    age: { kind: "text", required: true },
  },
  rubric: ({ age }) => `内容适合 ${age} 岁读者，且不包含不适龄细节。`,
  on: ({ candidate }) => [candidate],
});
```

`id` 在项目和依赖图中唯一，`version` 是正整数。
`scoreMode` 省略时是 `continuous`，并成为配方不可由调用者改写的属性。
rubric 语义、输入槽或输出解释改变时必须递增版本。

## 静态 Judge Graph

`defineJudgeGraph` 让一个配方拥有多个节点：

```ts
import { defineJudgeGraph } from "niceeval/judge";

export const answerQuality = defineJudgeGraph({
  id: "acme/answer-quality",
  version: 1,
  inputs: {
    candidate: { kind: "material", required: true },
    reference: { kind: "material", required: true },
  },
  build(g, input) {
    const grounded = g.model("grounded", {
      rubric: "candidate 的事实是否由 reference 支持。",
      on: [input.candidate, input.reference],
    });
    const useful = g.model("useful", {
      rubric: "candidate 是否直接完成用户目标。",
      on: [input.candidate],
    });

    return g.weightedMean("overall", [
      { from: grounded, weight: 0.7 },
      { from: useful, weight: 0.3 },
    ]);
  },
});
```

节点 id 在配方内唯一且稳定。
`build` 只能调用图 builder，不能读取运行条件、时间、随机数或执行 I/O。

builder 提供三类节点：

| API | 作用 |
|---|---|
| `g.model(id, spec)` | 通过 Provider 产生 Decision；`spec.profile` 可覆写 Check 的默认 profile |
| `g.aggregate(id, spec)` | 用内置规则聚合多个结果 |
| `g.fallback(id, primary, secondary)` | primary unavailable 时才执行并选择 secondary |

`weightedMean`、`minimum` 与 `maximum` 是 `aggregate` 的内置便捷入口。
图的返回节点必须产生 `JudgeDecision`。

## Eval 的静态使用声明

Eval 在定义期声明会使用哪些 profile 及模态。
没有声明时，`test(t)` 的类型上不暴露 `t.judge.llm`：

```ts
export default defineEval({
  judge: {
    llm: {
      uses: {
        default: { media: ["text"] },
        vision: { media: ["text", "image"] },
      },
    },
  },
  async test(t) {
    // t.judge.llm(...) 的 profile 只允许 "default" | "vision"
  },
});
```

`uses` 不是模型配置。
它让规划器在 Agent 派发前确定预检目标，并校验 Provider 的模态能力。
Judge Check 实际使用的 profile 或模态超出声明时是作者错误。

## Profile 与 Provider

项目、Eval 与 Experiment 都可以声明同名 profile 的配置层。
读取优先级是 Experiment → Eval → 项目；每个字段独立取第一份已声明值。

```ts
interface LlmJudgeConfig {
  profiles?: Record<string, JudgeProfileConfig>;
}

interface EvalLlmJudgeConfig extends LlmJudgeConfig {
  uses: Record<string, { media: readonly JudgeMedia[] }>;
}

interface JudgeProfileConfig {
  provider?: JudgeProvider;
  model?: string;
  requestTimeoutMs?: number;
  graphTimeoutMs?: number;
  maxAttempts?: number;
  maxConcurrency?: number;
}

type JudgeMedia = "text" | "image" | "audio" | "file";
```

读取后每个被使用的 profile 必须有 Provider 与 model。
预算字段省略时依次取 `180_000`、`300_000`、`3` 与 `1`。

```ts
import { openAICompatibleJudge } from "niceeval/judge/providers";

export default defineConfig({
  judge: {
    llm: {
      profiles: {
        default: {
          provider: openAICompatibleJudge({
            baseUrl: "https://gateway.example.com/v1",
            apiKeyEnv: "MY_JUDGE_KEY",
          }),
          model: "gpt-5.4-mini",
          requestTimeoutMs: 180_000,
          graphTimeoutMs: 300_000,
          maxAttempts: 3,
          maxConcurrency: 1,
        },
      },
    },
  },
});
```

`provider` 是原子字段；一层只能整体替换，不能合并 Provider 内部选项。
模型、预算、重试和并发是 profile 字段，不接受单条 Check 覆写。
Experiment 因此可以对 Judge 模型做 A/B，同时保证同一 Run 的执行身份稳定。

Check 的 `profile` 是图内模型节点的默认值。
配方可以在 `g.model` 上选择另一个已声明 profile，用于多模型复核或跨 Provider fallback。

`judge.llm` 与 `judge.agent` 是两个独立配置槽。
后者的 Agent、Sandbox 与生命周期由 [Agent-as-Judge](../agent-as-judge/library.md) 定义。

Provider 接口是公开扩展边界：

```ts
interface JudgeProvider {
  readonly id: string;
  readonly capabilities: {
    media: readonly ("text" | "image" | "audio" | "file")[];
    decisionProtocol: "native-schema" | "json-text";
  };
  identity(): JsonValue;
  precheck(request: JudgePrecheckRequest): Promise<void>;
  evaluate(request: JudgeModelRequest): Promise<JudgeProviderResponse>;
}
```

`identity()` 不得包含 key 值，但必须包含会改变请求语义的端点、协议和 Provider 版本。
凭据只从 Provider 配置指定的 env 变量读取。
