# Replayable Grading 用例

本目录把 Replayable Eval 的核心契约放回真实作者流程验证：执行可以跨越多个 Turn、Session、HITL 和 Sandbox 操作，而评分仍然能从已封口 Execution graph 重新求值，不重跑 Agent。

- [多轮、HITL 与 Sandbox](multi-turn-hitl.md)：作者如何逐个绑定具名 Turn，并在多 Session 场景保留各自的局部顺序。
- [历史重评](historical-regrade.md)：当前 checkout 如何以新评分逻辑重评历史 execution，以及为什么历史模块不作可执行回退。
