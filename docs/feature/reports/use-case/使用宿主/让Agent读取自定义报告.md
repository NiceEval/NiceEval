# 让人和 Agent 读取同一份自定义报告

项目把报告设为默认后，人用 `view`，Agent 用 `show`：

```bash
niceeval view
niceeval show
niceeval show memory/retention --page failures
```

两个宿主选择同一份 Sample，并执行同一个 page render。
一个 page 实例产生的同一棵值树分别交给 text 与 web renderer。

web 可以提供排序、tooltip、折叠与 dialog；
text 使用声明过的降级表达相同终值、缺失与证据 refs。
几何不必相同，事实不能静默减少。

需要稳定机器形状时，使用内建 show 切片的 `--json`。
任意自定义报告树不序列化成 JSON；机器结果来自公开任务函数。

报告声明 attempt page 后，浏览器 locator 与
`niceeval show @<locator>` 进入同一 PageDefinition。
未声明时浏览器仍使用官方详情页，而 show 保留普通 locator 文本；
要让两面共用官方定义，把 `standardAttemptPage` 放进自己的 pages 数组。
