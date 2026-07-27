# 让人和 Agent 读取同一份自定义报告

## 解决什么问题

团队定义了自己的质量、成本和失败分类口径。人需要在浏览器查看图表、导航和完整证据；Coding Agent
在终端里运行修复循环，需要先读同一套业务口径，再决定修改哪条 Eval 或被测代码。

如果自定义报告只有 web 面，Agent 就只能启动浏览器，或直接解析 Record 并重新实现聚合。两条路都会
绕开报告已经确定的 Sample 范围、读数和证据引用，容易让人和 Agent 看到不同数字。

## 同一份定义进入两个宿主

项目把报告设为默认后，人直接打开 `view`：

```bash
niceeval view
```

Agent 在终端读取同一份定义的 text 面：

```bash
niceeval show
niceeval show memory/retention --page failures
```

需要稳定机器形状时，Agent 使用同一视图的 JSON 面，而不是遍历 `.niceeval` 文件树：

```bash
niceeval show memory/retention --page failures --json
```

三种输出共享宿主选出的 Sample 和同一次 Source compute。质量分、成本、覆盖缺口与 locator 引用
因此同值；Agent 根据终端结果修代码后，人刷新浏览器看到的是同一口径下的新 Run。

## 两面相同的是事实，不是布局

web 面可以使用排序、过滤框、tooltip、折叠区和 dialog。text 面不模拟浏览器交互，而按原语规定的
降级形态表达同一份事实：输出既定行序或过滤后的行集，把 hover 内容写成括注，把折叠内容展开或按
预算给出 `--expand` 入口。

自定义 Source 和组合组件不分别实现两面 renderer。作者声明一次 Content 与组件树，官方原语负责
text/web 投影；这保证浏览器能看到的信息不会因为 Agent 只能访问终端而静默消失。

## 下钻

报告声明 attempt-input page 后，浏览器中的 locator 链接与终端命令进入同一张详情页：

```bash
niceeval show @1qrdcfq8
```

web 面可以把它放进 dialog，text 面按区块输出判定、断言、对话、时间树与 diff。两面消费同一份
`AttemptEvidence`，不会各自重读 artifact 或重建执行树。

## 边界

- `show` 保证事实与证据完整，不保证和浏览器具有相同几何布局。
- `links`、`footer`、主题、脚本与样式是 web 外壳，不为 Agent 转成无意义的终端文本。
- Agent 需要任意查询或外部统计工具时，使用 Record 读取面；自定义报告解决的是复用已经定稿的业务口径，
  不是替代通用查询。
- 报告没声明 attempt-input page 时 locator 只显示为文本；要复用官方详情，报告显式继承 `standard`
  或加入 `standardAttemptPage`。

## 相关阅读

- [共用自定义报告](共用自定义报告.md) —— `--report`、`--page` 与项目默认报告的完整流程。
- [Reports 架构](../../architecture.md) —— Source、双面 Component与宿主管线。
- [终端排版与本地化](../构建报告/自定义组件/终端排版与本地化.md) —— text 面的排版责任。
