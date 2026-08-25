# Judge Material —— Library

Judge 作者先从受管入口取得私有品牌的 Material View，再把 View 绑定到 recipe 的具名 slot。普通 JavaScript value 仍可供确定性 Assertion 使用，但不能满足 Judge slot。

```ts
const check = judge.check({
  recipe: answerQuality,
  material: {
    task: turn.material.input,
    reply: turn.material.reply,
  },
});

t.judge.llm(check).atLeast(0.8).label("回答质量");
```

`JudgeCheck` 不携带 model、Agent、threshold、score contribution 或 control。LLM 与 Agent runtime 以同一个 Check 作为输入，各自在调用处选择执行配置。

## Recipe 与 Check

以下形状是穷尽的；未列出的 slot 选项和 Check 字段不存在。

```ts
type MaterialSourceRole =
  | "task"
  | "candidate"
  | "evidence"
  | "custom"
  | "definition-reference";

type MaterialViewKind =
  | "turn-input"
  | "turn-reply"
  | "turn-actions"
  | "action-results"
  | "custom-text"
  | "custom-file"
  | "reference-text"
  | "reference-file";

type MaterialMultiplicity = "one" | "many";

declare const judgeMaterialViewBrand: unique symbol;

interface JudgeMaterialView<
  Kind extends MaterialViewKind,
  SourceRole extends MaterialSourceRole,
> {
  readonly [judgeMaterialViewBrand]: {
    readonly kind: Kind;
    readonly sourceRole: SourceRole;
  };
}

interface MaterialSlotSchema {
  readonly role: string;
  readonly accepts: readonly MaterialViewKind[];
  readonly sourceRoles: readonly MaterialSourceRole[];
  readonly mediaTypes: readonly string[];
  readonly multiplicity: MaterialMultiplicity;
  readonly maxBytes: number;
}

type SlotView<Slot extends MaterialSlotSchema> = JudgeMaterialView<
  Slot["accepts"][number],
  Slot["sourceRoles"][number]
>;

type MaterialBindings<Slots extends Record<string, MaterialSlotSchema>> = {
  readonly [Name in keyof Slots]:
    Slots[Name]["multiplicity"] extends "one"
      ? SlotView<Slots[Name]>
      : readonly [SlotView<Slots[Name]>, ...SlotView<Slots[Name]>[]];
};

interface JudgeRecipe<
  Slots extends Record<string, MaterialSlotSchema>,
  Control,
> {
  readonly identity: string;
  readonly slots: Slots;
  readonly maxRenderedBytes: number;
  readonly batchSafe: boolean;
  readonly control: Control;
}

interface JudgeCheck<Recipe extends JudgeRecipe<any, unknown>> {
  readonly recipe: Recipe;
  readonly material: MaterialBindings<Recipe["slots"]>;
}
```

`Control` 是 runtime-specific recipe control：LLM recipe 使用 rubric、anchors、Decision schema 与静态判分图，Agent recipe 使用 rubric、anchors 与调查指令。事实参考不属于 control；expected answer、source text、policy 或 reference implementation 必须占用 `definition-reference` slot。

所有 slot 都是 required。`one` 绑定一个 View；`many` 绑定非空 readonly array，并保留作者顺序。View kind、source role、MIME、数量或预算与 schema 不符时，`judge.check(...)` 同步拒绝，不创建 Assertion。

`judge.check(...)` 是唯一 Check 构造器。它不接受 `{ material: object }` 式无 schema 材料，也不自动加入 Turn input、reply、trace 或当前 workspace。

## Turn Material

运行中的 Turn 与 Replayable Grading 取得的 sealed Turn 暴露同一组只读入口：

```ts
interface TurnMaterial {
  readonly input: JudgeMaterialView<"turn-input", "task">;
  readonly reply: JudgeMaterialView<"turn-reply", "candidate">;
  actions(): JudgeMaterialView<"turn-actions", "evidence">;
  actionResults(
    selector: ActionResultSelector,
  ): JudgeMaterialView<"action-results", "evidence">;
}
```

- `input` 只有作者通过本次 `send` 发送的文本；附件必须另建 file View。
- `reply` 只有最终 assistant reply；不存在时 View 为 unavailable，不用空字符串代替。
- `actions()` 包含本 Turn 全部 LogicalToolOccurrence 的 occurrence ref、原名、canonical name、结构化 input、logical command projection、起始位置、lifecycle/status 与逐字段 coverage。它不含 result、thinking、OTel span、子 Agent transcript 或其它事件。
- `agent_task` 一类动作只暴露本次调用的 input 与 lifecycle，不展开子 Agent 输出。

V1 没有 `session.material()`、`session.snapshot()`、隐式 `last` / `current`、`actions(selector)` 或 attempt trace View。多轮场景逐个绑定明确的 Turn View。

