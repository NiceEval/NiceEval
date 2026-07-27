# `Callouts`

分级提示区：把一批已经解释好的 Notice 按组渲染。它不读取 snapshot 或 diagnostics，也不决定
严重度与下一步动作；这些由 `SampleNotices` / `RunNotices` / `AttemptNotices` 在上层完成。

```tsx
<Callouts data={notices} />
```

## 形状

```ts
interface CalloutItem {
  /** 决定汇总行与组头的视觉与文字区分；error 必须与 warning 在文字上也能分辨。 */
  level: "error" | "warning" | "info";
  /** 三段式完整叙述（现象 / 原因 / 下一步），原语原样呈现、不改写。 */
  message: LocalizedText;
  /** 可复制的推进命令；没有真实动作时省略，不硬造。 */
  command?: string;
  /** 写入方按同一 dedupe key 折叠后的次数；省略按 1。原语不再次去重。 */
  count?: number;
}

interface CalloutGroup {
  /** 组头文案，含本组条数。 */
  title: LocalizedText;
  /** 组内去重后仍唯一时挂在组头；多于一条时命令随明细逐条走。 */
  command?: string;
  /** 组头徽标：一条事实一枚，文案由数据源给。 */
  badges?: readonly LocalizedText[];
  items: readonly CalloutItem[];
  /** 嵌套一层来源分组（experiment → run 这类）；只有一个孩子时不渲染空壳层级。 */
  groups?: readonly CalloutGroup[];
}

interface CalloutsProps {
  data: readonly CalloutGroup[];
  locale?: ReportLocale;
  className?: string;
}
```

## 摘要恒可见，其余默认折叠

提示是数字的可信度脚注，不是页面的主角，不与数字争版面。要求是「提示的存在与分类和数字同框」，
不是「全文永远展开」：

- web 面整个区是一个默认折起的原生 `<details>`，`<summary>` 是恒可见的计数汇总行
  （如「2 个实验的数字带警告 · 1 个 Run 被跳过」）。汇总行在任何组数下都渲染，
  单组时就是该组的计数。汇总行至少交代涉及多少组、多少条以及最高严重度。
- 展开后每组的逐条原始 `message` 是第二层 `<details>`——无 JavaScript 可展开，
  满足增强层「初始静态 HTML 无 JS 完整可读」的不变量；总条数 ≤ 3 时这层默认展开。
- 视觉上提示区不占框：无边框、无底色、不缩进，警示色只落在汇总行文字与徽标上。
- 折叠层级与阈值是行为契约，不设 props 开关；作者只决定放不放整个原语。
- text 面内容同构但不折叠：先打印汇总，再逐组打印组头、徽标、命令，其下缩进逐条原样打印
  `message`，不截断尾段——终端天然可滚动，截断只会害调试。
- 空集两面零输出，不渲染空容器。

## 聚合轴是动作，不是发生顺序

分组由上层 Notice policy 决定，判据统一为「用户接下来要做什么」。逐条平铺会把一件事写成几条
长句加重复命令。原语只负责按 data 给定的分组渲染，并遵守两条：

- 组内命令去重后仍多于一条时，组头不放命令、命令随明细逐条走——组头命令的含义永远是
  「复制即推进整组」，不摆一排让用户猜。
- 汇总与组头的严重度取组内最高 `level`。只要含 `error`，汇总行与对应组就在文字和视觉上
  区别于纯 warning，不只依赖颜色。

## 开放词表友好

原语按 `level` / `message` / `command` / `count` 通用渲染，不按来源侧的 code 或 kind 建注册表，
也不拒绝未知成员。数据源没给分组模板的条目各自单独成组、逐条原样渲染 `message`，
行为不劣于平铺。

## 相关阅读

- [组件树](../README.md) —— 四层模型与结构节点规则。
- [数据源目录](../sources/README.md) —— 官方提示数据源与它们的准入判据。
- [错误反馈](../../../../error-feedback.md#消息三段式) —— `message` 的三段式契约。
