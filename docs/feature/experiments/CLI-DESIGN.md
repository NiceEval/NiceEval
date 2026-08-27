# Experiments CLI 运行反馈

`niceeval exp` 的终端输出只服务当前进程：说明选择了什么、正在做什么、是否完成，以及用户下一步该做什么。它不成为持久结果格式，也不开放 Report、Analysis、Page、renderer 或自定义 formatter。

## 结束反馈

Human 输出使用 Experiment、Eval、Attempt、结果、安全错误摘要、run ID 和下一步。它不展示 Record row、lease、Member、Slot、Relation、内部 selector 或数据库细节。

每条已封口 Run 都可由人使用 `niceeval view --run <run-id>` 审阅。已创建的单个 Attempt 保留 locator 作为数据 identity；用户从
该 Run 的页面 Run/Attempt 导航打开详情。自动化不读取 Human 文本，而是以 receipt 中的 `runIds` 构造固定 `niceeval query`
request。

Attempt 创建前的失败没有 locator。Human 输出必须说明受影响的 Experiment 与未启动数量，并给出 `niceeval view --run <run-id>`；它不能伪造 Attempt 详情或以空读数代替错误。

## 机器边界

`exp --json` 的 receipt 只交付 Invocation completion、run IDs 与进程级事实。Verdict、usage、cost、Attempt 详情、缺口和 Evidence 都在 sealed Record 中，由固定 Inspection operation 关闭后通过 query 或 View 读取。

终端输出与 query、View 的职责不重叠：前者描述当前进程，后两者只读取 sealed facts。任何持久结果都不能由进度面板、后台 session 或第三方 renderer 重建。
