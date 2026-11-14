# 模拟用户回答后的 Agent 续跑被生成期限中断

在 NiceEval-Eval 的六次 install Attempt 中，模拟用户已产生合法回答并发出第二轮输入，但续跑被报告为 simulated-user-failed: timeout。

公开证据：pnpm exec niceeval show @16EAGHWDC5DE1 --execution --expand ev_4a2b312c21c47eeeae26 显示模型约 5.4 秒提交回答；--timing 显示第二轮约 114 秒后失败，活动总计约 120 秒。预期回答后的 Agent 续跑遵守原 Session/Attempt 超时与错误归属，不消耗模拟用户生成期限。

影响 canary、v0.19.0、v0.20.0 两条安装题。宿主消费本地链接 NiceEval，Linux、Node 24、pnpm。观察来自用户提供运行定位符及公开 CLI，正文已脱敏。
