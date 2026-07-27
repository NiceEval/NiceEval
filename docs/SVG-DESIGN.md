# SVG 图示的视觉契约

`docs/` 与 `docs-site/` 里所有手绘 SVG 按这一页画。
色值、间距、字号在这里裁决一次，图里直接写死这些数。

色值取自产品自己的深色令牌（`src/view/styles.css` 的 `:root`，
`src/report/assets/styles.css` 的 `.nre` 抄同一份）。图和 `niceeval view`、
默认报告因此是同一个观感：近黑底、1px 细线、灰阶文字，颜色只在有语义时出现。

## 观感：默认无色

层级靠字重和留白，区分靠位置，颜色留给语义。

- 盒子默认不带颜色：`#0b0b0b` 的面加 `#262626` 的 1px 边，仅此而已。
- 一张图里带语义色的元素不超过 3 个，系列图除外。
- 不用渐变、阴影、发光、彩色描边、彩色盒底、左侧色条。
- 区域用一条 1px 边表达，不用色块铺出来。
- 要强调就提亮到 `#ededed` 或换字重 600，不放大字号，也不加粗描边。
- 图标手绘不进图。要画的是关系，不是插画。

## 共用样式：整段抄进每张图

下面这段是全部配色的唯一出处。新建一张图时连 `<defs>` 一起复制，
改画布尺寸和 `<title>` / `<desc>`，正文只挂 class，不写第二个 hex。

