# Recovery

TLC reached 77 states and 118 steps. The chart draws 9 states and 12 arrows.
The chart does not draw 10 steps that stay in one chart state.

## AfterFollowsRun breaks
The shortest path has 2 steps:
0. 原进程已停止，等待恢复
1. 确认原进程已停止，接手整组租约: 已接手租约，原 Run 仍显示运行中
2. 执行已登记的 after: after 已启动，原 Run 仍显示运行中

## RecoveryClosesRun breaks
The shortest path has 4 steps:
0. 原进程已停止，等待恢复
1. 确认原进程已停止，接手整组租约: 已接手租约，原 Run 仍显示运行中
2. 执行已登记的 after: after 已启动，原 Run 仍显示运行中
3. 确认 after 并移除对应登记: after 已确认，原 Run 仍显示运行中
4. 一次释放整组租约: 整组租约已释放，原 Run 仍显示运行中

## Rules that hold
WholeSetGeneration, RetirementIsAtomic, NoReplayAfterRetirement, NoDeadlock
