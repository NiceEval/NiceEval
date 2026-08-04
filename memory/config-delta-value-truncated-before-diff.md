# 已修 差异值在构造点被截到 80 字符，截断点常落在差异点之前

- **现象**(2026-08-04，下游 compare/codex 复盘)：`--dry` 与 `--dry --json` 里 `config:sandboxLayer changed`、`plan:physical changed` 两条差异的 `from`/`to` 打印出来两侧完全相同，差异全被 `…` 吞掉；`niceeval accept` 落盘的 `acceptedFrom.differences` 与 `carriedAccepting` 留痕也是同一份被截断的字符串。用户拿着这份输出判断不了配置到底改了什么，只能去翻源码。
- **根因**：`src/runner/config-identity.ts` 的 `configDeltas` 与 `src/runner/manifest.ts` 的 `manifestDeltas`/`planDelta` 共用一个在**构造点**就把值截到 80 字符的 `summarize` 函数（`text.length > 80 ? text.slice(0, 79) + "…" : text`）。两个长值只要公共前缀超过 79 字符，各自独立截断后就会截成完全相同的省略串——这正是 `sandboxLayer`（JSON 对象序列化）与 `plan`（物理计划 JSON）这类结构化字段的典型形状：字段名、公共 key 排在前面，真正变化的值排在后面。截断发生在数据产出的源头，落盘、`--dry --json` 透传和人读渲染都拿不到完整值,无法在下游任何一层补救。
- **修法**：把「有界」这个职责从构造点搬到唯一的人读渲染点。
  1. 构造侧完全不截断：`config-identity.ts` 与 `manifest.ts` 的截断函数改名 `serializeValue`，只做字符串投影（`JSON.stringify` 或原样返回字符串），不再限制长度。`ConfigFieldDelta`/`AcceptedDifference`/`CarriedAcceptance` 的字段形状不变（仍是 `string`），避免触发 record `schemaVersion` 升版。
  2. 落盘（`acceptedFrom.differences`、`carriedAccepting`）与 `--dry --json` 的 `ExpPlanDelta` 投影因此自动变成完整值——它们都是对构造侧输出的直接透传，没有独立的截断逻辑。
  3. 有界呈现搬到唯一的人读渲染点 `src/runner/feedback/human.ts` 的 `formatDryDelta`：新增 `windowChangedDeltaValues`，Changed 差异的双侧值对齐到第一处不同字符——公共前缀超过 24 字符时压缩显示但保留其尾部定位上下文，从差异点起两侧各留 56 字符的窗口，超出补 `…`；Added/Removed 单侧值仍按 80 字符简单上限截断（这一侧没有「两侧对比」的问题，独立截断不会丢差异点）。
  4. 落点：`src/runner/config-identity.ts`、`src/runner/manifest.ts`、`src/runner/feedback/human.ts`；契约见 [cache.md「manifest：哈希做索引，清单做解释」](../docs/feature/experiments/cache.md#manifest哈希做索引清单做解释)；覆盖类别见 [experiments-runner.md「差异值的完整性边界」](../docs/engineering/testing/unit/experiments-runner.md)。
- **复盘**：这类 bug 的通用形状是「有界呈现的截断逻辑长在数据产出的源头而不是最终渲染点」——一旦源头截断，下游任何消费者（落盘审计、JSON 透传、多种人读格式）都拿不到完整信息去分别决定怎么呈现。构造侧只做「产出完整值」这一件事，「在哪呈现、呈现多少」留给离读者最近的那一层决定，这条分工本身值得作为通用设计判据记住。