## Action Result Selector

Action result 必须经封闭 selector 单独授权。公开 factory 返回私有品牌值，作者不能构造 selector object。

```ts
type ActionLifecycle = "completed" | "failed";

type ExactJsonInput = Readonly<JSONValue>;

declare const actionOccurrenceRefBrand: unique symbol;
declare const actionResultSelectorBrand: unique symbol;

interface ActionOccurrenceRef {
  readonly [actionOccurrenceRefBrand]: "action-occurrence";
}

interface ActionResultSelector {
  readonly [actionResultSelectorBrand]: "action-result-selector";
}

interface ActionResultSelectorFactory {
  occurrence(ref: ActionOccurrenceRef): ActionResultSelector;

  tool(options: {
    canonicalName: string;
    input?: ExactJsonInput;
    lifecycle?: ActionLifecycle;
    exactly: number;
  }): ActionResultSelector;

  command(options: {
    logicalExecutable: string;
    argsStart?: readonly string[];
    lifecycle?: ActionLifecycle;
    exactly: number;
  }): ActionResultSelector;
}
```

`exactly` 必须是正整数。`tool` 的 input 是完整 normalized JSON 等值，不是 predicate；`command` 只读取 Adapter 封存的 logical command projection，不重新拆解 shell 字符串。

Selector 没有 output predicate、regex callback、`all`、`first`、`last`、`current`、`nth` 或零计数。`ToolMatch` 也不能充当 selector，因为 Match 没有持久 identity，并且可以读取 output。

最稳定的公开路径是：

```ts
const publicResult = turn.material.actionResults(
  actionResultSelector.command({
    logicalExecutable: "niceeval",
    argsStart: ["query"],
    lifecycle: "completed",
    exactly: 1,
  }),
);
```

Selector identity 由 schema version、规范化参数与 cardinality 形成；展示 label 不参与 identity。

## 自定义与参考材料

两阶段构造面是封闭的：

```ts
interface ExecutionMaterialFactory {
  customText(options: {
    readonly name: string;
    readonly text: string;
  }): JudgeMaterialView<"custom-text", "custom">;

  customFile(options: {
    readonly name: string;
    readonly bytes: Uint8Array;
    readonly mediaType: string;
  }): JudgeMaterialView<"custom-file", "custom">;
}

interface GradingMaterialFactory {
  customText(options: {
    readonly name: string;
    readonly text: string;
  }): JudgeMaterialView<"custom-text", "custom">;

  referenceText(options: {
    readonly name: string;
    readonly text: string;
  }): JudgeMaterialView<"reference-text", "definition-reference">;

  referenceFile(options: {
    readonly name: string;
    readonly source: URL;
    readonly mediaType: string;
  }): JudgeMaterialView<"reference-file", "definition-reference">;
}
```

Execution 阶段只能在值存在时快照自定义内容：

```ts
const note = t.material.customText({
  name: "diagnostic-note",
  text: "只检查公开行为。",
});

const resultFile = t.material.customFile({
  name: "public-results",
  bytes: await t.sandbox.readBytes("results.txt"),
  mediaType: "text/plain",
});
```

`customFile` 接受已经读取的 bytes，不接受 Sandbox path。调用时内容立即进入 Execution graph；Execution seal 后不能补录。

Grading definition 阶段使用另一组构造器：

```ts
const definition = defineGrading({
  version: "answer-quality/v2",
  evaluationKind: "score",
  async grade(g) {
    const expected = g.material.referenceText({
      name: "expected-answer",
      text: "应明确说明失败原因与修复步骤。",
    });

    const policy = g.material.referenceFile({
      name: "support-policy",
      source: new URL("./support-policy.md", import.meta.url),
      mediaType: "text/markdown",
    });

    const context = g.material.customText({
      name: "review-context",
      text: "只检查公开行为。",
    });
  },
});
```

`referenceText` 与 `referenceFile` 都产生 `sourceRole: "definition-reference"`；`customText` 始终是 `custom`，不能当作 reference 的糖。`referenceFile` 只接受受管 definition file loader，求值时读取当前评分定义的文件并校验 digest，不访问历史或 live execution workspace。

构造器只接受 string、bytes 或上述受管 file loader。它们拒绝 object、Turn、events、`toolCalls` 与 material-like object。作者可以先显式 `JSON.stringify(...)` 再创建 `customText`；这会成为 manifest 中可审计的显式 overgrant，而不是系统暗中扩张材料。

`name` 只用于作者与审计读面，永不发送给 evaluator。Renderer 使用 recipe slot identity 和稳定 ordinal 形成 block heading 或 Agent file path。V1 没有 evaluator-visible filename、title 或 label；将来若新增，这些 bytes 必须进入 presented representation、visible digest 与 Judge Evaluation identity。
