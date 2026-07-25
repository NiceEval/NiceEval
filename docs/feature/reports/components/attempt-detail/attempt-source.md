# `AttemptSource`

GitHub diff 式带标注源码：TypeScript 轻量语法高亮，send / assertion 按蓝 / 绿 / 红 / 黄整行着色，点击对应源码行展开该轮完整回复与 assertion 细节；计分制下承载全部给分证据——得分点行右缘挂挣分 pill、`t.score` 调用行原位标注给分、前置中止行标 `⤓` 且其后源码降灰，`loc` 不在源码内的得分点与给分记录进 unmapped 区（[计分制展示](../../../scoring/library/display.md#计分制points-与给分记录)）。没有 source 时零输出，不自行 fallback。区块在整体装配里的位置见[公开区块集](README.md#公开区块集)。

## web 面视觉规范

`AttemptSource` 的 web 面与产品站首页的 eval 示例卡（`site/components/site-home-setup.tsx` + `site/app/globals.css` 的 `.eval-code` 族）是同一套视觉语言的两份实现：示例卡是这套「源码即报告」叙事的公开形象，报告里的真实源码视图与它同语言，用户从官网到报告不切换视觉心智。二者不共享组件——示例卡是需要 hydration 的营销交互（React state 展开、轮播、埋点），`AttemptSource` 按报告契约必须在零 JS 的静态 attempt 文档里完整成立；数据上示例卡是策划数据，`AttemptSource` 是真实证据（一行多条 assertion、四种 tone、unmapped / unlocated 区）。因此对齐的单位是下面这份规范，不是组件：

- **密度**：等宽 12.5px / 1.65 行高；整块源码统一横向滚动，普通行之间不画分隔线；行盒撑到最长行宽度，状态底色与左缘盖满整行，不在横向滚动后断成半截。
- **行状态**：状态 = 整行浅染 + 2px 左缘 + 行号位图标。send 行蓝、passed 绿、gate-fail 红、soft-fail / unavailable 黄；浅染是 tone 色约 8% 的透明混合，不是饱和色块。有状态的行用内联 SVG 图标顶替行号（send 对话气泡、passed 圈勾、failed 圈叉、soft-fail 圈叹号、unavailable 圈问号；不引第三方图标库），普通行显示行号。计分制的前置中止行按 gate-fail 红；中止行之后的全部源码行整体降灰（未到达——那些行没有任何断言或给分记录，不是因为没写，是因为没跑到），行号照常显示。
- **给分行**：`t.score(...)` 调用行不着判定色——给分是分数面事实，不是判定；行号照常，右缘挂挣分 pill，展开区显示该条给分记录（label、挣分、分组路径）。`loc` 不在展示源码内的得分点与给分记录列在源码块后的 unmapped 区，给分记录按 `groupPath` 分组（与 `AttemptAssertions` 同一套分组算法）。
- **右缘 meta**：行右侧只放分数 pill（soft 的阈值分数，或计分制的挣分 `+1 pt` / `+0 pts`）、中止行的 `⤓` 标记与展开 chevron，钉在滚动视口右缘（sticky），横向滚动时始终可见；不显示内部 turn 标签（如 `turn1`）。
- **展开区**：点击行展开的回复 / assertion 细节直接接在源码行下，dashed 上边线 + tone 色左缘；按容器可视宽度排版换行并钉在滚动视口左缘，不跟随代码横向滚动；不套二级卡片，不重复 turn 头与 sent prompt。首个失败或警告行默认展开。
- **语法高亮**：零依赖逐行 TypeScript token（comment / string / keyword / number / function 五类语义 class）；暗色 token 取 VS Code Dark+ 系（与示例卡的 prism vsDark 主题同源），浅色为等价可读色。
- **兜底区**：源码块之后、与源码块同宽。「Other conversation」的分轮卡片带 verdict 色左缘与轮标签头行（这里没有可依附的 send 行，轮标签是该轮唯一的身份锚），卡片内部条目与 `AttemptConversation` 同视觉语言；回复条目在每个渲染容器里都必须有完整样式覆盖——`.nre-conv-*` 规则按容器限定，新容器不会自动继承。
- **交互载体**：展开一律是原生 `<details>`，静态文档零 JS 成立。

这份规范与官方 stylesheet 组合后的实际观感（染色、布局、滚动、展开交互）由 [E2E 报告域](../../../../engineering/testing/e2e/report.md)在真实浏览器里验收，单元层只覆盖数据投影与 DOM 结构事实。

## 在 `show` 与 `view` 怎样渲染

| `show @locator --report ...` 的 text 面 | `view` 的 web 面 |
|---|---|
| 未通过 assertion 的源码位置与 expected / received，加 `--source` 命令；含轮次时同时保留 `--execution` 下钻入口，不倾倒整份源码；计分制同时列得分点挣分与给分记录 | TypeScript 语法高亮的完整源码；send / pass / gate-fail / soft-fail 行分别着色，可点击展开该轮回复或 assertion 细节；计分制附挣分 pill、给分行标注与中止后降灰 |

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与 page 输入形态。
- [`AttemptAssessment`](attempt-assessment.md) —— 把本组件与 `AttemptAssertions` 二选一的组合件。
