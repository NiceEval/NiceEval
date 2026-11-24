# Runs

TLC reached 18 states and 33 steps. The chart draws 10 states and 14 arrows.
The chart does not draw 15 steps that stay in one chart state.

## RecoveryEntryPreserved breaks
The shortest path has 3 steps:
0. 运行中，会话尚未收口
1. 准备结束运行: 运行准备收口，会话尚未收口
2. 提交运行终态: 运行已完成，会话仍在进行
3. 删除最后一个运行: 最后一个运行已删除，会话未收口

## AllSessionsClose breaks
TLC's counterexample is in tlc-AllSessionsClose.out. It has 4 steps:
0. 运行中，会话尚未收口
1. 准备结束运行: 运行准备收口，会话尚未收口
2. 提交运行终态: 运行已完成，会话仍在进行
3. 删除最后一个运行: 最后一个运行已删除，会话未收口
4. 原命令退出: 原命令已结束，会话无法恢复
The run stops in "原命令已结束，会话无法恢复" forever.

## Rules that hold
DurableCoverage, SessionLast, DeleteTerminal, NoLiveTakeover, NoDeadlock, TerminalStable
