# Attempt 详情的呈现

打开一个 locator 是为了回答四个问题：挂在哪条断言、agent 当时说了什么做了什么、
时间花在哪、改了哪些文件。区块顺序、每块的字段与形态都按这四个问题定。
弹窗形态不改变其中任何一条：宿主只负责把这张 page 放进 dialog，
壳的行为见 [View · dialog 摆放](../../view.md#attempt-详情的-dialog-摆放)。

## 自上而下有什么

顺序即 [`AttemptDetail`](attempt-detail.md) 的排列，数据源与原语的对应见
[公开区块集](README.md#公开区块集)。

| 区块 | 回答什么 | 展示的字段 | 形态 |
|---|---|---|---|
| `AttemptSummary` | 这是谁、判定是什么 | locator、experiment / eval / attempt 序号、verdict、开始时刻、耗时、成本、本轮挣分、能力位 | verdict pill + locator 头行，其余为统计卡 |
| `AttemptAssessment` | 挂在哪条断言 | 有标注源码时是 `sources.attempt.source`，否则是 `sources.attempt.assertions` 的判定表 | 二选一，不并排 |
| `AttemptNotices` | 有没有基础设施问题 | snapshot error 的 phase / code / message / cause，加已持久化 diagnostics | 按级别分组的 Callouts |
| `AttemptFixPrompt` | 拿什么去修 | 单条失败的完整 prompt | 可复制块 |
| `Waterfall`（timeline） | 时间花在哪 | runner phases、hook、command、turn，以及按 `traceId` 挂上的 spans | 可逐层展开的时间树 |
| `AttemptUsage` | 花了多少 | turns、tool calls、token 用量、成本 | 数值表 |
| `Conversation` | agent 说了什么做了什么 | 分轮事件流与失败命令卡 | 分轮卡片；有标注源码时轮次已投影回源码行，这块不出现 |
| `Waterfall`（trace） | 原始 span 长什么样 | canonical OTel span 树 | 时间树 |
| `DiffView` | 改了哪些文件 | 文件清单、增删行数、patch | 文件列表 + 可展开 patch |

每块的数据源解析为 `null` 时整块不出现，不留空标题。
`AttemptSummary` 恒有：它读的 snapshot 对任何 attempt 都存在。

跨 attempt 的汇总不进这张 page——读数、榜位、稳定性矩阵的输入是 Sample，
这张 page 的输入是一份 `AttemptEvidence`。要对照另一次执行，用它自己的 locator 打开。

## 源码行展开区里有什么

点开一行，展开区接在该行下，按下面顺序排。轮标签与 sent prompt 不重复出现——
源码行本身就是那次 `t.send`，重复一遍等于把同一句话说两次。

| 内容 | 字段 | 形态 |
|---|---|---|
| 该行的轮次回复 | 每条 assistant / user / thinking / tool / error / skill / subagent 条目 | 与 `sources.attempt.conversation` 同一套条目呈现，轮头收起 |
| 该行的每条 assertion | name、outcome、severity、挣分 | 一行判定摘要，tone 与该行状态同色 |
| 失败与 soft 项的细节 | expected / received | 摘要行下的等宽正文 |
| 该行的给分记录 | label、挣分、分组路径 | 一行 `label · +n pts` |

行右缘只放分数 pill、中止标记与展开记号；着色、密度与滚动归属见
[`sources.attempt.source`](../sources/attempt-source.md#web-面视觉规范)。
没有 `loc` 的 assertion、给分记录与轮次不丢弃：它们落在全部源码块之后的兜底区。

## DOM 骨架与类名

稳定的 `niceeval-*` 类名是公开定制面：在官方 stylesheet 之后加载自己的覆盖即可，
不需要构建工具。骨架因此是契约的一部分——组件发射的类名与 stylesheet 的选择器
逐个对上，两侧都不许单方面改名。

`SourceView` 的骨架：

```html
<div class="niceeval-report niceeval-source-view">
  <div class="niceeval-source-block">              <!-- 嵌套片段加 niceeval-source-block--nested -->
    <div class="niceeval-source-block-path"></div> <!-- 文件路径头 -->
    <div class="niceeval-source-lines">            <!-- 统一横向滚动的行容器 -->
      <details class="niceeval-source-line niceeval-source-line--gate-fail">
        <summary>
          <span class="niceeval-source-line-summary">          <!-- 行盒：三列 -->
            <span class="niceeval-source-gutter"></span>       <!-- 行号；有状态时加 -mark 换成图标 -->
            <span class="niceeval-source-code"></span>         <!-- 高亮后的源码 -->
            <span class="niceeval-source-meta">                <!-- 右缘 -->
              <span class="niceeval-source-pill"></span>
              <span class="niceeval-source-abort-mark"></span>
            </span>
          </span>
        </summary>
        <div class="niceeval-source-line-detail"></div>        <!-- 展开区 -->
      </details>
      <div class="niceeval-source-line"></div>                 <!-- 无证据的行不是 details -->
    </div>
  </div>
  <div class="niceeval-source-unmapped"></div>                 <!-- 兜底区 -->
</div>
```

行状态一档一个类：`niceeval-source-line--send`、`--passed`、`--gate-fail`、`--soft-fail`、
`--unavailable`。中止行按 `--gate-fail` 呈现，其后未到达的行加
`niceeval-source-line-unreached`。调用片段是 `niceeval-source-calls` 下的
`niceeval-source-call`（帧无正文时是 `niceeval-source-opaque` 与 `niceeval-source-opaque-label`）。

展开区与兜底区里的三种条目各有自己的类：

| 条目 | 类名 |
|---|---|
| 判定摘要 | `niceeval-source-assertion`，加 `niceeval-tone-good` / `-warn` / `-bad` / `-na` 之一 |
| 细节正文 | `niceeval-source-assertion-body` |
| 给分记录 | `niceeval-source-score-entry` |
| 轮次回复 | `niceeval-conversation` 那一族，与独立的对话区块同一套条目呈现 |

展开记号与展开区里的轮头收起都由 stylesheet 负责，组件不为它们发节点：
纯呈现的记号进 CSS，不进 DOM 契约。

其余区块的根类名：

- `niceeval-attempt-summary`、`niceeval-usage-table`
- `niceeval-callouts`、`niceeval-copy-block`
- `niceeval-waterfall`、`niceeval-conversation`
- `niceeval-diff-view`、`niceeval-table`

每个族内的结构类都要有规则，纯挂钩的例外逐条写明理由；两个方向由
`test/unit/report-css-contract.test.ts` 守护。

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集、page 输入形态与在 show / view 怎样渲染。
- [`AttemptDetail`](attempt-detail.md) —— 区块排列顺序的组合组件全文。
- [`sources.attempt.source`](../sources/attempt-source.md) —— 着色、密度与展开交互的视觉规范。
- [View · dialog 摆放](../../view.md#attempt-详情的-dialog-摆放) —— 弹窗壳的宿主行为。
- [主题与 CSS](../../library/theme.md) —— 令牌与覆盖层次。
