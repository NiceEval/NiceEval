# Report 图表语义内核 —— Architecture

## 值与所有权

图表的值分四层，各层只有一个 owner。

| 值 | owner | 可以包含 | 不得包含 |
|---|---|---|---|
| `ChartSemantics` | 图表编译器 | series、channels、typed values、missing、`MetricValue`、refs、locator | locale 字符串、像素、主题、href、DOM |
| `ChartDisplayFacts` | 关闭 Report tree 的 Host | effective-locale 文本、coverage、issues、refs、可服务 locator | 几何、浏览器状态、重新计算能力 |
| `TextChart` | terminal projector | 字符布局、完整精确读数、terminal target | SVG、CSS、像素、web href |
| `WebChart` | web projector | SVG scene、精确值表、已生成 href、增强 payload | source rows、Sample、Analysis callback、原始 `MetricValue` object |

`ChartSemantics` 是 context-free。图表 compiler 不读取 render context，也不拥有 Page、route 或 visual theme。
它在一个组件实例关闭时运行一次。text 与 web 投影复用结果，不能为了另一种面再次执行作者逻辑。

`ChartDisplayFacts` 在 effective locale 下形成一次。每个 channel 各自保留显示文字、缺失 reason、coverage、issues 与 refs。
x 与 y 的 Evidence 不得先合并成 point-level 事实，再由任一 projector 拆回去。

## 编译输入

图表原语的 `points` 是 closed rows 或外部 scalar points。compiler 验证 series、channel 字段、轴、mark policy 与数值有限性，再形成语义值。

Analysis-backed channel 中，measure 字段必须是 `MetricValue`。它的 `value` 为 `null` 时仍携带 state、samples、total、issues 与 refs。
compiler 形成 missing cell，不得用零、空字符串或相邻 point 替换。

外部 scalar points 没有 `MetricValue`、coverage、issues 或 Evidence。它们与 Analysis-backed series 共用数值轴时，作者必须明确 axis 的 unit、format、bounds 与比较方向。
compiler 不从外部值猜这些语义。

每个 point 的内部 key 在 compiler 关闭输入时确定。它必须在同一 chart 内唯一，并同时用于 display facts、精确值行、scene point 与 payload。
作者不能以显示 label、数组 index、SVG node 或 locator 拼接它。任何具体编码都属于内部实现。

## Page、locator 与链接

图表 compiler 只保留已关闭 locator，不调用 `params.encode()`，也不产生 href。Host 在已知当前 Page、目标参数化 Page 和有效 locator 后执行现有参数验证。
随后 Host 把可服务结果投影为各面所需的 target。

terminal target 与 web href 都由同一验证结果派生。href 不可服务时，SVG、精确值表和 payload 都不含链接；refs 仍按 channel 显示。
静态执行先按 Page 契约列举参数实例，图表不会让浏览器临时生成另一个实例。

## 三面投影

terminal projector 读取 `ChartDisplayFacts` 并生成宽度适配的字符图或读数表。布局可以省略几何关系，但每个点的完整精确值与 missing reason 必须可读。

web projector 从同一份 facts 生成三份相互引用的输出：

```text
ChartDisplayFacts + size + theme
              │
              ▼
       SVG scene / exact-value table / enhancement payload
```

尺寸、tick、颜色、shape、class 与 SVG 几何只存在于 `WebChart`。theme 或尺寸变化不能改变 chart 的 value、missing、coverage、issues、refs、locator 或 point 集合。

精确值表是 SVG 的同级原生 HTML。每个可见 point 恰有一行，即使该 point 无法绘制；每个已声明 channel 恰有一个 cell。
cell 显示 value 或 missing reason，并保留该 channel 自己的 coverage、issues 和 refs。

payload 只携带 point key、稳定焦点顺序、几何、tooltip display rows、精确值行 key 与已生成 href。
它不含 source row、`MetricValue` object、locator、Page 参数、formatter 或任何 callback。

## 渐进增强

初始 HTML 已包含 SVG、名称、说明和精确值表。controller 不做 hydration，也不删除无脚本内容。

controller 只维护当前焦点点、固定提示点和输入方式。方向键通过 payload 的顺序和几何选择相邻点；pointer 命中写入同一个焦点 key。Enter 只在当前 point 有 href 时导航，Escape 只清除固定提示。

focus marker、tooltip 和 `aria-live` 状态区从 payload 按 key 查找。controller 不读取 `textContent`、SVG path、DOM 顺序或 `<title>` 来重新创建图表语义。

## 验收不变量

同一 locale 的 terminal points、web 精确值行与 static 精确值行必须逐字段相等：

- point 集合与 series 顺序相同；
- 每个 channel 的 scalar、display、missing reason、coverage、issues 与 refs 相同；
- 每个可服务 locator 在各面产生同一个可服务目标；
- 每个缺失 point 仍出现在精确值表；
- theme、尺寸、SVG tick 或 tooltip 开关不改变上述事实。

验收使用同时含 Evidence rows、外部 points、多个 `MetricValue` states、缺失与 locator 的真实 Report。
它分别通过 `show`、`view`、禁 JavaScript 的浏览器和 `view --out` 验证同事实输出。

另一组浏览器验收以键盘与 pointer 选中同一个 point，检查 tooltip、focus marker、状态区和精确值行一致。静态导出验收确认 Page 和图表只执行一次，断网浏览不会重新读取事实。
