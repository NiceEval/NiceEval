# Reports —— 查看与呈现结果

实验结束后有三种查看方式,它们读取同一份 [`.niceeval/` 运行产物](../results/README.md),区别只是交互深度和定制程度:

| 需求 | 入口 | 适合场景 |
|---|---|---|
| 在终端定位失败、看源码、对话和 diff | [`niceeval show`](show.md) | AI 自主迭代、CI、快速 debug |
| 在浏览器浏览历史、图表和完整证据 | [`niceeval view`](view.md) | 人工复盘、分享静态报告 |
| 定义自己的成绩单、榜单或趋势图 | [`niceeval/report`](library.md) | 产品页面、benchmark 站、定制汇报 |

`show` 和 `view` 读取同一份 Scope，也都接受 `--report <file>` 替换报告槽。`--report` 文件的默认导出恒为 `defineReport` 产物：传一棵报告树填进默认外壳；传配置对象还能声明导航外壳——标题、GitHub 等外部链接、页脚与自定义脚本——并把内容拆成多页，`view` 渲染完整导航（web 页脚恒带一行指向 niceeval 官网的 `Powered by niceeval`），`show` 用 `--page` 逐页读，写法见 [Library · 外壳与多页](library/shell.md)。不传 `--report` 时，两者装载内建报告——`niceeval/report/built-in` 的默认导出，内容就是一行 `<ExperimentComparison />`：它先按 experiment id 的父目录切成可比组，再在每组内部画成本 × 端到端成功率散点并列出配置；不同组的 experiment 永远不进入同一张图或同一张比较表。`view` 默认加载完整 Scope，由用户在组选择器里切换当前图表；`show` 若命中多个组只打印组索引与继续查看的命令，命中单组才展开散点与列表。单 Eval、Attempt、history 与证据切面仍由各自宿主负责下钻。

报告只表达“怎么看”。原始判定、断言、事件、trace 和 diff 的事实归 [Results](../results/README.md)；运行过程中把事实写出去的回调叫 [Reporter](../../runner.md),不属于这里。

## 从哪开始

- 正在修一个失败的 eval：从 [`show`](show.md) 开始。
- 想浏览或发布完整结果站：看 [`view`](view.md)。
- 想写自己的报告：看 [Library](library.md)，先按“选择组件”表挑形状，再进对应分篇复制配方。
- 想把结果发布成带品牌、外链和多页导航的站点：看 [Library · 外壳与多页](library/shell.md)。
- 想知道默认报告本身怎么写、怎么逐步改造：看 [Library · 内建报告](library/built-in.md)。
- 想知道字段从哪个文件来：看 [Results Architecture](../results/architecture.md)。

## 相关阅读

- [Show](show.md) —— 终端中的榜单、attempt 诊断和证据切面。
- [View](view.md) —— 本地网页、结果收窄和静态导出。
- [Library](library.md) —— 报告组件目录和常用组合配方。
- [Architecture](architecture.md) —— 两个宿主、报告树和可序列化边界。
- [Results Lib](../results/library.md) —— 结果读写库:类型的家、writer、`openResults`、实验/快照层次、选择器、身份键;第二档吃它的读取面。
- [Results Format](../results/architecture.md) —— 唯一持久化事实来源。
