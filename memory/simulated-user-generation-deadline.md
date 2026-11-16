---
relations:
  - role: supports
    target: docs/feature/eval/library/simulated-user.md
---

# 模拟用户期限不能中断被测 Agent 的续轮

六条安装评估都报告 `simulated-user-failed: timeout`，但公开 execution audit 显示模拟用户约 5.4 秒已提交合法回答，第二轮输入也已发出。timing 显示第二轮约 114 秒后被中断，合计恰好是默认 120 秒生成预算。回答存在并不代表整个 `reply` 已成功，必须同时核对 target Turn 与失败归属。

根因是 Session bridge 把回答生成的 deadline 继续传给下一轮 `sendEffect`，把被测 Agent 的执行超时包装成模拟用户失败。生成结束时解除专属计时器，续轮使用原 Session 与 Attempt 的期限，既保留 Agent 长任务能力，也保留生成超时及取消机制。

公开回归通过结构化 waiting 和普通消息两条路径验证：模型及时答复，Agent 的续轮超过模拟用户生成上限仍完成。真正不回答的模型仍须超时失败；增加模拟用户 timeout 只会掩盖归属错误。
