# Report 图表语义内核

> 本公共三面图表方向已由 [CLI 与 Insight](../../design/cli-insight/DECISION.md) 取消。MetricValue、missing、Evidence 与精确值语义仍归 Analysis；Insight 的图表是第一方私有实现，外部网页的 data / component 接入面仍在[独立决策](../../design/benchmark-web-consumption/README.md)中比较。

## 要解决的问题

同一张图必须在 terminal、网页和静态站中表达同一组读数、缺失、完整度、Evidence 与下钻入口。空间布局可以不同，但不能让任一呈现面重新计算数值、删除缺失或用 tooltip 隐藏精确值。

本方向为中立的笛卡尔图表建立共享语义内核。它服务 Bars、Line、Scatter 和后续同类原语；Table、数据取得、总体定义和 Report 路由仍由各自现有边界拥有。

## 核心心智

```text
closed rows / points / MetricValue
              │
              ▼
context-free chart compilation
              │
              ▼
shared display facts
       ┌──────┼──────┐
       ▼      ▼      ▼
    terminal  web  static web
```

中立图表只消费已经闭合的 rows、points 与 `MetricValue`。它不取得 Sample、Record、reader、字段执行器或聚合函数。
Analysis-backed channel 保留原有 `MetricValue` 的 state、samples、total、issues 与 refs。图表不能把 scalar 包装成新的 `MetricValue`。

语义编译不接收 locale、theme、像素尺寸、DOM、href 或浏览器状态。它只固定 series、channel、值、缺失、完整度、Evidence、声明顺序和可下钻的 locator。
随后为有效 locale 形成一份共享 display facts。terminal、web 和 static 都从它读取完整文字与事实。

## 图表输入与事实

`points` 可以是 Analysis 关闭后的 rows，也可以是没有 NiceEval Evidence 的外部标量点。前者的每个度量 channel 必须保留 `MetricValue`。
后者必须显式声明 axis 的 unit 与 format，不能伪装成有分母或 refs 的读数。

每个图表点在关闭组件树时取得内部不透明 key。Analysis rows 沿用其已闭合的行归属；外部点按输入出现次序规范化。
这个 key 只服务同一张图的精确值行、焦点和增强 payload。它不构成作者可声明的业务身份或新的 Evidence 关系。

缺失点仍进入 display facts 和精确值表。线、area 或 bar 怎样画由 mark policy 决定，但任何 policy 都不能把 missing 改成零或删除其 reason。

## 三种呈现面

同一 locale 下，terminal、web 与 static 必须具有相同的：

- series 顺序和图表点集合；
- 每个 channel 的 typed value、缺失状态与完整 scalar 字符串；
- 每个 `MetricValue` 独立携带的 coverage、issues 与 refs；
- 已声明且可服务的 locator 下钻入口。

字符布局、SVG 几何、tick、主题、颜色和换行可以不同。终端即使不画出空间关系，也必须输出完整的精确读数。静态站采用与网页相同的闭合事实，不会在浏览器重新执行 Page 或 Analysis。

## 精确值与键盘访问

每张网页图始终包含三个同级部分：

1. 带本地化名称和说明的 SVG；
2. 原生 `<details>` 中的精确值 `<table>`；
3. 可选渐进增强使用的版本化 payload。

精确值表列出每个点的 series、channel、完整显示字符串、missing reason、coverage、refs 与可服务链接。关闭 JavaScript 时，读者仍能通过键盘展开表格并取得全部事实。

启用 JavaScript 后，图表根只有一个顺序 tab stop。方向键在稳定点顺序中移动，pointer 与键盘写入同一当前点。
Enter 打开当前可服务入口，Escape 清除固定提示。tooltip、focus marker 和状态区只读取 payload，不能从 SVG、DOM 文本或几何反推业务值。

## 参数化下钻

图表不注册页面、生成独立 route，或从 refs 猜一个链接。需要下钻时，闭合点提供的 locator 交给已经定义的参数化 `Page`。
该 Page 的 `params.encode()` 与 `params.decode()` 决定可服务 instance。

Host 只有在 locator 对当前 Sample 有效、目标 Page 已定义且参数可规范往返时才生成 terminal target 与 web href。
这个已取消方向不定义 locator 路由、Page 或静态输出。

## 范围

本方向包含：

- context-free 的图表语义编译和共享 display facts；
- rows / points / `MetricValue` 的中立输入边界；
- terminal、web、static 的同事实呈现；
- 始终存在的精确值表、无 JavaScript 降级和键盘交互；
- 使用既有参数化 Page 与 locator 的下钻。

本方向不包含：

- 图表内重新聚合、查询 Record、定义 Population 或改变 `MetricValue.total`；
- 通用图形语法、作者自定义 mark、公开 scene API、Canvas、动画、zoom、pan 或浏览器端数据读取；
- 新的页面注册中心、路由协议、持久图表状态或另一份 Evidence identity；
- Table 的排序、搜索或展开控制器。

## 入口

- [Architecture](architecture.md) —— 编译、投影、链接、闭合树与验收不变量。
