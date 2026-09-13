# Assertions —— 自定义 Match

完整模型见 [Assertions](../README.md)。自定义 Match 只描述“这个 value 怎样比较”，不描述作者位置、scope、policy 或运行控制。

## Match 的边界

一个 Match descriptor 必须可复用、不可变且无副作用。普通自定义 Match 的 evaluator 还必须确定性且无副作用；它可以返回 Boolean result，或 finite `[0,1]` measurement。它不能保存 subject identity、callsite、groupPath、`key`、`label`、score、gate 或 stop condition，也不能自行从 ctx 取值。受管 collection combinator 的求值结果是 `matched`、`mismatched` 或 `unavailable`，并按需带 typed artifact；它们不是不带状态的 boolean。

```ts
const hasRequiredFields = defineValueMatch({
  name: "has-required-fields",
  evaluate: (value: unknown) =>
    isRecord(value) && typeof value.id === "string" && typeof value.title === "string",
});

t.check(payload, hasRequiredFields).label("返回必填字段");
```

Match 与 Assertion 分工明确：Match 比较 value；`t.check(value, match)` 读取调用时 value 并登记 Assertion；handle 再配置同一 entry。

## 连续 evaluator

`defineScoreMatch` 返回不可变 `ScoreMatch<T>`。普通 callback 返回数值或 Promise；高级 callback 声明受管 LLM 能力并组合 Effect。
`defineJudge` 与现成裁判都调用这个公开工厂，返回真实 ScoreMatch；check 统一准备、登记和执行。

连续 Match 本身只描述怎样得到 measurement，不保存 minimum。Pass 与 Score 都在登记后的 handle 上用 `.gate(minimum)` 建立显式质量门；Score 还可用 `.score(points)` 贡献分值。两者可在同一 entry 上任意先后组合，evaluator 仍只运行一次。

```ts
const similarity = defineScoreMatch({
  name: "answer-similarity",
  score: (actual: string) => compare(actual, expected),
});

pass.check(reply, similarity).gate(0.8);
score.check(reply, similarity).score(5);
score.check(reply, similarity).gate(0.8).score(5);
```

measurement handle 还可用 `.orStop(minimum)` 建立只影响控制流的 condition；它不会隐式 gate。已经调用 `.gate(minimum)` 后，使用无参 `.orStop()` 复用同一 condition。minimum 必须是有限 `[0,1]` 数值，同一 entry 不能建立第二个 condition。

数值 `atLeast(n)` 是比较 number subject 的 Boolean Match；工具和事件的 `.atLeast(count)` 是 occurrence 数量约束。它们与 continuous measurement handle 的 `gate(minimum)`／`orStop(minimum)` 不属于同一组合器。

## 受管 LLM Match

高级定义的 version、config 和 llm 限制组成显式身份。config 在定义时完成 canonical JSON 快照并冻结。
callback 使用登记时的材料快照；它不能读取 t、Turn 或 Session 的隐式材料。
以下是高级定义与 callback 结果的完整形状：

```ts
type ScoreMatchLlmFailure =
  | { readonly _tag: "ScoreMatchLlmUnavailable"; readonly code: string; readonly message: string }
  | { readonly _tag: "ScoreMatchLlmErrored"; readonly code: string; readonly message: string };
type ScoreMatchResult =
  | number
  | { readonly state: "measured"; readonly measurement: number; readonly rationale?: string }
  | { readonly state: "unavailable"; readonly reason: string; readonly rationale?: string }
  | { readonly state: "errored"; readonly code: string; readonly message: string };
interface ManagedScoreMatchOptions<T, E = ScoreMatchLlmFailure> {
  readonly name: string;
  readonly version: string;
  readonly config: JsonValue;
  readonly llm: {
    readonly maxCalls?: number;
    readonly maxMaterialBytes?: number;
    readonly maxAuditBytes?: number;
  };
  readonly score: (value: T, context: ScoreMatchContext) =>
    Effect.Effect<ScoreMatchResult, E>;
}
interface ScoreMatchContext {
  readonly llm: {
    score(input: {
      readonly rubric: string;
      readonly anchors: readonly { readonly measurement: number; readonly description: string }[];
      readonly material: JsonValue;
    }): Effect.Effect<LlmScoreResult, ScoreMatchLlmFailure>;
    classify(input: {
      readonly rubric: string;
      readonly choices: readonly string[];
      readonly material: JsonValue;
    }): Effect.Effect<LlmClassifyResult, ScoreMatchLlmFailure>;
    extract(input: {
      readonly rubric: string;
      readonly maxItems: number;
      readonly material: JsonValue;
    }): Effect.Effect<LlmExtractResult, ScoreMatchLlmFailure>;
    batchClassify(input: {
      readonly rubric: string;
      readonly choices: readonly string[];
      readonly items: readonly { readonly id: string; readonly text: string }[];
      readonly material: JsonValue;
    }): Effect.Effect<LlmBatchClassifyResult, ScoreMatchLlmFailure>;
  };
}
```

LlmScoreResult 等四种结果形状及约束由 [Judge 原语契约](../../judge/architecture.md#原语与算法) 唯一拥有。
所有原语在所属 entry 内串行运行，共用模型配置、重试、预算、取消和审计。
必要调用失败会锁存终态；callback 捕获后返回正常数值不能恢复完整成绩。
入口关闭后原语不能发送，也不能修改已封口证据。

作者 callback 属于可信代码。version/config 声明规则身份，不证明隐藏闭包或外部状态。
自定义 Match 的声明与其受管调用的完整审计分开保留；完整审计不等于算法正确性证明。
资源与身份的详细约束见 [Judge 架构](../../judge/architecture.md)。

## 第三方 criterion

第三方确定性 evaluator 可以有自己的 criterion schema，但 Assertions current payload 只保存精确的 `{ name, schemaId, data }`。它不保存 evaluator 函数、模块对象、闭包或运行时 dependency graph，也不能由此增加 durable family。`schemaId` 未安装或 `data` 无法解码时，reader 只把该 entry 标为 `unsupported` 或 `invalid`；同一 Attachment 的其它 entry 继续可读。
