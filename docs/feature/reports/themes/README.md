# 主题目录

一份主题一个文件。这里放的是**具体主题的设计**——它的令牌取值、视觉主张与验收要求；主题这个机制本身（`defineTheme`、装载链、令牌全集、CSS 级联）在 [Library · 主题](../library/theme.md)。

| 主题 | 名字 | 一句话 |
|---|---|---|
| [Basalt](basalt.md) | `basalt` | 官方暗色主题（默认）：黑色系、零圆角、发丝分隔线的冷峻数据面 |
| [Chalk](chalk.md) | `chalk` | 官方浅色主题：白面、圆角、蓝 accent，证明观感完整住在主题里 |

内建主题按名字从 `niceeval/report/built-in` 具名导出，名字同时是 CLI 上的取值：`niceeval view --theme basalt`。新增一份内建主题的形态是固定的——一份新的 `defineTheme` 成品、一个新名字、一个新文件、一条新的具名导出，加上这张表里的一行；不需要注册表，也不改装载管线。

自己的主题不必进这个目录：它是普通值，随项目文件或 npm 包分发（[写法](../library/theme.md#复用与分发)）。这里只收随 NiceEval 一起发布、由官方负责对比度与色觉可分辨性的那些。

## 相关阅读

- [Library · 主题](../library/theme.md) —— 主题制品、四档装载链、令牌全集与 CSS 出口。
- [Library · 内建报告](../library/built-in.md) —— 内建视图与内建主题的同一个入口。
- [自己写报告组件](../use-case/构建报告/自定义组件/) —— 组件怎么读令牌，才能跟随这里的任何一份主题。
