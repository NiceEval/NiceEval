# `RunDiagnostics`

Run 诊断区：呈现属于某次 Run 整体、无法诚实定位到单个 Eval 或 Attempt 行的操作性 [`DiagnosticRecord`](../../../record/architecture.md)。它与 [`SampleWarnings`](sample-warnings.md) 版面相邻、数据与词表分离：warnings 的 `kind` 是带模板登记的闭集，diagnostics 的 `code` 是 runner 侧开放词表；组件只按 `level`、`message`、`command` 与 `count` 通用渲染，不按 code 建注册表或拒绝未知成员。

它是 Run 级 diagnostics 的正式呈现组件。宿主不在报告树外另设诊断通道，[内建报告](../../library/built-in.md)的三张 sample-input page 都把它放在 `SampleWarnings` 之后，attempt-input page 不重复范围内的 Run 诊断。诊断可见性是报告作者义务：自定义报告可以省略，但省略后由作者自己承担未向读者交代 Run 操作性问题的责任。

准入判据与 warnings 的行归属铁律相同：只有“属于某次 Run 运行、但定位不到任何单行”的事实进入 `run.diagnostics` 与本组件。能归属具体 Eval 或 Attempt 的事实必须进入相应占位行、时效标注或 Attempt 详情，不得把本组件当杂物间。

```ts
interface RunDiagnosticsItem {
  experimentId: string;
  startedAt: string;
  diagnostics: readonly DiagnosticRecord[];
}

type RunDiagnosticsData = readonly RunDiagnosticsItem[];

function runDiagnosticsData(input: ReportInput): Promise<RunDiagnosticsData>;

type RunDiagnosticsProps = ComponentProps<RunDiagnosticsData, {
  locale?: ReportLocale;
  className?: string;
}>;
```

`runDiagnosticsData` 只投影 diagnostics 非空的真实 Run，不携带 `evals` 或 `AttemptHandle`，也不跨 Run 合并 DiagnosticRecord。输出按 experiment id 字典序排列，同一实验内按 `startedAt` 从新到旧排列。

## 按来源分组，按记录给动作

- 外组是 experiment id，内组是 Run；内组标题显示 `startedAt` 与人话时距，时距文案复用[实体列表的时效标注](../entity-lists/README.md#时效标注)。
- 单个 Run 只有一条 diagnostic 时，Run 内组退化成一行，不渲染只有一个孩子的空壳层级。
- 每条 `message` 遵循[三段式契约](../../../../error-feedback.md#消息三段式)，组件原样呈现、不按 code 改写；`command` 随该记录渲染为可复制动作，不提升到来源组头。
- `count` 省略按 1，超过 1 时显示重复次数。它表示写入方按同一 dedupe key 折叠后的次数；组件不跨记录或跨 Run 再次去重。
- 汇总与组头的严重度取组内最高 level；只要含 `level: "error"`，汇总行与对应来源组就必须在文字和视觉上区别于纯 warning，不能只依赖颜色。

## 摘要恒可见，其余默认折叠

- web 面整个诊断区是默认折起的原生 `<details>`；`<summary>` 是恒可见的计数汇总行，至少交代涉及多少个 experiment、多少个 Run、多少条记录（按 `count` 计数）以及最高严重度。
- 展开后显示来源分组与逐条完整 message；无 JavaScript 时仍可用原生 `<details>` 读完并复制动作。
- text 面与 web 面内容同构但不折叠：先打印汇总，再按 experiment → Run 打印来源、时距、严重度、message、count 与 command。
- 空集两面零输出，不渲染空容器。
- 折叠层级不设 props 开关；报告作者只决定是否放置整个组件。

## 两种输入形态

- spec 形态 `<RunDiagnostics />` 从宿主注入的 `Sample | Run[]` 计算投影。Sample 只通过 `sample.runs` 透传真实 Run，不合并 diagnostics；裸 `Run[]` 同样拥有实体上的 diagnostics，因此照常渲染。
- 嵌入自有 React 页面时先调用 `runDiagnosticsData(input)`，再传纯数据：`<RunDiagnostics data={diagnostics} />`。data 形态不接受 Run，避免把 `evals`、`AttemptHandle` 和文件读取能力拖进浏览器边界。

```tsx
<RunDiagnostics />
```

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
- [`SampleWarnings`](sample-warnings.md) —— 版面相邻的选择警告区。
