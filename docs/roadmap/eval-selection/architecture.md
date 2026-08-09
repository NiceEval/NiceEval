# Eval 选择 —— Architecture

选择系统把 Experiment 的签入条件与 CLI 的临时条件建模为两个独立表达式。
两者共享叶子语义和诊断 provenance，组合节点只表达集合交集；求值完成后，运行路径只接收 ID 集合。

## 数据建模

规范化表达式保留条件出处，但不保留作者数组顺序：

```ts
type EvalSelectionField =
  | "ids"
  | "idPrefixes"
  | "tags.allOf"
  | "tags.noneOf";

interface EvalSelectionClause {
  readonly origin: "experiment" | "cli";
  readonly field: EvalSelectionField;
  readonly value: string;
}

interface EvalFilterExpression {
  readonly _tag: "Filter";
  readonly ids: readonly string[];
  readonly idPrefixes: readonly string[];
  readonly allTags: readonly string[];
  readonly excludedTags: readonly string[];
  readonly clauses: readonly EvalSelectionClause[];
}

type EvalSelectionExpression =
  | { readonly _tag: "All" }
  | EvalFilterExpression
  | {
      readonly _tag: "AllOf";
      readonly selections: readonly [
        EvalSelectionExpression,
        EvalSelectionExpression,
      ];
    };
```

Experiment 对象与 CLI flags 分别生成一个表达式。
组合始终是 `AllOf(ExperimentSelection, CliSelection)`，不能把两边的 `ids`、前缀或 tag 数组浅合并。

## 集合求值

完整求值使用以下集合：

| 名称 | 含义 |
|---|---|
| `D` | discovery 完成后的全部 Eval，包含数组与 keyed record 展开项 |
| `I_E` | 某 Experiment 的身份轴候选；未声明身份轴时等于 `D` |
| `P_E` | `I_E` 应用 `tags.allOf` 后的正候选 |
| `S_E` | `P_E` 应用 `tags.noneOf` 后的静态 Experiment 集合 |
| `U` | 所有被选中且合法的 `S_E` 并集 |
| `I_C` | CLI 身份轴在 `U` 上得到的候选；未给身份 flag 时等于 `U` |
| `P_C` | `I_C` 应用全部 CLI 正 tag 后的候选 |
| `C` | `P_C` 应用全部 CLI 负 tag 后的临时集合 |
| `F_E` | `S_E ∩ C`，某 Experiment 本次最终选择 |

每个 Experiment 先独立求出 `S_E`。
CLI 没有 Eval flag 时，`C = U`；否则 CLI 只在静态集合并集上求值，不能把 Experiment 从未选择的 Eval 加回来。

## 条件校验

校验与集合求值使用同一批候选，不另建宽松路径：

- 每个 Library ID 和前缀必须在 `D` 中命中。
- 每个 Library 正 tag 必须在 `I_E` 中出现，且 `P_E` 必须非空。
- 每个 Library 负 tag 必须在 `P_E` 中出现，随后才共同排除。
- `S_E` 为空是 Experiment 配置错误。
- 每个 CLI ID 和前缀必须在 `U` 中命中。
- 每个 CLI 正 tag 必须在 `I_C` 中出现，且 `P_C` 必须非空。
- 每个 CLI 负 tag 必须在 `P_C` 中出现，随后才共同排除。
- `C` 为空是 CLI 用法错误。
- 单个 `F_E` 为空只排除该 Experiment；全部 `F_E` 为空才使 Invocation 失败。

负 tag 的存在校验以应用负条件前的正候选为准。
这防止 `ids: ["a"]` 搭配只出现在 `b` 上的排除 tag 被误认为有效，也不要求多个重叠负 tag 各自删掉不同成员。

## 数据流

```text
discover Eval 与 Eval Group membership
  -> 选择 Experiment
  -> 规范化并校验每个 ExperimentSelection
  -> 求 S_E 与 U
  -> 规范化并校验 CliSelection
  -> 求 C 与每个 F_E
  -> 排除 F_E 为空的 Experiment；全部为空则失败
  -> 生成 selectedEvalIds / knownEvalIds
  -> Sandbox link / carry / dry / Session / run
```

全部选择和错误聚合发生在 Provider 网络、fingerprint、build、Sandbox create 与 Session 创建之前。
下游不能重新调用作者条件，也不能自行解释 CLI flags。

## 顺序与 Group

选择条件中的数组顺序不影响结果或执行顺序；重复值在规范化时去重。
普通选择结果保持 discovery 的稳定顺序。

Eval Group 在过滤前按 `members` 给每条 Eval 标注 Group ID 与成员 index。
过滤只删除本次不选的槽位；同一 Group 的剩余槽位按原成员 index 排序，不按 CLI flag 或 Experiment 条件顺序重排。

每个 Group member 必须恰好对应一条发现后的 Eval。
Group 的完整 members、顺序、Sandbox Layer identity 与 ID 共同形成 `definitionHash`；增删或重排未选成员仍会改变组内其它成员的指纹。

## Record 与身份

每个实际创建的 Run 保存两个范围事实：

- `knownEvalIds = S_E`：Experiment 的静态统计分母，不因 CLI 临时收窄而缩小。
- `selectedEvalIds = F_E`：本次 CLI 交集后的计划全集。

Attempt 只来自 `F_E` 中实际运行或携入的条目。
被 CLI 排除的 Experiment 没有 Run，也不进入 Session 的 Experiment 列表。

选择表达式与 clause provenance 只服务加载错误、CLI 错误、dry 和排除反馈。
它们不落盘，不进入 configHash 或 Attempt fingerprint；给定相同静态与最终 ID 集，表达式重排或等价重写不会作废结果。

Eval Group 的 `definitionHash` 是独立的行为身份输入。
即使最终选择相同，Group 完整成员或顺序变化仍按 Group 契约使相关历史结果失效。

## 确定性边界

声明式形状消除运行器逐 Eval 调用任意 predicate 的路径，也让每个条件都能给出字段和值。
TypeScript 模块仍可根据进程变量集合、时间或闭包构造输入，因此确定性从模块加载完成后的值开始。

Run 保存实际求出的 ID，确保结果能说明本次 Eval 命中范围。
若要禁止模块级动态输入，需要静态配置格式或额外审计机制，不属于 Eval 选择契约。
