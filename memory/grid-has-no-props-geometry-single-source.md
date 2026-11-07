# Grid 收敛成零 props:体裁与体量也不是作者的输入

**裁决(2026-07-28)**:`Grid` 的公开面收敛成 `LayoutProps`(只有 `children` / `className`)。
列数、边框体裁、格内留白与内置 `Stat` 的主值字号全部从「格数 × 可用宽度」算出,几何常量只在
`src/report/definition/grid-layout.ts` 出现一次。

**曾选方案与否决理由**

- **保留 `variant: "plain" | "boxed"` + `density: "regular" | "compact"`**(7f05c699 的形态)。
  否决:同一次迭代刚立下「列数不是作者的输入,再给一个上限只会和算出来的宽度打架」,这句话对
  `variant` 和 `density` 一字不改地成立。实证是摘要条那层皮肤——它同时放大了 `--stat-value-size`
  (16→20px)、放宽了 padding(10→12/16px),还自己发明了一个 `@container (max-width: 920px)` 的
  合并/散开断点;而 Grid 自己算出来的 6 格一行门槛是 1010px。两个数从来没对齐过,容器宽度落在
  920–1010 之间时,皮肤按「合并条」渲染而列数还是 3,出来一个带外框、内部两行、行间没有分隔线的
  怪形态。皮肤永远只能靠猜一个像素数去追 Grid 算出来的宽度。
- **把合并态升格成 `variant: "joined"` 第三档**。否决:公开面 +1 只服务一个消费者,而且它在 text
  面没有对应物(终端里拼共边框已被 layout.md 否决过),等于声明一个两面不等价的档。
- **`density` 换成按格数判档**(格数 ≥ N 用 compact)。否决:文档现有的 6 格读数卡与 6 格摘要条
  想要不同的档,按格数判在这两个既有例子上就打架。

**落地形态**:最小格宽是唯一的几何常数(web 160px / text 24 显示列),只参与算容量列数;实际格宽
= 可用宽度扣掉格线后除以列数,是随容器连续变化的量;留白与字号是实际格宽的函数(160px 取下限,
220px 到上限,`clamp()` 线性过渡),插值写在 stylesheet 一次,随身 `@container` 规则只声明
`--grid-columns`。边框体裁两面各自成立:web 是一片面板(外框 + 圆角 + 每格向右/下投 1px 线,越界
的被 `overflow` 裁掉),text 只画格线不画外框——数据原语不画区域框,套在 `Section` 里会是吃掉可用
宽度的双框。

契约正文:`docs/feature/reports/library/layout.md`「换列规则」「体裁与体量」。
同批把 attempt 详情的身份 KPI 与 usage 两块也换成 `Grid`:它们原本是 `repeat(auto-fit, minmax(…))`
加 `@media (max-width: 640px)` 的自制几何——`auto-fit` 不摊匀(6 格在装得下 5 列的宽度上排成
5+1),视口 media query 量的又是窗口而不是这块内容实际拿到多宽,attempt 详情塞进 view 的窄 dialog
时会照着窗口排版。相关:[[grid-cell-child-block-margin-inflates-row-height]]
