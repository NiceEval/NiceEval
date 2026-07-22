# `@locator`:从榜单一行下钻到一次失败的全部证据

## 解决什么问题

一批 eval 跑完,榜单里一行 `✗ 失败` 只给出主失败断言的单行摘要——够分诊,不够定位。要回答「挂在哪条断言、agent 当时说了什么做了什么、时间花在哪、改了哪些文件」,不需要重跑:榜单中的 `@<locator>` 是 attempt 的稳定引用,把它复制给后续命令,便可从汇总数字回到同一次执行的证据([契约](../show.md#从榜单下钻到-attempt))。

## 全流程

1. 裸 `niceeval show` 渲染默认榜单,失败的 Attempt 子行自带 locator 与主失败摘要:

   ```text
   ✗ 失败    memory/swelancer-manager-proposals
     ✗       └─ @1qrdcfq8                            equals(4) · received 3                      50.0s     $0.05
   ```

2. 打开诊断首页,一页判断「为什么失败」:

   ```bash
   niceeval show @1qrdcfq8
   ```

   输出按区域框堆叠 assertions、timing、conversation、changes 等块,每块的下钻命令嵌在框的下边框上——命令总是紧贴它能展开的那块证据;没有对应证据的块整块省略,不留空标题([失败诊断首页](../show/attempt.md))。`errored` attempt 的首页则先给结构化 error 的 phase、code、message 与有限 cause,不用 trace 也能解释基础设施错误。

3. 只有在需要理解断言上下文、agent 为什么给出这个结果、或具体改了什么时,才继续打开证据切面,四个 flag 各答一件事:
   - `niceeval show @1qrdcfq8 --source` —— 挂在源码哪一行?断言与 `t.send(...)` 行标回运行时保存的 eval 源码,失败行紧跟分组、matcher、期望值和实际值([分篇](../show/eval-source.md))。
   - `niceeval show @1qrdcfq8 --execution` —— agent 每轮说了什么、调了什么工具?对话按轮分段、轮内按时间线卡片显示([分篇](../show/execution.md))。
   - `niceeval show @1qrdcfq8 --timing` —— 时间花在哪?有界诊断时间树;`--timing=full` 逐节点展开同一棵完整时间树([分篇](../show/timing.md))。
   - `niceeval show @1qrdcfq8 --diff` —— 实际改了哪些文件?agent 归因增量的文件级摘要;`--diff=manager_decisions.json` 看单文件逐窗口 patch([分篇](../show/diff.md))。

## 边界

- locator 必须带 `@`,既不是数组下标也不是文件路径。漏写 `@` 时输入按 eval id 前缀处理并明确报无匹配,不做模糊猜测([契约](../show.md#无匹配与不可读结果))。
- `--diff=<path>` 必须用 `=` 连写,空格后的 token 会按 eval id 位置参数解析。
- 四个证据 flag 是直接读取同一份 Results evidence 的专用终端投影,不经报告 page;带 `--report` 时它们照常可用([契约](../show.md#选择结果范围))。
- `--timing=<mode>` 只接受 `summary` 与 `full`,其它值按用法错误退出非零,不静默回退。

## 相关阅读

- [失败诊断首页](../show/attempt.md) —— `show @locator` 一页的区块顺序与省略规则。
- [`--source`](../show/eval-source.md) / [`--execution`](../show/execution.md) / [`--timing`](../show/timing.md) / [`--diff`](../show/diff.md) —— 四个证据切面的单源契约。
- [裸 `show` 的默认报告](../show/default-report.md) —— locator 从哪里来、Result 单元格的摘要口径。
