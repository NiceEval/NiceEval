# Budget warning 只能由真实 agent turn 触发

**现象（2026-07-15）**：一批带 budget 的 E2B attempt 因模板名不存在，全部在 `sandbox.create` 以 `404 template not found` 结束。agent 从未启动、usage/cost 理应不存在，但 runner 把这些前置错误也累计进“完成但无成本”的样本；第三条之后额外发出 `budget-unenforceable`，把排查方向从模板配置误导到 adapter 计费。

**结论**：`budget-unenforceable` 的证据不是“结果没有 `estimatedCostUSD`”，而是“attempt 已经实际发起 agent turn，结果仍没有 `estimatedCostUSD`”。`phases` 中的 `turn` timing node 是 runner 直接观察到的调用事实；`sandbox.create`、setup、eval 在首次 send 前的错误都没有这个事实，只保留结构化 attempt error。不能用 `verdict !== errored` 或 phase 排序近似，因为 agent 运行后仍可能 errored，而 `eval.run` 也可能在 send 前失败。

**修法落点**：`src/runner/run.ts` 的 budget 记账只累计带 `turn` timing node 的无成本结果；`src/runner/run.test.ts` 同时守住“模板 404 不报警”和“真实 turn 无成本仍报警”两侧边界。