样式是复制进每份文件的，不是外链的一份 CSS：SVG 经 `<img>` 或 markdown
图片语法渲染时取不到外部样式表，GitHub 与 Mintlify 也会清掉外链。
改配色时改 `src/view/styles.css` 的令牌，再把这段同步一遍。

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 480"
     role="img" aria-labelledby="figTitle figDesc">
  <title id="figTitle">一句话说清这张图回答什么</title>
  <desc id="figDesc">完整一句：谁、按什么顺序、产生什么。读屏用户只拿到这一句。</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4"
            markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0 0 L8 4 L0 8 z" fill="#74747b" />
    </marker>
    <style>
      /* 值来自 src/view/styles.css 的深色令牌，改色先改那里 */
      text { fill: #a1a1aa; font-family: ui-sans-serif, -apple-system,
             BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; font-size: 16px; }
      .title { fill: #ededed; font-size: 20px; font-weight: 600; }
      .label { fill: #ededed; font-size: 18px; font-weight: 600; }
      .note  { fill: #74747b; font-size: 14px; }
      .num   { fill: #ededed; font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .mono  { fill: #ededed; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

      .canvas { fill: #050505; stroke: #262626; stroke-width: 1; }
      .box    { fill: #0b0b0b; stroke: #262626; stroke-width: 1; }
      .box-2  { fill: #111111; stroke: #262626; stroke-width: 1; }

      .rule        { stroke: #262626; stroke-width: 1; fill: none; }
      .rule-strong { stroke: #343434; stroke-width: 1; fill: none; }
      .dash        { stroke: #262626; stroke-width: 1; stroke-dasharray: 4 6; fill: none; }
      .arrow       { stroke: #74747b; stroke-width: 1.5; fill: none; marker-end: url(#arrow); }

      .good { fill: #3ddc97; } .bad { fill: #ff6b6b; } .warn { fill: #e8b84a; }
      .good-s { stroke: #3ddc97; } .bad-s { stroke: #ff6b6b; } .warn-s { stroke: #e8b84a; }

      .c0 { fill: #3987e5; } .c1 { fill: #199e70; } .c2 { fill: #c98500; }
      .c3 { fill: #008300; } .c4 { fill: #e66767; } .c5 { fill: #d95926; }
      .c0-s { stroke: #3987e5; } .c1-s { stroke: #199e70; } .c2-s { stroke: #c98500; }
      .c3-s { stroke: #008300; } .c4-s { stroke: #e66767; } .c5-s { stroke: #d95926; }
      .soft { fill-opacity: .16; }
    </style>
  </defs>

  <rect x="0.5" y="0.5" width="1239" height="479" rx="12" class="canvas" />
</svg>
```

## 每个 class 什么时候用

| class | 用在 | 约束 |
|---|---|---|
| `.canvas` | 铺满 viewBox 的那一个 `rect` | 一张图一个，`rx="12"`，坐标取 `.5` |
| `.box` | 节点、泳道、图例框 | `rx="8"`，比画布亮一档 |
| `.box-2` | 盒内还要再分一块 | 只允许再套这一层 |
| `.title` | 图左上角那一句 | 一张图一句，写清它回答什么 |
| `.label` | 盒标题、泳道名 | 是标识符时叠 `.mono` |
| 无 class 的 `text` | 说明句 | 已经是 16px 次文字色 |
| `.note` | 图例、单位、注解 | 最小字号，不再往下 |
| `.num` | 单个读数（通过率、成本、条数） | 已开等宽数字 |
| `.mono` | 标识符、命令、字段名、路径 | 与中文混排不改字号 |
| `.rule` | 分隔线、坐标轴、刻度 | 不够显眼就换 `.rule-strong`，不加粗 |
| `.dash` | 参照线、对齐线 | 不拿来表示"可选"或"异步" |
| `.arrow` | 真实的控制流或数据流 | 纵向堆叠已表达先后，不再加箭头 |
| `.good` `.bad` `.warn` | 判定通过、失败与错误、等待与注意 | 只上文字和小图形 |
| `.c0`–`.c5` | 需要区分的 N 个对象（实验、agent、系列） | 顺序不重排，超过 6 个就别用颜色分 |
| `.soft` | 确实需要色面时 | 配同色 1px 描边，不铺满饱和色块 |

填充与描边分成两组 class（`.good` 与 `.good-s`），因为 SVG 的 `fill` 和
`stroke` 不共用一个属性。文字挂填充类，线条挂描边类。

要一个表里没有的颜色时，先确认能不能用 `.c0`–`.c5`。确实需要新色，
去 `src/view/styles.css` 立一个令牌，再同步到这段样式，不在单张图里发明 hex。

## 色值

| 角色 | 值 | 用在哪 |
|---|---|---|
| 画布底 | `#050505` | 铺满 viewBox 的那一个矩形 |
| 面 | `#0b0b0b` | 盒子、泳道、图例框 |
| 次面 | `#111111` | 盒中盒、表头条 |
| 分隔线 | `#262626` | 所有边框、分隔线、参照虚线 |
| 强分隔线 | `#343434` | 坐标轴、需要压过一档的边 |
| 主文字 | `#ededed` | 标题、标签、读数、代码 |
| 次文字 | `#a1a1aa` | 说明句，正文默认色 |
| 弱文字 | `#74747b` | 注解、图例、单位、箭头 |

语义色只有三个，含义固定，不因为好看借用：

| 角色 | 值 | 含义 |
|---|---|---|
| good | `#3ddc97` | 通过、达成、省下的部分 |
| bad | `#ff6b6b` | 失败、错误 |
| warn | `#e8b84a` | 等待、注意、重复付出的成本 |

要区分 N 个对象时用六色 CVD 色板，与报告的系列色同一份，顺序不重排：

| 下标 | 值 | | 下标 | 值 |
|---|---|---|---|---|
| c0 | `#3987e5` | | c3 | `#008300` |
| c1 | `#199e70` | | c4 | `#e66767` |
| c2 | `#c98500` | | c5 | `#d95926` |

## 间距：8 的网格

所有坐标是 8 的倍数，微调用 4。看着差一点时挪 4，不挪 3。

| 名目 | 值 | 说明 |
|---|---|---|
| 画布安全区 | 32 | 画布边到任何内容 |
| 盒内 padding | 横 20 / 竖 16 | 盒边到盒内文字 |
| 同组盒间距 | 16 | 相邻的并列盒 |
| 跨组间距 | 32 | 两块讲不同事情的内容之间 |
| 标签贴附距 | 8 | 标签到它指的那个元素 |
| 列间距 | 24 | 表格状排列的列 |
| 行距 | 字号 × 1.5，取偶数 | 16px 文字用 24 |
| 圆角 | 画布 12 / 盒 8 / 药丸 6 | 半径不随尺寸变大 |
| 描边 | 1，强调也是 1 | 靠颜色分层，不靠粗细 |

SVG 的文字按基线定位，盒内第一行的基线这样算：

```text
基线 y = 盒顶 + 竖 padding + 字号 × 0.8，取偶数
18px 的盒标题：y = 盒顶 + 16 + 14.4 ≈ 盒顶 + 30
```

1px 描边的矩形坐标带 `.5` 偏移（`x="0.5"`），否则一条线跨两个像素，
渲染出来是一圈发灰的 2px 边。

## 字号与字重

| 角色 | 字号 / 字重 | 颜色 | 字体 |
|---|---|---|---|
| 图标题 | 20 / 600 | `#ededed` | sans |
| 盒标题、泳道名 | 18 / 600 | `#ededed` | sans，标识符用 mono |
| 说明句 | 16 / 400 | `#a1a1aa` | sans |
| 代码、命令、字段名 | 16 / 400 | `#ededed` | mono |
| 注解、图例、单位 | 14 / 400 | `#74747b` | sans |
| 单个读数 | 28 / 600 | `#ededed` | sans + 等宽数字 |

字重只有 400 和 600 两档。一张图最多三种字号。

最小字号跟着画布宽走：**画布宽 ÷ 90，向上取偶数**。1240 宽的画布最小 14。
理由是渲染尺寸：一张图缩到正文宽度的一半，字号也跟着减半。

## 画布与构图

| 名目 | 值 |
|---|---|
| viewBox 宽 | 固定 1240 |
| viewBox 高 | ≤ 620，横版 |
| 盒子数 | ≤ 12 |
| 文本节点 | ≤ 24 |
| 嵌套 | 画布之内最多再套两层 |

一张图占满正文宽度。要对比两个状态时画两条泳道，不并排放两张竖图——
并排渲染宽度减半，图里的字跟着掉到读不出来。

超出密度上限说明这张图在替表格干活。判据一句：把图里的文字抄成一张两列
表，信息没丢，就别画这张图。图只画表格画不出的东西——拓扑、并行、时间
比例、包含关系、重复次数。

## 一张最小的图

复制上面那段 `<defs>` 之后，正文长这样。安全区 32、盒间距 48、
基线 `盒顶 + 30` 都能在坐标里认出来。

```svg
  <rect x="0.5" y="0.5" width="1239" height="271" rx="12" class="canvas" />
  <text x="32" y="48" class="title">一条 Attempt 的三段</text>

  <rect x="32.5" y="88.5" width="359" height="104" rx="8" class="box" />
  <text x="52" y="118" class="label mono">sandbox.setup</text>
  <text x="52" y="142">每个 Sandbox 一次</text>
  <text x="52" y="166" class="note">Runner 自动调度</text>

  <path d="M400 140 H432" class="arrow" />

  <rect x="440.5" y="88.5" width="359" height="104" rx="8" class="box" />
  <text x="460" y="118" class="label mono">test(t)</text>
  <text x="460" y="142">作者的代码</text>
  <text x="460" y="166" class="note">t.send、断言、判分材料</text>

  <path d="M808 140 H840" class="arrow" />

  <rect x="848.5" y="88.5" width="359" height="104" rx="8" class="box" />
  <text x="868" y="118" class="label">判定</text>
  <text x="868" y="142"><tspan class="good">passed</tspan> / <tspan class="bad">failed</tspan></text>
  <text x="868" y="166" class="note">四态折叠后写进 Run</text>

  <text x="32" y="236" class="note">三段之间是顺序，不是重试：重试在 Attempt 之外。</text>
```

## 落盘与引用

| 图的用处 | 放哪 |
|---|---|
| 只服务一篇 `docs/` 文档 | 该文档旁边的 `assets/<主题>.svg` |
| 多篇 `docs/` 文档共用 | `docs/assets/<主题>.svg` |
| 公开站 | `docs-site/images/<主题>-zh.svg`，英文另存一份 |

用 markdown 图片语法引用，路径填 `assets/<主题>.svg`，占满正文宽度。
不要用 `<table>` 或 `<img width>` 把两张图并排塞进一行。

图是独立文档，class 名与 id 不会和宿主页互撞。只有整份 SVG 内联进 MDX 时
才需要给 `id` 加文件前缀——那时同一页的 marker 共享一个命名空间。

## 源码卫生

- `role="img"` 加 `<title>` / `<desc>` 加 `aria-labelledby`，三样齐全。
  `<desc>` 写成完整一句，读屏用户和搜索引擎只拿得到它。
- 手写坐标，对齐网格，不放设计工具导出的路径。导出件的 diff 读不了也改不动。
- 正文里的 `&`、`<`、`>` 转义成实体。
- 不写 `prefers-color-scheme`。媒体查询对上的是渲染器的主题，不是文档的主题，
  而图自带底色，浅色页面上照样是同一个样子。
- 不引外部字体、不嵌位图、不引外部样式表。字体族只用系统栈。

## 过关清单

- 缩到正文宽度的一半，最小的字还读得出吗。
- 去掉所有颜色，图还讲得通吗；讲得通说明颜色只在做语义。
- 带语义色的元素超过 3 个了吗。
- 坐标里有 8 的倍数之外的数吗（`.5` 偏移与 4 的微调除外）。
- 把图里的文字抄成两列表，信息丢了吗；没丢就删掉这张图。
- 单独读 `<desc>` 那一句，说得清这张图讲什么吗。
