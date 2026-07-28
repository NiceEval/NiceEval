# Reports 单次 resolve 与作者模型迁移计划

## 目标

让实现满足 `docs/feature/reports/` 的最终契约：

```text
Source.compute(input)
  → 一次 page resolve 产出的可序列化 Content
  → text / web / 多 locale 纯同步投影
```

完成态只保留三种作者概念：

- Source 负责 NiceEval 领域计算。
- Composition 通过 `ctx.resolve(source, input?)` 编排 Source。
- Component 只有 `dimensions`、`text`、`web`、`enhance` 与 `styles`，没有 `resolve` 或取数能力。

niceeval 仍是 beta。本迁移不保留旧 spec / data 双形态、函数形态 `defineComponent`、
`ctx.scope` / `ctx.results` 或 `*Data` 公共兼容层。

## 当前差距

1. `src/report/definition/tree.ts` 的 `ComponentFaces` 仍有 `resolve?`，`defineComponent` 仍接受组合函数。
2. `src/report/components/shared.ts` 的 `makeDataComponent` 仍通过 `dataFn` 在组件解析面取数，
   `DataProps` 仍保留旧 spec 形态。
3. `SampleOverview`、`FailureList`、`Hero`、`AttemptDetail` 等官方组合仍使用函数形态
   `defineComponent`，部分直接读取 `ctx.scope`、`ctx.page.evidence` 或调用 `*Data`。
4. `CompositionContext.resolve` 只能使用 page 默认 input，无法为 `input?` 组合组件复用缓存。
5. text、web 和每个 web locale 的宿主入口各自调用 `resolveReportTree()`。
   `view` 为 en / zh-CN 渲染同一 page 时会重复执行 Source。
6. 当前单元测试证明单次 `resolveReportTree()` 内会去重，但没有证明同一 resolved page
   可以安全投影多个面或多个 locale。

## 实施顺序

### 1. 固化 resolved page 制品

- 在 `src/report/runtime/` 引入内部 `ResolvedPage`：
  - 保存展开并校验后的组件树；
  - 保存 Content、组件样式清单与不依赖 face 的 label keyset；
  - 不保存 locale、终端宽度、主题颜色或 HTML。
- 拆分入口：
  - `resolvePage(tree, context): Promise<ResolvedPage>`；
  - `renderResolvedPageText(resolved, options): string`；
  - `renderResolvedPageWeb(resolved, options): string`。
- `renderReportTreeToText` / `renderReportTreeToStaticHtml` 可以继续作为便利入口，
  但内部必须组合上述两个阶段，不复制 resolve 实现。
- `src/view/data.ts` 对每个 page / locator 只调用一次 `resolvePage`，随后从同一个
  `ResolvedPage` 生成 en 与 zh-CN。
- text 与 web 的维度规划分别在 render 前完成：label keyset 共用，web 才计算 visual keyset
  与 `seriesSlot`。

### 2. 扩展 Composition 的显式 input

- 把 `CompositionContext.resolve` 改成：

  ```ts
  resolve<Content>(
    source: Source<Input, Content>,
    input?: Input,
  ): Promise<Content>;
  ```

- 省略 input 时使用 `ctx.input`；显式 input 只影响本次 Source 计算。
- 两种调用与组件的 `<Table source={source} input={input}>` 共用同一个
  `Source 对象身份 × input 对象身份` Promise 缓存。
- 在 page 装载 / resolve 边界校验 Source 与 input 类型分支，错误指向 Composition 调用点。

### 3. 收紧 Component 公共协议

- 从 `ComponentFaces` 删除 `resolve?`。
- 删除函数形态 `defineComponent` overload、`COMPONENT_COMPOSE`、`ComposeContext`、
  `ResolveMemo` 的旧 spec 计算用途和 `memoFetchOf`。
- `defineComponent` 只接受 `{ dimensions, text, web, enhance?, styles? }`。
- text / web renderer 的参数统一为 `(data, options, ctx)`，不再把解析后的 data 混进 props。
- `DataProps` 只保留互斥的 source / data 两支。
- `niceeval/report/react` 同名原语只暴露 data 形态。

### 4. 迁移官方 Source 与 Composition

- 官方 Source 继续复用现有 `src/report/components/**/compute.ts` 领域计算，
  但计算函数只由 `src/report/sources.ts` 装配，不再由 Component 引用。
- 把以下组合迁到 `defineComposition`：
  - `SampleOverview`、`SampleSummary`；
  - `FailureList`；
  - `Hero`、`RunNotices`、`SampleFixPrompt`；
  - `AttemptDetail`、`AttemptAssessment`、`AttemptNotices`、`AttemptFixPrompt`。
- Composition 只能通过 `ctx.input`、`ctx.resolve()`、`ctx.data` 与 page 元数据编排。
- 叶子组件全部改为 data-only Component；renderer 不 import `sources.ts`、Record、
  Sample、AttemptHandle 或 compute 模块。

### 5. 删除旧公共面

- 从 `src/report/index.ts` 删除：
  - `*Data` 公共计算函数；
  - Scope / Snapshot / Metric 旧词出口；
  - 旧专用数据组件和旧组合别名；
  - `ResolveContext`、`ComposeContext` 与手工 resolve 辅助出口。
- 更新 `src/report/react/index.tsx`，只保留纯 web 原语与 Content 类型。
- 更新 package exports、生成参考与 bundled index。
- 用 `rg` 守尾：

  ```sh
  rg "faces\\.resolve|memoFetchOf|ctx\\.scope|ctx\\.results|defineComponent\\(async|spec 形态|DataProps<" src
  ```

  合并态不得留下旧作者模型。

## 验证

动测试前先核对 `docs/engineering/testing/unit/reports.md` 的覆盖规范；缺少以下类别时先补文档条目：

1. 同一 Source + input 在一个 page resolve 中只计算一次，包括并发消费者与失败 Promise。
2. `ctx.resolve(source, input)`、`ctx.resolve(source)` 与组件 `source=` 命中同一缓存。
3. 一个 `ResolvedPage` 可渲染 text、web(en) 与 web(zh-CN)，Source 调用计数仍为 1。
4. Component 缺 `dimensions` / `text` / `web` 时失败；携带 `resolve` 或函数形态定义时失败。
5. renderer 只能收到 Content、options 与呈现 context，无法触达 Source input。
6. 不同 page、不同 Source 对象或不同 input 引用分别计算。

建议验证命令：

```sh
pnpm run typecheck
pnpm test src/report
pnpm test src/view
pnpm run build:report
pnpm e2e --repo report
```

实现、测试、`docs/source-map.md` 差异删除与公开出口同步应在同一批收口，不能让旧路径以兼容名留存。
