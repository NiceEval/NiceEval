# Replayable Grading 用例

本目录把 Replayable Eval 的核心契约放回真实作者流程验证：执行可以跨越多个 Turn、Session、HITL 和 Sandbox 操作，而评分仍然能从已封口 Execution graph 重新求值，不重跑 Agent。

- [多轮、HITL 与 Sandbox](multi-turn-hitl.md)：作者如何命名 Turn 和 Session，并在评分中选择完整会话、某个前缀或单轮 diff。
- [历史重评](historical-regrade.md)：当前 checkout 如何以新评分逻辑重评历史 execution，以及为什么历史模块不作可执行回退。
