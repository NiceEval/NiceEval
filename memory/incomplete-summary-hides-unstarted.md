# INCOMPLETE 结论隐藏 unstarted

## 现象

2026-08-03 在 MemoryBench 的 `compare/codex` 运行中，Nowledge 共享服务探针触发
`dispatch-halted`。计划共 108 条，结论只列出 91 passed、9 failed、1 errored，标题为
`INCOMPLETE`；未派发的 7 条既没有数量，也没有身份词，操作者只能手算差值，并容易误以为
它们应当是没显示理由的 `skipped`。

## 根因

Runner 与 `assembleInvocationCompletion` 已经正确把止损闸拦下的数量记入
`InvocationCompletion.unstarted`，JSON 结果也会输出它；但 human summary 只渲染 verdict 与
reused 计数，没有消费 `completion.unstarted`。标题会因 completion 变成 `INCOMPLETE`，正文却
丢了导致 incomplete 的规模。

## 修法与范围

human renderer 在 `completion.unstarted > 0` 时选用带 `unstarted` 的结论行；数量保持
`unstarted` 身份，不改判为 `skipped`，因为这些 Attempt 从未执行、没有 Verdict。单元测覆盖
incomplete 且数量非零的结论行；完整终端字节另由 CLI E2E 负责。
