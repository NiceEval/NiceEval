# Scheduling

TLC reached 57 states and 64 steps. The chart draws 18 states and 18 arrows.
The chart does not draw 4 steps that stay in one chart state.
The step 取得实验名额 changes only one of Attempt 1 and Attempt 2 at a time.
The step 取得全局名额 changes only one of Attempt 1 and Attempt 2 at a time.
The step 归还全局名额，等待独占 Sandbox changes only one of Attempt 1 and Attempt 2 at a time.
The step 取得独占 Sandbox 名额 changes only one of Attempt 1 and Attempt 2 at a time.
The step 取回全局名额，开始发送 changes only one of Attempt 1 and Attempt 2 at a time.
The step 执行与收尾结束，归还名额 changes only one of Attempt 1 and Attempt 2 at a time.
The step 请求未被受理，归还全局名额并退避 changes only one of Attempt 1 and Attempt 2 at a time.
The step 退避到期 changes only one of Attempt 1 and Attempt 2 at a time.
The step 取回全局名额，重发原请求 changes only one of Attempt 1 and Attempt 2 at a time.

## Rules that hold
GlobalBound, ExperimentBound, LaneBound, NoDeadlock, Progress
