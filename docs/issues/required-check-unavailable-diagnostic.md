# 必需检查不可用导致 errored 但执行诊断为空

公开 Attempt @157DQADS388G1 的两轮 conversation 都 completed，模拟用户活动为 Simulated user answered the Agent，但总结果是 errored；attempt.trace diagnostics.items 为空。attempt.assertion.detail 显示必需文件检查“不另建或改动子目录的 Node 项目与锁文件”为 unavailable / source-unavailable。用户必须枚举断言才能定位错误归属。

期望公开总览或执行诊断直接指出导致 errored 的必需检查及不可用原因，并提供证据入口。运行于 NiceEval-Eval，Run a24d296c-8237-42f4-90ea-24cab074a714，宿主消费本地修复候选（HITL 修复提交 eb59bb063），被测文档版本 0.20.1-canary.123。Linux / Node 24 / Instabox。使用公开 query run 的 attempt.get、attempt.trace、attempt.assertion.detail 取得证据，未读取私有结果文件。未含凭据。
